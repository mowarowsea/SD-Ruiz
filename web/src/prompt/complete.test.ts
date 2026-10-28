import { describe, expect, test } from "vitest";
import { tagToPrompt, tagsIn } from "./complete";

describe("tagToPrompt", () => {
  test("アンダースコアを空白に、括弧をエスケープする", () => {
    expect(tagToPrompt("hatsune_miku_(cosplay)")).toBe("hatsune miku \\(cosplay\\)");
    expect(tagToPrompt("1girl")).toBe("1girl");
  });

  test("顔文字系のタグはアンダースコアを残す", () => {
    expect(tagToPrompt("^_^")).toBe("^_^");
    expect(tagToPrompt("(o)_(o)")).toBe("\\(o\\)_\\(o\\)");
  });
});

describe("tagsIn (範囲選択の訳)", () => {
  test("タグを書いた順に、LoRA・ワイルドカード・重み・変数の参照を除いて取り出す", () => {
    expect(tagsIn("masterpiece, (blue hair:1.2), <lora:x:1>, __wc__, ${v}, 1girl")).toEqual(["masterpiece", "blue hair", "1girl"]);
  });

  test("エスケープした括弧は外して 1 つのタグにする", () => {
    expect(tagsIn("hatsune miku \\(cosplay\\), smile")).toEqual(["hatsune miku (cosplay)", "smile"]);
  });

  test("重なり (_ と空白、大文字小文字) は 1 つにまとめる。記号だけ・BREAK は除く", () => {
    expect(tagsIn("blue_hair, Blue Hair, BREAK, @@, AND")).toEqual(["blue_hair"]);
  });

  test("日本語のタグも拾う", () => {
    expect(tagsIn("青髪, 1girl")).toEqual(["青髪", "1girl"]);
  });
});
