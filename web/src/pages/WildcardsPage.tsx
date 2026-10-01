import { faArrowLeft, faEllipsis, faMagnifyingGlass, faPlus } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { type MouseEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, type WildcardFile } from "../api";
import { Heading } from "../components/Heading";
import { MenuItem, PopMenu } from "../components/PopMenu";
import { PromptEditor } from "../components/PromptEditor";
import { invalidateWildcards } from "../prompt/complete";

interface Open {
  name: string;
  /** 開いたときの更新日時。null は新規 (まだ保存していない) */
  mtime: number | null;
  text: string;
  saved: string;
}

/**
 * ワイルドカードの編集: Dynamic Prompts の wildcards/ 以下の .txt を一覧・編集する。
 * 1 行が 1 つの候補。入力欄は生成画面のプロンプトと同じ補完 (タグ / ワイルドカード / LoRA) が効く
 */
export function WildcardsPage() {
  const [files, setFiles] = useState<WildcardFile[] | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Open | null>(null);
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const dirty = !!open && (open.mtime === null || open.text !== open.saved);

  const reload = useCallback(() => api.wildcardFiles().then((r) => setFiles(r.files), (e) => setMessage({ text: (e as Error).message, error: true })), []);
  useEffect(() => void reload(), [reload]);

  // 保存していない変更があるときはタブを閉じる前に確認する
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [dirty]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, WildcardFile[]>();
    for (const f of files ?? []) {
      if (q && !f.name.toLowerCase().includes(q)) continue;
      const folder = f.name.includes("/") ? f.name.slice(0, f.name.lastIndexOf("/")) : "";
      map.set(folder, [...(map.get(folder) ?? []), f]);
    }
    return [...map].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
  }, [files, query]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  const openFile = (name: string) =>
    run(async () => {
      const r = await api.wildcardFile(name);
      setOpen({ name: r.name, mtime: r.mtime, text: r.text, saved: r.text });
      scrollTo(0, 0);
    });

  const create = () => {
    const name = prompt("新しいワイルドカードの名前 (フォルダは / で区切る。例: chara/fate)", query.trim());
    if (!name?.trim()) return;
    const n = name.trim().replace(/\.txt$/i, "");
    if (files?.some((f) => f.name === n)) return void openFile(n);
    setOpen({ name: n, mtime: null, text: "", saved: "" });
    setMessage(null);
  };

  const back = () => {
    if (dirty && !confirm("保存していない変更があります。破棄して一覧に戻りますか？")) return;
    setOpen(null);
    setMessage(null);
  };

  const save = () =>
    open &&
    run(async () => {
      const r = await api.saveWildcard(open.name, open.text, open.mtime);
      setOpen({ ...open, name: r.name, mtime: r.mtime, saved: open.text });
      setMessage({ text: `保存しました (${r.entries} 件)` });
      if (open.mtime === null) invalidateWildcards();
      void reload();
    });

  const renameFile = () => {
    setMenu(null);
    if (!open || open.mtime === null) return;
    const to = prompt("新しい名前", open.name);
    if (!to?.trim() || to.trim() === open.name) return;
    void run(async () => {
      const r = await api.renameWildcard(open.name, to.trim());
      setOpen({ ...open, name: r.name });
      setMessage({ text: `名前を変えました。プロンプトの __${open.name}__ は __${r.name}__ に書き換えてください` });
      invalidateWildcards();
      void reload();
    });
  };

  const removeFile = () => {
    setMenu(null);
    if (!open || open.mtime === null) return;
    if (!confirm(`${open.name} をゴミ箱フォルダへ移しますか？`)) return;
    void run(async () => {
      await api.deleteWildcard(open.name);
      setOpen(null);
      setMessage({ text: `${open.name} をゴミ箱フォルダへ移しました` });
      invalidateWildcards();
      void reload();
    });
  };

  if (open)
    return (
      <div className="pb-24">
        <div className="mb-3 flex items-center gap-2">
          <button onClick={back} aria-label="一覧へ戻る" className="-ml-1 p-1 text-muted">
            <FontAwesomeIcon icon={faArrowLeft} />
          </button>
          <div className="min-w-0 flex-1 truncate font-mono text-sm">
            __{open.name}__
            {dirty && <span className="ml-1 text-accent">●</span>}
          </div>
          {open.mtime !== null && (
            <button onClick={(e: MouseEvent<HTMLButtonElement>) => setMenu(menu ? null : e.currentTarget.getBoundingClientRect())} aria-label="その他" className="p-1 text-muted">
              <FontAwesomeIcon icon={faEllipsis} />
            </button>
          )}
          <button onClick={save} disabled={!dirty || busy} className="rounded-lg bg-accent px-4 py-1.5 text-sm text-accent-ink disabled:opacity-40">
            保存
          </button>
        </div>
        {menu && (
          <PopMenu anchor={menu} onClose={() => setMenu(null)} width={180}>
            <MenuItem onClick={renameFile}>名前を変更</MenuItem>
            <MenuItem onClick={removeFile}>
              <span className="text-danger">削除</span>
            </MenuItem>
          </PopMenu>
        )}
        {message && <p className={`mb-2 text-xs break-words ${message.error ? "text-danger" : "text-accent"}`}>{message.text}</p>}
        <PromptEditor key={open.name + (open.mtime === null ? ":new" : "")} value={open.text} onChange={(text) => setOpen((o) => o && { ...o, text })} lineNumbers minHeight="60vh" placeholder="1 行に 1 つ候補を書く" />
      </div>
    );

  return (
    <div className="pb-24">
      <Heading
        as="h1"
        info={"Dynamic Prompts のワイルドカード (プロンプトに __名前__ と書くと、ファイルの中から 1 行選ばれる)。\n1 行が 1 つの候補で、# で始まる行はコメント。編集欄では生成画面と同じ補完が使えます。\n削除したものはゴミ箱フォルダの wildcards へ移ります。"}
        aside={
          <button onClick={create} className="flex items-center gap-1.5 rounded-lg border border-accent px-3 py-1 text-xs text-accent">
            <FontAwesomeIcon icon={faPlus} />
            新規
          </button>
        }
      >
        ワイルドカード
      </Heading>

      <label className="field mb-3 flex items-center gap-2">
        <FontAwesomeIcon icon={faMagnifyingGlass} className="text-xs text-muted" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="名前で絞り込み" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
      </label>

      {message && <p className={`mb-2 text-xs break-words ${message.error ? "text-danger" : "text-accent"}`}>{message.text}</p>}
      {!files && <p className="text-sm text-muted">読み込み中…</p>}
      {files && !groups.length && <p className="text-sm text-muted">{query ? "当てはまるものがありません" : "ワイルドカードがありません"}</p>}

      {groups.map(([folder, list]) => (
        <section key={folder} className="mb-3">
          {folder && <div className="mb-1 px-1 font-mono text-[11px] text-muted">{folder}/</div>}
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            {list.map((f) => (
              <button key={f.name} onClick={() => openFile(f.name)} disabled={busy} className="flex w-full items-center gap-2 border-b border-line px-3 py-2.5 text-left last:border-b-0">
                <span className="min-w-0 flex-1 truncate font-mono text-sm">{folder ? f.name.slice(folder.length + 1) : f.name}</span>
                <span className="text-xs text-muted">{f.entries}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
