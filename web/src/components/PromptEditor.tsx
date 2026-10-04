import { autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers as lineNumbersExt, placeholder as placeholderExt, tooltips } from "@codemirror/view";
import { faCheck, faCopy } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { isUsed, promptCompletion, translateSelection, translationColumn } from "../prompt/complete";
import { promptHighlight } from "../prompt/highlight";
import { foldAll, promptStructure } from "../prompt/structure";
import { countTokens, loadTokenizer, onTokenizerReady } from "../prompt/tokens";

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
    // ${name=値} を畳んだときの …
    ".cm-foldPlaceholder": { margin: "0 2px", padding: "0 6px", border: "1px solid var(--color-line)", borderRadius: "4px", backgroundColor: "var(--color-surface2)", color: "var(--color-accent)", cursor: "pointer" },
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
  copyable = false,
}: {
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  minHeight?: string;
  /** 表示専用 (ギャラリーの生成情報など)。ハイライトだけ効かせる */
  readOnly?: boolean;
  /** 行番号を出す (1 行が 1 つの候補になるワイルドカードの編集用) */
  lineNumbers?: boolean;
  /** 枠の内側の右上にコピーボタンを出す */
  copyable?: boolean;
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
          promptStructure,
          translateSelection,
          autocompletion({ override: [promptCompletion], icons: false, activateOnTypingDelay: 0, addToOptions: [translationColumn], optionClass: (c) => `cm-opt-${c.type ?? ""}${isUsed(c) ? " cm-opt-used" : ""}` }),
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
    foldAll(v);
    return () => v.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外から値が変わったとき (設定の読み込みなど) だけ反映する
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
      foldAll(v);
    }
  }, [value]);

  // 右上のトークン数 (ワイルドカードは 1 行ずつ別の候補なので出さない)
  const showCount = !lineNumbers;
  const [tokenizerVersion, tokenizerLoaded] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!showCount) return;
    void loadTokenizer();
    return onTokenizerReady(tokenizerLoaded);
  }, [showCount]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tokens = useMemo(() => (showCount && value ? countTokens(value) : null), [showCount, value, tokenizerVersion]);

  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (await copyText(value)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="relative">
      <div ref={host} className={`field cursor-text focus-within:border-accent ${copyable ? "pr-9" : ""}`} style={{ minHeight }} onClick={() => view.current?.focus()} />
      {copyable && (
        <button
          onClick={copy}
          aria-label="コピー"
          className={`absolute top-2.5 right-1.5 flex size-7 items-center justify-center rounded-md ${copied ? "text-ok" : "text-muted active:bg-surface2"}`}
        >
          <FontAwesomeIcon icon={copied ? faCheck : faCopy} className="text-sm" />
        </button>
      )}
      {tokens && (
        <span className={`pointer-events-none absolute -top-2 right-3 rounded bg-bg px-1.5 font-mono text-[10px] leading-4 ${tokens.count > 75 && !tokens.words ? "text-accent" : "text-muted"}`}>
          {tokens.words ? `${tokens.count} 語` : `${tokens.count}/${tokens.limit}`}
        </span>
      )}
    </div>
  );
}

/** Clipboard API は https (か localhost) でしか使えないので、LAN の http では textarea を選択してコピーする */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 下のやり方で */
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  const ok = document.execCommand("copy");
  ta.remove();
  return ok;
}
