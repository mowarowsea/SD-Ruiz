import { type ReactNode, useEffect } from "react";

/** 下からせり上がるシート。背景タップか Esc で閉じる */
export function Sheet({ open, onClose, title, aside, children }: { open: boolean; onClose: () => void; title: string; aside?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/55" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 top-14 mx-auto flex max-w-xl flex-col rounded-t-3xl border-t border-line bg-bg px-4 pt-2.5">
        <button className="mx-auto mb-3 h-1 w-10 rounded bg-line" onClick={onClose} aria-label="閉じる" />
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-serif text-xl">{title}</h2>
          {aside && <span className="text-xs text-muted">{aside}</span>}
        </div>
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}
