import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fastifyCompress from "@fastify/compress";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { TagDictionary, listWildcards } from "./dictionary.js";
import { ForgeClient, ForgeError } from "./forge.js";
import { type GenerateParams, type Job, JobBusyError, JobManager } from "./jobs.js";

const cfg = loadConfig();
const forge = new ForgeClient(cfg.forgeUrl);
const jobs = new JobManager(forge);
const tags = new TagDictionary(cfg.forgeDir && join(cfg.forgeDir, "extensions/a1111-sd-webui-tagcomplete/tags"), cfg.tagFile, cfg.translationFile);
const wildcardsDir = cfg.forgeDir && join(cfg.forgeDir, "extensions/sd-dynamic-prompts/wildcards");
const server = Fastify({ logger: { level: "info" }, bodyLimit: 1024 * 1024 });

// Tailscale 越しのスマホ向けに JS やタグ候補を圧縮して返す (画像は対象外)
await server.register(fastifyCompress, { threshold: 1024, customTypes: /^(text\/|application\/(json|javascript))/ });

server.setErrorHandler((err, _req, reply) => {
  if (err instanceof ForgeError) return reply.code(502).send({ error: err.message });
  if (err instanceof JobBusyError) return reply.code(409).send({ error: err.message });
  // バリデーションエラーや不正な JSON など、Fastify が 4xx と判定したもの
  const status = (err as { statusCode?: number }).statusCode;
  if (status && status >= 400 && status < 500) return reply.code(status).send({ error: (err as Error).message });
  server.log.error(err);
  return reply.code(500).send({ error: "内部エラー" });
});

// LocalLauncher のヘルスチェック用。SD-Ruiz 自体が動いていれば 200 (Forge の状態は body で返す)
server.get("/api/health", async () => ({ ok: true, forge: await forge.status() }));

// 生成画面の選択肢 (Checkpoint / Sampler / Scheduler) をまとめて返す
server.get("/api/meta", async () => {
  const [models, current, samplers, schedulers] = await Promise.all([forge.models(), forge.currentCheckpoint(), forge.samplers(), forge.schedulers()]);
  return {
    current,
    models: models.map((m) => ({ title: m.title, name: m.model_name, filename: m.filename })),
    samplers: samplers.map((s) => s.name),
    schedulers: schedulers.map((s) => ({ name: s.name, label: s.label })),
  };
});

// プロンプト補完: タグは件数が多いのでサーバー側で検索する
server.get<{ Querystring: { q?: string; limit?: string } }>("/api/tags", async (req) => ({
  tags: tags.search(req.query.q ?? "", Math.min(Number(req.query.limit) || 20, 50)),
}));

// ワイルドカードと LoRA は数が少ないので一覧を返してフロントで絞り込む
server.get("/api/wildcards", async () => ({ wildcards: await listWildcards(wildcardsDir) }));

server.get("/api/loras", async () => {
  const loras = await forge.loras();
  const root = /[\\/]models[\\/]Lora[\\/]/i;
  return {
    loras: loras
      .map((l) => {
        const rel = l.path.split(root).pop() ?? l.name;
        return { name: l.name, alias: l.alias, folder: rel.split(/[\\/]/).slice(0, -1).join("/") };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
});

const generateSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["checkpoint", "prompt", "negative", "width", "height", "steps", "cfg", "sampler", "scheduler", "seed", "batch"],
    properties: {
      checkpoint: { type: "string", minLength: 1 },
      prompt: { type: "string" },
      negative: { type: "string" },
      width: { type: "integer", minimum: 64, maximum: 4096, multipleOf: 8 },
      height: { type: "integer", minimum: 64, maximum: 4096, multipleOf: 8 },
      steps: { type: "integer", minimum: 1, maximum: 150 },
      cfg: { type: "number", minimum: 0, maximum: 30 },
      sampler: { type: "string" },
      scheduler: { type: "string" },
      seed: { type: "integer", minimum: -1 },
      batch: { type: "integer", minimum: 1, maximum: 8 },
      save: { type: "boolean", default: true },
    },
  },
};

server.post<{ Body: GenerateParams }>("/api/generate", { schema: generateSchema }, async (req) => {
  const job = jobs.start(req.body);
  return { id: job.id };
});

server.post("/api/interrupt", async () => {
  await jobs.interrupt();
  return { ok: true };
});

function jobView(job: Job) {
  return {
    id: job.id,
    status: job.status,
    params: job.params,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt ?? null,
    imageCount: job.images.length,
    seeds: job.seeds,
    prompts: job.prompts,
    interrupted: job.interrupted,
    error: job.error ?? null,
  };
}

// 直近のジョブの状態。生成中なら Forge の進捗とライブプレビューも付ける
server.get("/api/job", async () => {
  const job = jobs.current;
  if (!job) return { job: null, progress: null };
  if (job.status !== "running") return { job: jobView(job), progress: null };
  const p = await forge.progress(true).catch(() => null);
  return {
    job: jobView(job),
    progress: p && {
      ratio: p.progress,
      eta: p.eta_relative,
      step: p.state.sampling_step,
      steps: p.state.sampling_steps,
      preview: p.current_image ? `data:image/png;base64,${p.current_image}` : null,
    },
  };
});

server.get<{ Params: { id: string; index: string } }>("/api/job/:id/image/:index", async (req, reply) => {
  const job = jobs.current;
  const image = job?.id === req.params.id ? job.images[Number(req.params.index)] : undefined;
  if (!image) return reply.code(404).send({ error: "画像がありません" });
  return reply.type("image/png").header("cache-control", "private, max-age=86400").send(image);
});

// 本番はビルド済みフロントを配信する (開発時は Vite dev server が /api をここへプロキシする)
const dist = fileURLToPath(new URL("../web/dist", import.meta.url));
if (existsSync(dist)) {
  await server.register(fastifyStatic, { root: dist });
  server.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "not found" });
    return reply.sendFile("index.html");
  });
}

await server.listen({ port: cfg.port, host: cfg.host });
server.log.info(`Forge: ${cfg.forgeUrl}`);
server.log.info(cfg.forgeDir ? `タグ ${tags.size} 件を読み込みました` : "forgeDir が未設定なのでタグ補完は無効です");
