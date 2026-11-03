import { describe, expect, it } from "vitest";
import type { Meta } from "./api";
import { infotextToParams, parseInfotext } from "./infotext";

const sample = [
  "1girl, blue hair,",
  "smile",
  "Negative prompt: lowres,",
  "bad anatomy",
  'Steps: 28, Sampler: Euler a, Schedule type: Karras, CFG scale: 5, Seed: 123, Size: 832x1216, Model: foo, Lora hashes: "a: 1, b: 2", Template: "1girl, __hair__",',
].join("\n");

describe("parseInfotext", () => {
  it("プロンプト (複数行)・Negative・パラメータに分ける。引用符つきの値は中のカンマで切らない", () => {
    const r = parseInfotext(sample);
    expect(r.prompt).toBe("1girl, blue hair,\nsmile");
    expect(r.negative).toBe("lowres,\nbad anatomy");
    expect(r.params).toEqual({
      Steps: "28",
      Sampler: "Euler a",
      "Schedule type": "Karras",
      "CFG scale": "5",
      Seed: "123",
      Size: "832x1216",
      Model: "foo",
      "Lora hashes": "a: 1, b: 2",
      Template: "1girl, __hair__",
    });
  });

  it("Negative もパラメータも無いもの", () => {
    expect(parseInfotext("just a prompt")).toEqual({ prompt: "just a prompt", negative: "", params: {} });
  });
});

describe("infotextToParams", () => {
  const meta: Meta = {
    current: null,
    models: [
      { title: "sd\\foo.safetensors [abcd]", name: "foo", base: null, family: null, arch: null, preview: false, mtime: 0 },
      { title: "bar.safetensors", name: "bar", base: null, family: null, arch: null, preview: false, mtime: 0 },
    ],
    samplers: ["Euler a"],
    schedulers: [{ name: "karras", label: "Karras" }],
    dmd2: { lora: "dmd2_lora", presets: { fast: { weight: 1, steps: 8, cfg: 1, sampler: "LCM", scheduler: "sgm_uniform" }, balanced: { weight: 0.6, steps: 10, cfg: 2, sampler: "LCM", scheduler: "sgm_uniform" } } },
    apgCfg: 10,
  };

  it("Dynamic Prompts のテンプレートがあればそちらを使い、数値・サイズ・Scheduler (label から name)・Model を合わせる", () => {
    const p = infotextToParams(parseInfotext(sample), meta);
    expect(p).toEqual({
      prompt: "1girl, __hair__",
      negative: "lowres,\nbad anatomy",
      steps: 28,
      cfg: 5,
      seed: 123,
      width: 832,
      height: 1216,
      sampler: "Euler a",
      scheduler: "karras",
      fast: false,
      pag: false,
      apg: false,
      dmd2: "off",
      checkpoint: "sd\\foo.safetensors [abcd]",
    });
  });

  it("Forge に無い Sampler / Scheduler は持ってこない (meta が無ければ Sampler はそのまま)", () => {
    const info = parseInfotext("a\nSteps: 20, Sampler: DPM++ 3M, Schedule type: Weird");
    expect(infotextToParams(info, meta)).not.toHaveProperty("sampler");
    expect(infotextToParams(info, meta)).not.toHaveProperty("scheduler");
    expect(infotextToParams(info, null).sampler).toBe("DPM++ 3M");
  });

  it("Spectrum / PAG / APG の印を見る。APG のときの CFG は APG 用なので持ってこない", () => {
    const info = parseInfotext("a\nSteps: 20, CFG scale: 10, spec_w: 0.25, pag_scale: 2, apg: True");
    const p = infotextToParams(info, meta);
    expect(p).toMatchObject({ fast: true, pag: true, apg: true });
    expect(p).not.toHaveProperty("cfg");
  });

  it("DMD2 の LoRA が入っていれば外して DMD2 モードに戻し、Steps などは持ってこない", () => {
    const fast = infotextToParams(parseInfotext("1girl\n<lora:dmd2_lora:1>\nSteps: 8, CFG scale: 1, Sampler: LCM"), meta);
    expect(fast).toMatchObject({ prompt: "1girl", dmd2: "fast" });
    expect(fast).not.toHaveProperty("steps");
    expect(fast).not.toHaveProperty("cfg");
    expect(fast).not.toHaveProperty("sampler");
    expect(infotextToParams(parseInfotext("1girl, <lora:dmd2_lora:0.6>\nSteps: 10"), meta)).toMatchObject({ prompt: "1girl,", dmd2: "balanced" });
  });
});
