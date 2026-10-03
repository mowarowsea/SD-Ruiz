// 端末をまたいで共有したい設定 (お気に入り・最近使ったモデル・ベースモデルとモデルごとの設定)。data/prefs.json に保存する

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { type BaseSettings, builtinBaseSettings } from "./base.js";
import type { GenerateParams } from "./jobs.js";

/** モデルを切り替えたときに復元するパラメータ */
export type ModelParams = Pick<GenerateParams, "width" | "height" | "steps" | "cfg" | "sampler" | "scheduler">;

export interface Prefs {
  favoriteCheckpoints: string[];
  favoriteLoras: string[];
  /** 新しい順 */
  recentCheckpoints: string[];
  /** モデルごとの前回のパラメータ (生成したときに覚える) */
  modelParams: Record<string, ModelParams>;
  /** モデルごとに個別に指定した TE / VAE。無ければベースモデルの設定 */
  modelModules: Record<string, string[]>;
  /** ベースモデル (familyOf の名前) ごとの既定のうち、自分で変えたもの。変えていない項目は builtinBaseSettings */
  baseSettings: Record<string, Partial<BaseSettings>>;
}

const path = fileURLToPath(new URL("../data/prefs.json", import.meta.url));
const empty: Prefs = { favoriteCheckpoints: [], favoriteLoras: [], recentCheckpoints: [], modelParams: {}, modelModules: {}, baseSettings: {} };

export class PrefsStore {
  private prefs: Prefs = existsSync(path) ? { ...empty, ...JSON.parse(readFileSync(path, "utf8")) } : structuredClone(empty);

  get value() {
    return this.prefs;
  }

  /** ベースモデルの既定 (自分で変えたもの > 組み込み) */
  baseSettings(family: string | null): BaseSettings {
    const builtin = (family && builtinBaseSettings[family]) || { params: null, modules: [] };
    const mine = (family && this.prefs.baseSettings[family]) || {};
    return { params: mine.params !== undefined ? mine.params : builtin.params, modules: mine.modules ?? builtin.modules };
  }

  /** このモデルで使う TE / VAE (モデルごとの指定 > ベースモデルの既定) */
  modulesFor(checkpoint: string, family: string | null) {
    return this.prefs.modelModules[checkpoint] ?? this.baseSettings(family).modules;
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

  /** ベースモデルの既定を変える。undefined の項目はそのまま、null の項目は組み込みの既定に戻す */
  setBase(family: string, patch: { params?: ModelParams | null; modules?: string[] | null }) {
    const cur = { ...this.prefs.baseSettings[family] };
    if (patch.params === null) delete cur.params;
    else if (patch.params) cur.params = patch.params;
    if (patch.modules === null) delete cur.modules;
    else if (patch.modules) cur.modules = patch.modules;
    if (Object.keys(cur).length) this.prefs.baseSettings[family] = cur;
    else delete this.prefs.baseSettings[family];
    this.save();
  }

  /** モデルごとの設定を変える。null の項目は消してベースモデルの既定に戻す */
  setModel(id: string, patch: { params?: null; modules?: string[] | null }) {
    if (patch.params === null) delete this.prefs.modelParams[id];
    if (patch.modules === null) delete this.prefs.modelModules[id];
    else if (patch.modules) this.prefs.modelModules[id] = patch.modules;
    this.save();
  }

  /** 消したモデルをお気に入り・最近・モデルごとの設定から外す */
  forget(kind: "checkpoint" | "lora", id: string) {
    if (kind === "lora") this.prefs.favoriteLoras = this.prefs.favoriteLoras.filter((x) => x !== id);
    else {
      this.prefs.favoriteCheckpoints = this.prefs.favoriteCheckpoints.filter((x) => x !== id);
      this.prefs.recentCheckpoints = this.prefs.recentCheckpoints.filter((x) => x !== id);
      delete this.prefs.modelParams[id];
      delete this.prefs.modelModules[id];
    }
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
