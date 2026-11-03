import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GenerateParams } from "./jobs.js";
import { type ModelParams, PrefsStore } from "./prefs.js";
import { tempDir } from "./testing/tmp.js";

let tmp: ReturnType<typeof tempDir>;
let path: string;
beforeEach(() => {
  tmp = tempDir();
  path = join(tmp.dir, "data", "prefs.json");
});
afterEach(() => tmp.remove());

const params: ModelParams = { width: 1024, height: 1024, steps: 20, cfg: 4, sampler: "Euler a", scheduler: "karras" };
const gen = (checkpoint: string): GenerateParams => ({ checkpoint, prompt: "", negative: "", ...params, seed: -1, batch: 1, save: true, fast: false, dmd2: "off", pag: false, apg: false });

describe("PrefsStore", () => {
  it("ファイルが無ければ空から始まり、変えると (フォルダごと) 保存し、次に開いたとき読み戻す", () => {
    const store = new PrefsStore(path);
    expect(store.value.favoriteCheckpoints).toEqual([]);
    expect(existsSync(path)).toBe(false);
    store.setFavorite("checkpoint", "a", true);
    expect(JSON.parse(readFileSync(path, "utf8")).favoriteCheckpoints).toEqual(["a"]);
    expect(new PrefsStore(path).value.favoriteCheckpoints).toEqual(["a"]);
  });

  it("古いファイルに無い項目は既定で埋める", () => {
    mkdirSync(join(tmp.dir, "data"));
    writeFileSync(path, JSON.stringify({ favoriteCheckpoints: ["a"] }));
    const store = new PrefsStore(path);
    expect(store.value).toEqual({ favoriteCheckpoints: ["a"], favoriteLoras: [], recentCheckpoints: [], modelParams: {}, modelModules: {}, baseSettings: {} });
  });

  it("お気に入りは種類ごとに持ち、重複せず、外せる", () => {
    const store = new PrefsStore(path);
    store.setFavorite("checkpoint", "a", true);
    store.setFavorite("checkpoint", "a", true);
    store.setFavorite("lora", "l", true);
    expect(store.value.favoriteCheckpoints).toEqual(["a"]);
    expect(store.value.favoriteLoras).toEqual(["l"]);
    store.setFavorite("checkpoint", "a", false);
    expect(store.value.favoriteCheckpoints).toEqual([]);
  });

  it("生成すると最近使ったモデル (新しい順・8 件まで) とそのパラメータを覚える", () => {
    const store = new PrefsStore(path);
    for (let i = 0; i < 10; i++) store.recordGenerate(gen(`m${i}`));
    store.recordGenerate(gen("m5"));
    expect(store.value.recentCheckpoints).toEqual(["m5", "m9", "m8", "m7", "m6", "m4", "m3", "m2"]);
    expect(store.value.modelParams.m5).toEqual(params);
    expect(store.value.modelParams.m5).not.toHaveProperty("prompt");
  });

  describe("ベースモデルの既定", () => {
    it("組み込み > 無し。自分で変えた項目だけ上書きする", () => {
      const store = new PrefsStore(path);
      expect(store.baseSettings("Anima").modules.length).toBeGreaterThan(0);
      expect(store.baseSettings("Pony")).toEqual({ params: null, modules: [] });
      expect(store.baseSettings(null)).toEqual({ params: null, modules: [] });
      store.setBase("Anima", { params });
      expect(store.baseSettings("Anima").params).toEqual(params);
      expect(store.baseSettings("Anima").modules.length).toBeGreaterThan(0);
      store.setBase("Anima", { modules: ["te.safetensors"] });
      expect(store.baseSettings("Anima")).toEqual({ params, modules: ["te.safetensors"] });
    });

    it("null で組み込みに戻し、全部戻したら項目ごと消す", () => {
      const store = new PrefsStore(path);
      store.setBase("Pony", { params, modules: ["x"] });
      store.setBase("Pony", { params: null });
      expect(store.baseSettings("Pony")).toEqual({ params: null, modules: ["x"] });
      expect(store.value.baseSettings.Pony).toEqual({ modules: ["x"] });
      store.setBase("Pony", { modules: null });
      expect(store.value.baseSettings).toEqual({});
    });
  });

  describe("モデルごとの設定", () => {
    it("TE / VAE はモデルごとの指定 > ベースモデルの既定", () => {
      const store = new PrefsStore(path);
      store.setBase("Anima", { modules: ["base-te"] });
      expect(store.modulesFor("m", "Anima")).toEqual(["base-te"]);
      store.setModel("m", { modules: ["my-te"] });
      expect(store.modulesFor("m", "Anima")).toEqual(["my-te"]);
      store.setModel("m", { modules: null });
      expect(store.modulesFor("m", "Anima")).toEqual(["base-te"]);
    });

    it("params: null で前回のパラメータを消す", () => {
      const store = new PrefsStore(path);
      store.recordGenerate(gen("m"));
      store.setModel("m", { params: null });
      expect(store.value.modelParams).toEqual({});
    });
  });

  it("消したモデルはお気に入り・最近・モデルごとの設定から外す (LoRA はお気に入りだけ)", () => {
    const store = new PrefsStore(path);
    store.setFavorite("checkpoint", "m", true);
    store.setFavorite("lora", "l", true);
    store.recordGenerate(gen("m"));
    store.setModel("m", { modules: ["te"] });
    store.forget("lora", "l");
    expect(store.value.favoriteLoras).toEqual([]);
    expect(store.value.favoriteCheckpoints).toEqual(["m"]);
    store.forget("checkpoint", "m");
    expect(store.value).toMatchObject({ favoriteCheckpoints: [], recentCheckpoints: [], modelParams: {}, modelModules: {} });
  });
});
