// ルートのテスト: Forge は fetch の偽物、ファイルを使う部品は一時フォルダ、ギャラリーと推奨は最小の偽物

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AppDeps, createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { TagDictionary } from "./dictionary.js";
import { ForgeClient, type Txt2ImgRequest } from "./forge.js";
import type { Gallery } from "./gallery.js";
import { JobManager } from "./jobs.js";
import { Launcher } from "./launcher.js";
import { PrefsStore } from "./prefs.js";
import type { RecommendStore } from "./recommend.js";
import { fakeForge, idleProgress, tinyPngBase64 } from "./testing/forge.js";
import { tempDir } from "./testing/tmp.js";
import { Wildcards } from "./wildcards.js";

let tmp: ReturnType<typeof tempDir>;
let forge: ReturnType<typeof fakeForge>;
let app: Awaited<ReturnType<typeof createApp>>;
let deps: AppDeps;
let models: string;
let recommend: { [K in "ensure" | "view" | "refresh"]: ReturnType<typeof vi.fn<RecommendStore[K]>> };
let gallery: { [K in "trashDir" | "countTaggedUsing" | "list"]: ReturnType<typeof vi.fn<Gallery[K]>> };

beforeEach(async () => {
  tmp = tempDir();
  models = join(tmp.dir, "models");
  mkdirSync(join(models, "Stable-diffusion"), { recursive: true });
  mkdirSync(join(models, "Lora", "style"), { recursive: true });
  // Illustrious の Checkpoint と、ベースモデル不明の Checkpoint
  writeFileSync(join(models, "Stable-diffusion", "illu.safetensors"), "");
  writeFileSync(join(models, "Stable-diffusion", "illu.cm-info.json"), JSON.stringify({ BaseModel: "Illustrious", ModelId: 1, VersionId: 2 }));
  writeFileSync(join(models, "Stable-diffusion", "anima.safetensors"), "");
  writeFileSync(join(models, "Stable-diffusion", "anima.cm-info.json"), JSON.stringify({ BaseModel: "Anima" }));
  writeFileSync(join(models, "Lora", "style", "ink.safetensors"), "");
  writeFileSync(join(models, "Lora", "style", "ink.cm-info.json"), JSON.stringify({ BaseModel: "Illustrious", TrainedWords: ["ink style"] }));

  forge = fakeForge({
    models: [
      { title: "illu.safetensors [aaaa1111]", model_name: "illu", filename: join(models, "Stable-diffusion", "illu.safetensors") },
      { title: "anima.safetensors [bbbb2222]", model_name: "anima", filename: join(models, "Stable-diffusion", "anima.safetensors") },
    ],
    loras: [{ name: "ink", alias: "ink-alias", path: join(models, "Lora", "style", "ink.safetensors") }],
    modules: [
      { model_name: "qwen_3_06b_base.safetensors", filename: join(models, "text_encoder", "qwen_3_06b_base.safetensors") },
      { model_name: "qwen_image_vae.safetensors", filename: join(models, "VAE", "qwen_image_vae.safetensors") },
    ],
    options: { sd_model_checkpoint: "illu.safetensors [aaaa1111]" },
  });

  const cfg = loadConfig(join(tmp.dir, "nope.json"), {});
  const client = new ForgeClient("http://forge.test");
  recommend = { ensure: vi.fn(), view: vi.fn(() => ({ status: "none", url: null, entry: null, error: null })), refresh: vi.fn() };
  gallery = { trashDir: vi.fn(async () => join(tmp.dir, "Trash")), countTaggedUsing: vi.fn(async () => 0), list: vi.fn() };
  const wildcardsDir = join(tmp.dir, "wildcards");
  mkdirSync(wildcardsDir);
  writeFileSync(join(wildcardsDir, "color.txt"), "red\nblue\n");
  const tagsDir = join(tmp.dir, "tags");
  mkdirSync(tagsDir);
  writeFileSync(join(tagsDir, "danbooru.csv"), '1girl,0,5000000,"1girls"\nblue_hair,0,1000000,\n');
  deps = {
    forge: client,
    jobs: new JobManager(client, cfg.dmd2Lora, join(tmp.dir, "last")),
    prefs: new PrefsStore(join(tmp.dir, "prefs.json")),
    recommend,
    gallery: gallery as unknown as Gallery,
    tags: new TagDictionary(tagsDir, "danbooru.csv", [], join(tmp.dir, "translations.csv")),
    wildcards: new Wildcards(wildcardsDir, () => gallery.trashDir()),
    launcher: new Launcher(null, "sd-forge-neo"),
  };
  app = await createApp(cfg, deps, { logger: false, dist: null });
});
afterEach(async () => {
  await app.close();
  forge.restore();
  tmp.remove();
});

const get = (url: string): Promise<LightMyRequestResponse> => app.inject({ method: "GET", url });
const post = (url: string, payload?: object): Promise<LightMyRequestResponse> => app.inject({ method: "POST", url, payload });
const put = (url: string, payload: object): Promise<LightMyRequestResponse> => app.inject({ method: "PUT", url, payload });

const generate = {
  checkpoint: "illu.safetensors [aaaa1111]",
  prompt: "1girl",
  negative: "",
  width: 832,
  height: 1216,
  steps: 20,
  cfg: 5,
  sampler: "Euler a",
  scheduler: "automatic",
  seed: -1,
  batch: 1,
};

const settle = () => vi.waitFor(() => expect(deps.jobs.current?.status).not.toBe("running"));

describe("健康状態と Forge の起動", () => {
  it("GET /api/health は SD-Ruiz 自体が動いていれば 200 で、Forge の状態を body で返す", async () => {
    const r = await get("/api/health");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, forge: { online: true, busy: false }, starting: false, launcher: false });
    forge.state.down = true;
    expect((await get("/api/health")).json().forge).toEqual({ online: false, reason: "unreachable" });
  });

  it("POST /api/forge/start: 動いていれば 409、LocalLauncher が無ければ 502", async () => {
    expect((await post("/api/forge/start")).statusCode).toBe(409);
    forge.state.down = true;
    const r = await post("/api/forge/start");
    expect(r.statusCode).toBe(502);
    expect(r.json().error).toContain("LocalLauncher");
  });

  it("GET /api/forge/diagnose は Forge の状態とログの取れなかった理由を返す", async () => {
    const r = await get("/api/forge/diagnose");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: { online: true }, sessions: [], warnings: [] });
    expect(r.json().logError).toContain("LocalLauncher");
  });

  it("知らない /api/* は 404、未処理のエラーは 500 (中身は出さない)", async () => {
    expect((await get("/api/nope")).statusCode).toBe(404);
    gallery.countTaggedUsing.mockRejectedValueOnce(new Error("secret detail"));
    const r = await get("/api/models/usage?kind=lora&id=ink");
    expect(r.statusCode).toBe(500);
    expect(r.json()).toEqual({ error: "内部エラー" });
  });
});

describe("モデルの一覧", () => {
  it("GET /api/meta: Checkpoint に付随ファイルのベースモデルと系統を付け、Sampler / Scheduler / DMD2 の設定を返す。推奨の取得を裏で始める", async () => {
    const r = await get("/api/meta");
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.current).toBe("illu.safetensors [aaaa1111]");
    expect(j.models).toEqual([
      expect.objectContaining({ title: "illu.safetensors [aaaa1111]", name: "illu", base: "Illustrious", family: "Illustrious", arch: "sdxl", preview: false }),
      expect.objectContaining({ title: "anima.safetensors [bbbb2222]", base: "Anima", family: "Anima", arch: "anima" }),
    ]);
    expect(j.samplers).toEqual(["Euler a", "DPM++ 2M", "LCM"]);
    expect(j.schedulers[0]).toEqual({ name: "automatic", label: "Automatic" });
    expect(j.dmd2).toMatchObject({ lora: "dmd2_sdxl_4step_lora_fp16", presets: { fast: { steps: 8 } } });
    expect(j.apgCfg).toBe(10);
    expect(recommend.ensure).toHaveBeenCalledWith([expect.objectContaining({ civitai: { modelId: 1, versionId: 2 } }), expect.objectContaining({ civitai: null })], expect.anything());
  });

  it("Forge が落ちていれば 502", async () => {
    forge.state.down = true;
    const r = await get("/api/meta");
    expect(r.statusCode).toBe(502);
    expect(r.json().error).toContain("Forge に接続できません");
  });

  it("GET /api/loras: models/Lora からの相対フォルダ・ベースモデル・トリガーワードを付けて名前順", async () => {
    const r = await get("/api/loras");
    expect(r.json().loras).toEqual([{ name: "ink", alias: "ink-alias", folder: "style", base: "Illustrious", family: "Illustrious", arch: "sdxl", trainedWords: ["ink style"], preview: false, mtime: expect.any(Number) }]);
  });

  it("GET /api/modules: TE / VAE の名前と、どのフォルダのものか", async () => {
    expect((await get("/api/modules")).json().modules).toEqual([
      { name: "qwen_3_06b_base.safetensors", folder: "text_encoder" },
      { name: "qwen_image_vae.safetensors", folder: "VAE" },
    ]);
  });

  it("POST /api/models/refresh は Forge に読み直してもらう (kind は checkpoint / lora だけ)", async () => {
    expect((await post("/api/models/refresh", { kind: "lora" })).json()).toEqual({ ok: true });
    expect(forge.callsTo("/sdapi/v1/refresh-loras")).toHaveLength(1);
    expect((await post("/api/models/refresh", { kind: "vae" })).statusCode).toBe(400);
  });

  it("GET /api/models/usage: 生成情報にそのモデルが使われているかを見る関数をギャラリーに渡す", async () => {
    expect((await get("/api/models/usage?kind=checkpoint&id=illu.safetensors%20%5Baaaa1111%5D")).json()).toEqual({ tagged: 0 });
    const used = gallery.countTaggedUsing.mock.calls[0][0] as (s: string) => boolean;
    expect(used("1girl\nSteps: 20, Model: illu, Seed: 1")).toBe(true);
    expect(used("Steps: 20, Model hash: aaaa1111, Seed: 1")).toBe(true);
    expect(used("Steps: 20, Model: illu2, Seed: 1")).toBe(false);

    await get("/api/models/usage?kind=lora&id=ink");
    const usedLora = gallery.countTaggedUsing.mock.calls[1][0] as (s: string) => boolean;
    expect(usedLora("1girl, <lora:ink:0.8>")).toBe(true);
    expect(usedLora('Lora hashes: "other: 1234, ink-alias: 5678"')).toBe(true);
    expect(usedLora("1girl, <lora:inkling:1>")).toBe(false);
    expect((await get("/api/models/usage?kind=lora")).statusCode).toBe(400);
  });

  it("POST /api/models/delete: 付随ファイルごとゴミ箱へ移し、設定から外し、Forge に読み直してもらう", async () => {
    await put("/api/prefs/favorite", { kind: "lora", id: "ink", on: true });
    const r = await post("/api/models/delete", { kind: "lora", id: "ink" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ files: 2 });
    expect(deps.prefs.value.favoriteLoras).toEqual([]);
    expect(forge.callsTo("/sdapi/v1/refresh-loras")).toHaveLength(1);
    expect((await post("/api/models/delete", { kind: "lora", id: "ink" })).statusCode).toBe(404);
  });
});

describe("プロンプト補完", () => {
  it("GET /api/tags は検索し、limit は 50 まで", async () => {
    expect((await get("/api/tags?q=1g")).json().tags[0]).toMatchObject({ name: "1girl" });
    expect((await get("/api/tags?q=")).json().tags).toEqual([]);
  });

  it("POST /api/tags/lookup と訳の編集", async () => {
    expect((await post("/api/tags/lookup", { names: ["1girls"] })).json().tags[0]).toMatchObject({ name: "1girl", alias: "1girls" });
    expect((await put("/api/tags/translation", { name: "blue_hair", text: "青髪" })).json().tag).toMatchObject({ translation: "青髪", edited: true });
    expect((await get("/api/tags/translations?edited=1")).json()).toEqual({ tags: [expect.objectContaining({ name: "blue_hair" })], total: 1 });
  });

  it("GET /api/tokenizer/merges は forgeDir が無ければ 404", async () => {
    expect((await get("/api/tokenizer/merges")).statusCode).toBe(404);
  });
});

describe("ワイルドカード", () => {
  it("一覧・読み込み・保存・名前変更・削除", async () => {
    expect((await get("/api/wildcards")).json()).toEqual({ wildcards: ["color"] });
    expect((await get("/api/wildcards/files")).json().files).toEqual([expect.objectContaining({ name: "color", entries: 2 })]);
    const file = (await get("/api/wildcards/file?name=color")).json();
    expect(file).toMatchObject({ name: "color", text: "red\nblue\n" });

    const saved = await put("/api/wildcards/file", { name: "color", text: "red\nblue\ngreen\n", mtime: file.mtime });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ name: "color", entries: 3 });
    expect((await put("/api/wildcards/file", { name: "color", text: "x", mtime: file.mtime })).statusCode).toBe(409);
    expect((await put("/api/wildcards/file", { name: "color", text: "x" })).statusCode).toBe(400);

    expect((await post("/api/wildcards/rename", { from: "color", to: "palette/color" })).json()).toEqual({ name: "palette/color" });
    expect((await get("/api/wildcards/file?name=color")).statusCode).toBe(404);
    expect((await post("/api/wildcards/delete", { name: "palette/color" })).json()).toEqual({ ok: true });
    expect((await get("/api/wildcards")).json()).toEqual({ wildcards: [] });
  });
});

describe("設定", () => {
  it("GET /api/prefs はベースモデルの既定 (組み込み + 自分で変えたもの) を bases にまとめる", async () => {
    const j = (await get("/api/prefs")).json();
    expect(j.bases.Anima).toMatchObject({ custom: { params: false, modules: false } });
    expect(j.bases.Anima.modules.length).toBeGreaterThan(0);
    const r = await put("/api/prefs/base", { family: "Pony", params: { width: 1024, height: 1024, steps: 20, cfg: 4, sampler: "Euler a", scheduler: "karras" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().bases.Pony).toMatchObject({ params: { width: 1024 }, modules: [], custom: { params: true, modules: false } });
    expect((await put("/api/prefs/base", { family: "Pony", params: { width: 1001, height: 1024, steps: 20, cfg: 4, sampler: "x", scheduler: "y" } })).statusCode).toBe(400);
    expect((await put("/api/prefs/base", { family: "" })).statusCode).toBe(400);
  });

  it("PUT /api/prefs/model と /api/prefs/favorite", async () => {
    expect((await put("/api/prefs/model", { id: "m", modules: ["te"] })).json().modelModules).toEqual({ m: ["te"] });
    expect((await put("/api/prefs/favorite", { kind: "checkpoint", id: "m", on: true })).json().favoriteCheckpoints).toEqual(["m"]);
    expect((await put("/api/prefs/favorite", { kind: "vae", id: "m", on: true })).statusCode).toBe(400);
  });
});

describe("生成", () => {
  it("POST /api/generate は Forge に txt2img を送り、ジョブの ID を返す。最近使ったモデルを覚える", async () => {
    const r = await post("/api/generate", generate);
    expect(r.statusCode).toBe(200);
    const { id } = r.json();
    expect(id).toEqual(expect.any(String));
    await settle();
    const req = forge.callsTo("/sdapi/v1/txt2img")[0].body as Txt2ImgRequest;
    expect(req.override_settings).toMatchObject({ sd_model_checkpoint: generate.checkpoint, forge_additional_modules: [] });
    expect(req.n_iter).toBe(1);
    expect(deps.prefs.value.recentCheckpoints).toEqual([generate.checkpoint]);

    const job = (await get("/api/job")).json();
    expect(job.job).toMatchObject({ id, status: "done", imageCount: 1, seeds: [1], prompts: ["x"], interrupted: false, error: null });
    expect(job.job.params).not.toHaveProperty("modules");
    expect(job.progress).toBeNull();
    expect(job.last.id).toBe(id);

    const png = await get(`/api/job/${id}/image/0`);
    expect(png.statusCode).toBe(200);
    expect(png.headers["content-type"]).toBe("image/png");
    expect(png.rawPayload.subarray(1, 4).toString()).toBe("PNG");
    expect((await get(`/api/job/${id}/image/1`)).statusCode).toBe(404);
  });

  it("生成中は Forge の進捗とプレビューを付け、もう 1 件は 409、中断は Forge に送る", async () => {
    let release!: () => void;
    forge.state.txt2img = () => new Promise((r) => (release = () => r({ images: [tinyPngBase64], info: "{}" })));
    forge.state.progress = { ...idleProgress, progress: 0.5, eta_relative: 3, state: { ...idleProgress.state, job_count: 1, sampling_step: 10, sampling_steps: 20 }, current_image: "AAAA" };
    expect((await post("/api/generate", generate)).statusCode).toBe(200);
    await vi.waitFor(() => expect(release).toBeDefined());
    const j = (await get("/api/job")).json();
    expect(j.job.status).toBe("running");
    expect(j.progress).toEqual({ ratio: 0.5, eta: 3, step: 10, steps: 20, preview: "data:image/png;base64,AAAA" });
    const busy = await post("/api/generate", generate);
    expect(busy.statusCode).toBe(409);
    expect(busy.json().error).toBe("生成中です");
    expect((await post("/api/models/delete", { kind: "lora", id: "ink" })).statusCode).toBe(409);
    expect((await post("/api/interrupt")).json()).toEqual({ ok: true });
    expect(forge.callsTo("/sdapi/v1/interrupt")).toHaveLength(1);
    release();
    await settle();
  });

  it("入力の検査 (スキーマ)", async () => {
    expect((await post("/api/generate", { ...generate, width: 830 })).statusCode).toBe(400);
    expect((await post("/api/generate", { ...generate, batch: 9 })).statusCode).toBe(400);
    expect((await post("/api/generate", { ...generate, dmd2: "turbo" })).statusCode).toBe(400);
    expect(forge.callsTo("/sdapi/v1/txt2img")).toHaveLength(0);
    // 知らない項目は捨てる (Fastify の既定)
    expect((await post("/api/generate", { ...generate, extra: 1 })).statusCode).toBe(200);
    await settle();
    expect(deps.jobs.current?.params).not.toHaveProperty("extra");
    expect(deps.jobs.current?.params).toMatchObject({ save: true, fast: false, dmd2: "off", pag: false, apg: false });
  });

  it("知らない Checkpoint は Forge に送らず 400 (Forge は黙っていま読み込んでいるモデルで生成するため)", async () => {
    const r = await post("/api/generate", { ...generate, checkpoint: "ghost.safetensors" });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toContain("Checkpoint が見つかりません");
    expect(forge.callsTo("/sdapi/v1/txt2img")).toHaveLength(0);
  });

  it("Anima は TE / VAE を Forge に渡し、Forge に無ければ 400", async () => {
    const anima = { ...generate, checkpoint: "anima.safetensors [bbbb2222]" };
    expect((await post("/api/generate", anima)).statusCode).toBe(200);
    await settle();
    const req = forge.callsTo("/sdapi/v1/txt2img")[0].body as Txt2ImgRequest;
    expect(req.override_settings.forge_additional_modules).toEqual(["qwen_3_06b_base.safetensors", "qwen_image_vae.safetensors"]);

    forge.state.modules = [];
    const r = await post("/api/generate", anima);
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toContain("Text Encoder / VAE が Forge にありません");

    await put("/api/prefs/base", { family: "Anima", modules: [] });
    expect((await post("/api/generate", anima)).json().error).toContain("Text Encoder と VAE を別に指定しないと使えません");
  });

  it("高速化 / DMD2 / PAG / APG は SDXL 系だけ。拡張や LoRA が無ければ分かる言葉で 400", async () => {
    const anima = { ...generate, checkpoint: "anima.safetensors [bbbb2222]" };
    expect((await post("/api/generate", { ...anima, fast: true })).json().error).toContain("SDXL 系のモデル");

    expect((await post("/api/generate", { ...generate, fast: true })).json().error).toContain("Spectrum (Ruiz)");
    expect((await post("/api/generate", { ...generate, pag: true })).json().error).toContain("Guidance (Ruiz)");
    expect((await post("/api/generate", { ...generate, dmd2: "fast" })).json().error).toContain("DMD2 の LoRA");

    forge.state.scripts = ["Spectrum (Ruiz)", "Guidance (Ruiz)"];
    forge.state.loras.push({ name: "dmd2_sdxl_4step_lora_fp16", alias: "dmd2", path: join(models, "Lora", "dmd2.safetensors") });
    expect((await post("/api/generate", { ...generate, fast: true, pag: true, apg: true })).statusCode).toBe(200);
    await settle();
    const req = forge.callsTo("/sdapi/v1/txt2img")[0].body as Txt2ImgRequest;
    expect(Object.keys(req.alwayson_scripts)).toEqual(["Spectrum (Ruiz)", "Guidance (Ruiz)"]);
    expect(req.cfg_scale).toBe(10);
    expect((await post("/api/generate", { ...generate, dmd2: "balanced" })).statusCode).toBe(200);
    await settle();
    expect((forge.callsTo("/sdapi/v1/txt2img")[1].body as Txt2ImgRequest).prompt).toContain("<lora:dmd2_sdxl_4step_lora_fp16:0.6>");
  });
});

describe("推奨設定", () => {
  it("GET /api/recommend は Checkpoint / LoRA の実ファイルを引いて推奨の取得を頼む。知らないものは none", async () => {
    expect((await get("/api/recommend?id=ink&kind=lora")).json()).toMatchObject({ status: "none", url: null, entry: null });
    expect(recommend.ensure).toHaveBeenCalledWith([expect.objectContaining({ file: join(models, "Lora", "style", "ink.safetensors") })], null, true);
    expect(recommend.view).toHaveBeenCalledTimes(1);
    expect((await get("/api/recommend?id=ghost")).json()).toEqual({ status: "none", url: null, entry: null });
    expect(recommend.view).toHaveBeenCalledTimes(1);
  });

  it("POST /api/recommend/refresh は Forge の Sampler / Scheduler の名前を添えて取り直す", async () => {
    await post("/api/recommend/refresh", { id: "illu.safetensors [aaaa1111]" });
    expect(recommend.refresh).toHaveBeenCalledWith(expect.objectContaining({ civitai: { modelId: 1, versionId: 2 } }), { samplers: ["Euler a", "DPM++ 2M", "LCM"], schedulers: expect.any(Array) });
    expect((await get("/api/recommend/image?f=../x")).statusCode).toBe(404);
  });
});

describe("ギャラリー (ルートからの受け渡し)", () => {
  it("GET /api/gallery は kind が要り、tag を数値 / none / any に直して渡す", async () => {
    gallery.list.mockResolvedValue({ files: [], next: null, total: 0 });
    expect((await get("/api/gallery")).statusCode).toBe(400);
    expect((await get("/api/gallery?kind=grid&offset=90&tag=3&q=%20cat%20")).json()).toEqual({ files: [], next: null, total: 0 });
    expect(gallery.list).toHaveBeenLastCalledWith({ kind: "grid", offset: 90, limit: 90, tag: 3, q: "cat" });
    await get("/api/gallery?kind=image&tag=none");
    expect(gallery.list).toHaveBeenLastCalledWith({ kind: "image", offset: 0, limit: 90, tag: "none", q: undefined });
  });
});
