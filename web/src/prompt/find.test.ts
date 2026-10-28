import { describe, expect, test } from "vitest";
import { findAll, findTags, removeTag, replaceAll, replaceInTag, tagRange } from "./find";

const tagsOf = (text: string, q: string) => findTags(text, q).map((h) => text.slice(h.from, h.to));
const removeFirst = (text: string, q: string) => removeTag(text, findTags(text, q)[0]);

describe("findAll / tagRange", () => {
  test("大文字小文字を区別せずに全部探す。空の検索語は何も返さない", () => {
    expect(findAll("Red, red hair", "red")).toEqual([{ from: 0, to: 3 }, { from: 5, to: 8 }]);
    expect(findAll("abc", "")).toEqual([]);
  });

  test("同じ括弧の深さの , | 改行 で区切った範囲をタグにする (前後の空白は除く)", () => {
    expect(tagRange("masterpiece, (blue hair:1.2), 1girl", 15, 19)).toEqual({ from: 14, to: 27 });
    expect(tagRange("a\n blue hair \nc", 3, 7)).toEqual({ from: 3, to: 12 });
  });

  test("検索語に片方だけの括弧が入っていれば、対応する括弧までタグにする", () => {
    expect(tagsOf("a, (blue hair:1.2), c", "(blue")).toEqual(["(blue hair:1.2)"]);
    expect(tagsOf("a, (blue hair:1.2), c", "1.2)")).toEqual(["(blue hair:1.2)"]);
  });

  test("エスケープした括弧はタグの境界にしない", () => {
    expect(tagsOf("a, \\(b\\), c", "b")).toEqual(["\\(b\\)"]);
  });
});

describe("findTags", () => {
  test("同じタグに複数当たったら 1 つにまとめ、別のタグは分ける", () => {
    const hits = findTags("hair, hairband\nhair ornament", "hair");
    expect(hits.map((h) => h.matches.length)).toEqual([1, 1, 1]);
    expect(findTags("red red", "red")).toHaveLength(1);
    expect(findTags("red red", "red")[0].matches).toHaveLength(2);
  });
});

describe("removeTag", () => {
  test("後ろの区切りごと外す。最後のタグなら前の区切りごと", () => {
    expect(removeFirst("a, b, c", "a")).toBe("b, c");
    expect(removeFirst("a, b, c", "b")).toBe("a, c");
    expect(removeFirst("a, b, c", "c")).toBe("a, b");
  });

  test("空になった括弧も外す", () => {
    expect(removeFirst("a, (b), c", "b")).toBe("a, c");
    expect(removeFirst("a, (b:1.3), c", "b")).toBe("a, c");
    expect(removeFirst("(a:1.2)", "a")).toBe("");
  });

  test("重み付きの括弧の最後のタグを外しても、重みは前のタグに残す", () => {
    expect(removeFirst("(masterpiece, best quality:1.2), 1girl", "best")).toBe("(masterpiece:1.2), 1girl");
    // 最初のタグを外したときは重みは後ろのタグのものとしてそのまま
    expect(removeFirst("(masterpiece, best quality:1.2), 1girl", "master")).toBe("(best quality:1.2), 1girl");
  });

  test("行が空になったら行ごと消す", () => {
    expect(removeFirst("a\nb\nc", "b")).toBe("a\nc");
    expect(removeFirst("a\nb", "b")).toBe("a");
  });

  test("{a|b|c} の候補も | ごと外す", () => {
    expect(removeFirst("{a|b|c}", "b")).toBe("{a|c}");
    expect(removeFirst("{a|b}", "a")).toBe("{b}");
    expect(removeFirst("{a|b}", "b")).toBe("{a}");
  });

  test("エスケープした括弧の中のタグも外せる", () => {
    expect(removeFirst("a, \\(b\\), c", "b")).toBe("a, c");
  });
});

describe("replaceInTag / replaceAll", () => {
  const text = "masterpiece, (blue hair:1.2), 1girl";

  test("当たった部分だけ置き換える", () => {
    expect(replaceInTag(text, findTags(text, "blue")[0], "red")).toBe("masterpiece, (red hair:1.2), 1girl");
  });

  test("置き換えてタグが空になったらタグごと外す", () => {
    expect(replaceInTag("masterpiece, (blue:1.2), 1girl", findTags("masterpiece, (blue:1.2), 1girl", "blue")[0], "")).toBe("masterpiece, 1girl");
    expect(replaceInTag("a, b, c", findTags("a, b, c", "b")[0], "")).toBe("a, c");
  });

  test("残った空白は詰める", () => {
    const t = "a, (blue hair:1.2)";
    expect(replaceInTag(t, findTags(t, "blue")[0], "")).toBe("a, (hair:1.2)");
    expect(replaceInTag(t, findTags(t, "hair")[0], "")).toBe("a, (blue:1.2)");
  });

  test("replaceAll は置き換え後に検索語が入っていても繰り返さない", () => {
    expect(replaceAll("red hair, red eyes, (red:1.1)", "red", "blue")).toBe("blue hair, blue eyes, (blue:1.1)");
    expect(replaceAll("a, a", "a", "aa")).toBe("aa, aa");
  });

  test("1 つのタグの中の複数の当たりも全部置き換える", () => {
    expect(replaceInTag("red red", findTags("red red", "red")[0], "x")).toBe("x x");
  });
});
