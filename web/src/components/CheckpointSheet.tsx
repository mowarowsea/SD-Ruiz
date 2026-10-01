import { useMemo, useState } from "react";
import { baseLabel, type Model, modelFolder, modelLabel, type Prefs } from "../api";
import { Sheet } from "./Sheet";
import { BaseBadge, FilterChips, Star, Thumb } from "./Thumb";

type Filter = "all" | "fav" | "recent" | `folder:${string}`;

/** Checkpoint 選択。プレビューつきのカードを 2 列で並べる */
export function CheckpointSheet({
  open,
  onClose,
  models,
  value,
  prefs,
  onSelect,
  onFavorite,
}: {
  open: boolean;
  onClose: () => void;
  models: Model[];
  value: string;
  prefs: Prefs | null;
  onSelect: (title: string) => void;
  onFavorite: (title: string, on: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const favs = new Set(prefs?.favoriteCheckpoints ?? []);
  const recent = prefs?.recentCheckpoints ?? [];

  const folders = useMemo(() => [...new Set(models.map((m) => modelFolder(m.title)))].filter(Boolean).sort(), [models]);
  const chips = [
    { id: "all" as Filter, label: "すべて" },
    { id: "fav" as Filter, label: "★ お気に入り" },
    { id: "recent" as Filter, label: "最近" },
    ...folders.map((f) => ({ id: `folder:${f}` as Filter, label: f })),
  ];

  const shown = useMemo(() => {
    const q = query.toLowerCase();
    let list = models.filter((m) => m.title.toLowerCase().includes(q));
    if (filter === "fav") list = list.filter((m) => favs.has(m.title));
    else if (filter === "recent") list = recent.map((t) => list.find((m) => m.title === t)).filter((m): m is Model => !!m);
    else if (filter.startsWith("folder:")) list = list.filter((m) => modelFolder(m.title) === filter.slice(7));
    if (filter !== "recent") list = [...list].sort((a, b) => modelLabel(a.title).localeCompare(modelLabel(b.title)));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, query, filter, prefs]);

  return (
    <Sheet open={open} onClose={onClose} title="Checkpoint" aside={`${models.length} models`}>
      <input className="field w-full text-sm" placeholder="🔍 モデルを検索" value={query} onChange={(e) => setQuery(e.target.value)} />
      <FilterChips items={chips} value={filter} onChange={setFilter} />
      <ul className="grid grid-cols-2 gap-2.5">
        {shown.map((m) => (
          <li key={m.title} className="relative">
            <button
              onClick={() => {
                onSelect(m.title);
                onClose();
              }}
              className={`relative block w-full overflow-hidden rounded-2xl border text-left ${m.title === value ? "border-accent ring-1 ring-accent" : "border-line"}`}
            >
              <Thumb kind="checkpoint" id={m.title} has={m.preview} className="aspect-[3/4] w-full" />
              <BaseBadge label={baseLabel(m.base)} className="absolute top-2 left-2" />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/60 to-transparent px-2.5 pt-6 pb-2">
                <div className="line-clamp-2 text-[12px] leading-tight font-semibold break-all text-white">{modelLabel(m.title)}</div>
                <div className="truncate text-[10px] text-white/55">{modelFolder(m.title)}</div>
              </div>
            </button>
            {/* ボタンの入れ子にならないよう、カードの外に重ねる */}
            <Star on={favs.has(m.title)} onClick={() => onFavorite(m.title, !favs.has(m.title))} className="absolute top-0.5 right-0.5 drop-shadow" />
          </li>
        ))}
      </ul>
      {shown.length === 0 && <p className="py-8 text-center text-sm text-muted">{filter === "fav" ? "お気に入りはまだありません" : "見つかりません"}</p>}
    </Sheet>
  );
}
