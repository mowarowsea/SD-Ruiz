import { describe, expect, it } from "vitest";
import { htmlToText, type Recommendation, sampleImagePath, tidy } from "./recommend.js";

describe("htmlToText", () => {
  it("段落・改行・箇条書きを改行にし、タグと実体参照を落とす", () => {
    expect(htmlToText("<p>Hello<br/>World</p><ul><li>a &amp; b</li><li>&lt;c&gt;</li></ul><p>x&nbsp;&quot;y&quot;&#39;z  </p>")).toBe('Hello\nWorld\n- a & b\n- <c>\nx "y"\'z');
  });

  it("続く空行は 1 つにまとめる", () => {
    expect(htmlToText("<p>a</p>\n\n\n<p>b</p>")).toBe("a\nb");
  });
});

describe("tidy", () => {
  const rec: Recommendation = {
    steps: { min: 20, max: 30, best: 25 },
    cfg: null,
    samplers: ["euler a", "DPM++ 2M Karras", "Euler a"],
    schedulers: ["KARRAS", "sgm uniform", "unknown"],
    sizes: ["832x1216"],
    clipSkip: 2,
    hires: null,
    quality: null,
    negative: null,
    notes: ["Steps は 25 前後", "CFG 5 がよい", "重みは 0.8", "商用利用は禁止", "手が崩れやすい", "a", "b", "c", "d"],
    weight: { min: null, max: null, best: 0.8 },
    triggers: undefined as unknown as string[],
  };
  const names = { samplers: ["Euler a", "DPM++ 2M"], schedulers: [{ name: "karras", label: "Karras" }, { name: "sgm_uniform", label: "SGM Uniform" }] };

  it("Sampler / Scheduler を Forge の名前にそろえて重複を消し、ほかの項目と同じ・ライセンスの注意を落とす", () => {
    const out = tidy(rec, names);
    expect(out.samplers).toEqual(["Euler a", "DPM++ 2M Karras"]);
    expect(out.schedulers).toEqual(["karras", "sgm_uniform", "unknown"]);
    expect(out.notes).toEqual(["手が崩れやすい", "a", "b", "c", "d"]);
    expect(out.triggers).toEqual([]);
  });

  it("重みの無い LoRA では重みの注意は残す", () => {
    expect(tidy({ ...rec, weight: null, notes: ["重みは 0.8"] }, names).notes).toEqual(["重みは 0.8"]);
  });
});

describe("sampleImagePath", () => {
  it("保存した作例の名前だけ受け付ける", () => {
    expect(sampleImagePath("123/456/0", "full")).toMatch(/[\\/]123[\\/]456[\\/]0\.webp$/);
    expect(sampleImagePath("123/0", "thumb")).toMatch(/[\\/]123[\\/]0-thumb\.webp$/);
    expect(sampleImagePath("../etc/passwd", "full")).toBeNull();
    expect(sampleImagePath("", "full")).toBeNull();
  });
});
