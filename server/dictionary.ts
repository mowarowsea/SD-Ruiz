// プロンプト補完の材料: tagcomplete のタグ CSV と和訳 CSV、自分で直した訳 (data/translations.csv)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Tag {
  name: string;
  /** danbooru のカテゴリ (0 一般 / 1 作者 / 3 版権 / 4 キャラ / 5 メタ) */
  category: number;
  count: number;
  aliases: string[];
}

export interface TagHit {
  name: string;
  category: number;
  count: number;
  /** 別名で当たったときの別名 */
  alias?: string;
  translation?: string;
  /** 訳を自分で直したもの */
  edited?: boolean;
  /** タグの CSV に無い (訳だけあるもの・プロンプトに書いた独自の語) */
  unknown?: boolean;
}

/** `name,category,count,"alias1,alias2"` 形式の CSV を読む (ファイルは件数の多い順に並んでいる) */
function parseTagCsv(text: string): Tag[] {
  const tags: Tag[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const m = /^([^,]+),(\d*),(\d*),?(.*)$/.exec(line);
    if (!m) continue;
    const aliases = m[4].replace(/^"|"$/g, "");
    tags.push({ name: m[1], category: Number(m[2] || 0), count: Number(m[3] || 0), aliases: aliases ? aliases.split(",") : [] });
  }
  return tags;
}

/** 比べるときの形: 小文字・空白は _ */
export const tagKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "_");

/** `tag,訳` 形式の CSV を読む */
function parseTranslationCsv(text: string, map = new Map<string, string>()) {
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(",");
    if (i <= 0) continue;
    const tr = line.slice(i + 1).trim().replace(/^"|"$/g, "");
    if (tr) map.set(tagKey(line.slice(0, i)), tr);
  }
  return map;
}

const userPath = fileURLToPath(new URL("../data/translations.csv", import.meta.url));
const hasJapanese = (s: string) => /[^\x00-\x7f]/.test(s);

export class TagDictionary {
  private tags: Tag[] = [];
  private byName = new Map<string, Tag>();
  private byAlias = new Map<string, Tag>();
  /** 配布されている訳 (複数ファイルは後ろのものが優先) */
  private base = new Map<string, string>();
  /** 自分で直した訳。base より優先する */
  private user = new Map<string, string>();

  constructor(tagsDir: string | null, tagFile: string, translationFiles: string | string[] | null) {
    if (existsSync(userPath)) this.user = parseTranslationCsv(readFileSync(userPath, "utf8"));
    if (!tagsDir) return;
    const tagPath = join(tagsDir, tagFile);
    if (existsSync(tagPath)) this.tags = parseTagCsv(readFileSync(tagPath, "utf8"));
    for (const t of this.tags) {
      this.byName.set(t.name, t);
      for (const a of t.aliases) if (!this.byAlias.has(a)) this.byAlias.set(a, t);
    }
    for (const file of [translationFiles ?? []].flat()) {
      const p = join(tagsDir, file);
      if (existsSync(p)) parseTranslationCsv(readFileSync(p, "utf8"), this.base);
    }
  }

  get size() {
    return this.tags.length;
  }

  get translationCount() {
    return new Set([...this.base.keys(), ...this.user.keys()]).size;
  }

  private translation(name: string) {
    return this.user.get(name) ?? this.base.get(name);
  }

  private hit(t: Tag, alias?: string): TagHit {
    return { name: t.name, category: t.category, count: t.count, alias, translation: this.translation(t.name), edited: this.user.has(t.name) || undefined };
  }

  /** タグの CSV に無い語は訳だけで作る */
  private loose(name: string): TagHit {
    return { name, category: 0, count: 0, translation: this.translation(name), edited: this.user.has(name) || undefined, unknown: true };
  }

  /**
   * 前方一致 → 別名の前方一致 → 部分一致 の順に、それぞれ件数の多い順で返す。
   * 日本語が混じっていれば訳から引く (逆引き)
   */
  search(query: string, limit = 20): TagHit[] {
    if (hasJapanese(query)) return this.searchTranslation(query, limit);
    const q = tagKey(query);
    if (!q) return [];
    const hits: TagHit[] = [];
    const seen = new Set<string>();
    const add = (t: Tag, alias?: string) => {
      if (seen.has(t.name) || hits.length >= limit) return;
      seen.add(t.name);
      hits.push(this.hit(t, alias));
    };
    for (const t of this.tags) if (t.name.startsWith(q)) add(t);
    for (const t of this.tags) {
      if (hits.length >= limit) break;
      const alias = t.aliases.find((a) => a.startsWith(q));
      if (alias) add(t, alias);
    }
    if (q.length >= 3) for (const t of this.tags) if (t.name.includes(q)) add(t);
    return hits;
  }

  /** 訳から引く: 訳が前方一致するもの → 部分一致するもの、それぞれ件数の多い順 */
  private searchTranslation(query: string, limit: number): TagHit[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const prefix: TagHit[] = [];
    const partial: TagHit[] = [];
    for (const name of new Set([...this.user.keys(), ...this.base.keys()])) {
      const tr = this.translation(name)!.toLowerCase();
      const i = tr.indexOf(q);
      if (i < 0) continue;
      const t = this.byName.get(name);
      (i === 0 ? prefix : partial).push(t ? this.hit(t) : this.loose(name));
    }
    const byCount = (a: TagHit, b: TagHit) => b.count - a.count;
    return [...prefix.sort(byCount), ...partial.sort(byCount)].slice(0, limit);
  }

  /** プロンプトに書いた語を引く (別名なら元のタグにする)。無い語も unknown として返す */
  lookup(names: string[]): TagHit[] {
    return names.map((raw) => {
      const name = tagKey(raw);
      const t = this.byName.get(name);
      if (t) return this.hit(t);
      const a = this.byAlias.get(name);
      if (a && !this.user.has(name)) return this.hit(a, name);
      return this.loose(name);
    });
  }

  /** 訳の一覧 (編集画面用)。タグ名か訳の部分一致。edited なら直したものだけ */
  translations(query: string, edited: boolean, limit = 100): TagHit[] {
    const q = query.trim().toLowerCase();
    const k = tagKey(query);
    const names = edited ? [...this.user.keys()] : [...new Set([...this.user.keys(), ...this.base.keys()])];
    const hits = names
      .filter((n) => !q || n.includes(k) || this.translation(n)!.toLowerCase().includes(q))
      .map((n) => {
        const t = this.byName.get(n);
        return t ? this.hit(t) : this.loose(n);
      });
    // 何も絞っていないときに 10 万件を返さないよう、件数の多い順で切る
    return hits.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, limit);
  }

  /** 訳を直す。空なら自分の訳を消して配布の訳に戻す */
  setTranslation(raw: string, text: string): TagHit {
    const name = tagKey(raw);
    if (!name || name.includes(",") || /[\r\n]/.test(name)) throw Object.assign(new Error("タグ名が正しくありません"), { statusCode: 400 });
    const tr = text.replace(/[\r\n]+/g, " ").trim();
    if (tr) this.user.set(name, tr);
    else this.user.delete(name);
    mkdirSync(dirname(userPath), { recursive: true });
    const lines = [...this.user].sort(([a], [b]) => a.localeCompare(b)).map(([n, t]) => `${n},${t}`);
    writeFileSync(userPath, lines.join("\n") + (lines.length ? "\n" : ""));
    return this.lookup([name])[0];
  }
}
