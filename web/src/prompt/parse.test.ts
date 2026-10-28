import { describe, expect, test } from "vitest";
import { parsePrompt, type Span } from "./parse";

/** span を [種類, その文字列, 深さ] にして見やすくする */
const kinds = (text: string) => parsePrompt(text).spans.map((s: Span) => [s.kind, text.slice(s.from, s.to), ...(s.depth === undefined ? [] : [s.depth])]);

describe("parsePrompt: 強調", () => {
  test("(tag:1.2) は重みの span と、タグの範囲だけの強調になる", () => {
    const r = parsePrompt("(a:1.2)");
    expect(kinds("(a:1.2)")).toEqual([["bracket", "(", 0], ["weight", "1.2"], ["bracket", ")", 0]]);
    expect(r.emphasis).toEqual([{ from: 1, to: 2, weight: 1.2 }]);
    expect(r.pairs).toEqual([{ open: 0, close: 6 }]);
  });

  test("重みは負や .5 の書き方も読む", () => {
    expect(parsePrompt("(a:-0.5)").emphasis).toEqual([{ from: 1, to: 2, weight: -0.5 }]);
    expect(parsePrompt("(a:.5)").emphasis).toEqual([{ from: 1, to: 2, weight: 0.5 }]);
  });

  test("(tag) は 1.1 倍、[tag] は 1/1.1 倍", () => {
    expect(parsePrompt("(a)").emphasis).toEqual([{ from: 1, to: 2, weight: 1.1 }]);
    expect(parsePrompt("[a]").emphasis[0].weight).toBeCloseTo(1 / 1.1);
  });

  test("入れ子の倍率は掛け合わせ、重ならない区間に分ける", () => {
    const { emphasis } = parsePrompt("(a, (b:1.5), c)");
    expect(emphasis.map((e) => [e.from, e.to])).toEqual([[1, 5], [5, 6], [6, 14]]);
    expect(emphasis.map((e) => e.weight)).toEqual([1.1, expect.closeTo(1.65, 10), 1.1]);
    expect(parsePrompt("((a))").emphasis.find((e) => e.from === 2)!.weight).toBeCloseTo(1.21);
  });

  test("括弧の深さは色分け用に 0 から数える", () => {
    expect(kinds("((a))")).toEqual([["bracket", "(", 0], ["bracket", "(", 1], ["bracket", ")", 1], ["bracket", ")", 0]]);
  });

  test("[a|b] (交互) と [a:b:0.5] (切り替え) は強弱にしない", () => {
    expect(parsePrompt("[a|b]").emphasis).toEqual([]);
    expect(parsePrompt("[a:b:0.5]").emphasis).toEqual([]);
    expect(kinds("[a|b]")).toContainEqual(["separator", "|"]);
  });

  test("\\( \\) はエスケープで、括弧として数えない", () => {
    const r = parsePrompt("\\(a\\)");
    expect(r.spans.map((s) => s.kind)).toEqual(["escape", "escape"]);
    expect(r.pairs).toEqual([]);
    expect(r.emphasis).toEqual([]);
  });
});

describe("parsePrompt: Extra networks と Dynamic Prompts", () => {
  test("<lora:name:0.8> は全体・名前・重みの 3 つの span", () => {
    expect(kinds("<lora:foo:0.8>")).toEqual([["network", "<lora:foo:0.8>"], ["network-name", "foo"], ["network-weight", "0.8"]]);
    expect(kinds("<lora:foo>")).toEqual([["network", "<lora:foo>"], ["network-name", "foo"]]);
  });

  test("ワイルドカードは __name__ (フォルダと * も可)", () => {
    expect(kinds("__hair/*__")).toEqual([["wildcard", "__hair/*__"]]);
  });

  test("{a|b|c} の | は区切り、{2$$a|b} の 2$$ は個数指定", () => {
    expect(kinds("{a|b|c}").filter((k) => k[0] === "separator")).toHaveLength(2);
    expect(kinds("{2$$a|b}")).toContainEqual(["variant", "2$$"]);
    expect(kinds("{1-2$$a|b}")).toContainEqual(["variant", "1-2$$"]);
  });

  test("括弧の外の | は区切りにしない", () => {
    expect(kinds("a|b")).toEqual([]);
  });

  test("${name=値} は定義として値の範囲を返し、${name} は返さない", () => {
    expect(parsePrompt("${x=foo}").variables).toEqual([{ from: 0, valueFrom: 4, to: 7 }]);
    expect(parsePrompt("${x=!foo}").variables).toEqual([{ from: 0, valueFrom: 5, to: 8 }]);
    expect(parsePrompt("${x}").variables).toEqual([]);
    expect(kinds("${x=foo}")[0]).toEqual(["variable", "${x="]);
  });

  test("BREAK / AND は単語として独立しているときだけキーワード", () => {
    expect(kinds("a BREAK b AND c")).toEqual([["keyword", "BREAK"], ["keyword", "AND"]]);
    expect(kinds("BREAKS")).toEqual([]);
    expect(kinds("xBREAK")).toEqual([]);
  });
});

describe("parsePrompt: コメントとエラー", () => {
  test("# と // は行末まで、/* */ は閉じるまでコメント", () => {
    expect(kinds("# comment\na")).toEqual([["comment", "# comment"]]);
    expect(kinds("a // c\nb")).toEqual([["comment", "// c"]]);
    expect(kinds("a /* c\nd */ b")).toEqual([["comment", "/* c\nd */"]]);
  });

  test("閉じていない /* は末尾までコメント", () => {
    expect(kinds("a /* c")).toEqual([["comment", "/* c"]]);
  });

  test("コメントの中の括弧は数えない", () => {
    expect(parsePrompt("# (\na").spans.filter((s) => s.kind === "error")).toEqual([]);
  });

  test("閉じていない・対応しない括弧は error", () => {
    expect(kinds("(a")).toEqual([["error", "(", 0]]);
    expect(kinds("a)")).toEqual([["error", ")"]]);
    expect(kinds("(a]")).toEqual([["error", "(", 0], ["error", "]"]]);
    expect(kinds("(a:1.2)))").filter((k) => k[0] === "error")).toHaveLength(2);
  });

  test("span は位置順に並ぶ", () => {
    const { spans } = parsePrompt("<lora:x:1>, (a:1.2), __w__ # c");
    for (let i = 1; i < spans.length; i++) expect(spans[i].from).toBeGreaterThanOrEqual(spans[i - 1].from);
  });

  test("空文字と末尾のバックスラッシュで落ちない", () => {
    expect(parsePrompt("")).toEqual({ spans: [], emphasis: [], pairs: [], variables: [] });
    expect(parsePrompt("a\\").spans).toEqual([]);
  });
});
