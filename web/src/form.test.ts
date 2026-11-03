import { describe, expect, it } from "vitest";
import { defaultForm, toForm } from "./form";

describe("toForm", () => {
  it("フォームの項目だけを取り出し、無い項目は既定で埋める", () => {
    const out = toForm({ prompt: "1girl", steps: 10, modules: ["te"], seed: 5 } as never);
    expect(out).toEqual({ ...defaultForm, prompt: "1girl", steps: 10, seed: 5 });
    expect(out).not.toHaveProperty("modules");
    expect(toForm({})).toEqual(defaultForm);
    expect(toForm({})).not.toBe(defaultForm);
  });
});
