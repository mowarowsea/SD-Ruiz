import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import fastifyCompress from "@fastify/compress";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import sharp from "sharp";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { TagDictionary } from "./dictionary.js";
import { analyze, currentWarnings, exitedSinceLastStart, windowsInfo } from "./forge-doctor.js";
import { ForgeClient, ForgeError } from "./forge.js";
import { Gallery, type Kind } from "./gallery.js";
import { type GenerateParams, type Job, JobBusyError, JobManager } from "./jobs.js";
import { archNeedsModules, archOf, builtinBaseSettings, familyOf } from "./base.js";
import { Launcher } from "./launcher.js";
import { moveModelToTrash, SidecarCache, thumbnail } from "./library.js";
import { type ModelParams, PrefsStore } from "./prefs.js";
import { RecommendStore } from "./recommend.js";
import { Wildcards } from "./wildcards.js";

const cfg = loadConfig();
const forge = new ForgeClient(cfg.forgeUrl);
const jobs = new JobManager(forge);
const prefs = new PrefsStore();
const recommend = new RecommendStore({ apiKey: cfg.groqApiKey, model: cfg.groqModel });
const gallery = new Gallery(cfg.forgeUrl, {
  gridFolders: cfg.gridFolders,
  imageFolders: cfg.imageFolders,
  iibDb: cfg.forgeDir && join(cfg.forgeDir, "extensions/sd-webui-infinite-image-browsing/iib.db"),
  trashDir: cfg.trashDir,
  savedDir: cfg.savedDir,
});
const tags = new TagDictionary(cfg.forgeDir && join(cfg.forgeDir, "extensions/a1111-sd-webui-tagcomplete/tags"), cfg.tagFile, cfg.translationFiles);
const wildcards = new Wildcards(cfg.forgeDir && join(cfg.forgeDir, "extensions/sd-dynamic-prompts/wildcards"), () => gallery.trashDir());
const launcher = new Launcher(cfg.launcherUrl?.replace(/\/+$/, "") ?? null, cfg.launcherServiceId);
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
server.get("/api/health", async () => {
  const status = await forge.status();
  return { ok: true, forge: status, starting: await isStarting(status.online), launcher: !!launcher.baseUrl };
});

// ---- Forge の起動と診断 ----

// 起動を頼んでから応答するまで 1〜2 分かかる。その間に二重に起動しないよう覚えておく
let startRequestedAt = 0;
const startTimeout = 4 * 60_000;

/** 起動を頼んで、まだ応答も終了もしていない。起動中に落ちたらログの pause で気づいて解除する */
async function isStarting(online: boolean) {
  if (online) startRequestedAt = 0;
  if (Date.now() - startRequestedAt >= startTimeout) return false;
  if (exitedSinceLastStart(await launcher.log(200).catch(() => ""))) startRequestedAt = 0;
  return startRequestedAt !== 0;
}

server.post("/api/forge/start", async (_req, reply) => {
  const { online } = await forge.status();
  if (online) return reply.code(409).send({ error: "Forge はもう動いています" });
  if (await isStarting(online)) return reply.code(409).send({ error: "起動中です。少し待ってください" });
  const r = await launcher.start();
  startRequestedAt = Date.now();
  return r;
});

server.post("/api/forge/restart", async (_req, reply) => {
  if (jobs.current?.status === "running") return reply.code(409).send({ error: "生成中です。終わってから再起動してください" });
  const r = await launcher.restart();
  startRequestedAt = Date.now();
  return r;
});

// LocalLauncher のログを起動ごとに分け、どう終わったか・原因の見当を返す
server.get("/api/forge/diagnose", async () => {
  const [status, log, win] = await Promise.all([forge.status(), launcher.log().catch((e: Error) => e), windowsInfo(Number(new URL(cfg.forgeUrl).port || 80))]);
  return {
    status,
    logError: log instanceof Error ? log.message : null,
    sessions: log instanceof Error ? [] : analyze(log, status.online, win.events),
    memory: win.memory,
    warnings: currentWarnings(win.memory),
  };
});

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
  // まだ推奨設定を取っていないモデルがあれば、裏で取りにいく
  recommend.ensure(
    models.map((m) => ({ file: m.filename, civitai: sidecars.get(m.filename).civitai })),
    { samplers: samplers.map((s) => s.name), schedulers: schedulers.map((s) => ({ name: s.name, label: s.label })) },
  );
  return {
    current,
    models: models.map((m) => {
      const sc = sidecars.get(m.filename);
      const family = familyOf(sc.base);
      return { title: m.title, name: m.model_name, base: sc.base, family, arch: archOf(family), preview: !!sc.preview, mtime: sc.mtime };
    }),
    samplers: samplers.map((s) => s.name),
    schedulers: schedulers.map((s) => ({ name: s.name, label: s.label })),
  };
});

// モデルの推奨設定と作例 (status は RecommendStore.view)
async function modelRef(checkpoint: string) {
  if (!checkpointPaths.has(checkpoint)) await fetchModels();
  const file = checkpointPaths.get(checkpoint);
  return file ? { file, civitai: sidecars.get(file).civitai } : null;
}

server.get<{ Querystring: { id?: string } }>("/api/recommend", async (req) => {
  const ref = await modelRef(req.query.id ?? "");
  return ref ? recommend.view(ref) : { status: "none", url: null, entry: null };
});

server.post<{ Body: { id?: string } }>("/api/recommend/refresh", async (req) => {
  const ref = await modelRef(req.body.id ?? "");
  if (!ref) return { status: "none", url: null, entry: null };
  const [samplers, schedulers] = await Promise.all([forge.samplers(), forge.schedulers()]);
  recommend.refresh(ref, { samplers: samplers.map((s) => s.name), schedulers: schedulers.map((s) => ({ name: s.name, label: s.label })) });
  return recommend.view(ref);
});

// プロンプト補完: タグは件数が多いのでサーバー側で検索する
server.get<{ Querystring: { q?: string; limit?: string } }>("/api/tags", async (req) => ({
  tags: tags.search(req.query.q ?? "", Math.min(Number(req.query.limit) || 20, 50)),
}));

// プロンプトに書いた語の訳 (補完の窓で範囲選択したときに出す)
server.post<{ Body: { names?: string[] } }>("/api/tags/lookup", async (req) => ({ tags: tags.lookup((req.body.names ?? []).slice(0, 200)) }));

// 訳の一覧と編集 (自分で直した訳は data/translations.csv)
server.get<{ Querystring: { q?: string; edited?: string } }>("/api/tags/translations", async (req) => ({
  tags: tags.translations(req.query.q ?? "", req.query.edited === "1"),
  total: tags.translationCount,
}));
server.put<{ Body: { name?: string; text?: string } }>("/api/tags/translation", async (req) => ({ tag: tags.setTranslation(req.body.name ?? "", req.body.text ?? "") }));

// トークン数を数えるための CLIP の BPE (SDXL の CLIP-L と同じもの)。数えるのはフロント側
const mergesFile = cfg.forgeDir && join(cfg.forgeDir, "backend/huggingface/stabilityai/stable-diffusion-xl-base-1.0/tokenizer/merges.txt");
server.get("/api/tokenizer/merges", async (_req, reply) => {
  if (!mergesFile || !existsSync(mergesFile)) return reply.code(404).send({ error: "CLIP の merges.txt が見つかりません" });
  return reply.type("text/plain; charset=utf-8").header("cache-control", "max-age=86400").send(await readFile(mergesFile, "utf8"));
});

// ワイルドカードと LoRA は数が少ないので一覧を返してフロントで絞り込む
server.get("/api/wildcards", async () => ({ wildcards: (await wildcards.list()).map((w) => w.name) }));

// ---- ワイルドカードの編集 ----

server.get("/api/wildcards/files", async () => ({ files: await wildcards.list() }));

server.get<{ Querystring: { name: string } }>("/api/wildcards/file", async (req) => wildcards.read(req.query.name ?? ""));

server.put<{ Body: { name: string; text: string; mtime: number | null } }>(
  "/api/wildcards/file",
  { schema: { body: { type: "object", required: ["name", "text", "mtime"], properties: { name: { type: "string" }, text: { type: "string" }, mtime: { type: ["number", "null"] } } } } },
  async (req) => wildcards.write(req.body.name, req.body.text, req.body.mtime),
);

server.post<{ Body: { from: string; to: string } }>(
  "/api/wildcards/rename",
  { schema: { body: { type: "object", required: ["from", "to"], properties: { from: { type: "string" }, to: { type: "string" } } } } },
  async (req) => wildcards.rename(req.body.from, req.body.to),
);

server.post<{ Body: { name: string } }>(
  "/api/wildcards/delete",
  { schema: { body: { type: "object", required: ["name"], properties: { name: { type: "string" } } } } },
  async (req) => wildcards.remove(req.body.name),
);

server.get("/api/loras", async () => {
  const loras = await fetchLoras();
  const root = /[\\/]models[\\/]Lora[\\/]/i;
  return {
    loras: loras
      .map((l) => {
        const rel = l.path.split(root).pop() ?? l.name;
        const sc = sidecars.get(l.path);
        const family = familyOf(sc.base);
        return { name: l.name, alias: l.alias, folder: rel.split(/[\\/]/).slice(0, -1).join("/"), base: sc.base, family, arch: archOf(family), trainedWords: sc.trainedWords, preview: !!sc.preview, mtime: sc.mtime };
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

// Checkpoint / LoRA の削除: 付随ファイルごとゴミ箱フォルダの models/ へ移し、Forge に一覧を読み直してもらう
server.post<{ Body: { kind: "checkpoint" | "lora"; id: string } }>(
  "/api/models/delete",
  { schema: { body: { type: "object", required: ["kind", "id"], properties: { kind: { enum: ["checkpoint", "lora"] }, id: { type: "string" } } } } },
  async (req, reply) => {
    const { kind, id } = req.body;
    if (jobs.current?.status === "running") return reply.code(409).send({ error: "生成中です。終わってから消してください" });
    const paths = kind === "checkpoint" ? checkpointPaths : loraPaths;
    if (!paths.size) await (kind === "checkpoint" ? fetchModels() : fetchLoras());
    const file = paths.get(id);
    if (!file || !existsSync(file)) return reply.code(404).send({ error: `見つかりません: ${id}` });
    const dest = join(await gallery.trashDir(), "models", kind === "checkpoint" ? "Stable-diffusion" : "Lora");
    let r;
    try {
      r = await moveModelToTrash(file, dest);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      return reply.code(409).send({ error: code === "EBUSY" || code === "EPERM" ? "ファイルが使用中で動かせません (Forge が読み込んでいる可能性があります)" : (e as Error).message });
    }
    paths.delete(id);
    sidecars.clear();
    prefs.forget(kind, id);
    await (kind === "checkpoint" ? forge.refreshCheckpoints() : forge.refreshLoras()).catch((e) => server.log.warn(e));
    return r;
  },
);

// ---- ギャラリー ----

const kindSchema = { type: "string", enum: ["grid", "image"] };

server.get<{ Querystring: { kind: Kind; offset?: number; tag?: string; q?: string } }>(
  "/api/gallery",
  { schema: { querystring: { type: "object", required: ["kind"], properties: { kind: kindSchema, offset: { type: "integer", minimum: 0 }, tag: { type: "string" }, q: { type: "string" } } } } },
  async (req) => {
    const { kind, offset = 0, tag, q } = req.query;
    return gallery.list({ kind, offset, limit: 90, tag: tag === "none" || tag === "any" ? tag : tag ? Number(tag) : undefined, q: q?.trim() || undefined });
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
  const tagged = await gallery.taggedInOutput();
  return { grids: t.grids.length, images: t.images.length, bytes: t.bytes, keptGrids: t.keptGrids, keptImages: t.keptImages, taggedGrids: tagged.grids.length, taggedImages: tagged.images.length };
});

// 出力フォルダに残っているタグ付き (保管庫を使う前に IIB で付けた分) を保管庫へ
server.post("/api/cleanup/migrate-tagged", async () => gallery.migrateTagged());

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

// 端末をまたいで共有する設定。bases はベースモデルごとの既定 (組み込みか自分で変えたものがあるものだけ。無いものは params: null, modules: [])
function prefsView() {
  const p = prefs.value;
  const families = new Set([...Object.keys(builtinBaseSettings), ...Object.keys(p.baseSettings)]);
  const bases = Object.fromEntries(
    [...families].map((f) => [f, { ...prefs.baseSettings(f), custom: { params: p.baseSettings[f]?.params !== undefined, modules: p.baseSettings[f]?.modules !== undefined } }]),
  );
  return { ...p, bases };
}

server.get("/api/prefs", async () => prefsView());

// TE / VAE に選べるファイル。folder は "VAE" / "text_encoder" など
server.get("/api/modules", async () => ({
  modules: (await forge.modules())
    .map((m) => ({ name: m.model_name, folder: m.filename.split(/[\\/]/).slice(-2, -1)[0] ?? "" }))
    .sort((a, b) => a.name.localeCompare(b.name)),
}));

const modelParamsSchema = {
  type: ["object", "null"],
  required: ["width", "height", "steps", "cfg", "sampler", "scheduler"],
  properties: {
    width: { type: "integer", minimum: 64, maximum: 4096, multipleOf: 8 },
    height: { type: "integer", minimum: 64, maximum: 4096, multipleOf: 8 },
    steps: { type: "integer", minimum: 1, maximum: 150 },
    cfg: { type: "number", minimum: 0, maximum: 30 },
    sampler: { type: "string" },
    scheduler: { type: "string" },
  },
};
const modulesSchema = { type: ["array", "null"], items: { type: "string" } };

// ベースモデルの既定を変える (null の項目は組み込みの既定に戻す)
server.put<{ Body: { family: string; params?: ModelParams | null; modules?: string[] | null } }>(
  "/api/prefs/base",
  { schema: { body: { type: "object", required: ["family"], properties: { family: { type: "string", minLength: 1 }, params: modelParamsSchema, modules: modulesSchema } } } },
  async (req) => {
    const { family, ...patch } = req.body;
    prefs.setBase(family, patch);
    return prefsView();
  },
);

// モデルごとの設定を変える (null の項目は消してベースモデルの既定に戻す)
server.put<{ Body: { id: string; params?: null; modules?: string[] | null } }>(
  "/api/prefs/model",
  { schema: { body: { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 }, params: { type: "null" }, modules: modulesSchema } } } },
  async (req) => {
    const { id, ...patch } = req.body;
    prefs.setModel(id, patch);
    return prefsView();
  },
);

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
    return prefsView();
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

/** 設定が足りなくて生成できないとき (400 で返す) */
class SetupError extends Error {
  readonly statusCode = 400;
}

/**
 * このモデルで使う TE / VAE を決め、Forge にあるか確かめる。
 * Forge は見つからないファイル名を黙って捨て、TE が無いまま読み込もうとして分かりにくい落ち方をするので、先に止める
 */
async function resolveModules(checkpoint: string): Promise<string[]> {
  if (!checkpointPaths.has(checkpoint)) await fetchModels();
  const file = checkpointPaths.get(checkpoint);
  // 知らない名前だと Forge は黙っていま読み込んでいるモデルで生成するので、ここで止める
  if (!file) throw new SetupError(`Checkpoint が見つかりません: ${checkpoint}`);
  const family = familyOf(sidecars.get(file).base);
  const modules = prefs.modulesFor(checkpoint, family);
  const label = family ?? "このモデル";
  if (!modules.length) {
    if (archNeedsModules.has(archOf(family) ?? "")) throw new SetupError(`${label} は Text Encoder と VAE を別に指定しないと使えません。Extras の「モデルの設定」で選んでください`);
    return [];
  }
  const have = new Set((await forge.modules()).map((m) => m.model_name));
  const missing = modules.filter((m) => !have.has(m));
  if (missing.length)
    throw new SetupError(
      `${label} に使う Text Encoder / VAE が Forge にありません: ${missing.join(", ")}。` +
        "models/text_encoder か models/VAE に置いて Forge を再起動するか (Forge は起動したときにしか一覧を読みません)、Extras の「モデルの設定」で選び直してください",
    );
  return modules;
}

server.post<{ Body: GenerateParams }>("/api/generate", { schema: generateSchema }, async (req) => {
  const job = jobs.start(req.body, await resolveModules(req.body.checkpoint));
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
  if (job.status !== "running") {
    // 画面がすぐ取りに来るので、表示用の WebP を先に作り始めておく
    for (const img of jobs.last?.images ?? []) void viewImage(img).catch(() => {});
    return { job: jobView(job), progress: null, last };
  }
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

// 生成画面とビューアで見る用の軽い WebP (PNG の原寸は 1 枚 2MB 近くあり、スマホの回線だと読み込みの間ほかの通信が詰まるため)。
// 品質 92 で 150KB 前後。PSNR 42dB ほどで、画面のサイズではまず見分けがつかない
const viewImages = new WeakMap<Buffer, Promise<Buffer>>();
function viewImage(png: Buffer) {
  let p = viewImages.get(png);
  if (!p) viewImages.set(png, (p = sharp(png).webp({ quality: 92 }).toBuffer()));
  return p;
}

server.get<{ Params: { id: string; index: string }; Querystring: { view?: string } }>("/api/job/:id/image/:index", async (req, reply) => {
  const image = jobs.find(req.params.id)?.images[Number(req.params.index)];
  if (!image) return reply.code(404).send({ error: "画像がありません" });
  if (req.query.view) return reply.type("image/webp").header("cache-control", "private, max-age=86400").send(await viewImage(image));
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
server.log.info(cfg.forgeDir ? `タグ ${tags.size} 件・訳 ${tags.translationCount} 件を読み込みました` : "forgeDir が未設定なのでタグ補完は無効です");
