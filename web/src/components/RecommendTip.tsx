import { faCircleInfo } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { type ReactNode, useState } from "react";
import { PopMenu } from "./PopMenu";

/**
 * ラベルの横の (i)。押すとそのモデルの推奨値を小さな窓で出す。
 * label 要素の中には置かない (中のボタンが label の対象になり、吹き出しの文字を押すと (i) が押されて閉じてしまうため)
 */
export function RecommendTip({ children, width = 280 }: { children: ReactNode; width?: number }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  return (
    <>
      <button
        type="button"
        aria-label="このモデルの推奨"
        className={`ml-1 normal-case ${anchor ? "text-accent" : "text-muted"}`}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect())}
      >
        <FontAwesomeIcon icon={faCircleInfo} className="text-[11px]" />
      </button>
      {anchor && (
        <PopMenu anchor={anchor} onClose={() => setAnchor(null)} width={width}>
          <div className="px-3.5 py-3 text-xs leading-relaxed tracking-normal normal-case">
            <div className="mb-1.5 text-[11px] text-muted">このモデルの推奨 (Civitai)</div>
            {children}
          </div>
        </PopMenu>
      )}
    </>
  );
}

/** 推奨の値。onPick があればタップでその値にする (勝手には変えない) */
export function TipValue({ children, onPick, current = false }: { children: ReactNode; onPick?: () => void; current?: boolean }) {
  if (!onPick) return <span className="mr-1.5 mb-1 inline-block rounded-md bg-surface2 px-2 py-1 font-mono">{children}</span>;
  return (
    <button
      type="button"
      onClick={onPick}
      className={`mr-1.5 mb-1 inline-block rounded-md border px-2 py-1 font-mono ${current ? "border-accent text-accent" : "border-line active:bg-surface2"}`}
    >
      {children}
    </button>
  );
}
