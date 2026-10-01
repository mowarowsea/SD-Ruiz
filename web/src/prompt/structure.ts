// 括弧の対応と Dynamic Prompts の変数定義をエディタで扱う
// - キャレットの隣の括弧と、対応する括弧を強調する (エスケープした \( \) は括弧として数えない)
// - ${name=値} の値を折りたためるようにする (定義の頭の ▾ で畳み、… を押すと開く)

import { codeFolding, foldEffect, foldedRanges } from "@codemirror/language";
import { type EditorState, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { type ParseResult, parsePrompt } from "./parse";

// 括弧の強調・折りたたみのたびに解析し直さないよう、文書ごとに 1 回だけ解析する
const parsed = StateField.define<ParseResult>({
  create: (state) => parsePrompt(state.doc.toString()),
  update: (value, tr) => (tr.docChanged ? parsePrompt(tr.state.doc.toString()) : value),
});

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

/** 畳めるもの (中身のある変数定義) の頭に ▾ を出す。畳んだものには出さない */
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
      for (const v of state.field(parsed).variables) {
        if (v.to <= v.valueFrom) continue;
        let isFolded = false;
        folded.between(v.valueFrom, v.to, (from, to) => {
          if (from === v.valueFrom && to === v.to) isFolded = true;
        });
        if (!isFolded) builder.add(v.from, v.from, Decoration.widget({ widget: new FoldToggle(v.valueFrom, v.to), side: -1 }));
      }
      return builder.finish();
    }
  },
  { decorations: (p) => p.decorations },
);

export const promptStructure = [
  parsed,
  bracketMatch,
  codeFolding({ placeholderText: "…" }),
  foldToggles,
];
