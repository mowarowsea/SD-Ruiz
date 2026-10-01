// 端末をまたいで共有したい設定 (お気に入り・最近使ったモデル・モデルごとのパラメータ)。data/prefs.json に保存する

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { GenerateParams } from "./jobs.js";

/** モデルを切り替えたときに復元するパラメータ */
export type ModelParams = Pick<GenerateParams, "width" | "height" | "steps" | "cfg" | "sampler" | "scheduler">;

export interface Prefs {
  favoriteCheckpoints: string[];
  favoriteLoras: string[];
  /** 新しい順 */
  recentCheckpoints: string[];
  modelParams: Record<string, ModelParams>;
}

const path = fileURLToPath(new URL("../data/prefs.json", import.meta.url));
const empty: Prefs = { favoriteCheckpoints: [], favoriteLoras: [], recentCheckpoints: [], modelParams: {} };

export class PrefsStore {
  private prefs: Prefs = existsSync(path) ? { ...empty, ...JSON.parse(readFileSync(path, "utf8")) } : structuredClone(empty);

  get value() {
    return this.prefs;
  }

  private save() {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(this.prefs, null, 2));
  }

  setFavorite(kind: "checkpoint" | "lora", id: string, on: boolean) {
    const key = kind === "checkpoint" ? "favoriteCheckpoints" : "favoriteLoras";
    const list = this.prefs[key].filter((x) => x !== id);
    this.prefs[key] = on ? [...list, id] : list;
    this.save();
  }

  /** 生成したときに呼ぶ。最近使ったモデルとそのパラメータを覚える */
  recordGenerate(p: GenerateParams) {
    this.prefs.recentCheckpoints = [p.checkpoint, ...this.prefs.recentCheckpoints.filter((x) => x !== p.checkpoint)].slice(0, 8);
    const { width, height, steps, cfg, sampler, scheduler } = p;
    this.prefs.modelParams[p.checkpoint] = { width, height, steps, cfg, sampler, scheduler };
    this.save();
  }
}
