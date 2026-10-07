import { faArrowRotateLeft, faTrashCan, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useState } from "react";
import { findTags, type Hit, removeTag, replaceAll, replaceInTag } from "../prompt/find";

type Texts = { prompt: string; negative: string };
type Key = keyof Texts;

/** Prompt / Negative をまとめて検索し、当たったタグごとに「その部分だけ置換」「タグごと外す」をする */
export function FindReplace({
  query,
  onQuery,
  texts,
  onChange,
  onClose,
}: {
  query: string;
  onQuery: (q: string) => void;
  texts: Texts;
  onChange: (t: Partial<Texts>) => void;
  onClose: () => void;
}) {
  const [replacement, setReplacement] = useState("");
  // before: 置き換える前、after: 置き換えた後 (戻すときに、その後で手で書き換えていないかを見る)
  const [undo, setUndo] = useState<{ before: Texts; after: Texts }[]>([]);
  const hits = (["prompt", "negative"] as const).flatMap((key) => findTags(texts[key], query).map((hit) => ({ key, hit })));

  const apply = (t: Partial<Texts>) => {
    setUndo((u) => [...u, { before: texts, after: { ...texts, ...t } }]);
    onChange(t);
  };

  const undoLast = () => {
    const last = undo[undo.length - 1];
    // 置き換えたあとに手で書き換えていたら、それも消えるので確かめる
    const edited = last.after.prompt !== texts.prompt || last.after.negative !== texts.negative;
    if (edited && !confirm("置き換えたあとに書き換えた分も消えて、置き換える前に戻ります。戻しますか？")) return;
    onChange(last.before);
    setUndo((u) => u.slice(0, -1));
  };

  return (
    <div className="mb-2 rounded-2xl border border-line bg-surface p-2.5">
      <div className="flex items-center gap-2">
        <input
          className="field min-w-0 flex-1 bg-bg! py-1.5! text-sm"
          type="search"
          placeholder="探す文言"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          autoFocus
          enterKeyHint="search"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <span className="w-10 flex-none text-right text-[11px] text-muted">{query ? `${hits.length} 個` : ""}</span>
        <button onClick={onClose} aria-label="検索を閉じる" className="grid size-8 flex-none place-items-center rounded-lg text-muted active:bg-surface2">
          <FontAwesomeIcon icon={faXmark} />
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          className="field min-w-0 flex-1 bg-bg! py-1.5! text-sm"
          placeholder="置き換える文言 (空なら消す)"
          value={replacement}
          onChange={(e) => setReplacement(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button
          onClick={() => apply({ prompt: replaceAll(texts.prompt, query, replacement), negative: replaceAll(texts.negative, query, replacement) })}
          disabled={!hits.length}
          className="flex-none rounded-lg border border-line px-3 py-1.5 text-xs active:bg-surface2 disabled:opacity-40"
        >
          全部置換
        </button>
      </div>

      {hits.length > 0 && (
        <ul className="mt-2 max-h-64 overflow-y-auto border-t border-line">
          {hits.map(({ key, hit }) => (
            <li key={`${key}-${hit.from}`} className="flex items-center gap-1.5 border-b border-line py-1.5 last:border-b-0">
              <span className="w-3 flex-none text-center text-[10px] text-muted">{key === "prompt" ? "P" : "N"}</span>
              <Snippet text={texts[key]} hit={hit} />
              <button
                onClick={() => apply({ [key]: replaceInTag(texts[key], hit, replacement) })}
                className="max-w-28 flex-none truncate rounded-lg border border-line px-2 py-1 text-[11px] active:bg-surface2"
              >
                {replacement ? `→ ${replacement}` : "部分を消す"}
              </button>
              <button
                onClick={() => apply({ [key]: removeTag(texts[key], hit) })}
                aria-label="タグごと外す"
                className="grid size-7 flex-none place-items-center rounded-lg text-danger active:bg-surface2"
              >
                <FontAwesomeIcon icon={faTrashCan} className="text-xs" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {query && !hits.length && <p className="mt-2 px-1 text-[11px] text-muted">見つかりません</p>}

      {undo.length > 0 && (
        <div className="mt-2 flex justify-end">
          <button
            onClick={undoLast}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-muted active:bg-surface2"
          >
            <FontAwesomeIcon icon={faArrowRotateLeft} />
            元に戻す
          </button>
        </div>
      )}
    </div>
  );
}

/** 当たったタグを 1 行で。タグが長いときは当たったところの少し前から出す */
function Snippet({ text, hit }: { text: string; hit: Hit }) {
  const start = Math.max(hit.from, hit.matches[0].from - 12);
  const parts: { s: string; on: boolean }[] = [];
  let at = start;
  for (const m of hit.matches) {
    parts.push({ s: text.slice(at, m.from), on: false }, { s: text.slice(m.from, m.to), on: true });
    at = m.to;
  }
  parts.push({ s: text.slice(at, hit.to), on: false });
  return (
    <span className="min-w-0 flex-1 truncate font-mono text-xs">
      {start > hit.from && <span className="text-muted">…</span>}
      {parts.map((p, i) =>
        p.on ? (
          <mark key={i} className="rounded-sm bg-accent/35 text-ink">
            {p.s}
          </mark>
        ) : (
          <span key={i}>{p.s.replace(/\s+/g, " ")}</span>
        ),
      )}
    </span>
  );
}
