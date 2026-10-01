import { faCircleInfo, faClone, faFileArrowDown, faTags, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { api, type GalleryFile, type GalleryInfo, type GalleryTag, type GenerateParams, type Meta } from "../api";
import { infotextToParams, parseInfotext } from "../infotext";
import { ImageViewer } from "./ImageViewer";
import { MenuItem, PopMenu } from "./PopMenu";
import { PromptEditor } from "./PromptEditor";

/**
 * ギャラリーの画像詳細。ビューアの操作 (左右で送る・真ん中で閉じる) に、下部の操作バーを重ねる。
 * Grid 表示では grid → その元画像 → 次の grid … の順に送る (items は並べ終わったもの)。
 * grid のタグは元画像にも同じように付け外しされ、削除も元画像ごとゴミ箱フォルダへ移る。
 * タグを付けると grid と元画像が保管庫 (Saved) へ移り、全部外すと出力フォルダへ戻る
 */
export function GalleryViewer({
  items,
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
  items: GalleryFile[];
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
  const file = items[index];
  const kind = file?.grid ? "grid" : "image";
  const [infos, setInfos] = useState<Record<string, GalleryInfo>>({});
  const [panel, setPanel] = useState(false);
  const [menu, setMenu] = useState<{ kind: "tags" | "settings"; anchor: DOMRect } | null>(null);
  // ボタンの位置はクリックの処理中に取る (setMenu の更新関数は後で呼ばれることがあり、そのときには e.currentTarget が null)
  const openMenu = (kind: "tags" | "settings", e: MouseEvent<HTMLButtonElement>) =>
    setMenu(menu?.kind === kind ? null : { kind, anchor: e.currentTarget.getBoundingClientRect() });
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const info = file && infos[file.path];
  const tags = file?.tags ?? info?.tags ?? [];
  // ビューアを閉じ終わってから (履歴を戻してから) 実行したい処理
  const afterClose = useRef<(() => void) | null>(null);

  useEffect(() => {
    setMessage(null);
    setMenu(null);
    if (!file || infos[file.path]) return;
    api.galleryInfo(file.path, kind).then(
      (i) => setInfos((m) => ({ ...m, [file.path]: i })),
      (e) => setMessage({ text: (e as Error).message, error: true }),
    );
    if (index >= items.length - 6) onNearEnd();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.path]);

  if (!file) return null;
  const has = (t: GalleryTag) => tags.some((x) => x.id === t.id);

  const toggleTag = async (t: GalleryTag) => {
    try {
      const r = await api.toggleGalleryTag(file.path, kind, t.id);
      const extra = r.count > 1 ? ` (元画像 ${r.count - 1} 枚も)` : "";
      const moved = r.file && r.file.path !== file.path;
      if (r.file) onFileChanged(file.path, r.file);
      if (moved) setMessage({ text: r.on ? `${t.name} を付けて保管庫へ移しました${extra}` : `タグが無くなったので出力フォルダへ戻しました${extra}` });
      else setMessage({ text: `${t.name} を${r.on ? "付けました" : "外しました"}${extra}` });
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    }
  };

  const applySettings = (keepSeed: boolean) => {
    if (!info) return;
    const params = infotextToParams(parseInfotext(info.geninfo), meta);
    if (!keepSeed) params.seed = -1;
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
    const n = file.sources?.length ?? 0;
    const extra = n ? ` と元画像 ${n} 枚` : "";
    if (!confirm(`${file.name}${extra} をゴミ箱フォルダへ移しますか？\n(「ギャラリー整理」でゴミ箱を空にするまでは元に戻せます)`)) return;
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
  const seed = parsed?.params["Seed"];

  return (
    <ImageViewer
      images={items.map((f) => api.galleryImageUrl(f, false))}
      placeholders={items.map((f) => api.galleryImageUrl(f, true))}
      index={index}
      onIndex={onIndex}
      onClose={() => {
        onClose();
        afterClose.current?.();
        afterClose.current = null;
      }}
      loop={false}
      showCounter={false}
      overlay={
        <>
          <div className="pointer-events-none absolute inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] text-center font-mono text-[10px] text-white/45">
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
            </div>
          )}

          {menu?.kind === "tags" && (
            <PopMenu anchor={menu.anchor} onClose={() => setMenu(null)}>
              {customTags.map((t) => (
                <MenuItem key={t.id} onClick={() => toggleTag(t)} active={has(t)}>
                  <span className="w-4 text-center">{has(t) ? "✓" : ""}</span>
                  {t.name === "like" ? "♥ Like" : t.name}
                </MenuItem>
              ))}
            </PopMenu>
          )}
          {menu?.kind === "settings" && (
            <PopMenu anchor={menu.anchor} onClose={() => setMenu(null)}>
              <MenuItem onClick={() => applySettings(true)}>
                Seed も引き継ぐ{seed && <span className="ml-auto font-mono text-[10px] text-muted">{seed}</span>}
              </MenuItem>
              <MenuItem onClick={() => applySettings(false)}>
                Seed は引き継がない<span className="ml-auto font-mono text-[10px] text-muted">-1</span>
              </MenuItem>
            </PopMenu>
          )}

          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent pt-6 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            {message && <p className={`mx-auto mb-1 max-w-xl px-4 text-center text-xs break-words ${message.error ? "text-danger" : "text-white/70"}`}>{message.text}</p>}
            <div className="mx-auto flex max-w-xl justify-around text-white/85">
              <BarButton icon={faTags} label="タグ" active={menu?.kind === "tags" || tags.length > 0} onClick={(e) => openMenu("tags", e)} />
              <BarButton icon={faCircleInfo} label="情報" active={panel} onClick={() => setPanel((v) => !v)} />
              <BarButton icon={faClone} label="to t2i" active={menu?.kind === "settings"} onClick={(e) => openMenu("settings", e)} disabled={!info} />
              <BarButton icon={faFileArrowDown} label="保存" onClick={share} />
              <BarButton icon={faTrashCan} label="削除" onClick={remove} />
            </div>
          </div>
        </>
      }
    />
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 text-[10px] tracking-wider text-muted uppercase">{title}</div>
      {children}
    </div>
  );
}

function BarButton({ icon, label, onClick, active = false, disabled = false }: { icon: IconDefinition; label: string; onClick: (e: MouseEvent<HTMLButtonElement>) => void; active?: boolean; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className={`flex w-16 flex-col items-center gap-1 py-1 text-[10px] disabled:opacity-40 ${active ? "text-accent" : ""}`}>
      <FontAwesomeIcon icon={icon} className="text-lg" />
      {label}
    </button>
  );
}
