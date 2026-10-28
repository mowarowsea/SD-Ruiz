import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { countTokens, formatCount, loadTokenizer, onTokenizerReady, tokenizerReady } from "./tokens";

// merges.txt が無いあいだは単語数で数える
describe("countTokens (単語数)", () => {
  test("空なら 0 / 75", () => {
    expect(countTokens("")).toEqual({ count: 0, limit: 75, words: true });
  });

  test("コメント・LoRA・ワイルドカード・強調の括弧と重みは数えない", () => {
    expect(countTokens("1girl, blue hair").count).toBe(3);
    expect(countTokens("(masterpiece:1.2), <lora:x:1>, __wc__ # comment").count).toBe(1);
    expect(countTokens("\\(a\\)").count).toBe(1);
  });

  test("BREAK で 75 の区切りを改める", () => {
    expect(countTokens("a BREAK b")).toEqual({ count: 2, limit: 150, words: true });
  });

  test("変数の定義は数えず、${name} も 0。definitions を付けると定義の中身を数える", () => {
    expect(countTokens("${x=foo bar}, ${x}").count).toBe(0);
    expect(countTokens("${x=foo bar}, ${x}", { definitions: true }).count).toBe(2);
  });

  test("{a|b} は全部の候補を数える", () => {
    expect(countTokens("{a|b}").count).toBe(2);
  });

  test("formatCount は単語なら 語、トークンなら tok", () => {
    expect(formatCount({ count: 3, limit: 75, words: true })).toBe("3 語");
    expect(formatCount({ count: 3, limit: 75, words: false })).toBe("3 tok");
  });
});

// 小さな merges.txt を読ませて BPE で数える
describe("countTokens (BPE)", () => {
  const merges = ["#version: 0.2", "b l", "bl u", "blu e</w>", "h a"].join("\n");
  const fetched: string[] = [];
  const fetchMock = async (url: string) => {
    fetched.push(url);
    return new Response(merges, { status: 200 });
  };

  beforeAll(async () => {
    vi.stubGlobal("fetch", fetchMock);
    const ready = vi.fn();
    onTokenizerReady(ready);
    await loadTokenizer();
    expect(tokenizerReady()).toBe(true);
    expect(ready).toHaveBeenCalledOnce();
  });
  afterAll(() => vi.unstubAllGlobals());

  test("merges.txt は 1 回しか読まない", async () => {
    await loadTokenizer();
    expect(fetched).toEqual(["/api/tokenizer/merges"]);
  });

  test("マージできる語は 1 トークン、できない語は 1 文字ずつ", () => {
    // blue → b l u e</w> → bl u e</w> → blu e</w> → blue</w>
    expect(countTokens("blue")).toEqual({ count: 1, limit: 75, words: false });
    // hair → h a / i / r</w>
    expect(countTokens("hair").count).toBe(3);
    expect(countTokens("blue hair").count).toBe(4);
  });

  test("大文字は小文字にして数え、記号も 1 つと数える", () => {
    expect(countTokens("BLUE").count).toBe(1);
    expect(countTokens("blue, blue").count).toBe(3);
  });

  test("75 を超えたら limit は 150 に", () => {
    const long = Array.from({ length: 76 }, () => "blue").join(" ");
    expect(countTokens(long)).toEqual({ count: 76, limit: 150, words: false });
  });
});
