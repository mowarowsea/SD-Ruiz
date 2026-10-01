import { useEffect, useRef, useState } from "react";
import { api, type GalleryFile, type GalleryTag, type GenerateParams, type Meta } from "../api";
import { infotextToParams, parseInfotext } from "../infotext";
import { ImageViewer } from "./ImageViewer";
import { PromptEditor } from "./PromptEditor";

interface Info {
  geninfo: string;
  tags: GalleryTag[];
}

/** ギャラリーの画像詳細。ビューアの操作 (左右で送る・真ん中で閉じる) に、下部の操作バーを重ねる */
export function GalleryViewer({
  files,
  index,
  onIndex,
  onClose,
  onNearEnd,
  onDeleted,
  customTags,
  meta,
  onUseSettings,
}: {
  files: GalleryFile[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onNearEnd: () => void;
  onDeleted: (f: GalleryFile) => void;
  customTags: GalleryTag[];
  meta: Meta | null;
  onUseSettings: (p: Partial<GenerateParams>) => void;
}) {
  const file = files[index];
  const [infos, setInfos] = useState<Record<string, Info>>({});
  const [panel, setPanel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const info = file && infos[file.path];
  const like = customTags.find((t) => t.name === "like");
  // ビューアを閉じ終わってから (履歴を戻してから) 実行したい処理
  const afterClose = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!file || infos[file.path]) return;
    api.galleryInfo(file.path).then(
      (i) => setInfos((m) => ({ ...m, [file.path]: i })),
      (e) => setError((e as Error).message),
    );
    if (index >= files.length - 4) onNearEnd();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.path]);

  if (!file) return null;
  const has = (t: GalleryTag) => !!info?.tags.some((x) => x.id === t.id);

  const toggleTag = async (t: GalleryTag) => {
    setError(null);
    try {
      const { on } = await api.toggleGalleryTag(file.path, t.id);
      setInfos((m) => {
        const cur = m[file.path] ?? { geninfo: "", tags: [] };
        return { ...m, [file.path]: { ...cur, tags: on ? [...cur.tags, t] : cur.tags.filter((x) => x.id !== t.id) } };
      });
    } catch (e) {
      setError((e as Error).message);
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
    if (!confirm(`${file.name} を削除しますか？\n(ごみ箱には入らず、元に戻せません)`)) return;
    setError(null);
    try {
      await api.deleteGalleryFile(file.path);
      onDeleted(file);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const parsed = info ? parseInfotext(info.geninfo) : null;

  return (
    <ImageViewer
      images={files.map((f) => api.galleryImageUrl(f, false))}
      placeholders={files.map((f) => api.galleryImageUrl(f, true))}
      index={index}
      onIndex={(i) => {
        setError(null);
        onIndex(i);
      }}
      onClose={() => {
        onClose();
        afterClose.current?.();
        afterClose.current = null;
      }}
      loop={false}
      overlay={
        <>
          <div className="pointer-events-none absolute inset-x-0 top-[max(2rem,calc(env(safe-area-inset-top)+1.25rem))] text-center font-mono text-[10px] text-white/45">{file.date}</div>

          {panel && parsed && (
            <div className="absolute inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] mx-auto max-h-[62%] max-w-xl overflow-y-auto rounded-t-2xl border-t border-line bg-bg/95 p-4 backdrop-blur">
              <Section title="Prompt">
                <PromptEditor key={`${file.path}-p`} value={parsed.params["Template"] ?? parsed.prompt} readOnly />
              </Section>
              {(parsed.params["Negative Template"] ?? parsed.negative) && (
                <Section title="Negative">
                  <PromptEditor key={`${file.path}-n`} value={parsed.params["Negative Template"] ?? parsed.negative} readOnly />
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
            </div>
          )}

          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent pt-6 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            {error && <p className="mx-auto mb-1 max-w-xl px-4 text-xs break-words text-danger">{error}</p>}
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
