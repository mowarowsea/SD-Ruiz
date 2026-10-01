// プロンプト構文の簡易パーサ。シンタックスハイライト用に「どこが何か」の範囲だけを返す
//
// 対応する構文
// - 強調: (tag) (tag:1.2) [tag]   ※ \( \) はエスケープされた文字
// - Extra networks: <lora:name:0.8>
// - Dynamic Prompts: {a|b|c} {2$$a|b} __wildcard__ ${var} ${var=...} ${var=!...}
// - BREAK / AND
// - コメント (Forge の "Remove Comments from Prompts"): # ... / // ... / /* ... */

export type SpanKind =
  | "comment"
  | "escape"
  | "comma"
  | "keyword"
  | "weight" // (tag:1.2) の 1.2
  | "bracket" // ( ) [ ] { }
  | "separator" // {a|b} の |
  | "variant" // {2$$a|b} の 2$$
  | "wildcard"
  | "variable" // ${var=...} の "${var="
  | "network" // <lora:...> 全体
  | "network-name"
  | "network-weight"
  | "error"; // 閉じていない / 対応しない括弧

export interface Span {
  from: number;
  to: number;
  kind: SpanKind;
  /** bracket の入れ子の深さ (色分け用) */
  depth?: number;
}

/** 強調の効いている範囲と、そこにかかる倍率 (入れ子の倍率は掛け合わされる) */
export interface Emphasis {
  from: number;
  to: number;
  weight: number;
}

export interface ParseResult {
  spans: Span[];
  emphasis: Emphasis[];
}

interface Frame {
  char: "(" | "[" | "{";
  pos: number;
  depth: number;
}

const closer = { ")": "(", "]": "[", "}": "{" } as const;
const wildcardRe = /__[\w\-/*.!]+?__/y;
const networkRe = /<([a-z]+):([^:>\n]*)(?::([^>\n]*))?>/y;
const keywordRe = /\b(BREAK|AND)\b/y;
const variantRe = /(\d+(?:-\d+)?|-\d+|\d+-)?\$\$(?:[^${}|]*\$\$)?/y;

export function parsePrompt(text: string): ParseResult {
  const spans: Span[] = [];
  const emphasis: Emphasis[] = [];
  const stack: Frame[] = [];
  const at = (re: RegExp, i: number) => {
    re.lastIndex = i;
    return re.exec(text);
  };

  let i = 0;
  while (i < text.length) {
    const c = text[i];

    // コメント
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const to = end === -1 ? text.length : end + 2;
      spans.push({ from: i, to, kind: "comment" });
      i = to;
      continue;
    }
    if (c === "#" || (c === "/" && text[i + 1] === "/")) {
      const end = text.indexOf("\n", i);
      const to = end === -1 ? text.length : end;
      spans.push({ from: i, to, kind: "comment" });
      i = to;
      continue;
    }

    if (c === "\\" && i + 1 < text.length) {
      spans.push({ from: i, to: i + 2, kind: "escape" });
      i += 2;
      continue;
    }

    if (c === ",") {
      spans.push({ from: i, to: i + 1, kind: "comma" });
      i++;
      continue;
    }

    if (c === "<") {
      const m = at(networkRe, i);
      if (m) {
        const end = i + m[0].length;
        spans.push({ from: i, to: end, kind: "network" });
        const nameFrom = i + 1 + m[1].length + 1;
        spans.push({ from: nameFrom, to: nameFrom + m[2].length, kind: "network-name" });
        if (m[3] !== undefined) spans.push({ from: end - 1 - m[3].length, to: end - 1, kind: "network-weight" });
        i = end;
        continue;
      }
    }

    if (c === "_" && text[i + 1] === "_") {
      const m = at(wildcardRe, i);
      if (m) {
        spans.push({ from: i, to: i + m[0].length, kind: "wildcard" });
        i += m[0].length;
        continue;
      }
    }

    if (c === "B" || c === "A") {
      const m = at(keywordRe, i);
      if (m && (i === 0 || !/\w/.test(text[i - 1]))) {
        spans.push({ from: i, to: i + m[0].length, kind: "keyword" });
        i += m[0].length;
        continue;
      }
    }

    // Dynamic Prompts の変数 ${name} / ${name=値} / ${name=!値}。閉じ括弧は通常の } として扱う
    if (c === "$" && text[i + 1] === "{") {
      const m = /^\$\{[\w-]+(=!?)?/.exec(text.slice(i, i + 80));
      if (m) {
        spans.push({ from: i, to: i + m[0].length, kind: "variable" });
        stack.push({ char: "{", pos: i + 1, depth: stack.length });
        i += m[0].length;
        continue;
      }
    }

    if (c === "(" || c === "[" || c === "{") {
      spans.push({ from: i, to: i + 1, kind: "bracket", depth: stack.length });
      stack.push({ char: c, pos: i, depth: stack.length });
      i++;
      if (c === "{") {
        // {2$$a|b} の個数指定
        const m = at(variantRe, i);
        if (m && m[0]) {
          spans.push({ from: i, to: i + m[0].length, kind: "variant" });
          i += m[0].length;
        }
      }
      continue;
    }

    if (c === "|") {
      // Dynamic Prompts の {a|b} と、A1111 の [a|b] (交互) のどちらでも区切りとして扱う
      if (stack.length) spans.push({ from: i, to: i + 1, kind: "separator" });
      i++;
      continue;
    }

    if (c === ")" || c === "]" || c === "}") {
      const top = stack[stack.length - 1];
      if (!top || top.char !== closer[c]) {
        spans.push({ from: i, to: i + 1, kind: "error" });
        i++;
        continue;
      }
      stack.pop();
      spans.push({ from: i, to: i + 1, kind: "bracket", depth: top.depth });
      if (c === ")") {
        // (tag:1.2) の重み
        const inner = text.slice(top.pos + 1, i);
        const m = /:\s*(-?\d+(?:\.\d+)?|-?\.\d+)\s*$/.exec(inner);
        const weight = m ? Number(m[1]) : 1.1;
        if (m) spans.push({ from: top.pos + 1 + m.index + m[0].indexOf(m[1]), to: top.pos + 1 + m.index + m[0].indexOf(m[1]) + m[1].length, kind: "weight" });
        emphasis.push({ from: top.pos + 1, to: m ? top.pos + 1 + m.index : i, weight });
      } else if (c === "]" && !text.slice(top.pos + 1, i).includes("|") && !/:\s*[\d.]+\s*$/.test(text.slice(top.pos + 1, i))) {
        // [tag] は弱め。[a|b] (交互) や [a:b:0.5] (切り替え) は強弱ではないので除く
        emphasis.push({ from: top.pos + 1, to: i, weight: 1 / 1.1 });
      }
      i++;
      continue;
    }

    i++;
  }

  // 閉じられなかった括弧
  for (const f of stack) {
    const s = spans.find((sp) => sp.from === f.pos && sp.kind === "bracket");
    if (s) s.kind = "error";
  }

  return { spans: spans.sort((a, b) => a.from - b.from), emphasis: flattenEmphasis(emphasis, text.length) };
}

/** 入れ子の強調の倍率を掛け合わせ、重ならない区間に分けて返す (倍率 1 の区間は含めない) */
function flattenEmphasis(emphasis: Emphasis[], length: number): Emphasis[] {
  if (!emphasis.length) return [];
  const weights = new Float64Array(length).fill(1);
  // 外側 → 内側の順に掛けていく
  emphasis.sort((a, b) => a.from - b.from || b.to - a.to);
  for (const e of emphasis) for (let k = e.from; k < e.to; k++) weights[k] *= e.weight;
  const out: Emphasis[] = [];
  let start = 0;
  for (let k = 1; k <= length; k++) {
    if (k < length && Math.abs(weights[k] - weights[start]) < 1e-9) continue;
    if (Math.abs(weights[start] - 1) > 1e-9) out.push({ from: start, to: k, weight: weights[start] });
    start = k;
  }
  return out;
}
