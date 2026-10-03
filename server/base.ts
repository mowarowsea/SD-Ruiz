// ベースモデル (Illustrious / Pony / Anima ...) の正規化と、ベースモデルごとの既定の設定

import type { ModelParams } from "./prefs.js";

/**
 * Civitai などのベースモデル名 ("Illustrious" / "SDXL 1.0" / "Pony" ...) を、設定をまとめる単位の名前にそろえる。
 * 分からなければ null
 */
export function familyOf(base: string | null): string | null {
  if (!base) return null;
  if (/illustrious/i.test(base)) return "Illustrious";
  if (/noob/i.test(base)) return "NoobAI";
  if (/pony/i.test(base)) return "Pony";
  if (/anima/i.test(base)) return "Anima";
  if (/sdxl/i.test(base)) return "SDXL";
  if (/flux/i.test(base)) return "Flux";
  if (/^sd ?1/i.test(base)) return "SD 1.5";
  if (/^sd ?2/i.test(base)) return "SD 2";
  if (/^sd ?3/i.test(base)) return "SD 3";
  return base;
}

/**
 * 中身の構造 (アーキテクチャ)。同じものどうしなら LoRA が使える (Illustrious / Pony / SDXL はどれも sdxl)。
 * 分からなければ null
 */
export function archOf(family: string | null): string | null {
  switch (family) {
    case "Illustrious":
    case "NoobAI":
    case "Pony":
    case "SDXL":
      return "sdxl";
    case "SD 1.5":
      return "sd1";
    case "SD 2":
      return "sd2";
    case "SD 3":
      return "sd3";
    case "Flux":
      return "flux";
    case "Anima":
      return "anima";
    default:
      return null;
  }
}

/** ベースモデルごとの既定。モデルごとの設定 (前回の値・TE/VAE の個別指定) が無いときに使う */
export interface BaseSettings {
  /** 初めて選んだときのパラメータ。null なら生成画面の今の値のまま */
  params: ModelParams | null;
  /** Forge の「VAE / Text Encoder」に渡すファイル名 (models/VAE・models/text_encoder の中) */
  modules: string[];
}

/** 何も設定していないときの既定。Anima は Forge Neo のプリセット (modules_forge/presets.py) に合わせる */
export const builtinBaseSettings: Record<string, BaseSettings> = {
  Anima: {
    params: { width: 832, height: 1216, steps: 32, cfg: 4, sampler: "ER SDE", scheduler: "beta" },
    modules: ["qwen_3_06b_base.safetensors", "qwen_image_vae.safetensors"],
  },
};

/** TE と VAE を別に入れないと動かないアーキテクチャ (Checkpoint に DiT しか入っていない。Flux は全部入りの配布もあるので入れない) */
export const archNeedsModules = new Set(["anima"]);
