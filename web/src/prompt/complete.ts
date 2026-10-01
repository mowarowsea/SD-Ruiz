// プロンプトの入力補完 (タグ / ワイルドカード / LoRA)。挙動は tagcomplete の設定に合わせている

import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { api, type Lora } from "../api";

// アンダースコアを空白にしない顔文字系のタグ (tagcomplete の既定の除外リスト)
const keepUnderscore = new Set(["0_0", "(o)_(o)", "+_+", "+_-", "._.", "<o>_<o>", "<|>_<|>", "=_=", ">_<", "3_3", "6_9", ">_o", "@_@", "^_^", "o_o", "u_u", "x_x", "|_|", "||_||"]);

/** danbooru のタグ名をプロンプトに書く形にする (空白区切り・括弧はエスケープ) */
export function tagToPrompt(name: string) {
  const text = keepUnderscore.has(name) ? name : name.replace(/_/g, " ");
  return text.replace(/[()]/g, "\\$&");
}

function formatCount(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

// ワイルドカードと LoRA の一覧はページを開いている間キャッシュする (失敗したら次回取り直す)
let wildcardsCache: Promise<string[]> | null = null;
let lorasCache: Promise<Lora[]> | null = null;
const wildcards = () =>
  (wildcardsCache ??= api
    .wildcards()
    .then((r) => r.wildcards)
    .catch((e) => {
      wildcardsCache = null;
      throw e;
    }));
const loras = () =>
  (lorasCache ??= api
    .loras()
    .then((r) => r.loras)
    .catch((e) => {
      lorasCache = null;
      throw e;
    }));

/** 補完の後ろに区切りの ", " を付ける (すでに続いていれば付けない) */
function withComma(view: { state: { doc: { sliceString(a: number, b: number): string } } }, to: number) {
  const next = view.state.doc.sliceString(to, to + 1);
  return next === "," ? "" : ", ";
}

async function wildcardSource(ctx: CompletionContext): Promise<CompletionResult | null> {
  const m = ctx.matchBefore(/__[\w\-/*.!]*$/);
  if (!m) return null;
  const q = m.text.slice(2).toLowerCase();
  const list = await wildcards().catch(() => []);
  return {
    from: m.from,
    filter: false,
    options: list
      .filter((w) => w.toLowerCase().includes(q))
      .slice(0, 50)
      .map((w) => ({ label: `__${w}__`, type: "wildcard", apply: `__${w}__` })),
  };
}

async function loraSource(ctx: CompletionContext): Promise<CompletionResult | null> {
  const m = ctx.matchBefore(/<(?:lora:)?[^:<>,\n]*$/);
  if (!m) return null;
  const q = m.text.replace(/^<(lora:)?/, "").toLowerCase();
  const list = await loras().catch(() => []);
  return {
    from: m.from,
    filter: false,
    options: list
      .filter((l) => l.name.toLowerCase().includes(q) || l.folder.toLowerCase().includes(q))
      .slice(0, 50)
      .map((l) => ({ label: l.name, detail: l.folder, type: "lora", apply: `<lora:${l.name}:1>` })),
  };
}

async function tagSource(ctx: CompletionContext): Promise<CompletionResult | null> {
  // 直前の区切り (カンマや括弧など) から後ろを 1 つのタグとして扱う
  const m = ctx.matchBefore(/[^\s,()[\]{}|<>:\\][^,()[\]{}|<>:\n]*$/);
  if (!m || (m.text.length < 2 && !ctx.explicit)) return null;
  // 重みの数値や <lora:...> の中では出さない
  if (/^[\d.\s]+$/.test(m.text)) return null;
  const line = ctx.state.doc.lineAt(ctx.pos);
  const before = line.text.slice(0, ctx.pos - line.from);
  if (before.lastIndexOf("<") > before.lastIndexOf(">")) return null;
  // 少し待ってから問い合わせる (打っている途中の問い合わせを減らす)
  await new Promise((r) => setTimeout(r, 120));
  if (ctx.aborted) return null;
  const { tags } = await api.tags(m.text).catch(() => ({ tags: [] }));
  if (ctx.aborted || !tags.length) return null;
  return {
    from: m.from,
    filter: false,
    options: tags.map(
      (t): Completion => ({
        label: tagToPrompt(t.name),
        detail: [t.alias && `← ${t.alias}`, t.translation, formatCount(t.count)].filter(Boolean).join("  "),
        type: `tag-${t.category}`,
        apply: (view, _c, from, to) => {
          const insert = tagToPrompt(t.name) + withComma(view, to);
          view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
        },
      }),
    ),
  };
}

/** カーソル直前の書きかけに応じて補完の種類を切り替える */
export async function promptCompletion(ctx: CompletionContext): Promise<CompletionResult | null> {
  return (await wildcardSource(ctx)) ?? (await loraSource(ctx)) ?? (await tagSource(ctx));
}
