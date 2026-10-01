import { autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers as lineNumbersExt, placeholder as placeholderExt, tooltips } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { promptCompletion } from "../prompt/complete";
import { promptHighlight } from "../prompt/highlight";

const theme = EditorView.theme(
  {
    "&": { backgroundColor: "transparent", color: "var(--color-ink)", fontSize: "14px" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.65" },
    ".cm-content": { padding: "0", caretColor: "var(--color-accent)" },
    ".cm-line": { padding: "0" },
    ".cm-cursor": { borderLeftColor: "var(--color-accent)", borderLeftWidth: "2px" },
    ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "var(--color-muted)", opacity: "0.55" },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 0", minWidth: "2ch" },
    ".cm-placeholder": { color: "var(--color-muted)", opacity: "0.6" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "rgba(201,155,171,0.3) !important" },
  },
  { dark: true },
);

/** シンタックスハイライトと補完つきのプロンプト入力欄 */
export function PromptEditor({
  value,
  onChange,
  placeholder,
  minHeight,
  readOnly = false,
  lineNumbers = false,
}: {
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  minHeight?: string;
  /** 表示専用 (ギャラリーの生成情報など)。ハイライトだけ効かせる */
  readOnly?: boolean;
  /** 行番号を出す (1 行が 1 つの候補になるワイルドカードの編集用) */
  lineNumbers?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          ...(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
          ...(lineNumbers ? [lineNumbersExt()] : []),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ autocapitalize: "off", autocorrect: "off", spellcheck: "false" }),
          placeholderExt(placeholder ?? ""),
          promptHighlight,
          autocompletion({ override: [promptCompletion], icons: false, activateOnTypingDelay: 0, optionClass: (c) => `cm-opt-${c.type ?? ""}` }),
          // 補完の候補が入力欄の枠で切れないように body 直下に出す
          tooltips({ parent: document.body }),
          theme,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) changeRef.current?.(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外から値が変わったとき (設定の読み込みなど) だけ反映する
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  return <div ref={host} className="field cursor-text focus-within:border-accent" style={{ minHeight }} onClick={() => view.current?.focus()} />;
}
