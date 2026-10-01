import type { ReactNode } from "react";

/**
 * 押したボタンのすぐ上 (画面の上の方のボタンならすぐ下) に出す小さなメニュー。外側をタップすると閉じる
 * anchor: 押したボタンの位置 (getBoundingClientRect())。画面の端からははみ出さないようにずらす
 */
export function PopMenu({ anchor, onClose, width = 240, children }: { anchor: DOMRect; onClose: () => void; width?: number; children: ReactNode }) {
  const below = anchor.top < innerHeight / 2;
  const left = Math.min(Math.max(8, anchor.left + anchor.width / 2 - width / 2), innerWidth - width - 8);
  return (
    <>
      <button className="fixed inset-0 z-[60] cursor-default" aria-label="閉じる" onClick={onClose} />
      <div className="fixed z-[61] overflow-hidden rounded-xl border border-line bg-surface text-ink shadow-xl" style={{ left, width, ...(below ? { top: anchor.bottom + 6 } : { bottom: innerHeight - anchor.top + 6 }) }}>
        {children}
      </div>
    </>
  );
}

export function MenuItem({ onClick, active = false, disabled = false, children }: { onClick: () => void; active?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2.5 border-b border-line px-4 py-3 text-left text-sm last:border-b-0 disabled:opacity-45 ${active ? "text-accent" : ""}`}
    >
      {children}
    </button>
  );
}
