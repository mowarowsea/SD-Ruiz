import { useEffect, useMemo, useState } from "react";
import { baseLabel, forgetLora, type Lora, loadLoras, type Prefs } from "../api";
import { Sheet } from "./Sheet";
import { usePersistentState } from "../hooks";
import { BaseBadge, confirmDeleteModel, DeleteMark, DeleteModeButton, FilterChips, SortButton, type SortBy, sortItems, Star, Thumb } from "./Thumb";

type Filter = "all" | "fav" | "used" | `folder:${string}`;

/**
 * LoRA 選択。タップでプロンプトに足す / 外す (続けて何個でも選べるよう、シートは開いたまま)。削除モードではタップで削除する。
 * 今のモデルに合うもの (ベースモデルの構造が同じもの。どちらかが分からなければ合うことにする) だけを出す
 */
export function LoraSheet({
  open,
  onClose,
  used,
  arch,
  family,
  prefs,
  onToggle,
  onFavorite,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  /** プロンプトで使用中の LoRA 名 */
  used: Set<string>;
  /** 今のモデルの構造 ("sdxl" / "anima" ...) とベースモデル名 */
  arch: string | null;
  family: string | null;
  prefs: Prefs | null;
  onToggle: (lora: Lora) => void;
  onFavorite: (name: string, on: boolean) => void;
  onDeleted: (name: string) => void;
}) {
  const [loras, setLoras] = useState<Lora[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = usePersistentState("ruiz.sort.lora", { by: "mtime" as SortBy });
  const favs = new Set(prefs?.favoriteLoras ?? []);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const close = () => {
    setDeleting(false);
    setDeleteError(null);
    onClose();
  };
  const remove = async (l: Lora) => {
    if (!(await confirmDeleteModel("lora", l.name, setDeleteError))) return;
    setDeleteError(null);
    forgetLora(l.name);
    setLoras((ls) => ls && ls.filter((x) => x.name !== l.name));
    onDeleted(l.name);
  };

  useEffect(() => {
    if (open && !loras) loadLoras().then(setLoras, (e) => setError((e as Error).message));
  }, [open, loras]);

  const fits = useMemo(() => (loras ?? []).filter((l) => !arch || !l.arch || l.arch === arch), [loras, arch]);
  const hidden = (loras?.length ?? 0) - fits.length;
  const folders = useMemo(() => [...new Set(fits.map((l) => l.folder))].filter(Boolean).sort(), [fits]);
  const chips = [
    { id: "all" as Filter, label: "すべて" },
    { id: "fav" as Filter, label: "★ お気に入り" },
    { id: "used" as Filter, label: `使用中 ${used.size || ""}`.trim() },
    ...folders.map((f) => ({ id: `folder:${f}` as Filter, label: f })),
  ];

  const q = query.toLowerCase();
  const filtered = fits.filter(
    (l) =>
      (l.name.toLowerCase().includes(q) || l.alias.toLowerCase().includes(q) || l.trainedWords.some((w) => w.toLowerCase().includes(q))) &&
      (filter === "all" || (filter === "fav" && favs.has(l.name)) || (filter === "used" && used.has(l.name)) || (filter.startsWith("folder:") && l.folder === filter.slice(7))),
  );
  const shown = sortItems(filtered, sort.by, (l) => l.name);

  return (
    <Sheet
      open={open}
      onClose={close}
      title="LoRA"
      aside={
        <span className="flex items-center gap-2">
          {loras && `${fits.length} LoRA`}
          <DeleteModeButton on={deleting} onChange={setDeleting} />
        </span>
      }
    >
      <div className="flex gap-2">
        <input className="field min-w-0 flex-1 text-sm" placeholder="🔍 名前・トリガーワードで検索" value={query} onChange={(e) => setQuery(e.target.value)} />
        <SortButton value={sort.by} onChange={(by) => setSort({ by })} />
      </div>
      <FilterChips items={chips} value={filter} onChange={setFilter} />
      {error && <p className="py-4 text-sm text-danger">{error}</p>}
      {hidden > 0 && (
        <p className="mb-2 text-[11px] text-muted">
          {family ?? "このモデル"} に合わない {hidden} 件は出していません
        </p>
      )}
      {deleteError && <p className="mb-3 text-xs break-words text-danger">{deleteError}</p>}
      {!loras && !error && <p className="py-8 text-center text-sm text-muted">読み込み中…</p>}
      <ul className="space-y-1.5">
        {shown.map((l) => {
          const on = used.has(l.name);
          return (
            <li key={l.name} className="relative">
              <button
                onClick={() => (deleting ? remove(l) : onToggle(l))}
                className={`flex w-full items-center gap-3 rounded-xl border p-2 pr-10 text-left ${deleting ? "border-danger/60 bg-surface" : on ? "border-accent bg-accent/10" : "border-line bg-surface"}`}
              >
                <div className="relative flex-none">
                  <Thumb kind="lora" id={l.name} has={l.preview} className="size-14 rounded-lg" />
                  {deleting ? (
                    <DeleteMark className="absolute inset-0 rounded-lg" />
                  ) : (
                    on && <span className="absolute inset-0 grid place-items-center rounded-lg bg-accent/60 text-lg text-accent-ink">✓</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{l.name}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                    <BaseBadge label={baseLabel(l.base)} className="bg-surface2 text-muted" />
                    <span className="truncate">{l.folder || "/"}</span>
                  </div>
                  {l.trainedWords.length > 0 && <div className="mt-0.5 truncate font-mono text-[10px] text-muted/80">{l.trainedWords.join(", ")}</div>}
                </div>
              </button>
              {!deleting && <Star on={favs.has(l.name)} onClick={() => onFavorite(l.name, !favs.has(l.name))} className="absolute top-1/2 right-1 -translate-y-1/2 text-accent" />}
            </li>
          );
        })}
      </ul>
      {loras && shown.length === 0 && <p className="py-8 text-center text-sm text-muted">{filter === "fav" ? "お気に入りはまだありません" : "見つかりません"}</p>}
    </Sheet>
  );
}
