// プロンプトの入力補完 (タグ / ワイルドカード / LoRA)。挙動は tagcomplete の設定に合わせている

import { type Completion, type CompletionContext, type CompletionResult, startCompletion } from "@codemirror/autocomplete";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { api, loadLoras, type TagHit } from "../api";

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

// ワイルドカードの一覧はページを開いている間キャッシュする (失敗したら次回取り直す)
let wildcardsCache: Promise<string[]> | null = null;
const wildcards = () =>
  (wildcardsCache ??= api
    .wildcards()
    .then((r) => r.wildcards)
    .catch((e) => {
      wildcardsCache = null;
      throw e;
    }));
const loras = loadLoras;

/** ワイルドカードを作った・消したあとに、補完の一覧を取り直させる */
export function invalidateWildcards() {
  wildcardsCache = null;
}

/** 比べるためにタグを正規化する (エスケープを外し、_ は空白、大文字小文字を無視) */
const normalize = (s: string) => s.replace(/\\(.)/g, "$1").replace(/_/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 同じ入力欄ですでに使っているもの。書きかけの部分 (from〜カーソル) は除く。
 * タグは区切り (カンマ・括弧・| など) で分け、(tag:1.2) の重みは外して比べる
 */
function usedInDoc(ctx: CompletionContext, from: number) {
  const doc = ctx.state.doc;
  const text = doc.sliceString(0, from) + doc.sliceString(ctx.pos);
  const lower = text.toLowerCase();
  // エスケープした括弧 \( \) で切らないよう、いったん別の文字に逃がしてから区切る
  const tags = new Set(
    text
      .replace(/<[^>\n]*>|__[\w\-/*.!]+?__/g, ",")
      .replace(/\\\(/g, "\u0001")
      .replace(/\\\)/g, "\u0002")
      .split(/[,()[\]{}|\n]/)
      .map((t) => normalize(t.replace(/:\s*-?[\d.]+\s*$/, "").replace(/\u0001/g, "(").replace(/\u0002/g, ")")))
      .filter(Boolean),
  );
  return {
    tag: (name: string) => tags.has(normalize(name)),
    wildcard: (name: string) => lower.includes(`__${name.toLowerCase()}__`),
    lora: (name: string) => new RegExp(`<lora:${escapeRe(name.toLowerCase())}(:|>)`).test(lower),
  };
}

type Option = Completion & { used?: boolean; translation?: string };

/** 候補が同じ入力欄ですでに使われているか (補完の一覧で印を付ける) */
export const isUsed = (c: Completion) => !!(c as Option).used;

/** 補完の一覧で、タグ名の隣に訳を出す */
export const translationColumn = {
  position: 60,
  render(c: Completion) {
    const tr = (c as Option).translation;
    if (tr === undefined) return null;
    const el = document.createElement("span");
    el.className = tr ? "cm-completionTr" : "cm-completionTr cm-completionTr-none";
    el.textContent = tr || "訳なし";
    return el;
  },
};

const hasJapanese = (s: string) => /[^\x00-\x7f]/.test(s);

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
  const used = usedInDoc(ctx, m.from);
  return {
    from: m.from,
    filter: false,
    options: list
      .filter((w) => w.toLowerCase().includes(q))
      .slice(0, 50)
      .map((w) => ({ label: `__${w}__`, type: "wildcard", apply: `__${w}__`, used: used.wildcard(w) })),
  };
}

async function loraSource(ctx: CompletionContext): Promise<CompletionResult | null> {
  const m = ctx.matchBefore(/<(?:lora:)?[^:<>,\n]*$/);
  if (!m) return null;
  const q = m.text.replace(/^<(lora:)?/, "").toLowerCase();
  const list = await loras().catch(() => []);
  const used = usedInDoc(ctx, m.from);
  return {
    from: m.from,
    filter: false,
    options: list
      .filter((l) => l.name.toLowerCase().includes(q) || l.folder.toLowerCase().includes(q))
      .slice(0, 50)
      .map((l) => ({ label: l.name, detail: l.folder, type: "lora", apply: `<lora:${l.name}:1>`, used: used.lora(l.name) })),
  };
}

async function tagSource(ctx: CompletionContext): Promise<CompletionResult | null> {
  // 直前の区切り (カンマや括弧など) から後ろを 1 つのタグとして扱う
  const m = ctx.matchBefore(/[^\s,()[\]{}|<>:\\][^,()[\]{}|<>:\n]*$/);
  // 日本語なら訳から引く (逆引き) ので 1 文字から出す
  if (!m || (m.text.length < 2 && !ctx.explicit && !hasJapanese(m.text))) return null;
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
  const used = usedInDoc(ctx, m.from);
  return {
    from: m.from,
    filter: false,
    options: tags.map(
      (t): Option => ({
        label: tagToPrompt(t.name),
        detail: [t.alias && `← ${t.alias}`, formatCount(t.count)].filter(Boolean).join("  "),
        translation: t.translation ?? "",
        type: `tag-${t.category}`,
        used: used.tag(t.name),
        apply: (view, _c, from, to) => {
          const insert = tagToPrompt(t.name) + withComma(view, to);
          view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
        },
      }),
    ),
  };
}

// ---- 範囲選択したタグの訳 ----

/** タグの区切り */
const delimiter = /[,()[\]{}|<>\n]/;

/** 選択範囲を、両端のタグの切れ目まで広げる (単語の途中から選んでもタグ全体を引く) */
function expandToTags(doc: string, from: number, to: number) {
  while (from > 0 && !delimiter.test(doc[from - 1])) from--;
  while (to < doc.length && !delimiter.test(doc[to])) to++;
  return doc.slice(from, to);
}

/** 範囲の中のタグを書いた順に取り出す。LoRA・ワイルドカード・重み・変数は除く */
export function tagsIn(text: string) {
  const seen = new Set<string>();
  const out: string[] = [];
  // エスケープした括弧 \( \) で切らないよう、いったん別の文字に逃がしてから区切る
  const parts = text
    .replace(/<[^>\n]*>?|__[\w\-/*.!]+?__|\$\{[\w-]+(?:=!?|\})/g, ",") // LoRA・ワイルドカード・${name= と ${name}
    .replace(/\\\(/g, "\u0001")
    .replace(/\\\)/g, "\u0002")
    .split(delimiter);
  for (const part of parts) {
    const t = part
      .replace(/:\s*-?[\d.]*\s*$/, "") // :1.2 の重み
      .replace(/\u0001/g, "(")
      .replace(/\u0002/g, ")")
      .replace(/\\(.)/g, "$1")
      .trim();
    if (!/[a-z]/i.test(t) && !hasJapanese(t)) continue; // 記号だけ
    if (/^(BREAK|AND)$/.test(t)) continue;
    const key = normalize(t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** 訳を直す (補完の一覧で選んだとき)。保存したら一覧を出し直す */
async function editTranslation(view: EditorView, t: TagHit) {
  const text = prompt(`${tagToPrompt(t.name)} の訳 (空にすると辞書の訳に戻す)`, t.translation ?? "");
  view.focus();
  if (text === null) return;
  try {
    await api.setTranslation(t.name, text);
  } catch (e) {
    alert((e as Error).message);
  }
  startCompletion(view);
}

async function selectionSource(ctx: CompletionContext): Promise<CompletionResult | null> {
  const sel = ctx.state.selection.main;
  const names = tagsIn(expandToTags(ctx.state.doc.toString(), sel.from, sel.to));
  if (!names.length) return null;
  const { tags } = await api.lookupTags(names.slice(0, 200)).catch(() => ({ tags: [] as TagHit[] }));
  if (ctx.aborted || !tags.length) return null;
  return {
    from: sel.from,
    to: sel.to,
    filter: false,
    options: tags.map(
      (t, i): Option => ({
        label: tagToPrompt(t.name),
        detail: [t.alias && `← ${tagToPrompt(t.alias)}`, t.edited && "✎", !t.unknown && formatCount(t.count)].filter(Boolean).join("  "),
        translation: t.translation ?? "",
        type: `tag-${t.category}`,
        section: { name: "選択した範囲の訳 (タップで訳を直す)", rank: 0 },
        boost: -i,
        apply: (view) => void editTranslation(view, t),
      }),
    ),
  };
}

/** カーソル直前の書きかけに応じて補完の種類を切り替える。範囲を選んでいるときは、その中のタグの訳を出す */
export async function promptCompletion(ctx: CompletionContext): Promise<CompletionResult | null> {
  if (!ctx.state.selection.main.empty) return ctx.explicit ? selectionSource(ctx) : null;
  return (await wildcardSource(ctx)) ?? (await loraSource(ctx)) ?? (await tagSource(ctx));
}

/** 範囲を選び終えたら (少し待って選択が動かなければ) 訳の一覧を出す */
export const translateSelection = ViewPlugin.fromClass(
  class {
    timer = 0;
    constructor(readonly view: EditorView) {}
    update(u: ViewUpdate) {
      if (!u.selectionSet || u.docChanged) return;
      clearTimeout(this.timer);
      const sel = u.state.selection.main;
      if (sel.empty || !u.view.hasFocus) return;
      this.timer = window.setTimeout(() => {
        if (this.view.state.selection.main.eq(sel)) startCompletion(this.view);
      }, 350);
    }
    destroy() {
      clearTimeout(this.timer);
    }
  },
);
