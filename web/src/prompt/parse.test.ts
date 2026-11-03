import { describe, expect, it } from "vitest";
import { parsePrompt, type Span } from "./parse";

const kinds = (text: string) => parsePrompt(text).spans.map((s) => [s.kind, text.slice(s.from, s.to)] as const);
const of = (text: string, kind: Span["kind"]) => parsePrompt(text).spans.filter((s) => s.kind === kind).map((s) => text.slice(s.from, s.to));

describe("parsePrompt", () => {
  it("コメント: # と // は行末まで、/* */ は閉じるまで (閉じなければ最後まで)", () => {
    expect(of("a # c1\nb // c2\nc /* c3 */ d", "comment")).toEqual(["# c1", "// c2", "/* c3 */"]);
    expect(of("a /* open", "comment")).toEqual(["/* open"]);
  });

  it("エスケープした括弧は括弧として数えず、カンマは区切り", () => {
    expect(kinds("\\(a\\), b")).toEqual([
      ["escape", "\\("],
      ["escape", "\\)"],
      ["comma", ","],
    ]);
  });

  it("強調 (tag:1.2) は重みと倍率、(tag) は 1.1、[tag] は 1/1.1。入れ子は掛け合わせる", () => {
    const r = parsePrompt("(a:1.5) (b) [c] ((d))");
    expect(r.spans.filter((s) => s.kind === "weight").map((s) => "(a:1.5) (b) [c] ((d))".slice(s.from, s.to))).toEqual(["1.5"]);
    // ((d)) は外側の範囲に内側の括弧も入るので、1.1 / 1.21 / 1.1 の 3 区間になる
    expect(r.emphasis.map((e) => [e.from, e.to, Math.round(e.weight * 1000) / 1000])).toEqual([
      [1, 2, 1.5],
      [9, 10, 1.1],
      [13, 14, 0.909],
      [17, 18, 1.1],
      [18, 19, 1.21],
      [19, 20, 1.1],
    ]);
  });

  it("[a|b] (交互) や [a:b:0.5] (切り替え) は弱めの強調ではない", () => {
    expect(parsePrompt("[a|b] [a:b:0.5]").emphasis).toEqual([]);
  });

  it("括弧の対応と深さ。閉じていない・対応しない括弧は error", () => {
    const r = parsePrompt("(a [b]) )");
    expect(r.pairs).toEqual([
      { open: 3, close: 5 },
      { open: 0, close: 6 },
    ]);
    expect(r.spans.filter((s) => s.kind === "bracket").map((s) => s.depth)).toEqual([0, 1, 1, 0]);
    expect(of("(a [b]) )", "error")).toEqual([")"]);
    expect(of("((a)", "error")).toEqual(["("]);
  });

  it("Extra networks: <lora:name:0.8> は全体・名前・重み", () => {
    expect(kinds("<lora:my-lora:0.8>")).toEqual([
      ["network", "<lora:my-lora:0.8>"],
      ["network-name", "my-lora"],
      ["network-weight", "0.8"],
    ]);
    expect(kinds("<lora:x>").map((k) => k[0])).toEqual(["network", "network-name"]);
  });

  it("Dynamic Prompts: __wildcard__、{a|b}、{2$$a|b}、${var}、${var=...}", () => {
    expect(of("__chara/fate__ __a*__", "wildcard")).toEqual(["__chara/fate__", "__a*__"]);
    expect(kinds("{2$$a|b}").map((k) => k[0])).toEqual(["bracket", "variant", "separator", "bracket"]);
    expect(kinds("{a|b}").map((k) => k[0])).toEqual(["bracket", "separator", "bracket"]);
    // 括弧の外の | は区切りではない
    expect(of("a|b", "separator")).toEqual([]);
    const r = parsePrompt("${x=a|b} ${x} ${y=!c}");
    expect(of("${x=a|b} ${x} ${y=!c}", "variable")).toEqual(["${x=", "${x", "${y=!"]);
    expect(r.variables).toEqual([
      { from: 0, valueFrom: 4, to: 7 },
      { from: 14, valueFrom: 19, to: 20 },
    ]);
  });

  it("BREAK / AND は単語として独立しているときだけ", () => {
    expect(of("a BREAK b AND c", "keyword")).toEqual(["BREAK", "AND"]);
    expect(of("BREAKFAST ANDROID xBREAK", "keyword")).toEqual([]);
  });

  it("空文字でも落ちない", () => {
    expect(parsePrompt("")).toEqual({ spans: [], emphasis: [], pairs: [], variables: [] });
  });
});
