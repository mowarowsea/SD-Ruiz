import { faBroom, faImages, faPuzzlePiece, faStar, faWandMagicSparkles } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { type MouseEvent, useState } from "react";
import { MenuItem, PopMenu } from "./PopMenu";

/** 画面。cleanup などのおまけ機能は Extras メニューから開く */
export type Tab = "generate" | "gallery" | "cleanup";

const extras: { id: Tab | null; icon: IconDefinition; label: string; description: string }[] = [
  { id: "cleanup", icon: faBroom, label: "整理", description: "タグの付いていない grid と画像を片付ける" },
  { id: null, icon: faStar, label: "ワイルドカード", description: "準備中" },
];

export function BottomNav({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const inExtras = tab !== "generate" && tab !== "gallery";

  return (
    <>
      {menu && (
        <PopMenu anchor={menu} onClose={() => setMenu(null)} width={256}>
          {extras.map((it) => (
            <MenuItem
              key={it.label}
              disabled={!it.id}
              active={tab === it.id}
              onClick={() => {
                setMenu(null);
                if (it.id) onChange(it.id);
              }}
            >
              <FontAwesomeIcon icon={it.icon} className="w-4 text-accent" />
              <div className="min-w-0">
                <div>{it.label}</div>
                <div className="text-[11px] text-muted">{it.description}</div>
              </div>
            </MenuItem>
          ))}
        </PopMenu>
      )}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex h-15 max-w-xl">
          <NavButton icon={faWandMagicSparkles} label="生成" active={tab === "generate"} onClick={() => onChange("generate")} />
          <NavButton icon={faImages} label="ギャラリー" active={tab === "gallery"} onClick={() => onChange("gallery")} />
          <NavButton icon={faPuzzlePiece} label="Extras" active={inExtras || !!menu} onClick={(e) => setMenu((m) => (m ? null : e.currentTarget.getBoundingClientRect()))} />
        </div>
      </nav>
    </>
  );
}

function NavButton({ icon, label, active, onClick }: { icon: IconDefinition; label: string; active: boolean; onClick: (e: MouseEvent<HTMLButtonElement>) => void }) {
  return (
    <button onClick={onClick} className={`flex flex-1 flex-col items-center justify-center gap-1 text-[10px] ${active ? "text-accent" : "text-muted"}`}>
      <FontAwesomeIcon icon={icon} className="text-lg" />
      {label}
    </button>
  );
}
