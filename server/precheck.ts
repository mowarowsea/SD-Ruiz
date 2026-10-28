// 生成の前の確認。だめなら Forge に送らずに 400 で止める。
//
// Forge は渡したものが無くても教えてくれない:
// - 知らない Checkpoint → 黙っていま読み込んでいるモデルで生成する
// - 知らない TE / VAE のファイル名 → 黙って捨て、TE が無いまま読み込もうとして分かりにくい落ち方をする
// - 知らない LoRA (<lora:名前>) → 黙って無視する (DMD2 モードが効かないまま 8 ステップで生成する)
// - 知らないスクリプト名 (alwayson_scripts) → エラーにはなるが英語の 500
// なのでここで先に確かめて、どうすればいいかを日本語で出す

import { archNeedsModules, archOf, familyOf } from "./base.js";
import type { ForgeClient } from "./forge.js";
import type { GenerateParams } from "./jobs.js";
import { GUIDANCE_SCRIPT, SPECTRUM_SCRIPT } from "./speed.js";

/** 設定が足りなくて生成できないとき (400 で返す) */
export class SetupError extends Error {
  readonly statusCode = 400;
}

export interface PrecheckDeps {
  /** Checkpoint の title → 実ファイル。知らない title なら一覧を取り直してから引く。無ければ null */
  checkpointFile(title: string): Promise<string | null>;
  /** 実ファイルのベースモデル名 ("Illustrious" / "Anima" ...。付随ファイルか safetensors のヘッダから)。分からなければ null */
  baseOf(file: string): string | null;
  /** このモデルで使う TE / VAE (モデルごとの指定 > ベースモデルの既定) */
  modulesFor(checkpoint: string, family: string | null): string[];
  forge: Pick<ForgeClient, "modules" | "loras" | "scripts">;
  /** DMD2 モードで使う LoRA の名前 (config の dmd2Lora) */
  dmd2Lora: string;
}

/**
 * Checkpoint が Forge にあるか確かめ、このモデルで使う TE / VAE を決めて、それも Forge にあるか確かめる。
 * ベースモデルの名前 (familyOf) も返す (checkSpeed で使う)
 */
export async function resolveModules(checkpoint: string, deps: PrecheckDeps): Promise<{ family: string | null; modules: string[] }> {
  const file = await deps.checkpointFile(checkpoint);
  if (!file) throw new SetupError(`Checkpoint が見つかりません: ${checkpoint}`);
  const family = familyOf(deps.baseOf(file));
  const modules = deps.modulesFor(checkpoint, family);
  const label = family ?? "このモデル";
  if (!modules.length) {
    if (archNeedsModules.has(archOf(family) ?? "")) throw new SetupError(`${label} は Text Encoder と VAE を別に指定しないと使えません。Extras の「モデルの設定」で選んでください`);
    return { family, modules: [] };
  }
  const have = new Set((await deps.forge.modules()).map((m) => m.model_name));
  const missing = modules.filter((m) => !have.has(m));
  if (missing.length)
    throw new SetupError(
      `${label} に使う Text Encoder / VAE が Forge にありません: ${missing.join(", ")}。` +
        "models/text_encoder か models/VAE に置いて Forge を再起動するか (Forge は起動したときにしか一覧を読みません)、Extras の「モデルの設定」で選び直してください",
    );
  return { family, modules };
}

/** 高速化 / DMD2 / PAG / APG を使えるか確かめる (SDXL 系か、DMD2 の LoRA と Forge の拡張があるか)。使わないなら何もしない */
export async function checkSpeed(p: GenerateParams, family: string | null, deps: PrecheckDeps): Promise<void> {
  const dmd2 = p.dmd2 !== "off";
  if (!p.fast && !dmd2 && !p.pag && !p.apg) return;
  const what = [dmd2 && "DMD2", p.fast && "高速化", p.pag && "PAG", p.apg && "APG"].filter(Boolean).join(" / ");
  if (archOf(family) !== "sdxl") throw new SetupError(`${what} は SDXL 系のモデル (Illustrious / NoobAI / Pony / SDXL) でしか使えません`);
  if (dmd2) {
    // DMD2 中は高速化・PAG・APG を重ねない (speed.ts) ので、拡張の有無は見ない
    if (!(await deps.forge.loras()).some((l) => l.name === deps.dmd2Lora))
      throw new SetupError(`DMD2 の LoRA (${deps.dmd2Lora}) が Forge にありません。models/Lora に置いて LoRA の一覧を再読込してください (別の名前なら config.json の dmd2Lora)`);
    return;
  }
  const { txt2img } = await deps.forge.scripts();
  const need = [p.fast && ["高速化", SPECTRUM_SCRIPT, "ruiz-spectrum"], (p.pag || p.apg) && ["PAG / APG", GUIDANCE_SCRIPT, "ruiz-guidance"]].filter((x): x is string[] => !!x);
  for (const [label, script, dir] of need)
    if (!txt2img.includes(script.toLowerCase()))
      throw new SetupError(`${label}に使う Forge の拡張 (${script}) がありません。forge-extensions/${dir} を Forge の extensions につないで、Forge を再起動してください`);
}

/** 生成の前の確認をまとめて。通れば Forge に渡す TE / VAE を返す */
export async function precheck(p: GenerateParams, deps: PrecheckDeps): Promise<string[]> {
  const { family, modules } = await resolveModules(p.checkpoint, deps);
  await checkSpeed(p, family, deps);
  return modules;
}
