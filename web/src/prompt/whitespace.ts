// スペースと改行を薄く見えるようにする (スペースは 1 文字ずつ点を打つので、いくつ続いているか数えられる)

import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, MatchDecorator, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { useSyncExternalStore } from "react";

const space = Decoration.mark({ class: "pt-space" });
// 全角スペースは半角と見分けにくく、混ざると気付けないので枠で囲む
const wideSpace = Decoration.mark({ class: "pt-wide-space" });
const tab = Decoration.mark({ class: "pt-tab" });

const spaces = new MatchDecorator({
  regexp: / |　|\t/g,
  decoration: (m) => (m[0] === " " ? space : m[0] === "\t" ? tab : wideSpace),
});

class NewlineWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "pt-newline";
    s.textContent = "↵";
    s.setAttribute("aria-hidden", "true");
    return s;
  }
  ignoreEvent() {
    return false;
  }
}

const newline = Decoration.widget({ widget: new NewlineWidget(), side: 1 });

/** 最後の行以外の行末に ↵ を置く */
function newlines(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  let last = -1;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos);
      // 折りたたみで見える範囲が 1 行の途中で分かれることがあるので、同じ行に 2 度置かない
      if (line.number < doc.lines && line.to > last) builder.add(line.to, line.to, newline);
      last = line.to;
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

export const showWhitespace = [
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = spaces.createDeco(view);
      }
      update(u: ViewUpdate) {
        this.decorations = spaces.updateDeco(u, this.decorations);
      }
    },
    { decorations: (v) => v.decorations },
  ),
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = newlines(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) this.decorations = newlines(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  ),
];

// 表示のオンオフ。端末ごとの好みなので localStorage に置き、開いているすべての入力欄に一斉に効かせる
const KEY = "sd-ruiz.showWhitespace";
let enabled = (() => {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
})();
const listeners = new Set<() => void>();

export function setWhitespaceVisible(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* 保存できなくても切り替えは効かせる */
  }
  listeners.forEach((l) => l());
}

export function useWhitespaceVisible() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => enabled,
  );
}
