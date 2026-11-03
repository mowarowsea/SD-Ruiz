import { describe, expect, it } from "vitest";
import type { Txt2ImgRequest } from "./forge.js";
import { APG_CFG, applySpeed, dmd2Presets, GUIDANCE_SCRIPT, PAG_SCALE, SPECTRUM_SCRIPT } from "./speed.js";

const base: Txt2ImgRequest = {
  prompt: "1girl",
  negative_prompt: "lowres",
  width: 832,
  height: 1216,
  steps: 28,
  cfg_scale: 5,
  sampler_name: "Euler a",
  scheduler: "automatic",
  seed: 1,
  batch_size: 1,
  n_iter: 2,
  save_images: true,
  override_settings: {},
  override_settings_restore_afterwards: false,
  alwayson_scripts: { Existing: { args: [1] } },
};

const off = { fast: false, dmd2: "off" as const, pag: false, apg: false, dmd2Lora: "dmd2" };

describe("applySpeed", () => {
  it("何も使わなければそのまま (元の要求は書き換えない)", () => {
    const out = applySpeed(base, off);
    expect(out).toEqual(base);
    expect(out).not.toBe(base);
    expect(out.alwayson_scripts).not.toBe(base.alwayson_scripts);
  });

  it("高速化は Spectrum (Ruiz) のスクリプトを足す。ほかのスクリプトは残す", () => {
    const out = applySpeed(base, { ...off, fast: true });
    expect(out.alwayson_scripts.Existing).toEqual({ args: [1] });
    expect(out.alwayson_scripts[SPECTRUM_SCRIPT].args[0]).toBe(true);
    expect(out.cfg_scale).toBe(5);
    expect(base.alwayson_scripts[SPECTRUM_SCRIPT]).toBeUndefined();
  });

  it("PAG は Guidance (Ruiz) に PAG の強さを渡し、APG は使わない", () => {
    const out = applySpeed(base, { ...off, pag: true });
    expect(out.alwayson_scripts[GUIDANCE_SCRIPT].args.slice(0, 3)).toEqual([true, PAG_SCALE, false]);
    expect(out.cfg_scale).toBe(5);
  });

  it("APG は CFG を APG 用の値にし、PAG の強さは 0", () => {
    const out = applySpeed(base, { ...off, apg: true });
    expect(out.alwayson_scripts[GUIDANCE_SCRIPT].args.slice(0, 3)).toEqual([true, 0, true]);
    expect(out.cfg_scale).toBe(APG_CFG);
  });

  it("PAG と APG は同時に使える", () => {
    const out = applySpeed(base, { ...off, pag: true, apg: true });
    expect(out.alwayson_scripts[GUIDANCE_SCRIPT].args.slice(0, 3)).toEqual([true, PAG_SCALE, true]);
    expect(out.cfg_scale).toBe(APG_CFG);
  });

  it.each(["fast", "balanced"] as const)("DMD2 (%s) は LoRA を足して Steps / CFG / Sampler / Scheduler を差し替え、ほかの高速化は重ねない", (mode) => {
    const p = dmd2Presets[mode];
    const out = applySpeed(base, { ...off, dmd2: mode, fast: true, pag: true, apg: true, dmd2Lora: "dmd2_sdxl_4step_lora_fp16" });
    expect(out.prompt).toBe(`1girl\n<lora:dmd2_sdxl_4step_lora_fp16:${p.weight}>`);
    expect(out.steps).toBe(p.steps);
    expect(out.cfg_scale).toBe(p.cfg);
    expect(out.sampler_name).toBe("LCM");
    expect(out.scheduler).toBe("sgm_uniform");
    expect(Object.keys(out.alwayson_scripts)).toEqual(["Existing"]);
  });
});
