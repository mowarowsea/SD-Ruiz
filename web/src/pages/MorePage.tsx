import { useState } from "react";
import { CleanupPage } from "./CleanupPage";

type Item = "cleanup" | "wildcards";

// たまに使う機能のサブメニュー。機能はここに増やしていく
const items: { id: Item; icon: string; label: string; description: string; ready: boolean }[] = [
  { id: "cleanup", icon: "♻", label: "整理", description: "タグの付いていない grid と画像をまとめて片付ける", ready: true },
  { id: "wildcards", icon: "✦", label: "ワイルドカード", description: "Dynamic Prompts のワイルドカードを編集", ready: false },
];

export function MorePage() {
  const [open, setOpen] = useState<Item | null>(null);
  if (open === "cleanup") return <CleanupPage onBack={() => setOpen(null)} />;

  return (
    <div>
      <h1 className="mb-4 font-serif text-2xl">メニュー</h1>
      <ul className="overflow-hidden rounded-2xl border border-line bg-surface">
        {items.map((it) => (
          <li key={it.id} className="border-b border-line last:border-b-0">
            <button onClick={() => it.ready && setOpen(it.id)} disabled={!it.ready} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
              <span className="w-5 text-center text-accent">{it.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm">{it.label}</div>
                <div className="text-[11px] text-muted">{it.description}</div>
              </div>
              <span className="text-xs text-muted">{it.ready ? "›" : "準備中"}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
