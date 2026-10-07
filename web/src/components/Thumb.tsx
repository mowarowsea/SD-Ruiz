import { faArrowRotateRight, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
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

/** シートの右上に置く削除モードの切り替え。オンの間はタップで選ぶ代わりに削除する */
export function DeleteModeButton({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      aria-pressed={on}
      className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] ${on ? "border-danger bg-danger/15 text-danger" : "border-line text-muted"}`}
    >
      <FontAwesomeIcon icon={faTrashCan} className="text-[10px]" />
      {on ? "削除モード中" : "削除"}
    </button>
  );
}

/** シートの右上に置く再読込ボタン。Forge に一覧を読み直してもらい、フォルダに足したファイルを再起動なしで出す */
export function RefreshButton({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={async () => {
        setBusy(true);
        try {
          await onRefresh();
        } finally {
          setBusy(false);
        }
      }}
      disabled={busy}
      className="flex items-center gap-1 rounded-full border border-line px-2.5 py-0.5 text-[11px] text-muted disabled:opacity-60"
    >
      <FontAwesomeIcon icon={faArrowRotateRight} className={`text-[10px] ${busy ? "animate-spin" : ""}`} />
      {busy ? "読込中…" : "再読込"}
    </button>
  );
}

/** 削除モードでカードに重ねる印 */
export function DeleteMark({ className = "" }: { className?: string }) {
  return (
    <span className={`grid place-items-center bg-danger/35 text-white ${className}`}>
      <FontAwesomeIcon icon={faTrashCan} className="text-lg drop-shadow" />
    </span>
  );
}

/** 削除の途中のもの (確認を待つ間に重ねてタップしても 1 回だけ消す) */
const removing = new Set<string>();

/**
 * 削除する。ギャラリーでタグの付いた画像に使われているものだけ確認を出し、それ以外はすぐ消す
 * (付随ファイルごとゴミ箱フォルダへ移すので、「ゴミ箱を空にする」までは元に戻せる)。成功したら true
 */
export async function confirmDeleteModel(kind: "checkpoint" | "lora", id: string, onError: (msg: string) => void) {
  const k = `${kind}:${id}`;
  if (removing.has(k)) return false;
  removing.add(k);
  try {
    return await deleteModel(kind, id, onError);
  } finally {
    removing.delete(k);
  }
}

async function deleteModel(kind: "checkpoint" | "lora", id: string, onError: (msg: string) => void) {
  const what = kind === "checkpoint" ? "モデル" : "LoRA";
  const tagged = await api.modelUsage(kind, id).then(
    (r) => r.tagged,
    () => null,
  );
  if (tagged === null) {
    if (!confirm(`${id} がタグの付いた画像に使われているかを確かめられませんでした。\nそれでも削除しますか？`)) return false;
  } else if (tagged > 0) {
    if (!confirm(`${id} は、ギャラリーでタグの付いた画像 ${tagged.toLocaleString()} 枚に使われている${what}です。\n消してもいいですか？`)) return false;
  }
  try {
    await api.deleteModel(kind, id);
    return true;
  } catch (e) {
    onError((e as Error).message);
    return false;
  }
}
