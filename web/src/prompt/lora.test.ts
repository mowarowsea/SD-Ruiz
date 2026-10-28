import { describe, expect, test } from "vitest";
import { addLora, findLoras, removeLora, setLoraWeight } from "./lora";

describe("findLoras", () => {
  test("名前と重みと位置。重みが無ければ 1、数字でなければ 1", () => {
    expect(findLoras("a, <lora:foo:0.8>, <lora:bar>, <lora:baz:abc>")).toEqual([
      { name: "foo", weight: 0.8, from: 3, to: 17 },
      { name: "bar", weight: 1, from: 19, to: 29 },
      { name: "baz", weight: 1, from: 31, to: 45 },
    ]);
  });

  test("3 つ目以降の引数 (<lora:name:0.5:lbw=...>) があっても重みは 2 つ目", () => {
    expect(findLoras("<lora:q:0.5:lbw=1,0,0>")[0]).toMatchObject({ name: "q", weight: 0.5 });
  });
});

describe("setLoraWeight / removeLora / addLora", () => {
  const text = "a, <lora:foo:0.8>, b";
  const use = findLoras(text)[0];

  test("重みを書き換える", () => {
    expect(setLoraWeight(text, use, 0.5)).toBe("a, <lora:foo:0.5>, b");
  });

  test("外すときは前後の区切りごと", () => {
    expect(removeLora(text, use)).toBe("a, b");
    expect(removeLora("a, <lora:foo:0.8>", findLoras("a, <lora:foo:0.8>")[0])).toBe("a");
    expect(removeLora("<lora:foo:0.8>", findLoras("<lora:foo:0.8>")[0])).toBe("");
  });

  test("末尾に足す。区切りはプロンプトの終わりに合わせる", () => {
    expect(addLora("", "x")).toBe("<lora:x:1>");
    expect(addLora("a", "x")).toBe("a, <lora:x:1>");
    expect(addLora("a,", "x", 0.5)).toBe("a, <lora:x:0.5>");
    expect(addLora("a, \n", "x")).toBe("a, <lora:x:1>");
  });
});
