// プロンプトのトークン数 (CLIP の BPE で数える。A1111 / Forge の右上の 12/75 と同じ考え方)
// merges.txt はサーバーから一度だけ読む。読めないあいだ (Forge のフォルダが無いなど) は単語数で代わりにする

import { parsePrompt } from "./parse";

let ranks: Map<string, number> | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const cache = new Map<string, number>();

/** merges.txt を読む (何度呼んでも 1 回だけ)。読めたら onTokenizerReady に登録したものを呼ぶ */
export function loadTokenizer() {
  loading ??= fetch("/api/tokenizer/merges")
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
    .then((text) => {
      // 先頭の #version 行を除き、CLIP が使う 49152 - 256 - 2 個だけ
      const lines = text.split(/\r?\n/).slice(1, 49152 - 256 - 2 + 1);
      ranks = new Map(lines.map((l, i) => [l, i]));
      for (const f of listeners) f();
    })
    .catch(() => {});
  return loading;
}

export function onTokenizerReady(f: () => void) {
  listeners.add(f);
  return () => void listeners.delete(f);
}

export const tokenizerReady = () => !!ranks;

// GPT-2 / CLIP のバイト → 文字の対応
const byteChar = (() => {
  const bs: number[] = [];
  for (let b = 33; b <= 126; b++) bs.push(b);
  for (let b = 161; b <= 172; b++) bs.push(b);
  for (let b = 174; b <= 255; b++) bs.push(b);
  const map: string[] = [];
  let n = 0;
  for (let b = 0; b < 256; b++) map[b] = String.fromCharCode(bs.includes(b) ? b : 256 + n++);
  return map;
})();
const encoder = new TextEncoder();

/** 1 語を BPE で分けたときの個数 */
function bpeCount(token: string) {
  const hit = cache.get(token);
  if (hit !== undefined) return hit;
  const chars = Array.from(encoder.encode(token), (b) => byteChar[b]);
  chars[chars.length - 1] += "</w>";
  let word = chars;
  while (word.length > 1) {
    let best = -1;
    let bestRank = Infinity;
    for (let i = 0; i < word.length - 1; i++) {
      const r = ranks!.get(`${word[i]} ${word[i + 1]}`);
      if (r !== undefined && r < bestRank) {
        bestRank = r;
        best = i;
      }
    }
    if (best < 0) break;
    const a = word[best];
    const b = word[best + 1];
    const next: string[] = [];
    for (let i = 0; i < word.length; i++) {
      if (i < word.length - 1 && word[i] === a && word[i + 1] === b) {
        next.push(a + b);
        i++;
      } else next.push(word[i]);
    }
    word = next;
  }
  if (cache.size > 20000) cache.clear();
  cache.set(token, word.length);
  return word.length;
}

const pattern = /'s|'t|'re|'ve|'m|'ll|'d|\p{L}+|\p{N}|[^\s\p{L}\p{N}]+/gu;

function countText(text: string) {
  const words = text.replace(/\s+/g, " ").trim().toLowerCase().match(pattern) ?? [];
  if (!ranks) return words.filter((w) => /\p{L}/u.test(w)).length;
  let n = 0;
  for (const w of words) n += bpeCount(w);
  return n;
}

/**
 * Forge に渡る中身だけを残して BREAK ごとに分ける。
 * コメント・LoRA・強調の括弧と重み・Dynamic Prompts の記号は数えない。
 * 変数の定義 ${name=...} はそれだけでは何も出さないので丸ごと除く (使う側の ${name} も 0 と数える)。{a|b} は両方数える
 * definitions を true にすると定義の中身も数える (畳んだところの量を出すとき)
 */
function segments(text: string, definitions: boolean) {
  const { spans, variables } = parsePrompt(text);
  const defs = new Map(definitions ? [] : variables.map((v) => [v.from, v.to + 1]));
  const out: string[] = [""];
  let pos = 0;
  for (const s of spans) {
    if (s.from < pos) continue;
    const defEnd = defs.get(s.from);
    if (defEnd !== undefined) {
      out[out.length - 1] += text.slice(pos, s.from) + " ";
      pos = defEnd;
      continue;
    }
    out[out.length - 1] += text.slice(pos, s.from);
    pos = s.to;
    const piece = text.slice(s.from, s.to);
    switch (s.kind) {
      case "escape":
        out[out.length - 1] += piece.slice(1);
        break;
      case "comma":
      case "error":
        out[out.length - 1] += piece;
        break;
      case "keyword":
        if (piece === "BREAK") out.push("");
        else out[out.length - 1] += ` ${piece} `;
        break;
      case "weight":
        out[out.length - 1] = out[out.length - 1].replace(/:\s*$/, "") + " ";
        break;
      default:
        out[out.length - 1] += " ";
    }
  }
  out[out.length - 1] += text.slice(pos);
  return out;
}

export interface TokenCount {
  count: number;
  /** 75 トークンずつのまとまりの上限 (12/75 の 75) */
  limit: number;
  /** トークンではなく単語で数えている */
  words: boolean;
}

export function countTokens(text: string, { definitions = false } = {}): TokenCount {
  let count = 0;
  let chunks = 0;
  for (const seg of segments(text, definitions)) {
    const n = countText(seg);
    count += n;
    chunks += Math.max(1, Math.ceil(n / 75));
  }
  return { count, limit: chunks * 75, words: !ranks };
}

/** 畳んだところの後ろに出す短い表示 */
export function formatCount(c: TokenCount) {
  return c.words ? `${c.count} 語` : `${c.count} tok`;
}
