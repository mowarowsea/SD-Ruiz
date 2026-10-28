import { describe, expect, test } from "vitest";
import type { Meta, Sample } from "./api";
import { matchSampler, sampleParams, schedulerLabel } from "./recommend";

const meta = {
  samplers: ["Euler a", "DPM++ 2M"],
  schedulers: [
    { name: "automatic", label: "Automatic" },
    { name: "karras", label: "Karras" },
    { name: "sgm_uniform", label: "SGM Uniform" },
  ],
} as Meta;

const sample = (over: Partial<Sample>): Sample => ({ url: "", width: 832, height: 1216, nsfwLevel: 1, prompt: "", negative: "", steps: 28, cfg: 5, sampler: "Euler a", scheduler: null, seed: null, clipSkip: null, ...over });

describe("matchSampler", () => {
  test("大文字小文字を無視して Forge の名前にする。Scheduler は表示名でも引ける", () => {
    expect(matchSampler(meta, "euler a", "sgm uniform")).toEqual({ sampler: "Euler a", scheduler: "sgm_uniform" });
  });

  test("「DPM++ 2M Karras」のような古い書き方は Sampler と Scheduler に分ける", () => {
    expect(matchSampler(meta, "DPM++ 2M Karras", null)).toEqual({ sampler: "DPM++ 2M", scheduler: "karras" });
    // Scheduler を別に指定してあればそちらが勝つ
    expect(matchSampler(meta, "DPM++ 2M Karras", "automatic")).toEqual({ sampler: "DPM++ 2M", scheduler: "automatic" });
  });

  test("合わないものと meta が無いときは null", () => {
    expect(matchSampler(meta, "Nope", "Nope")).toEqual({ sampler: null, scheduler: null });
    expect(matchSampler(null, "Euler a", null)).toEqual({ sampler: null, scheduler: null });
  });
});

describe("sampleParams", () => {
  test("サイズは 8 の倍数に丸め、Steps は整数に", () => {
    expect(sampleParams(meta, sample({ width: 835, height: 1213, steps: 28.4, scheduler: "Karras" }))).toEqual({
      patch: { width: 832, height: 1216, steps: 28, cfg: 5, sampler: "Euler a", scheduler: "karras" },
      skipped: [],
    });
  });

  test("拡大後のサイズ・大きすぎる Steps / CFG・合わない Sampler は外して、外したものを返す", () => {
    expect(sampleParams(meta, sample({ width: 2048, height: 3072, steps: 200, cfg: 40, sampler: "Nope", scheduler: "Nope" }))).toEqual({
      patch: {},
      skipped: ["サイズ 2048×3072 (拡大後)", "Sampler Nope", "Scheduler Nope"],
    });
  });

  test("値が無い項目は何もしない", () => {
    expect(sampleParams(meta, sample({ width: 0, height: 0, steps: null, cfg: null, sampler: null }))).toEqual({ patch: {}, skipped: [] });
  });
});

test("schedulerLabel は name を表示名にする (無ければそのまま)", () => {
  expect(schedulerLabel(meta, "sgm_uniform")).toBe("SGM Uniform");
  expect(schedulerLabel(meta, "nope")).toBe("nope");
  expect(schedulerLabel(null, "karras")).toBe("karras");
});
