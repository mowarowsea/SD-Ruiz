import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type GalleryFile, type GalleryTag, type GenerateParams, type Meta } from "../api";
import { GalleryViewer } from "../components/GalleryViewer";

interface Filter {
  q: string;
  /** 手で付けるタグ (like など) */
  custom: number | null;
  model: number | null;
}

const today = () => new Date().toLocaleDateString("sv-SE");

/** 生成画像の一覧 (IIB の索引を使う)。日付ごとに新しい順で並べ、下までスクロールすると続きを読む */
export function GalleryPage({ meta, onUseSettings }: { meta: Meta | null; onUseSettings: (p: Partial<GenerateParams>) => void }) {
  const [tags, setTags] = useState<GalleryTag[]>([]);
  const [filter, setFilter] = useState<Filter>({ q: "", custom: null, model: null });
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<GalleryFile[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const loadingRef = useRef(false);
  const firstLoad = useRef(true);

  useEffect(() => {
    api.galleryTags().then((r) => setTags(r.tags), () => {});
  }, []);
  const customTags = tags.filter((t) => t.type === "custom");
  const modelTags = useMemo(() => tags.filter((t) => t.type === "Model").sort((a, b) => b.count - a.count), [tags]);

  const load = useCallback(
    async (cursor: string | null) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      setError(null);
      try {
        const tagIds = [filter.custom, filter.model].filter((x): x is number => x !== null);
        // 初回だけ、新しく保存された画像を索引に取り込ませる
        const r = await api.gallery({ cursor, q: filter.q, tags: tagIds, refresh: firstLoad.current });
        firstLoad.current = false;
        setFiles((prev) => (cursor ? [...prev, ...r.files] : r.files));
        setNext(r.next);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [filter],
  );

  useEffect(() => {
    setFiles([]);
    setNext(null);
    void load(null);
  }, [load]);

  // 一番下の目印が見えたら続きを読む
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es[0].isIntersecting && next && load(next), { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [next, load]);

  // 日付ごとにまとめる
  const groups = useMemo(() => {
    const out: { date: string; items: { file: GalleryFile; index: number }[] }[] = [];
    files.forEach((file, index) => {
      const date = file.date.slice(0, 10);
      if (out[out.length - 1]?.date !== date) out.push({ date, items: [] });
      out[out.length - 1].items.push({ file, index });
    });
    return out;
  }, [files]);

  // タグ絞り込みと文字検索は IIB の API が別なので、どちらか一方にする
  const setTag = (p: Partial<Filter>) => {
    setQuery("");
    setFilter((f) => ({ ...f, q: "", ...p }));
  };

  return (
    <div className="pb-24">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setFilter({ q: query.trim(), custom: null, model: null });
        }}
      >
        <input className="field w-full text-sm" type="search" placeholder="🔍 プロンプトで検索" value={query} onChange={(e) => setQuery(e.target.value)} enterKeyHint="search" />
      </form>

      <div className="-mx-4 mt-3 mb-4 flex items-center gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
        <Chip on={filter.custom === null && filter.model === null && !filter.q} onClick={() => setTag({ custom: null, model: null })}>
          すべて
        </Chip>
        {customTags.map((t) => (
          <Chip key={t.id} on={filter.custom === t.id} onClick={() => setTag({ custom: filter.custom === t.id ? null : t.id })}>
            {t.name === "like" ? "♥ Like" : t.name}
          </Chip>
        ))}
        {modelTags.length > 0 && (
          <select
            className={`max-w-48 flex-none rounded-full border bg-transparent px-3 py-1 text-xs outline-none ${filter.model !== null ? "border-accent text-accent" : "border-line text-muted"}`}
            value={filter.model ?? ""}
            onChange={(e) => setTag({ model: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">モデル: すべて</option>
            {modelTags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.count})
              </option>
            ))}
          </select>
        )}
      </div>

      {error && <p className="mb-3 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-xs break-words text-danger">{error}</p>}

      {groups.map((g) => (
        <section key={g.date} className="mb-5">
          <h2 className="mb-2 flex items-baseline gap-2 font-serif text-lg">
            {g.date === today() ? "今日" : g.date}
            <span className="font-sans text-[11px] text-muted">{g.items.length}{g === groups[groups.length - 1] && next ? "+" : ""} 枚</span>
          </h2>
          <div className="grid grid-cols-3 gap-1">
            {g.items.map(({ file, index }) => (
              <button key={file.path} onClick={() => setViewing(index)} className="aspect-square overflow-hidden rounded-md bg-surface">
                <img src={api.galleryImageUrl(file, true)} alt={file.name} loading="lazy" decoding="async" className="size-full object-cover" />
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
          files={files}
          index={viewing}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
          onNearEnd={() => next && load(next)}
          onDeleted={(f) => {
            const rest = files.filter((x) => x.path !== f.path);
            setFiles(rest);
            if (!rest.length) history.back();
            else setViewing((i) => Math.min(i ?? 0, rest.length - 1));
          }}
          customTags={customTags}
          meta={meta}
          onUseSettings={onUseSettings}
        />
      )}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`flex-none rounded-full border px-3 py-1 text-xs ${on ? "border-accent bg-accent text-accent-ink" : "border-line text-muted"}`}>
      {children}
    </button>
  );
}
