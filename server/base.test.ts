import { expect, test } from "vitest";
import { archNeedsModules, archOf, builtinBaseSettings, familyOf } from "./base.js";

test("familyOf は Civitai のベースモデル名を設定の単位にそろえる。分からなければそのまま", () => {
  expect(["Illustrious", "NoobAI XL", "Pony", "Anima", "SDXL 1.0", "Flux.1 D", "SD 1.5", "SD1.5", "SD 2.1", "SD 3.5", "Other"].map(familyOf)).toEqual(["Illustrious", "NoobAI", "Pony", "Anima", "SDXL", "Flux", "SD 1.5", "SD 1.5", "SD 2", "SD 3", "Other"]);
  expect(familyOf(null)).toBeNull();
  expect(familyOf("")).toBeNull();
});

test("archOf: Illustrious / NoobAI / Pony / SDXL はどれも sdxl。知らないものは null", () => {
  expect(["Illustrious", "NoobAI", "Pony", "SDXL"].map(archOf)).toEqual(["sdxl", "sdxl", "sdxl", "sdxl"]);
  expect(["SD 1.5", "SD 2", "SD 3", "Flux", "Anima"].map(archOf)).toEqual(["sd1", "sd2", "sd3", "flux", "anima"]);
  expect(archOf("Other")).toBeNull();
  expect(archOf(null)).toBeNull();
});

test("Anima は TE / VAE が必須で、組み込みの既定を持つ", () => {
  expect(archNeedsModules.has("anima")).toBe(true);
  expect(archNeedsModules.has("sdxl")).toBe(false);
  expect(builtinBaseSettings.Anima.modules).toEqual(["qwen_3_06b_base.safetensors", "qwen_image_vae.safetensors"]);
  expect(builtinBaseSettings.Anima.params).toMatchObject({ width: 832, height: 1216, steps: 32, cfg: 4 });
});
