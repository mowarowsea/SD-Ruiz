import { faMagnifyingGlass, faPen, faPlus } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useState } from "react";
import { api, type TagHit } from "../api";
import { Heading } from "../components/Heading";
import { tagToPrompt } from "../prompt/complete";

/** タグのカテゴリ色 (補完の一覧と同じ) */
const categoryColor: Record<number, string> = { 1: "#e59a9a", 3: "#c7a4e3", 4: "#9fcf7f", 5: "#e8c27a" };
const tagKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "_");

/**
 * タグの訳の一覧と編集。訳は tagcomplete の和訳 CSV が元で、直したものは data/translations.csv に入る。
 * 補完の一覧でも、範囲を選んで出る訳をタップすれば直せる
 */
export function TranslationsPage() {
  const [query, setQuery] = useState("");
  const [editedOnly, setEditedOnly] = useState(false);
  const [list, setList] = useState<TagHit[] | null>(null);
  const [total, setTotal] = useState(0);
  const [editing, setEditing] = useState<{ name: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(
      () =>
        api.translations(query, editedOnly).then(
          (r) => {
            setList(r.tags);
            setTotal(r.total);
            setError(null);
          },
          (e) => setError((e as Error).message),
        ),
      200,
    );
    return () => clearTimeout(timer);
  }, [query, editedOnly]);

  const save = async (name: string, text: string) => {
    try {
      const { tag } = await api.setTranslation(name, text);
      setList((l) => {
        const rest = (l ?? []).filter((t) => t.name !== tag.name);
        // 自分の訳を消して辞書にも無くなったものは一覧から外す
        if (!tag.translation || (editedOnly && !tag.edited)) return rest;
        return (l ?? []).some((t) => t.name === tag.name) ? (l ?? []).map((t) => (t.name === tag.name ? tag : t)) : [tag, ...rest];
      });
      setEditing(null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // 英語で探して当てはまる訳が無いときは、その語の訳を足せるようにする
  const q = query.trim();
  const canAdd = !!q && !/[^\x00-\x7f]/.test(q) && !!list && !list.some((t) => t.name === tagKey(q));

  return (
    <div className="pb-24">
      <Heading as="h1" info={"補完の一覧に出る和訳。tagcomplete 向けの和訳 CSV が元で、直した訳は SD-Ruiz の data/translations.csv に入ります (辞書より優先)。\nプロンプトの範囲を選ぶと、その中のタグの訳が補完の窓に出ます。タップするとそこからも直せます。\n訳を空にして保存すると、辞書の訳に戻ります。"}>
        タグの訳
      </Heading>

      <label className="field mb-2 flex items-center gap-2">
        <FontAwesomeIcon icon={faMagnifyingGlass} className="text-xs text-muted" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="タグ名か訳で探す" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
      </label>
      <div className="mb-3 flex items-center gap-2 text-xs">
        <button onClick={() => setEditedOnly((v) => !v)} className={`rounded-full border px-3 py-1 ${editedOnly ? "border-accent bg-accent/15 text-accent" : "border-line text-muted"}`}>
          <FontAwesomeIcon icon={faPen} className="mr-1.5 text-[10px]" />
          直したものだけ
        </button>
        <span className="ml-auto text-muted">訳 {total.toLocaleString()} 件</span>
      </div>

      {error && <p className="mb-2 text-xs break-words text-danger">{error}</p>}
      {!list && !error && <p className="text-sm text-muted">読み込み中…</p>}

      <div className="overflow-hidden rounded-xl border border-line bg-surface empty:hidden">
        {canAdd && editing?.name !== tagKey(q) && (
          <button onClick={() => setEditing({ name: tagKey(q), text: "" })} className="flex w-full items-center gap-2 border-b border-line px-3 py-2.5 text-left text-sm text-accent last:border-b-0">
            <FontAwesomeIcon icon={faPlus} className="text-xs" />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-mono">{tagToPrompt(tagKey(q))}</span> の訳を追加
            </span>
          </button>
        )}
        {editing && !list?.some((t) => t.name === editing.name) && <EditRow name={editing.name} text={editing.text} onChange={(text) => setEditing({ ...editing, text })} onSave={save} onCancel={() => setEditing(null)} />}
        {list?.map((t) =>
          editing?.name === t.name ? (
            <EditRow key={t.name} name={t.name} text={editing.text} edited={t.edited} onChange={(text) => setEditing({ ...editing, text })} onSave={save} onCancel={() => setEditing(null)} />
          ) : (
            <button key={t.name} onClick={() => setEditing({ name: t.name, text: t.translation ?? "" })} className="flex w-full items-baseline gap-3 border-b border-line px-3 py-2.5 text-left last:border-b-0">
              <span className="w-[45%] shrink-0 truncate font-mono text-[13px]" style={{ color: categoryColor[t.category] }}>
                {tagToPrompt(t.name)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{t.translation}</span>
              {t.edited && <FontAwesomeIcon icon={faPen} className="text-[10px] text-accent" title="直した訳" />}
            </button>
          ),
        )}
      </div>
      {list && !list.length && !canAdd && <p className="text-sm text-muted">{editedOnly ? "直した訳はまだありません" : "見つかりません"}</p>}
      {list && list.length >= 100 && <p className="mt-2 text-xs text-muted">件数の多いタグから 100 件だけ出しています。絞り込んでください</p>}
    </div>
  );
}

function EditRow({
  name,
  text,
  edited,
  onChange,
  onSave,
  onCancel,
}: {
  name: string;
  text: string;
  edited?: boolean;
  onChange: (text: string) => void;
  onSave: (name: string, text: string) => void;
  onCancel: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(name, text);
      }}
      className="border-b border-line bg-bg/40 px-3 py-2.5 last:border-b-0"
    >
      <div className="mb-1.5 truncate font-mono text-[13px]">{tagToPrompt(name)}</div>
      <input autoFocus value={text} onChange={(e) => onChange(e.target.value)} placeholder="訳 (空で保存すると辞書の訳に戻す)" className="field mb-2 w-full text-sm" />
      <div className="flex items-center gap-2">
        {edited && (
          <button type="button" onClick={() => onSave(name, "")} className="text-xs text-muted underline">
            辞書の訳に戻す
          </button>
        )}
        <button type="button" onClick={onCancel} className="ml-auto rounded-lg px-3 py-1.5 text-sm text-muted">
          やめる
        </button>
        <button type="submit" className="rounded-lg bg-accent px-4 py-1.5 text-sm text-accent-ink">
          保存
        </button>
      </div>
    </form>
  );
}
