import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type GalleryFile, type GalleryKind, type GalleryTag, type GenerateParams, type Meta } from "../api";
import { GalleryViewer } from "../components/GalleryViewer";
import { usePersistentState } from "../hooks";

type TagFilter = number | "none" | null;

const dayKey = (ms: number) => new Date(ms).toLocaleDateString("sv-SE");

/**
 * 生成画像の一覧。普段は grid (バッチ 1 回分) で見る。日付ごとに新しい順で並べ、下までスクロールすると続きを読む
 */
export function GalleryPage({ active, meta, onUseSettings }: { active: boolean; meta: Meta | null; onUseSettings: (p: Partial<GenerateParams>) => void }) {
  const [view, setView] = usePersistentState<{ kind: GalleryKind }>("ruiz.gallery", { kind: "grid" });
  const kind = view.kind;
  const [tags, setTags] = useState<GalleryTag[]>([]);
  const [tag, setTag] = useState<TagFilter>(null);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<GalleryFile[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    api.galleryTags().then((r) => setTags(r.tags), () => {});
  }, []);

  const load = useCallback(
    async (offset: number) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      setError(null);
      try {
        const r = await api.gallery({ kind, offset, q, tag });
        setFiles((prev) => (offset ? [...prev, ...r.files] : r.files));
        setNext(r.next);
        setTotal(r.total);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [kind, q, tag],
  );

  const reload = useCallback(() => {
    setFiles([]);
    setNext(null);
    void load(0);
  }, [load]);
  useEffect(reload, [reload]);

  // タブに戻ってきたときは、新しく増えた分だけを先頭に足す (スクロール位置はそのまま)
  const refreshTop = useCallback(async () => {
    if (loadingRef.current) return;
    try {
      const r = await api.gallery({ kind, offset: 0, q, tag });
      setFiles((prev) => {
        const known = new Set(prev.map((f) => f.path));
        const fresh = r.files.filter((f) => !known.has(f.path));
        return fresh.length ? [...fresh, ...prev] : prev;
      });
      setTotal(r.total);
    } catch {
      /* 次の機会に */
    }
  }, [kind, q, tag]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (active) void refreshTop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  useEffect(() => {
    // ビューアを開いている間は並びを変えない (表示中の番号がずれるため)
    const onVisible = () => document.visibilityState === "visible" && active && viewing === null && refreshTop();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [active, refreshTop, viewing]);

  // 一番下の目印が見えたら続きを読む
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es[0].isIntersecting && next !== null && load(next), { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [next, load]);

  const groups = useMemo(() => {
    const out: { day: string; items: { file: GalleryFile; index: number }[] }[] = [];
    files.forEach((file, index) => {
      const day = dayKey(file.mtime);
      if (out[out.length - 1]?.day !== day) out.push({ day, items: [] });
      out[out.length - 1].items.push({ file, index });
    });
    return out;
  }, [files]);

  const today = dayKey(Date.now());
  const chips: { id: TagFilter; label: string }[] = [
    { id: null, label: "すべて" },
    ...tags.map((t) => ({ id: t.id, label: t.name === "like" ? "♥ Like" : t.name })),
    { id: "none", label: "タグなし" },
  ];

  return (
    <div className="pb-24">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex flex-none rounded-full border border-line p-0.5 text-xs">
          {(["grid", "image"] as const).map((k) => (
            <button key={k} onClick={() => setView({ kind: k })} className={`rounded-full px-3 py-1 ${kind === k ? "bg-accent text-accent-ink" : "text-muted"}`}>
              {k === "grid" ? "Grid" : "画像"}
            </button>
          ))}
        </div>
        <form
          className="min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            setQ(query.trim());
          }}
        >
          <input className="field w-full py-1.5! text-sm" type="search" placeholder="🔍 プロンプトで検索" value={query} onChange={(e) => setQuery(e.target.value)} enterKeyHint="search" />
        </form>
      </div>

      <div className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
        {chips.map((c) => (
          <button
            key={String(c.id)}
            onClick={() => setTag(c.id)}
            className={`flex-none rounded-full border px-3 py-1 text-xs ${tag === c.id ? "border-accent bg-accent text-accent-ink" : "border-line text-muted"}`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {total !== null && <p className="-mt-2 mb-3 text-[11px] text-muted">{total.toLocaleString()} 件</p>}
      {error && <p className="mb-3 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-xs break-words text-danger">{error}</p>}

      {groups.map((g) => (
        <section key={g.day} className="mb-5">
          <h2 className="mb-2 font-serif text-lg">{g.day === today ? "今日" : g.day}</h2>
          <div className={kind === "grid" ? "grid grid-cols-2 items-start gap-1.5" : "grid grid-cols-3 gap-1"}>
            {g.items.map(({ file, index }) => (
              <button
                key={file.path}
                onClick={() => setViewing(index)}
                className={`relative overflow-hidden rounded-md bg-surface ${kind === "grid" ? "min-h-20" : "aspect-square"}`}
              >
                <img src={api.galleryImageUrl(file, true)} alt={file.name} loading="lazy" decoding="async" className={kind === "grid" ? "block w-full" : "size-full object-cover"} />
                <TagBadges tags={file.tags ?? []} />
              </button>
            ))}
          </div>
        </section>
      ))}

      <div ref={sentinel} />
      {loading && <p className="py-6 text-center text-sm text-muted">読み込み中…</p>}
      {!loading && !error && files.length === 0 && <p className="py-10 text-center text-sm text-muted">画像がありません</p>}

      {viewing !== null && files[viewing] && (
        <GalleryViewer
          kind={kind}
          files={files}
          index={viewing}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
          onNearEnd={() => next !== null && load(next)}
          onTagsChanged={(path, t) => setFiles((fs) => fs.map((f) => (f.path === path ? { ...f, tags: t } : f)))}
          onDeleted={(f) => {
            const rest = files.filter((x) => x.path !== f.path);
            setFiles(rest);
            setTotal((t) => (t === null ? t : t - 1));
            if (!rest.length) history.back();
            else setViewing((i) => Math.min(i ?? 0, rest.length - 1));
          }}
          customTags={tags}
          meta={meta}
          onUseSettings={onUseSettings}
        />
      )}
    </div>
  );
}

/** 一覧のタイルに付けるタグの印 (Like は ♥、それ以外は名前) */
function TagBadges({ tags }: { tags: GalleryTag[] }) {
  if (!tags.length) return null;
  return (
    <div className="pointer-events-none absolute top-1 right-1 flex gap-1">
      {tags.map((t) => (
        <span key={t.id} className="rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] leading-none text-accent">
          {t.name === "like" ? "♥" : t.name}
        </span>
      ))}
    </div>
  );
}
