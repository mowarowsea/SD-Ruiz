import { expect, test } from "vitest";
import { defaultForm, toForm } from "./form";

test("toForm はフォームの項目だけを取り出し、無い項目は既定にする", () => {
  expect(toForm({})).toEqual(defaultForm);
  const out = toForm({ prompt: "a", steps: 10, save: true, modules: ["x"] } as never);
  expect(out).toEqual({ ...defaultForm, prompt: "a", steps: 10 });
  expect("save" in out).toBe(false);
});

test("既定の値は書き換わらない", () => {
  const out = toForm({ prompt: "a" });
  out.prompt = "b";
  expect(defaultForm.prompt).toBe("");
});
