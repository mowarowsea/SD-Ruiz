import { describe, expect, test } from "vitest";
import { htmlToText, tidy, type Recommendation } from "./recommend.js";

describe("htmlToText", () => {
  test("段落と箇条書きは改行に、実体参照は文字に戻し、空行は詰める", () => {
    expect(htmlToText("<p>Hello&nbsp;<b>world</b></p><ul><li>one</li><li>two &amp; three</li></ul><br/>x &lt;y&gt; &quot;q&quot; &#39;a&#39;\n\n\n<div>end</div>")).toBe("Hello world\n- one\n- two & three\nx <y> \"q\" 'a'\nend");
  });

  test("タグの属性ごと外す", () => {
    expect(htmlToText('<a href="https://x">link</a>  <img src="y"> text')).toBe("link text");
  });
});

describe("tidy", () => {
  const names = { samplers: ["Euler a", "DPM++ 2M"], schedulers: [{ name: "karras", label: "Karras" }, { name: "sgm_uniform", label: "SGM Uniform" }] };
  const rec: Recommendation = { steps: null, cfg: null, samplers: [], schedulers: [], sizes: [], clipSkip: null, hires: null, quality: null, negative: null, notes: [], weight: null, triggers: [] };

  test("Sampler / Scheduler を Forge の名前にそろえる (合わなければ原文のまま)。重複は 1 つに", () => {
    const out = tidy({ ...rec, samplers: ["euler a", "Euler a", "Nope"], schedulers: ["Karras", "sgm uniform", "nope"] }, names);
    expect(out.samplers).toEqual(["Euler a", "Nope"]);
    expect(out.schedulers).toEqual(["karras", "sgm_uniform", "nope"]);
  });

  test("注意からほかの項目と同じこと・ライセンスの話を落とし、5 件まで", () => {
    const notes = ["Steps 20-30 がおすすめ", "CFG は 5", "Sampler は Euler a", "832x1216 で", "商用利用は禁止", "手が崩れやすい", "a", "b", "c", "d", "e"];
    expect(tidy({ ...rec, notes }, names).notes).toEqual(["手が崩れやすい", "a", "b", "c", "d"]);
  });

  test("LoRA の重みがあれば、重みの話も注意から落とす", () => {
    expect(tidy({ ...rec, notes: ["重みは 0.8 がよい"] }, names).notes).toEqual(["重みは 0.8 がよい"]);
    expect(tidy({ ...rec, notes: ["重みは 0.8 がよい"], weight: { min: null, max: null, best: 0.8 } }, names).notes).toEqual([]);
  });

  test("古い保存に無い weight / triggers は埋める", () => {
    const old = { ...rec } as Partial<Recommendation>;
    delete old.weight;
    delete old.triggers;
    expect(tidy(old as Recommendation, names)).toMatchObject({ weight: null, triggers: [] });
  });
});
