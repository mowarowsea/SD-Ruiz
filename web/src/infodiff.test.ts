import { describe, expect, test } from "vitest";
import { diffInfotext } from "./infodiff";
import { parseInfotext } from "./infotext";

const diff = (cur: string, prev: string) => diffInfotext(parseInfotext(cur), parseInfotext(prev));

describe("diffInfotext", () => {
  test("パラメータの違いと、タグの増減・重みの変化を出す", () => {
    const out = diff("1girl, (blue hair:1.2), smile\nNegative prompt: bad\nSteps: 28, CFG scale: 5, Seed: 1", "1girl, (blue hair:1.1), frown\nNegative prompt: bad, worst\nSteps: 28, CFG scale: 4, Seed: 2");
    expect(out).toEqual([
      { kind: "param", key: "CFG scale", from: "4", to: "5" },
      { kind: "prompt", added: ["smile"], removed: ["frown"], reweighted: [{ tag: "blue hair", from: "1.1", to: "1.2" }] },
      { kind: "negative", added: [], removed: ["worst"], reweighted: [] },
    ]);
  });

  test("Seed・ハッシュ・バージョン・Template・Spectrum の細かい設定は比べない", () => {
    expect(diff("a\nSteps: 1, Seed: 1, Model hash: aaa, Version: f1, spec_w: 0.25, spec_window_size: 2, Lora hashes: \"x: 1\"", "a\nSteps: 1, Seed: 2, Model hash: bbb, Version: f2, spec_w: 0.3, spec_window_size: 2, Lora hashes: \"x: 2\"")).toEqual([]);
    // オンオフが分かる spec_window_size だけは出す
    expect(diff("a\nSteps: 1, spec_window_size: 2", "a\nSteps: 1")).toEqual([{ kind: "param", key: "spec_window_size", from: undefined, to: "2" }]);
  });

  test("何も違わなければ空", () => {
    expect(diff("a, b\nSteps: 1", "a, b\nSteps: 1")).toEqual([]);
  });

  test("Template は両方にあるときだけ使い、片方だけなら展開後で比べる", () => {
    expect(diff('x\nSteps: 1, Template: "{a|b}, c"', 'y\nSteps: 1, Template: "{a|b}"')).toEqual([{ kind: "prompt", added: ["c"], removed: [], reweighted: [] }]);
    expect(diff('x\nSteps: 1, Template: "{a|b}, c"', "y\nSteps: 1")).toEqual([{ kind: "prompt", added: ["x"], removed: ["y"], reweighted: [] }]);
  });

  test("Template のコメントは除いて比べる", () => {
    expect(diff('a\nSteps: 1, Template: "a # note"', 'a\nSteps: 1, Template: "a"')).toEqual([]);
  });

  test("括弧の数での重み ((a)) や [b] も倍率にして比べる", () => {
    expect(diff("((a)), (b)\nSteps: 1", "a, [b]\nSteps: 1")).toEqual([
      { kind: "prompt", added: [], removed: [], reweighted: [{ tag: "a", from: "1", to: "1.21" }, { tag: "b", from: "0.9", to: "1.1" }] },
    ]);
  });

  test("(a, b:1.1) をカンマで切って片方だけ残った括弧は外す", () => {
    expect(diff("(a, b:1.1)\nSteps: 1", "a, (b:1.1)\nSteps: 1")).toEqual([]);
  });
});
