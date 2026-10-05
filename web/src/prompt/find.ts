// プロンプトの検索・置換。文字列として探し、当たったところを「タグ」単位でまとめて外したり書き換えたりする
//
// タグは同じ括弧の深さにある , | 改行 で区切った範囲。(a, blue hair:1.2) の hair なら "blue hair:1.2"、
// 外して括弧が空になったら括弧ごと外す

const openers = new Set(["(", "[", "{"]);
const closers = new Set([")", "]", "}"]);
const seps = new Set([",", "|", "\n"]);

/** 大文字・小文字を区別せず、そのままの文字列で探す */
export function findAll(text: string, query: string): { from: number; to: number }[] {
  if (!query) return [];
  const hay = text.toLowerCase();
  const q = query.toLowerCase();
  const out: { from: number; to: number }[] = [];
  for (let i = hay.indexOf(q); i >= 0; i = hay.indexOf(q, i + q.length)) out.push({ from: i, to: i + q.length });
  return out;
}

const escaped = (text: string, i: number) => text[i - 1] === "\\";

/** from〜to を含むタグの範囲 (前後の空白は除く) */
export function tagRange(text: string, from: number, to: number) {
  let s = from;
  for (let depth = 0; s > 0; s--) {
    const c = text[s - 1];
    if (escaped(text, s - 1)) continue;
    if (closers.has(c)) depth++;
    else if (openers.has(c)) {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && seps.has(c)) break;
  }
  let e = to;
  for (let depth = 0; e < text.length; e++) {
    const c = text[e];
    if (escaped(text, e)) continue;
    if (openers.has(c)) depth++;
    else if (closers.has(c)) {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && seps.has(c)) break;
  }
  while (s < from && /\s/.test(text[s])) s++;
  while (e > to && /\s/.test(text[e - 1])) e--;
  return { from: s, to: e };
}

/** タグを区切りごと外す。括弧が空になったら括弧も、行が空になったら行も外す */
function removeRange(text: string, from: number, to: number): string {
  let a = from;
  let b = to;
  // 後ろの区切りごと消す。後ろに無ければ (最後のタグなら) 前の区切りごと
  const after = /^[ \t]*[,|][ \t]*/.exec(text.slice(b));
  if (after) b += after[0].length;
  else {
    const before = /[ \t]*[,|][ \t]*$/.exec(text.slice(0, a));
    if (before) a -= before[0].length;
  }
  text = text.slice(0, a) + text.slice(b);

  // 空になった括弧 "()" "[]" "{}" (重みだけ残った "(:1.2)" は重みもタグに含めて消しているので来ない)
  let i = a;
  while (i > 0 && /[ \t]/.test(text[i - 1])) i--;
  let j = a;
  while (j < text.length && /[ \t]/.test(text[j])) j++;
  const open = text[i - 1];
  if (i > 0 && openers.has(open) && !escaped(text, i - 1) && text[j] === { "(": ")", "[": "]", "{": "}" }[open]) {
    // {2$$a|b} の 2$$ のように括弧の直後に付くものは残らないので、括弧だけ見ればよい
    return removeRange(text, i - 1, j + 1);
  }

  // 行が空いたら改行も消す (タグがあった行なので、もとは空ではなかった)
  const lineStart = text.lastIndexOf("\n", a - 1) + 1;
  const nl = text.indexOf("\n", a);
  const lineEnd = nl < 0 ? text.length : nl;
  if (/^[ \t]*$/.test(text.slice(lineStart, lineEnd))) {
    if (nl >= 0) return text.slice(0, lineStart) + text.slice(nl + 1);
    return text.slice(0, Math.max(0, lineStart - 1));
  }
  return text;
}

/** 1 つのタグ (検索に当たったものをタグ単位にまとめたもの) */
export interface Hit {
  /** タグの範囲 */
  from: number;
  to: number;
  /** タグの中で当たった範囲 (text の中の位置) */
  matches: { from: number; to: number }[];
}

export function findTags(text: string, query: string): Hit[] {
  const hits: Hit[] = [];
  for (const m of findAll(text, query)) {
    const last = hits[hits.length - 1];
    if (last && m.from < last.to) last.matches.push(m);
    else hits.push({ ...tagRange(text, m.from, m.to), matches: [m] });
  }
  return hits;
}

export function removeTag(text: string, hit: Hit) {
  return removeRange(text, hit.from, hit.to);
}

/** タグの中の当たったところを置き換える。置き換えでタグが空になったらタグごと外す */
export function replaceInTag(text: string, hit: Hit, replacement: string) {
  let tag = "";
  let at = hit.from;
  for (const m of hit.matches) {
    tag += text.slice(at, m.from) + replacement;
    at = m.to;
  }
  tag = (tag + text.slice(at, hit.to)).replace(/[ \t]{2,}/g, " ");
  // "(:1.2)" "( )" のように中身が無くなったら外す
  if (!tag.replace(/[()[\]{}\s]|:\s*-?[\d.]+/g, "")) return removeTag(text, hit);
  // 端や重みの前に残った空白 ("( hair" "blue :1.2") を詰める
  tag = tag
    .replace(/^([([{]*)\s+/, "$1")
    .replace(/\s+([)\]}]*)$/, "$1")
    .replace(/\s+(:\s*-?[\d.]+[)\]}]*)$/, "$1")
    .trim();
  return text.slice(0, hit.from) + tag + text.slice(hit.to);
}

/** すべて置き換える。後ろから順に置き換えるので、置き換え後の文字列に検索語が入っていても繰り返さない */
export function replaceAll(text: string, query: string, replacement: string) {
  for (const hit of findTags(text, query).reverse()) text = replaceInTag(text, hit, replacement);
  return text;
}
