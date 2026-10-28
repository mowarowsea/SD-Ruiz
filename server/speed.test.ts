import { describe, expect, test } from "vitest";
import type { Txt2ImgRequest } from "./forge.js";
import { APG_CFG, GUIDANCE_SCRIPT, PAG_SCALE, SPECTRUM_SCRIPT, applySpeed, dmd2Presets } from "./speed.js";

const req: Txt2ImgRequest = {
  prompt: "1girl",
  negative_prompt: "bad",
  width: 832,
  height: 1216,
  steps: 28,
  cfg_scale: 5,
  sampler_name: "Euler a",
  scheduler: "automatic",
  seed: -1,
  batch_size: 1,
  n_iter: 2,
  save_images: true,
  override_settings: {},
  override_settings_restore_afterwards: false,
  alwayson_scripts: {},
};
const off = { fast: false, dmd2: "off" as const, pag: false, apg: false, dmd2Lora: "dmd2" };

describe("applySpeed", () => {
  test("全部オフなら何も変えない。元のリクエストも書き換えない", () => {
    const before = structuredClone(req);
    expect(applySpeed(req, off)).toEqual(req);
    applySpeed(req, { ...off, fast: true, pag: true, apg: true });
    applySpeed(req, { ...off, dmd2: "fast" });
    expect(req).toEqual(before);
  });

  test("高速化は Spectrum (Ruiz) を alwayson_scripts に付ける", () => {
    const out = applySpeed(req, { ...off, fast: true });
    expect(Object.keys(out.alwayson_scripts)).toEqual([SPECTRUM_SCRIPT]);
    expect(out.alwayson_scripts[SPECTRUM_SCRIPT].args[0]).toBe(true);
    expect(out.cfg_scale).toBe(5);
  });

  test("PAG は Guidance (Ruiz) に強さを渡し、APG は CFG を差し替える。重ねられる", () => {
    const pag = applySpeed(req, { ...off, pag: true });
    expect(pag.alwayson_scripts[GUIDANCE_SCRIPT].args.slice(0, 3)).toEqual([true, PAG_SCALE, false]);
    expect(pag.cfg_scale).toBe(5);

    const apg = applySpeed(req, { ...off, apg: true });
    expect(apg.alwayson_scripts[GUIDANCE_SCRIPT].args.slice(0, 3)).toEqual([true, 0, true]);
    expect(apg.cfg_scale).toBe(APG_CFG);

    const all = applySpeed(req, { ...off, fast: true, pag: true, apg: true });
    expect(Object.keys(all.alwayson_scripts).sort()).toEqual([GUIDANCE_SCRIPT, SPECTRUM_SCRIPT].sort());
    expect(all.alwayson_scripts[GUIDANCE_SCRIPT].args.slice(0, 3)).toEqual([true, PAG_SCALE, true]);
  });

  test("DMD2 は LoRA を足して Steps / CFG / Sampler / Scheduler を差し替え、高速化・PAG・APG は重ねない", () => {
    for (const mode of ["fast", "balanced"] as const) {
      const p = dmd2Presets[mode];
      const out = applySpeed(req, { ...off, dmd2: mode, fast: true, pag: true, apg: true });
      expect(out).toMatchObject({ prompt: `1girl\n<lora:dmd2:${p.weight}>`, steps: p.steps, cfg_scale: p.cfg, sampler_name: p.sampler, scheduler: p.scheduler, alwayson_scripts: {} });
      expect(out.n_iter).toBe(2);
    }
  });
});
