import { describe, expect, test } from "vitest";
import { baseLabel, baseSettingsOf, civitaiImage, formatBytes, formatRange, modelFolder, modelLabel, type Prefs, sampleImage } from "./api";

describe("モデル名", () => {
  test("modelLabel はフォルダと拡張子を外す", () => {
    expect(modelLabel("sd\\anime\\foo_v2.safetensors")).toBe("foo_v2");
    expect(modelLabel("foo.ckpt [abcd]")).toBe("foo.ckpt [abcd]");
    expect(modelLabel("a/b/c.gguf")).toBe("c");
  });

  test("modelFolder はフォルダだけ", () => {
    expect(modelFolder("sd\\anime\\foo.safetensors")).toBe("sd/anime");
    expect(modelFolder("foo.safetensors")).toBe("");
  });

  test("baseLabel はバッジ用に短くする", () => {
    expect(["Illustrious", "NoobAI XL", "Pony", "SDXL 1.0", "Flux.1 D", "Anima", "SD 1.5", "SD1", "SD 3.5", "Other", null].map(baseLabel)).toEqual(["IL", "Noob", "Pony", "XL", "Flux", "Anima", "1.5", "1", "3.5", "Other", null]);
  });
});

describe("表示", () => {
  test("formatBytes", () => {
    expect(formatBytes(512)).toBe("1 KB");
    expect(formatBytes(1.5 * 1024 ** 2)).toBe("1.5 MB");
    expect(formatBytes(2 * 1024 ** 3)).toBe("2.0 GB");
  });

  test("formatRange", () => {
    expect(formatRange(null)).toBeNull();
    expect(formatRange({ min: 25, max: 30, best: 28 })).toBe("25–30 (おすすめ 28)");
    expect(formatRange({ min: 25, max: 25, best: 25 })).toBe("25");
    expect(formatRange({ min: 15, max: null, best: null })).toBe("15 以上");
    expect(formatRange({ min: null, max: 30, best: null })).toBe("30 以下");
    expect(formatRange({ min: null, max: null, best: 7 })).toBe("7");
  });

  test("civitaiImage は幅の指定を差し替える", () => {
    expect(civitaiImage("https://x/original=true/a.jpeg", 450)).toBe("https://x/width=450/a.jpeg");
    expect(civitaiImage("https://x/width=1024/a.jpeg", 450)).toBe("https://x/width=450/a.jpeg");
  });

  test("sampleImage は BFF に保存した画像を優先する", () => {
    const s = { url: "https://x/original=true/a.jpeg", file: "1/2/a.webp" } as Parameters<typeof sampleImage>[0];
    expect(sampleImage(s, "thumb", 3)).toBe("/api/recommend/image?f=1%2F2%2Fa.webp&size=thumb&v=3");
    expect(sampleImage({ ...s, file: undefined }, "full")).toBe("https://x/width=1024/a.jpeg");
  });
});

test("baseSettingsOf は BFF が決めたベースモデルの既定を返し、無ければ空", () => {
  const anima = { params: { width: 832, height: 1216, steps: 32, cfg: 4, sampler: "ER SDE", scheduler: "beta" }, modules: ["qwen"], custom: { params: false, modules: true } };
  const prefs = { bases: { Anima: anima } } as unknown as Prefs;
  expect(baseSettingsOf(prefs, "Anima")).toBe(anima);
  const empty = { params: null, modules: [], custom: { params: false, modules: false } };
  expect(baseSettingsOf(prefs, "Pony")).toEqual(empty);
  expect(baseSettingsOf(prefs, null)).toEqual(empty);
  expect(baseSettingsOf(null, "Anima")).toEqual(empty);
});
