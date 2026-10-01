import { useEffect, useRef, useState } from "react";
import { api, type GalleryFile, type GalleryInfo, type GalleryKind, type GalleryTag, type GenerateParams, type Meta } from "../api";
import { infotextToParams, parseInfotext } from "../infotext";
import { ImageViewer } from "./ImageViewer";
import { PromptEditor } from "./PromptEditor";

/**
 * ギャラリーの画像詳細。ビューアの操作 (左右で送る・真ん中で閉じる) に、下部の操作バーを重ねる。
 * grid のタグは元画像にも同じように付け外しされ、削除も元画像ごとゴミ箱フォルダへ移る。
 * Like は保管庫 (Saved) への出し入れで、付けると grid と元画像が保管庫へ移る
 */
export function GalleryViewer({
  kind,
  files,
  index,
  onIndex,
  onClose,
  onNearEnd,
  onFileChanged,
  onDeleted,
  customTags,
  meta,
  onUseSettings,
}: {
  kind: GalleryKind;
  files: GalleryFile[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onNearEnd: () => void;
  /** タグが変わった / 保管庫との間で移った (path は元の場所) */
  onFileChanged: (path: string, file: GalleryFile) => void;
  onDeleted: (f: GalleryFile) => void;
  customTags: GalleryTag[];
  meta: Meta | null;
  onUseSettings: (p: Partial<GenerateParams>) => void;
}) {
  const file = files[index];
  const [infos, setInfos] = useState<Record<string, GalleryInfo>>({});
  const [panel, setPanel] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const info = file && infos[file.path];
  const tags = info?.tags ?? file?.tags ?? [];
  const like = customTags.find((t) => t.name === "like");
  // ビューアを閉じ終わってから (履歴を戻してから) 実行したい処理
  const afterClose = useRef<(() => void) | null>(null);

  useEffect(() => {
    setMessage(null);
    if (!file || infos[file.path]) return;
    api.galleryInfo(file.path, kind).then(
      (i) => setInfos((m) => ({ ...m, [file.path]: i })),
      (e) => setMessage({ text: (e as Error).message, error: true }),
    );
    if (index >= files.length - 4) onNearEnd();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.path]);

  if (!file) return null;
  const has = (t: GalleryTag) => tags.some((x) => x.id === t.id);

  const toggleTag = async (t: GalleryTag) => {
    try {
      const r = await api.toggleGalleryTag(file.path, kind, t.id);
      const extra = r.count > 1 ? ` (元画像 ${r.count - 1} 枚も)` : "";
      if (r.file) {
        // Like: 保管庫へ移した / 出力フォルダへ戻した。場所が変わったので詳細は取り直す
        onFileChanged(file.path, r.file);
        setMessage({ text: r.on ? `Like して保管庫へ移しました${extra}` : `Like を外して出力フォルダへ戻しました${extra}` });
        return;
      }
      const next = r.on ? [...tags.filter((x) => x.id !== t.id), t] : tags.filter((x) => x.id !== t.id);
      setInfos((m) => (m[file.path] ? { ...m, [file.path]: { ...m[file.path], tags: next } } : m));
      onFileChanged(file.path, { ...file, tags: next });
      setMessage({ text: `${t.name} を${r.on ? "付けました" : "外しました"}${extra}` });
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    }
  };

  const applySettings = () => {
    if (!info) return;
    const params = infotextToParams(parseInfotext(info.geninfo), meta);
    afterClose.current = () => onUseSettings(params);
    history.back();
  };

  const share = async () => {
    const url = api.galleryImageUrl(file, false);
    try {
      // Web Share は https でしか使えないので、使えなければダウンロードにする
      if (navigator.canShare) {
        const blob = await fetch(url).then((r) => r.blob());
        const f = new File([blob], file.name, { type: blob.type });
        if (navigator.canShare({ files: [f] })) return await navigator.share({ files: [f] });
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
  };

  const remove = async () => {
    const extra = kind === "grid" && info?.sources.length ? ` と元画像 ${info.sources.length} 枚` : "";
    if (!confirm(`${file.name}${extra} をゴミ箱フォルダへ移しますか？\n(メニューの「整理」から空にするまでは元に戻せます)`)) return;
    try {
      await api.deleteGalleryFile(file.path, kind);
      onDeleted(file);
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    }
  };

  const parsed = info ? parseInfotext(info.geninfo) : null;
  const prompt = parsed && (parsed.params["Template"] ?? parsed.prompt);
  const negative = parsed && (parsed.params["Negative Template"] ?? parsed.negative);

  return (
    <ImageViewer
      images={files.map((f) => api.galleryImageUrl(f, false))}
      placeholders={files.map((f) => api.galleryImageUrl(f, true))}
      index={index}
      onIndex={onIndex}
      onClose={() => {
        onClose();
        afterClose.current?.();
        afterClose.current = null;
      }}
      loop={false}
      overlay={
        <>
          <div className="pointer-events-none absolute inset-x-0 top-[max(2rem,calc(env(safe-area-inset-top)+1.25rem))] text-center font-mono text-[10px] text-white/45">
            {new Date(file.mtime).toLocaleString("sv-SE")} · {file.saved && "保管庫 · "}
            {file.name}
          </div>

          {panel && (
            <div className="absolute inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] mx-auto max-h-[62%] max-w-xl overflow-y-auto rounded-t-2xl border-t border-line bg-bg/95 p-4 backdrop-blur">
              {!parsed && <p className="text-sm text-muted">読み込み中…</p>}
              {parsed && (
                <>
                  <Section title="Prompt">
                    <PromptEditor key={`${file.path}-p`} value={prompt ?? ""} readOnly />
                  </Section>
                  {negative && (
                    <Section title="Negative">
                      <PromptEditor key={`${file.path}-n`} value={negative} readOnly />
                    </Section>
                  )}
                  <Section title="Params">
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[11px]">
                      {Object.entries(parsed.params)
                        .filter(([k]) => !/Template|hashes|Version|Source Identifier/i.test(k))
                        .map(([k, v]) => (
                          <div key={k} className="contents">
                            <dt className="text-muted">{k}</dt>
                            <dd className="break-all">{v}</dd>
                          </div>
                        ))}
                    </dl>
                  </Section>
                </>
              )}
              {customTags.length > 0 && (
                <Section title="Tags">
                  <div className="flex flex-wrap gap-1.5">
                    {customTags.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => toggleTag(t)}
                        className={`rounded-full border px-3 py-1 text-xs ${has(t) ? "border-accent bg-accent text-accent-ink" : "border-line text-muted"}`}
                      >
                        {t.name}
                      </button>
                    ))}
                  </div>
                </Section>
              )}
              {kind === "grid" && info && (
                <Section title={`元画像 ${info.sources.length} 枚`}>
                  <div className="flex gap-1.5 overflow-x-auto">
                    {info.sources.map((s) => (
                      <img key={s.path} src={api.galleryImageUrl(s, true)} alt={s.name} title={s.name} className="h-24 flex-none rounded-md" />
                    ))}
                    {info.sources.length === 0 && <p className="text-[11px] text-muted">見つかりませんでした</p>}
                  </div>
                </Section>
              )}
            </div>
          )}

          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent pt-6 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            {message && <p className={`mx-auto mb-1 max-w-xl px-4 text-center text-xs break-words ${message.error ? "text-danger" : "text-white/70"}`}>{message.text}</p>}
            <div className="mx-auto flex max-w-xl justify-around text-white/85">
              {like && <BarButton icon={has(like) ? "♥" : "♡"} label="Like" active={has(like)} onClick={() => toggleTag(like)} />}
              <BarButton icon="ⓘ" label="情報" active={panel} onClick={() => setPanel((v) => !v)} />
              <BarButton icon="✎" label="この設定で" onClick={applySettings} disabled={!info} />
              <BarButton icon="↗" label="保存" onClick={share} />
              <BarButton icon="🗑" label="削除" onClick={remove} />
            </div>
          </div>
        </>
      }
    />
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 text-[10px] tracking-wider text-muted uppercase">{title}</div>
      {children}
    </div>
  );
}

function BarButton({ icon, label, onClick, active = false, disabled = false }: { icon: string; label: string; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className={`flex w-16 flex-col items-center gap-0.5 py-1 text-[10px] disabled:opacity-40 ${active ? "text-accent" : ""}`}>
      <span className="text-xl leading-none">{icon}</span>
      {label}
    </button>
  );
}
