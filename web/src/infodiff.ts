// ギャラリーで 1 つ前 (古い方) の画像と生成情報を比べ、何を変えたかを出す

import type { Infotext } from "./infotext";
import { parsePrompt } from "./prompt/parse";

export type Change =
  | { kind: "param"; key: string; from: string | undefined; to: string | undefined }
  | { kind: "prompt" | "negative"; added: string[]; removed: string[]; reweighted: { tag: string; from: string; to: string }[] };

// 毎回変わるもの・比べても意味のないもの
// 高速化 (Spectrum) の設定は 7 つ並ぶので、オンオフが分かる spec_window_size だけ比べる
const ignoredParam = /^Seed$|hash|Version|Template|Source Identifier|^spec_(?!window_size$)/i;

/** 片側だけ残った括弧を外す (「(a, b:1.1)」をカンマで切ると「(a」「b:1.1)」になるため) */
function trimBrackets(t: string) {
  const count = (re: RegExp) => (t.match(re) ?? []).length;
  while (/^[([]/.test(t) && count(/[([]/g) > count(/[)\]]/g)) t = t.slice(1).trim();
  while (/[)\]]$/.test(t) && count(/[)\]]/g) > count(/[([]/g)) t = t.slice(0, -1).trim();
  return t;
}

/** コメント (# ... / // ... / /* ... *\/) を除く。Template には書いたままのプロンプトが入っているため */
function stripComments(text: string) {
  let out = "";
  let at = 0;
  for (const c of parsePrompt(text).spans.filter((s) => s.kind === "comment")) {
    out += text.slice(at, c.from);
    at = c.to;
  }
  return out + text.slice(at);
}

/** カンマ・改行で区切ったタグ (コメントと空は除く) */
function tags(text: string) {
  return new Set(
    stripComments(text)
      .split(/[,\n]/)
      .map((t) => trimBrackets(t.trim().replace(/\s+/g, " ")))
      .filter(Boolean),
  );
}

/** "(tag:1.2)" → tag と 重み 1.2。"(tag)" は 1.1、"[tag]" は 0.9 */
function weighted(t: string) {
  const m = /^\(*\s*(.+?)\s*:\s*(-?[\d.]+)\s*\)*$/.exec(t);
  if (m) return { tag: m[1], weight: Number(m[2]) };
  const up = /^\(+/.exec(t)?.[0].length ?? 0;
  const down = /^\[+/.exec(t)?.[0].length ?? 0;
  return { tag: t.replace(/^[([]+|[)\]]+$/g, ""), weight: 1.1 ** up * 0.9 ** down };
}

const fmt = (w: number) => String(Math.round(w * 100) / 100);

function tagDiff(kind: "prompt" | "negative", cur: string, prev: string): Change[] {
  const a = tags(cur);
  const b = tags(prev);
  let added = [...a].filter((t) => !b.has(t));
  let removed = [...b].filter((t) => !a.has(t));
  // 重みだけ変えたものは 1 つにまとめる
  const reweighted: { tag: string; from: string; to: string }[] = [];
  for (const t of added) {
    const w = weighted(t);
    const r = removed.find((x) => weighted(x).tag === w.tag);
    if (!r) continue;
    reweighted.push({ tag: w.tag, from: fmt(weighted(r).weight), to: fmt(w.weight) });
    removed = removed.filter((x) => x !== r);
    added = added.filter((x) => x !== t);
  }
  return added.length || removed.length || reweighted.length ? [{ kind, added, removed, reweighted }] : [];
}

export function diffInfotext(cur: Infotext, prev: Infotext): Change[] {
  const out: Change[] = [];
  // Dynamic Prompts のテンプレート (展開前) が両方に残っていればそちらで比べる。片方だけだと展開後と比べることになり、違いだらけになる
  const pick = (i: Infotext, neg: boolean) => {
    const key = neg ? "Negative Template" : "Template";
    const both = cur.params[key] !== undefined && prev.params[key] !== undefined;
    return both ? i.params[key] : neg ? i.negative : i.prompt;
  };
  const keys = [...new Set([...Object.keys(cur.params), ...Object.keys(prev.params)])].filter((k) => !ignoredParam.test(k));
  for (const key of keys) {
    const from = prev.params[key];
    const to = cur.params[key];
    if (from !== to) out.push({ kind: "param", key, from, to });
  }
  out.push(...tagDiff("prompt", pick(cur, false), pick(prev, false)));
  out.push(...tagDiff("negative", pick(cur, true), pick(prev, true)));
  return out;
}
