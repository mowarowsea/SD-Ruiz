// 推奨設定と作例を生成画面の値に合わせる

import type { GenerateParams, Meta, Sample } from "./api";

/**
 * 作例の Sampler / Scheduler を Forge の名前にする。
 * 「DPM++ 2M Karras」のような古い書き方は Sampler と Scheduler に分ける。合わないものは null
 */
export function matchSampler(meta: Meta | null, sampler: string | null, scheduler: string | null) {
  if (!meta) return { sampler: null, scheduler: null };
  const lc = (s: string) => s.trim().toLowerCase();
  const findSampler = (s: string) => meta.samplers.find((x) => lc(x) === lc(s)) ?? null;
  const findScheduler = (s: string) => meta.schedulers.find((x) => lc(x.name) === lc(s) || lc(x.label) === lc(s))?.name ?? null;
  let outSampler = sampler ? findSampler(sampler) : null;
  let outScheduler = scheduler ? findScheduler(scheduler) : null;
  if (sampler && !outSampler) {
    for (const s of meta.schedulers) {
      const suffix = ` ${lc(s.label)}`;
      if (!lc(sampler).endsWith(suffix)) continue;
      const head = findSampler(sampler.slice(0, -suffix.length));
      if (head) {
        outSampler = head;
        outScheduler ??= s.name;
        break;
      }
    }
  }
  return { sampler: outSampler, scheduler: outScheduler };
}

/** 作例の設定を生成画面の値にする。Forge に無い名前や Hires fix 後のサイズは外して、何を外したかを返す */
export function sampleParams(meta: Meta | null, s: Sample) {
  const patch: Partial<GenerateParams> = {};
  const skipped: string[] = [];
  const m = matchSampler(meta, s.sampler, s.scheduler);
  if (s.width >= 64 && s.height >= 64 && s.width <= 1600 && s.height <= 1600) {
    patch.width = Math.round(s.width / 8) * 8;
    patch.height = Math.round(s.height / 8) * 8;
  } else if (s.width) skipped.push(`サイズ ${s.width}×${s.height} (拡大後)`);
  if (s.steps && s.steps <= 150) patch.steps = Math.round(s.steps);
  if (s.cfg !== null && s.cfg <= 30) patch.cfg = s.cfg;
  if (m.sampler) patch.sampler = m.sampler;
  else if (s.sampler) skipped.push(`Sampler ${s.sampler}`);
  if (m.scheduler) patch.scheduler = m.scheduler;
  else if (s.scheduler) skipped.push(`Scheduler ${s.scheduler}`);
  return { patch, skipped };
}

/** Scheduler の name を表示名にする */
export function schedulerLabel(meta: Meta | null, name: string) {
  return meta?.schedulers.find((s) => s.name === name)?.label ?? name;
}
