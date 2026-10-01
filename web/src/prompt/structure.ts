// 括弧の対応と Dynamic Prompts の変数定義をエディタで扱う
// - キャレットの隣の括弧と、対応する括弧を強調する (エスケープした \( \) は括弧として数えない)
// - ${name=値} の値と #region 〜 #endregion を折りたためるようにする (頭の ▾ で畳み、… を押すと開く)
//   最初に読み込んだとき・外から書き換えたときは全部畳んでおく。畳んだところにはトークン数を出す

import { codeFolding, foldEffect, foldedRanges, unfoldEffect } from "@codemirror/language";
import { type EditorState, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { type ParseResult, parsePrompt } from "./parse";
import { countTokens, formatCount, onTokenizerReady } from "./tokens";

// 括弧の強調・折りたたみのたびに解析し直さないよう、文書ごとに 1 回だけ解析する
const parsed = StateField.define<ParseResult>({
  create: (state) => parsePrompt(state.doc.toString()),
  update: (value, tr) => (tr.docChanged ? parsePrompt(tr.state.doc.toString()) : value),
});

/** 畳めるもの。at は ▾ を出す位置、from / to は畳む範囲 */
interface Foldable {
  at: number;
  from: number;
  to: number;
}

/** #region 名前 の行の終わりから、対応する #endregion の行の終わりまで (入れ子にできる) */
function regions(state: EditorState): Foldable[] {
  const out: Foldable[] = [];
  const open: { at: number; from: number }[] = [];
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    if (/^\s*#region\b/.test(line.text)) open.push({ at: line.from, from: line.to });
    else if (/^\s*#endregion\b/.test(line.text)) {
      const r = open.pop();
      if (r) out.push({ ...r, to: line.to });
    }
  }
  return out;
}

const foldables = StateField.define<Foldable[]>({
  create: (state) => collect(state),
  update: (value, tr) => (tr.docChanged ? collect(tr.state) : value),
});

function collect(state: EditorState) {
  const vars = state.field(parsed).variables.filter((v) => v.to > v.valueFrom).map((v) => ({ at: v.from, from: v.valueFrom, to: v.to }));
  return [...vars, ...regions(state)].sort((a, b) => a.at - b.at);
}

const matchMark = Decoration.mark({ class: "pt-match" });

function bracketDecorations(state: EditorState): DecorationSet {
  const sel = state.selection.main;
  if (!sel.empty) return Decoration.none;
  const { pairs } = state.field(parsed);
  // キャレットの直後の括弧を優先し、無ければ直前の括弧
  const pair =
    pairs.find((p) => p.open === sel.head || p.close === sel.head) ?? pairs.find((p) => p.open === sel.head - 1 || p.close === sel.head - 1);
  if (!pair) return Decoration.none;
  return Decoration.set([matchMark.range(pair.open, pair.open + 1), matchMark.range(pair.close, pair.close + 1)]);
}

const bracketMatch = EditorView.decorations.compute(["doc", "selection", parsed], bracketDecorations);

class FoldToggle extends WidgetType {
  constructor(
    readonly from: number,
    readonly to: number,
  ) {
    super();
  }
  eq(other: FoldToggle) {
    return other.from === this.from && other.to === this.to;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = "pt-fold";
    el.textContent = "▾";
    el.title = "畳む";
    el.onmousedown = (e) => {
      e.preventDefault();
      view.dispatch({ effects: foldEffect.of({ from: this.from, to: this.to }) });
    };
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

/** 畳めるもの (中身のある変数定義と #region) の頭に ▾ を出す。畳んだものには出さない */
const foldToggles = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view.state);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.transactions.some((t) => t.effects.length)) this.decorations = this.build(u.state);
    }
    build(state: EditorState) {
      const folded = foldedRanges(state);
      const builder = new RangeSetBuilder<Decoration>();
      for (const f of state.field(foldables)) {
        let isFolded = false;
        folded.between(f.from, f.to, (from, to) => {
          if (from === f.from && to === f.to) isFolded = true;
        });
        if (!isFolded) builder.add(f.at, f.at, Decoration.widget({ widget: new FoldToggle(f.from, f.to), side: -1 }));
      }
      return builder.finish();
    }
  },
  { decorations: (p) => p.decorations },
);

/** 全部畳む (読み込んだときと、外から書き換えたとき) */
export function foldAll(view: EditorView) {
  const folded = foldedRanges(view.state);
  const effects = view.state
    .field(foldables)
    .filter((f) => {
      let exists = false;
      folded.between(f.from, f.to, (from, to) => {
        if (from === f.from && to === f.to) exists = true;
      });
      return !exists;
    })
    .map((f) => foldEffect.of({ from: f.from, to: f.to }));
  if (effects.length) view.dispatch({ effects });
}

/** トークナイザを読み終えたら、畳んだところの数を単語数からトークン数に出し直す */
const refoldOnTokenizer = ViewPlugin.fromClass(
  class {
    off: () => void;
    constructor(view: EditorView) {
      this.off = onTokenizerReady(() => {
        const effects: ReturnType<typeof foldEffect.of>[] = [];
        foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
          effects.push(unfoldEffect.of({ from, to }), foldEffect.of({ from, to }));
        });
        if (effects.length) view.dispatch({ effects });
      });
    }
    destroy() {
      this.off();
    }
  },
);

export const promptStructure = [
  parsed,
  foldables,
  bracketMatch,
  codeFolding({
    preparePlaceholder: (state, range) => formatCount(countTokens(state.doc.sliceString(range.from, range.to), { definitions: true })),
    placeholderDOM: (_view, onclick, prepared: string) => {
      const el = document.createElement("span");
      el.className = "cm-foldPlaceholder";
      el.textContent = `… ${prepared}`;
      el.title = "開く";
      el.onclick = onclick;
      return el;
    },
  }),
  foldToggles,
  refoldOnTokenizer,
];
