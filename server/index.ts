import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fastifyCompress from "@fastify/compress";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { TagDictionary, listWildcards } from "./dictionary.js";
import { ForgeClient, ForgeError } from "./forge.js";
import { Gallery, type Kind } from "./gallery.js";
import { type GenerateParams, type Job, JobBusyError, JobManager } from "./jobs.js";
import { SidecarCache, thumbnail } from "./library.js";
import { PrefsStore } from "./prefs.js";

const cfg = loadConfig();
const forge = new ForgeClient(cfg.forgeUrl);
const jobs = new JobManager(forge);
const prefs = new PrefsStore();
const gallery = new Gallery(cfg.forgeUrl, {
  gridFolders: cfg.gridFolders,
  imageFolders: cfg.imageFolders,
  iibDb: cfg.forgeDir && join(cfg.forgeDir, "extensions/sd-webui-infinite-image-browsing/iib.db"),
  trashDir: cfg.trashDir,
  savedDir: cfg.savedDir,
});
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

// Checkpoint / LoRA の実ファイルの場所 (サムネイルを引くのに使う)。一覧を取るたびに更新する
const checkpointPaths = new Map<string, string>();
const loraPaths = new Map<string, string>();
const sidecars = new SidecarCache();

async function fetchModels() {
  const models = await forge.models();
  checkpointPaths.clear();
  for (const m of models) checkpointPaths.set(m.title, m.filename);
  return models;
}

async function fetchLoras() {
  const loras = await forge.loras();
  loraPaths.clear();
  for (const l of loras) loraPaths.set(l.name, l.path);
  return loras;
}

// 生成画面の選択肢 (Checkpoint / Sampler / Scheduler) をまとめて返す
server.get("/api/meta", async () => {
  sidecars.clear();
  const [models, current, samplers, schedulers] = await Promise.all([fetchModels(), forge.currentCheckpoint(), forge.samplers(), forge.schedulers()]);
  return {
    current,
    models: models.map((m) => {
      const sc = sidecars.get(m.filename);
      return { title: m.title, name: m.model_name, base: sc.base, preview: !!sc.preview };
    }),
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
  const loras = await fetchLoras();
  const root = /[\\/]models[\\/]Lora[\\/]/i;
  return {
    loras: loras
      .map((l) => {
        const rel = l.path.split(root).pop() ?? l.name;
        const sc = sidecars.get(l.path);
        return { name: l.name, alias: l.alias, folder: rel.split(/[\\/]/).slice(0, -1).join("/"), base: sc.base, trainedWords: sc.trainedWords, preview: !!sc.preview };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
});

// プレビュー画像の縮小版
server.get<{ Params: { kind: string }; Querystring: { id: string } }>("/api/thumb/:kind", async (req, reply) => {
  const { kind } = req.params;
  if (kind !== "checkpoint" && kind !== "lora") return reply.code(404).send({ error: "not found" });
  const paths = kind === "checkpoint" ? checkpointPaths : loraPaths;
  if (!paths.size) await (kind === "checkpoint" ? fetchModels() : fetchLoras());
  const file = paths.get(req.query.id);
  const preview = file && sidecars.get(file).preview;
  if (!preview) return reply.code(404).send({ error: "プレビューがありません" });
  return reply.type("image/webp").header("cache-control", "private, max-age=604800").send(await thumbnail(preview));
});

// ---- ギャラリー ----

const kindSchema = { type: "string", enum: ["grid", "image"] };

server.get<{ Querystring: { kind: Kind; offset?: number; tag?: string; q?: string } }>(
  "/api/gallery",
  { schema: { querystring: { type: "object", required: ["kind"], properties: { kind: kindSchema, offset: { type: "integer", minimum: 0 }, tag: { type: "string" }, q: { type: "string" } } } } },
  async (req) => {
    const { kind, offset = 0, tag, q } = req.query;
    return gallery.list({ kind, offset, limit: 90, tag: tag === "none" ? "none" : tag ? Number(tag) : undefined, q: q?.trim() || undefined });
  },
);

server.get("/api/gallery/tags", async () => ({ tags: gallery.customTags() }));

server.get<{ Querystring: { path: string; kind: Kind } }>("/api/gallery/info", async (req) => gallery.info(req.query.path));

const pathKindBody = { type: "object", required: ["path", "kind"], properties: { path: { type: "string" }, kind: kindSchema } };

server.post<{ Body: { path: string; kind: Kind; tagId: number } }>(
  "/api/gallery/tag",
  { schema: { body: { ...pathKindBody, required: ["path", "kind", "tagId"], properties: { ...pathKindBody.properties, tagId: { type: "integer" } } } } },
  async (req) => gallery.toggleTag(req.body.path, req.body.tagId),
);

server.post<{ Body: { path: string; kind: Kind } }>("/api/gallery/delete", { schema: { body: pathKindBody } }, async (req) => gallery.remove(req.body.path));

// 整理: タグの付いていないものをゴミ箱フォルダへ
const cleanupBody = { type: "object", required: ["keepSince"], properties: { keepSince: { type: "number" } } };

server.post<{ Body: { keepSince: number } }>("/api/cleanup/preview", { schema: { body: cleanupBody } }, async (req) => {
  const t = await gallery.cleanupTargets(req.body.keepSince);
  const liked = await gallery.likedInOutput();
  return { grids: t.grids.length, images: t.images.length, bytes: t.bytes, keptGrids: t.keptGrids, keptImages: t.keptImages, likedGrids: liked.grids.length, likedImages: liked.images.length };
});

// 出力フォルダに残っている Like 付き (IIB のタグで Like していた分) を保管庫へ
server.post("/api/cleanup/migrate-liked", async () => gallery.migrateLiked());

server.post<{ Body: { keepSince: number } }>("/api/cleanup/run", { schema: { body: cleanupBody } }, async (req) => gallery.cleanup(req.body.keepSince));

server.get("/api/trash", async () => gallery.trashInfo());

server.post("/api/trash/empty", async () => {
  await gallery.emptyTrash();
  return { ok: true };
});

server.get<{ Params: { kind: string }; Querystring: { path: string; t: string } }>("/api/gallery/image/:kind", async (req, reply) => {
  if (req.params.kind !== "thumb" && req.params.kind !== "file") return reply.code(404).send({ error: "not found" });
  const res = await gallery.fetchImage(req.query.path, req.query.t ?? "", req.params.kind === "thumb");
  if (!res.ok) return reply.code(res.status).send({ error: `IIB が ${res.status} を返しました` });
  return reply
    .type(res.headers.get("content-type") ?? "application/octet-stream")
    .header("cache-control", "private, max-age=31536000, immutable")
    .send(Buffer.from(await res.arrayBuffer()));
});

// 端末をまたいで共有する設定
server.get("/api/prefs", async () => prefs.value);

server.put<{ Body: { kind: "checkpoint" | "lora"; id: string; on: boolean } }>(
  "/api/prefs/favorite",
  {
    schema: {
      body: {
        type: "object",
        required: ["kind", "id", "on"],
        properties: { kind: { enum: ["checkpoint", "lora"] }, id: { type: "string" }, on: { type: "boolean" } },
      },
    },
  },
  async (req) => {
    prefs.setFavorite(req.body.kind, req.body.id, req.body.on);
    return prefs.value;
  },
);

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
  prefs.recordGenerate(req.body);
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

// 直近のジョブの状態と、最後に成功したジョブ。生成中なら Forge の進捗とライブプレビューも付ける
server.get("/api/job", async () => {
  const job = jobs.current;
  const last = jobs.last && jobView(jobs.last);
  if (!job) return { job: null, progress: null, last };
  if (job.status !== "running") return { job: jobView(job), progress: null, last };
  const p = await forge.progress(true).catch(() => null);
  return {
    job: jobView(job),
    last,
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
  const image = jobs.find(req.params.id)?.images[Number(req.params.index)];
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
