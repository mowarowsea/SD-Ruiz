export type Tab = "generate" | "gallery" | "more";

const tabs: { id: Tab; icon: string; label: string }[] = [
  { id: "generate", icon: "✎", label: "生成" },
  { id: "gallery", icon: "▦", label: "ギャラリー" },
  { id: "more", icon: "☰", label: "メニュー" },
];

export function BottomNav({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex h-15 max-w-xl">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => onChange(t.id)} className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] ${tab === t.id ? "text-accent" : "text-muted"}`}>
            <span className="text-lg leading-none">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
