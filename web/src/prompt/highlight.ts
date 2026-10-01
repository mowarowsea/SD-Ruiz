// parsePrompt の結果を CodeMirror の装飾にする

import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { parsePrompt } from "./parse";

const markCache = new Map<string, Decoration>();
const mark = (cls: string) => {
  let d = markCache.get(cls);
  if (!d) markCache.set(cls, (d = Decoration.mark({ class: cls })));
  return d;
};

/** 強調の倍率を 0.1 刻みの段階にする (CSS のクラスで色の濃さを変える) */
function emphasisClass(weight: number) {
  if (weight > 1) return `pe-up-${Math.min(5, Math.max(1, Math.round((weight - 1) * 10)))}`;
  return `pe-down-${Math.min(5, Math.max(1, Math.round((1 - weight) * 10)))}`;
}

function build(view: EditorView): DecorationSet {
  const text = view.state.doc.toString();
  const { spans, emphasis } = parsePrompt(text);
  // RangeSetBuilder は from 順に足す必要があるので、強調と構文をまとめて並べる
  const ranges: { from: number; to: number; cls: string }[] = [
    ...emphasis.map((e) => ({ from: e.from, to: e.to, cls: emphasisClass(e.weight) })),
    ...spans.map((s) => ({ from: s.from, to: s.to, cls: s.kind === "bracket" ? `pt-bracket pt-depth-${(s.depth ?? 0) % 3}` : `pt-${s.kind}` })),
  ].filter((r) => r.to > r.from);
  ranges.sort((a, b) => a.from - b.from || b.to - a.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const r of ranges) builder.add(r.from, r.to, mark(r.cls));
  return builder.finish();
}

export const promptHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);
