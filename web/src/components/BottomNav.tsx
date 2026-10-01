import { faBroom, faHeartPulse, faImages, faPuzzlePiece, faShuffle, faWandMagicSparkles } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { type MouseEvent, useState } from "react";
import { MenuItem, PopMenu } from "./PopMenu";

/** 画面。cleanup などのおまけ機能は Extras メニューから開く */
export type Tab = "generate" | "gallery" | "cleanup" | "wildcards" | "forge";
export const tabs: Tab[] = ["generate", "gallery", "cleanup", "wildcards", "forge"];

/** id が null のものは準備中 */
const extras: { id: Tab | null; icon: IconDefinition; label: string }[] = [
  { id: "cleanup", icon: faBroom, label: "ギャラリー整理" },
  { id: "wildcards", icon: faShuffle, label: "ワイルドカード" },
  { id: "forge", icon: faHeartPulse, label: "Forge 起動・診断" },
];

export function BottomNav({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const inExtras = tab !== "generate" && tab !== "gallery";

  return (
    <>
      {menu && (
        <PopMenu anchor={menu} onClose={() => setMenu(null)} width={220}>
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
              {it.label}
              {!it.id && <span className="ml-auto text-[11px] text-muted">準備中</span>}
            </MenuItem>
          ))}
        </PopMenu>
      )}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex h-15 max-w-xl">
          <NavButton icon={faWandMagicSparkles} label="生成" active={tab === "generate"} onClick={() => onChange("generate")} />
          <NavButton icon={faImages} label="ギャラリー" active={tab === "gallery"} onClick={() => onChange("gallery")} />
          <NavButton icon={faPuzzlePiece} label="Extras" active={inExtras || !!menu} onClick={(e) => setMenu(menu ? null : e.currentTarget.getBoundingClientRect())} />
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
