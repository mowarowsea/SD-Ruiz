// たまに使う機能のサブメニュー。機能はここに増やしていく
const items: { icon: string; label: string; description: string; ready: boolean }[] = [
  { icon: "✦", label: "ワイルドカード", description: "Dynamic Prompts のワイルドカードを編集", ready: false },
];

export function MorePage() {
  return (
    <div>
      <h1 className="mb-4 font-serif text-2xl">メニュー</h1>
      <ul className="overflow-hidden rounded-2xl border border-line bg-surface">
        {items.map((it) => (
          <li key={it.label} className="flex items-center gap-3 border-b border-line px-4 py-3.5 last:border-b-0">
            <span className="w-5 text-center text-accent">{it.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm">{it.label}</div>
              <div className="text-[11px] text-muted">{it.description}</div>
            </div>
            <span className="text-xs text-muted">{it.ready ? "›" : "準備中"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
