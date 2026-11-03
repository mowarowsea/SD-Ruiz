import { describe, expect, it } from "vitest";
import { findAll, findTags, removeTag, replaceAll, replaceInTag, tagRange } from "./find";

describe("findAll", () => {
  it("大文字小文字を区別せず、重ならないように全部探す", () => {
    expect(findAll("Blue hair, blue eyes", "blue")).toEqual([
      { from: 0, to: 4 },
      { from: 11, to: 15 },
    ]);
    expect(findAll("aaa", "aa")).toEqual([{ from: 0, to: 2 }]);
    expect(findAll("x", "")).toEqual([]);
  });
});

describe("tagRange", () => {
  const range = (text: string, q: string) => {
    const [m] = findAll(text, q);
    const r = tagRange(text, m.from, m.to);
    return text.slice(r.from, r.to);
  };

  it("同じ深さの区切り (, | 改行) で囲まれた範囲", () => {
    expect(range("1girl, blue hair, smile", "hair")).toBe("blue hair");
    expect(range("a\nblue hair\nb", "hair")).toBe("blue hair");
    expect(range("{red hair|blue hair}", "blue")).toBe("blue hair");
  });

  it("括弧の中なら重みまで、エスケープした括弧は区切らない", () => {
    expect(range("(a, blue hair:1.2)", "hair")).toBe("blue hair:1.2");
    expect(range("x, \\(blue\\) hair, y", "hair")).toBe("\\(blue\\) hair");
  });

  it("検索語に括弧が入っていれば対応する括弧までタグに含める", () => {
    expect(range("a, (masterpiece:1.2), b", "(master")).toBe("(masterpiece:1.2)");
    expect(range("a, (masterpiece:1.2), b", "1.2)")).toBe("(masterpiece:1.2)");
  });
});

describe("findTags", () => {
  it("当たったところをタグ単位にまとめる (同じタグの複数の当たりは 1 つ)", () => {
    const hits = findTags("blue blue hair, blue eyes", "blue");
    expect(hits.map((h) => h.matches.length)).toEqual([2, 1]);
    expect(hits.map((h) => [h.from, h.to])).toEqual([
      [0, 14],
      [16, 25],
    ]);
  });
});

describe("removeTag", () => {
  const remove = (text: string, q: string) => removeTag(text, findTags(text, q)[0]);

  it("後ろの区切りごと外す。最後のタグなら前の区切りごと", () => {
    expect(remove("a, b, c", "b")).toBe("a, c");
    expect(remove("a, b, c", "c")).toBe("a, b");
    expect(remove("a, b, c", "a")).toBe("b, c");
    expect(remove("{a|b|c}", "b")).toBe("{a|c}");
  });

  it("括弧が空になったら括弧ごと、行が空になったら行ごと外す", () => {
    expect(remove("a, (b), c", "b")).toBe("a, c");
    expect(remove("a, ((b:1.2)), c", "b")).toBe("a, c");
    expect(remove("a\nb\nc", "b")).toBe("a\nc");
    expect(remove("a\nb", "b")).toBe("a");
  });

  it("括弧の最後のタグの重みは括弧全体のものなので、前のタグに付け直す", () => {
    expect(remove("(a, b:1.2)", "b")).toBe("(a:1.2)");
    expect(remove("(b:1.2)", "b")).toBe("");
  });
});

describe("replaceInTag / replaceAll", () => {
  it("タグの中の当たったところだけ置き換え、空白を詰める", () => {
    const text = "a, blue  hair, (blue eyes:1.2)";
    expect(replaceInTag(text, findTags(text, "blue")[1], "red")).toBe("a, blue  hair, (red eyes:1.2)");
    expect(replaceAll(text, "blue", "red")).toBe("a, red hair, (red eyes:1.2)");
  });

  it("置き換えで空になったらタグごと外す", () => {
    expect(replaceAll("a, (blue:1.2), c", "blue", "")).toBe("a, c");
    expect(replaceAll("a, ( blue ), c", "blue", "")).toBe("a, c");
  });

  it("置き換え後の文字列に検索語が入っていても繰り返さない", () => {
    expect(replaceAll("a, b", "a", "aa")).toBe("aa, b");
    expect(replaceAll("x, blue hair", "hair", "blue hair")).toBe("x, blue blue hair");
  });
});
