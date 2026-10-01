import { useState } from "react";
import { api } from "../api";

/** モデル / LoRA のプレビュー画像。無いときや読めないときはグラデーションにする */
export function Thumb({ kind, id, has, className = "" }: { kind: "checkpoint" | "lora"; id: string; has: boolean; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`overflow-hidden bg-gradient-to-br from-accent/45 to-surface2 ${className}`}>
      {has && !failed && <img src={api.thumbUrl(kind, id)} alt="" loading="lazy" decoding="async" className="size-full object-cover" onError={() => setFailed(true)} />}
    </div>
  );
}

/** ベースモデルのバッジ */
export function BaseBadge({ label, className = "" }: { label: string | null; className?: string }) {
  if (!label) return null;
  return <span className={`rounded-md bg-black/55 px-1.5 py-0.5 font-mono text-[10px] leading-none text-white/90 ${className}`}>{label}</span>;
}

export function Star({ on, onClick, className = "" }: { on: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      aria-label={on ? "お気に入りから外す" : "お気に入りに追加"}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`grid size-8 place-items-center text-base ${on ? "text-accent" : "text-white/50"} ${className}`}
    >
      {on ? "★" : "☆"}
    </button>
  );
}

/** 横スクロールの絞り込みチップ */
export function FilterChips<T extends string>({ items, value, onChange }: { items: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="my-3 flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => onChange(it.id)}
          className={`flex-none rounded-full border px-3 py-1 text-xs ${value === it.id ? "border-accent bg-accent text-accent-ink" : "border-line text-muted"}`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export type SortBy = "mtime" | "name";

/** 並び順の切り替え (新しい順 ⇔ 名前順)。検索欄の横に置く */
export function SortButton({ value, onChange }: { value: SortBy; onChange: (v: SortBy) => void }) {
  return (
    <button onClick={() => onChange(value === "mtime" ? "name" : "mtime")} className="flex-none rounded-xl border border-line px-3 text-xs text-muted">
      {value === "mtime" ? "新しい順" : "名前順"}
    </button>
  );
}

/** 新しい順 (ファイルの更新日時の降順) か名前順に並べる */
export function sortItems<T extends { mtime: number }>(list: T[], by: SortBy, name: (x: T) => string) {
  return [...list].sort((a, b) => (by === "mtime" ? b.mtime - a.mtime : 0) || name(a).localeCompare(name(b)));
}
