import { useMemo, useState } from "react";
import { type Model, modelFolder, modelLabel } from "../api";
import { Sheet } from "./Sheet";

/** Checkpoint 選択。カードのサムネイル表示はステップ 5 で入れる予定で、今はフォルダ別のリスト */
export function CheckpointSheet({ open, onClose, models, value, onSelect }: { open: boolean; onClose: () => void; models: Model[]; value: string; onSelect: (title: string) => void }) {
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState<string | null>(null);

  const folders = useMemo(() => [...new Set(models.map((m) => modelFolder(m.title)))].filter(Boolean).sort(), [models]);
  const shown = models.filter((m) => (folder === null || modelFolder(m.title) === folder) && m.title.toLowerCase().includes(query.toLowerCase()));

  return (
    <Sheet open={open} onClose={onClose} title="Checkpoint" aside={`${models.length} models`}>
      <input className="field w-full text-sm" placeholder="🔍 モデルを検索" value={query} onChange={(e) => setQuery(e.target.value)} />
      {folders.length > 1 && (
        <div className="my-3 flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
          {[null, ...folders].map((f) => (
            <button
              key={f ?? "all"}
              onClick={() => setFolder(f)}
              className={`flex-none rounded-full border px-3 py-1 text-xs ${folder === f ? "border-accent bg-accent text-accent-ink" : "border-line text-muted"}`}
            >
              {f ?? "すべて"}
            </button>
          ))}
        </div>
      )}
      <ul className="mt-2 space-y-1.5">
        {shown.map((m) => (
          <li key={m.title}>
            <button
              onClick={() => {
                onSelect(m.title);
                onClose();
              }}
              className={`w-full rounded-xl border px-3 py-2.5 text-left ${m.title === value ? "border-accent bg-surface2" : "border-line bg-surface"}`}
            >
              <div className="truncate text-sm font-semibold">{modelLabel(m.title)}</div>
              <div className="truncate text-[11px] text-muted">{modelFolder(m.title) || "/"}</div>
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="py-6 text-center text-sm text-muted">見つかりません</li>}
      </ul>
    </Sheet>
  );
}
