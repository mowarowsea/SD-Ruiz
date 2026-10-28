import { beforeEach, describe, expect, test, vi } from "vitest";

// data/prefs.json は本物に触らず、メモリ上に持つ
const mem = await vi.hoisted(async () => (await import("./test-fs.js")).memoryFs((p) => /[\\/]data[\\/]prefs\.json$/.test(p) || /[\\/]data$/.test(p)));
vi.mock("node:fs", async (orig) => mem.fake(await orig()));

import { PrefsStore } from "./prefs.js";

const prefsPath = () => [...mem.files.keys()].find((k) => k.endsWith("prefs.json"))!;
const params = { width: 832, height: 1216, steps: 28, cfg: 5, sampler: "Euler a", scheduler: "automatic" };
const gen = (checkpoint: string) => ({ checkpoint, prompt: "", negative: "", seed: -1, batch: 1, save: true, fast: false, dmd2: "off" as const, pag: false, apg: false, ...params });

beforeEach(() => mem.reset());

describe("PrefsStore", () => {
  test("ファイルが無ければ空から始まり、変えるたびに保存する", () => {
    const s = new PrefsStore();
    expect(s.value).toEqual({ favoriteCheckpoints: [], favoriteLoras: [], recentCheckpoints: [], modelParams: {}, modelModules: {}, baseSettings: {} });
    s.setFavorite("checkpoint", "a", true);
    expect(mem.json<{ favoriteCheckpoints: string[] }>(prefsPath()).favoriteCheckpoints).toEqual(["a"]);
  });

  test("古い prefs.json に無い項目は空で補う", () => {
    mem.files.set(new URL("../data/prefs.json", import.meta.url).pathname, Buffer.from(JSON.stringify({ favoriteCheckpoints: ["a"] })));
    const s = new PrefsStore();
    expect(s.value).toEqual({ favoriteCheckpoints: ["a"], favoriteLoras: [], recentCheckpoints: [], modelParams: {}, modelModules: {}, baseSettings: {} });
  });

  test("お気に入りは付け外しでき、同じものを二度足さない", () => {
    const s = new PrefsStore();
    s.setFavorite("lora", "x", true);
    s.setFavorite("lora", "x", true);
    s.setFavorite("lora", "y", true);
    expect(s.value.favoriteLoras).toEqual(["x", "y"]);
    s.setFavorite("lora", "x", false);
    expect(s.value.favoriteLoras).toEqual(["y"]);
  });

  test("生成するたびに最近使ったモデル (新しい順 8 件) とそのパラメータを覚える", () => {
    const s = new PrefsStore();
    for (let i = 0; i < 10; i++) s.recordGenerate(gen(`m${i}`));
    s.recordGenerate(gen("m3"));
    expect(s.value.recentCheckpoints).toEqual(["m3", "m9", "m8", "m7", "m6", "m5", "m4", "m2"]);
    expect(s.value.modelParams.m3).toEqual(params);
    expect(Object.keys(s.value.modelParams.m3)).not.toContain("prompt");
  });

  test("ベースモデルの既定: 自分で変えたもの > 組み込み。null で組み込みに戻す", () => {
    const s = new PrefsStore();
    expect(s.baseSettings("Anima").modules).toEqual(["qwen_3_06b_base.safetensors", "qwen_image_vae.safetensors"]);
    expect(s.baseSettings("Pony")).toEqual({ params: null, modules: [] });
    expect(s.baseSettings(null)).toEqual({ params: null, modules: [] });

    s.setBase("Anima", { modules: ["my_vae"] });
    expect(s.baseSettings("Anima")).toMatchObject({ modules: ["my_vae"], params: expect.objectContaining({ steps: 32 }) });
    s.setBase("Pony", { params });
    expect(s.baseSettings("Pony")).toEqual({ params, modules: [] });

    s.setBase("Anima", { modules: null });
    expect(s.value.baseSettings.Anima).toBeUndefined();
    expect(s.baseSettings("Anima").modules).toEqual(["qwen_3_06b_base.safetensors", "qwen_image_vae.safetensors"]);
  });

  test("モデルごとの TE / VAE はベースモデルの既定より優先し、null で既定に戻す", () => {
    const s = new PrefsStore();
    expect(s.modulesFor("anima_model", "Anima")).toEqual(["qwen_3_06b_base.safetensors", "qwen_image_vae.safetensors"]);
    s.setModel("anima_model", { modules: ["other"] });
    expect(s.modulesFor("anima_model", "Anima")).toEqual(["other"]);
    s.setModel("anima_model", { modules: null });
    expect(s.modulesFor("anima_model", "Anima")).toEqual(["qwen_3_06b_base.safetensors", "qwen_image_vae.safetensors"]);
    s.recordGenerate(gen("anima_model"));
    s.setModel("anima_model", { params: null });
    expect(s.value.modelParams.anima_model).toBeUndefined();
  });

  test("消したモデルはお気に入り・最近・モデルごとの設定から外す", () => {
    const s = new PrefsStore();
    s.setFavorite("checkpoint", "a", true);
    s.setFavorite("lora", "l", true);
    s.recordGenerate(gen("a"));
    s.setModel("a", { modules: ["x"] });
    s.forget("checkpoint", "a");
    expect(s.value).toMatchObject({ favoriteCheckpoints: [], recentCheckpoints: [], modelParams: {}, modelModules: {}, favoriteLoras: ["l"] });
    s.forget("lora", "l");
    expect(s.value.favoriteLoras).toEqual([]);
  });

  test("保存したものは次に作ったときに読める", () => {
    new PrefsStore().setFavorite("checkpoint", "a", true);
    expect(new PrefsStore().value.favoriteCheckpoints).toEqual(["a"]);
  });
});
