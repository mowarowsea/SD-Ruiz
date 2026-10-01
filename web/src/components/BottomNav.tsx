import { faBroom, faImages, faPuzzlePiece, faStar, faWandMagicSparkles } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { useState } from "react";

/** 画面。cleanup などのおまけ機能は Extras メニューから開く */
export type Tab = "generate" | "gallery" | "cleanup";

const extras: { id: Tab | null; icon: IconDefinition; label: string; description: string }[] = [
  { id: "cleanup", icon: faBroom, label: "整理", description: "タグの付いていない grid と画像を片付ける" },
  { id: null, icon: faStar, label: "ワイルドカード", description: "準備中" },
];

export function BottomNav({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const [menu, setMenu] = useState(false);
  const inExtras = tab !== "generate" && tab !== "gallery";

  return (
    <>
      {menu && (
        <>
          <button className="fixed inset-0 z-30 cursor-default" aria-label="閉じる" onClick={() => setMenu(false)} />
          <div className="fixed right-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-40 w-64 overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
            {extras.map((it) => (
              <button
                key={it.label}
                disabled={!it.id}
                onClick={() => {
                  setMenu(false);
                  if (it.id) onChange(it.id);
                }}
                className={`flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left last:border-b-0 disabled:opacity-45 ${tab === it.id ? "text-accent" : ""}`}
              >
                <FontAwesomeIcon icon={it.icon} className="w-4 text-accent" />
                <div className="min-w-0">
                  <div className="text-sm">{it.label}</div>
                  <div className="text-[11px] text-muted">{it.description}</div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex h-15 max-w-xl">
          <NavButton icon={faWandMagicSparkles} label="生成" active={tab === "generate"} onClick={() => onChange("generate")} />
          <NavButton icon={faImages} label="ギャラリー" active={tab === "gallery"} onClick={() => onChange("gallery")} />
          <NavButton icon={faPuzzlePiece} label="Extras" active={inExtras || menu} onClick={() => setMenu((v) => !v)} />
        </div>
      </nav>
    </>
  );
}

function NavButton({ icon, label, active, onClick }: { icon: IconDefinition; label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex flex-1 flex-col items-center justify-center gap-1 text-[10px] ${active ? "text-accent" : "text-muted"}`}>
      <FontAwesomeIcon icon={icon} className="text-lg" />
      {label}
    </button>
  );
}
