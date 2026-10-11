// 生成を速くする設定 (Params の「高速化」と「DMD2」)。フォームの値は変えず、Forge に送る直前に差し替える。
// 数字は 2026-10-11 のベンチマーク (semiRealIllustrious・960x1440・20 ステップ比) から

import type { Txt2ImgRequest } from "./forge.js";

/** forge-extensions/ruiz-spectrum のスクリプト名 */
export const SPECTRUM_SCRIPT = "Spectrum (Ruiz)";

/**
 * Spectrum (Ruiz) の引数: [有効, 予測の重み, 多項式の次数, 正則化, 何ステップに 1 回計算するか, その伸び方, 最初に必ず計算するステップ数, 最後に必ず計算する割合]
 * 1.27 倍速く、絵がほぼ変わらなかった設定
 */
const spectrumArgs = [true, 0.25, 6, 0.5, 2, 0, 6, 0.9];

export type Dmd2Mode = "off" | "fast" | "balanced";

/**
 * DMD2 (少ないステップで描けるよう蒸留した LoRA) を使うときの設定。
 * fast: CFG 1 で uncond の計算を省く。×3.2 だが Negative が効かず、表情などの追従も少し弱まる
 * balanced: 重みを下げて CFG 2。×2.1 で Negative も効く
 */
export const dmd2Presets = {
  fast: { weight: 1, steps: 8, cfg: 1, sampler: "LCM", scheduler: "sgm_uniform" },
  balanced: { weight: 0.6, steps: 10, cfg: 2, sampler: "LCM", scheduler: "sgm_uniform" },
} as const;

export function applySpeed(req: Txt2ImgRequest, opts: { fast: boolean; dmd2: Dmd2Mode; dmd2Lora: string }): Txt2ImgRequest {
  if (opts.dmd2 !== "off") {
    // DMD2 はステップが少なく Spectrum の省ける余地が無いので、高速化は重ねない
    const p = dmd2Presets[opts.dmd2];
    return {
      ...req,
      prompt: `${req.prompt}\n<lora:${opts.dmd2Lora}:${p.weight}>`,
      steps: p.steps,
      cfg_scale: p.cfg,
      sampler_name: p.sampler,
      scheduler: p.scheduler,
    };
  }
  if (opts.fast) return { ...req, alwayson_scripts: { ...req.alwayson_scripts, [SPECTRUM_SCRIPT]: { args: spectrumArgs } } };
  return req;
}
