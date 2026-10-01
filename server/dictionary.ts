// プロンプト補完の材料: tagcomplete のタグ CSV

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

/** `tag,訳` 形式の CSV を読む */
function parseTranslationCsv(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(",");
    if (i <= 0) continue;
    map.set(line.slice(0, i).trim().replace(/ /g, "_"), line.slice(i + 1).trim().replace(/^"|"$/g, ""));
  }
  return map;
}

export class TagDictionary {
  private tags: Tag[] = [];
  private translations = new Map<string, string>();

  constructor(tagsDir: string | null, tagFile: string, translationFile: string | null) {
    if (!tagsDir) return;
    const tagPath = join(tagsDir, tagFile);
    if (existsSync(tagPath)) this.tags = parseTagCsv(readFileSync(tagPath, "utf8"));
    if (translationFile) {
      const trPath = join(tagsDir, translationFile);
      if (existsSync(trPath)) this.translations = parseTranslationCsv(readFileSync(trPath, "utf8"));
    }
  }

  get size() {
    return this.tags.length;
  }

  /** 前方一致 → 別名の前方一致 → 部分一致 の順に、それぞれ件数の多い順で返す */
  search(query: string, limit = 20): TagHit[] {
    const q = query.trim().toLowerCase().replace(/\s+/g, "_");
    if (!q) return [];
    const hits: TagHit[] = [];
    const seen = new Set<string>();
    const add = (t: Tag, alias?: string) => {
      if (seen.has(t.name) || hits.length >= limit) return;
      seen.add(t.name);
      hits.push({ name: t.name, category: t.category, count: t.count, alias, translation: this.translations.get(t.name) });
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
}
