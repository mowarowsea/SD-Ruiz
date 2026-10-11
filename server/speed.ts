// 生成の速さと画質を変える設定 (Params の「DMD2」「高速化」「PAG」「APG」)。フォームの値は変えず、Forge に送る直前に差し替える。
// 数字は 2026-10-11 のベンチマーク (semiRealIllustrious・960x1440・20 ステップ比) から

import type { Txt2ImgRequest } from "./forge.js";

/** forge-extensions/ruiz-spectrum のスクリプト名 */
export const SPECTRUM_SCRIPT = "Spectrum (Ruiz)";
/** forge-extensions/ruiz-guidance のスクリプト名 */
export const GUIDANCE_SCRIPT = "Guidance (Ruiz)";

/**
 * Spectrum (Ruiz) の引数: [有効, 予測の重み, 多項式の次数, 正則化, 何ステップに 1 回計算するか, その伸び方, 最初に必ず計算するステップ数, 最後に必ず計算する割合]
 * 1.27 倍速く、絵がほぼ変わらなかった設定
 */
const spectrumArgs = [true, 0.25, 6, 0.5, 2, 0, 6, 0.9];

/** PAG の強さ。3 だと陰影を描き込みすぎ、2 で追従が上がりトーンの変化も許容内だった */
export const PAG_SCALE = 2;
/** APG のときの CFG。APG は CFG を上げても焼けにくくする仕組みなので、CFG を上げて使う */
export const APG_CFG = 10;
/** APG の引数: [eta (平行成分を残す割合), 押す強さの上限, momentum] */
const apgArgs = [0, 15, -0.5];

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

export interface SpeedOptions {
  fast: boolean;
  dmd2: Dmd2Mode;
  pag: boolean;
  apg: boolean;
  dmd2Lora: string;
}

export function applySpeed(req: Txt2ImgRequest, opts: SpeedOptions): Txt2ImgRequest {
  if (opts.dmd2 !== "off") {
    // DMD2 はステップが少なく Spectrum の省ける余地が無く、CFG も低いので PAG / APG も重ねない
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
  const out = { ...req, alwayson_scripts: { ...req.alwayson_scripts } };
  if (opts.fast) out.alwayson_scripts[SPECTRUM_SCRIPT] = { args: spectrumArgs };
  if (opts.pag || opts.apg) out.alwayson_scripts[GUIDANCE_SCRIPT] = { args: [true, opts.pag ? PAG_SCALE : 0, opts.apg, ...apgArgs] };
  if (opts.apg) out.cfg_scale = APG_CFG;
  return out;
}
