import { describe, expect, it } from "vitest";
import { addLora, findLoras, removeLora, setLoraWeight } from "./lora";

describe("findLoras", () => {
  it("<lora:name:weight> を位置つきで拾う。重みが無ければ 1、数でなければ 1", () => {
    expect(findLoras("a <lora:x:0.8>, <lora:y>, <lora:z:abc>, <lora:w:0.5:lbw=1>")).toEqual([
      { name: "x", weight: 0.8, from: 2, to: 14 },
      { name: "y", weight: 1, from: 16, to: 24 },
      { name: "z", weight: 1, from: 26, to: 38 },
      { name: "w", weight: 0.5, from: 40, to: 58 },
    ]);
  });
});

describe("setLoraWeight / removeLora / addLora", () => {
  it("重みを書き換える", () => {
    const text = "a, <lora:x:0.8>, b";
    expect(setLoraWeight(text, findLoras(text)[0], 0.5)).toBe("a, <lora:x:0.5>, b");
  });

  it("外すときは後ろの区切りごと (後ろに無ければ前の区切りごと)", () => {
    const mid = "a, <lora:x:1>, b";
    expect(removeLora(mid, findLoras(mid)[0])).toBe("a, b");
    const last = "a, <lora:x:1>";
    expect(removeLora(last, findLoras(last)[0])).toBe("a");
    const only = "<lora:x:1>";
    expect(removeLora(only, findLoras(only)[0])).toBe("");
  });

  it("末尾に足す (区切りは中身に合わせる)", () => {
    expect(addLora("", "x")).toBe("<lora:x:1>");
    expect(addLora("a", "x", 0.7)).toBe("a, <lora:x:0.7>");
    expect(addLora("a, ", "x")).toBe("a, <lora:x:1>");
    expect(addLora("a\n", "x")).toBe("a, <lora:x:1>");
  });
});
