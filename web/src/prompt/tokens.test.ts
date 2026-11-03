// トークナイザ (merges.txt) はサーバーから読むので、ここでは読めていないときの「単語で数える」経路を確かめる

import { describe, expect, it } from "vitest";
import { countTokens, formatCount, tokenizerReady } from "./tokens";

describe("countTokens (単語数)", () => {
  it("merges.txt を読めていなければ単語で数える (数字だけの語は数えない)", () => {
    expect(tokenizerReady()).toBe(false);
    expect(countTokens("1girl, blue hair, 2 cats")).toEqual({ count: 4, limit: 75, words: true });
  });

  it("コメント・LoRA・強調の括弧と重み・Dynamic Prompts の記号は数えない。{a|b} は両方数える", () => {
    expect(countTokens("(masterpiece:1.2), <lora:x:0.8>, # comment\n__chara__ {red|blue} hair").count).toBe(4);
  });

  it("変数の定義は数えず (使う側も 0)、definitions で定義の中身を数える", () => {
    const text = "${c=red hair} ${c}, smile";
    expect(countTokens(text).count).toBe(1);
    expect(countTokens(text, { definitions: true }).count).toBe(3);
  });

  it("BREAK で 75 トークンの区切りが増える", () => {
    expect(countTokens("a BREAK b")).toMatchObject({ count: 2, limit: 150 });
    expect(countTokens("a AND b")).toMatchObject({ count: 3, limit: 75 });
  });

  it("エスケープした括弧の中身は数える", () => {
    expect(countTokens("\\(red\\)").count).toBe(1);
  });
});

describe("formatCount", () => {
  it("単語数かトークン数かで単位を変える", () => {
    expect(formatCount({ count: 3, limit: 75, words: true })).toBe("3 語");
    expect(formatCount({ count: 3, limit: 75, words: false })).toBe("3 tok");
  });
});
