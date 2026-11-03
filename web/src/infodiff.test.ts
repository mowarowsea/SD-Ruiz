import { describe, expect, it } from "vitest";
import { diffInfotext } from "./infodiff";
import { parseInfotext } from "./infotext";

const info = (prompt: string, params: string, negative = "") => parseInfotext(`${prompt}\nNegative prompt: ${negative}\nSteps: 20, ${params}`);

describe("diffInfotext", () => {
  it("パラメータの違い (Seed・ハッシュ・Version・Template などは比べない)", () => {
    const cur = info("a", "CFG scale: 5, Seed: 2, Model hash: bbbb, Version: 2, Template: a, spec_w: 0.5, spec_window_size: 3");
    const prev = info("a", "CFG scale: 4, Seed: 1, Model hash: aaaa, Version: 1, Template: a, spec_w: 0.25, spec_window_size: 2");
    expect(diffInfotext(cur, prev)).toEqual([
      { kind: "param", key: "CFG scale", from: "4", to: "5" },
      { kind: "param", key: "spec_window_size", from: "2", to: "3" },
    ]);
  });

  it("片方にしか無いパラメータも違いとして出す", () => {
    expect(diffInfotext(info("a", "Hires upscale: 2"), info("a", ""))).toEqual([{ kind: "param", key: "Hires upscale", from: undefined, to: "2" }]);
  });

  it("プロンプトは足したタグ・外したタグ・重みだけ変えたタグに分ける (コメントは除く)", () => {
    const cur = info("1girl, (blue hair:1.3), smile # note", "", "lowres");
    const prev = info("1girl, (blue hair), frown", "", "lowres, bad hands");
    expect(diffInfotext(cur, prev)).toEqual([
      { kind: "prompt", added: ["smile"], removed: ["frown"], reweighted: [{ tag: "blue hair", from: "1.1", to: "1.3" }] },
      { kind: "negative", added: [], removed: ["bad hands"], reweighted: [] },
    ]);
  });

  it("[tag] は 0.9、((tag)) は 1.21。括弧の片側だけ残ったタグは括弧を外して比べる", () => {
    const cur = info("((a)), (b, c:1.2)", "");
    const prev = info("[a], (b, c:1.2)", "");
    expect(diffInfotext(cur, prev)).toEqual([{ kind: "prompt", added: [], removed: [], reweighted: [{ tag: "a", from: "0.9", to: "1.21" }] }]);
  });

  it("Dynamic Prompts のテンプレートが両方にあればそちらで比べる", () => {
    const cur = info("red hair", 'Template: "__hair__, smile"');
    const prev = info("blue hair", 'Template: "__hair__"');
    expect(diffInfotext(cur, prev)).toEqual([{ kind: "prompt", added: ["smile"], removed: [], reweighted: [] }]);
    // 片方だけなら展開後どうしで比べる
    expect(diffInfotext(cur, info("blue hair", ""))).toEqual([{ kind: "prompt", added: ["red hair"], removed: ["blue hair"], reweighted: [] }]);
  });

  it("同じなら空", () => {
    expect(diffInfotext(info("a, b", "CFG scale: 5"), info("a, b", "CFG scale: 5"))).toEqual([]);
  });
});
