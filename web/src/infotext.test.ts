import { describe, expect, test } from "vitest";
import type { Meta } from "./api";
import { infotextToParams, parseInfotext } from "./infotext";

const meta: Meta = {
  current: null,
  models: [
    { title: "sd\\anime\\foo.safetensors [abcd1234]", name: "foo", base: null, family: null, arch: null, preview: false, mtime: 0 },
    { title: "bar.safetensors", name: "bar", base: null, family: null, arch: null, preview: false, mtime: 0 },
  ],
  samplers: ["Euler a", "LCM"],
  schedulers: [
    { name: "automatic", label: "Automatic" },
    { name: "sgm_uniform", label: "SGM Uniform" },
  ],
  dmd2: {
    lora: "dmd2_sdxl_4step_lora_fp16",
    presets: {
      fast: { weight: 1, steps: 8, cfg: 1, sampler: "LCM", scheduler: "sgm_uniform" },
      balanced: { weight: 0.6, steps: 10, cfg: 2, sampler: "LCM", scheduler: "sgm_uniform" },
    },
  },
  apgCfg: 10,
};

describe("parseInfotext", () => {
  test("複数行のプロンプト・Negative・最後の行のパラメータに分ける", () => {
    const info = parseInfotext('1girl, (blue hair:1.2)\nsecond line\nNegative prompt: lowres, bad\nSteps: 28, Sampler: Euler a, Schedule type: Automatic, CFG scale: 5, Seed: 123, Size: 832x1216, Model: foo, Template: "1girl, {a|b}", Lora hashes: "x: abc, y: def"');
    expect(info.prompt).toBe("1girl, (blue hair:1.2)\nsecond line");
    expect(info.negative).toBe("lowres, bad");
    expect(info.params).toEqual({
      Steps: "28",
      Sampler: "Euler a",
      "Schedule type": "Automatic",
      "CFG scale": "5",
      Seed: "123",
      Size: "832x1216",
      Model: "foo",
      Template: "1girl, {a|b}",
      "Lora hashes": "x: abc, y: def",
    });
  });

  test("Negative やパラメータが無くても読める", () => {
    expect(parseInfotext("a, b\nSteps: 1")).toEqual({ prompt: "a, b", negative: "", params: { Steps: "1" } });
    expect(parseInfotext("a, b")).toEqual({ prompt: "a, b", negative: "", params: {} });
    expect(parseInfotext("Steps: 1, Seed: 2")).toEqual({ prompt: "", negative: "", params: { Steps: "1", Seed: "2" } });
  });

  test("引用符の中のエスケープを戻す", () => {
    expect(parseInfotext('x\nSteps: 1, Template: "a \\"b\\" c"').params.Template).toBe('a "b" c');
  });
});

describe("infotextToParams", () => {
  test("Template があればそちらをプロンプトにし、数値とサイズと Model を生成画面の値にする", () => {
    const info = parseInfotext('1girl, {a}\nNegative prompt: bad\nSteps: 28, Sampler: Euler a, Schedule type: Automatic, CFG scale: 5, Seed: 123, Size: 832x1216, Model: foo, Template: "1girl, {a|b}", Negative Template: "bad # c"');
    expect(infotextToParams(info, meta)).toEqual({
      prompt: "1girl, {a|b}",
      negative: "bad # c",
      steps: 28,
      cfg: 5,
      seed: 123,
      width: 832,
      height: 1216,
      sampler: "Euler a",
      scheduler: "automatic",
      fast: false,
      pag: false,
      apg: false,
      dmd2: "off",
      checkpoint: "sd\\anime\\foo.safetensors [abcd1234]",
    });
  });

  test("Forge に無い Sampler / Scheduler / Model は持ってこない", () => {
    const info = parseInfotext("a\nSteps: 10, Sampler: DPM++ 2M, Schedule type: Karras, Model: nope");
    const out = infotextToParams(info, meta);
    expect(out.sampler).toBeUndefined();
    expect(out.scheduler).toBeUndefined();
    expect(out.checkpoint).toBeUndefined();
    // meta がまだ無ければ Sampler はそのまま
    expect(infotextToParams(info, null).sampler).toBe("DPM++ 2M");
  });

  test("Model はファイル名での部分一致でも探す", () => {
    expect(infotextToParams(parseInfotext("a\nSteps: 1, Model: bar"), meta).checkpoint).toBe("bar.safetensors");
  });

  test("Spectrum / PAG / APG の生成情報があればオンにし、APG のときは CFG を持ってこない", () => {
    const out = infotextToParams(parseInfotext("a\nSteps: 20, CFG scale: 10, spec_w: 0.25, pag_scale: 2, apg: True"), meta);
    expect(out).toMatchObject({ fast: true, pag: true, apg: true });
    expect(out.cfg).toBeUndefined();
    expect(infotextToParams(parseInfotext("a\nSteps: 20, CFG scale: 10, pag_scale: 2"), meta).cfg).toBe(10);
  });

  test("DMD2 の LoRA があれば外して DMD2 モードに戻し、Steps などは持ってこない", () => {
    const fast = infotextToParams(parseInfotext("1girl\n<lora:dmd2_sdxl_4step_lora_fp16:1>\nSteps: 8, Sampler: LCM, Schedule type: SGM Uniform, CFG scale: 1, Seed: 1, Size: 832x1216"), meta);
    expect(fast).toEqual({ prompt: "1girl", negative: "", seed: 1, width: 832, height: 1216, fast: false, pag: false, apg: false, dmd2: "fast" });
    const balanced = infotextToParams(parseInfotext("1girl\n<lora:dmd2_sdxl_4step_lora_fp16:0.6>\nSteps: 10"), meta);
    expect(balanced.dmd2).toBe("balanced");
    expect(balanced.steps).toBeUndefined();
  });
});
