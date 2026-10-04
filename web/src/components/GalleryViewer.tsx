import { faCheck, faCircleInfo, faClone, faCopy, faFileArrowDown, faTags, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { api, type GalleryFile, type GalleryInfo, type GalleryTag, type GenerateParams, type Meta } from "../api";
import { usePersistentState } from "../hooks";
import { type Change, diffInfotext } from "../infodiff";
import { infotextToParams, parseInfotext } from "../infotext";
import { ImageViewer } from "./ImageViewer";
import { MenuItem, PopMenu } from "./PopMenu";
import { PromptEditor } from "./PromptEditor";

/**
 * ギャラリーの画像詳細。ビューアの操作 (左右で送る・真ん中で閉じる) に、下部の操作バーを重ねる。
 * Grid 表示では grid → その元画像 → 次の grid … の順に送る (items は並べ終わったもの)。
 * grid のタグは元画像にも同じように付け外しされ、削除も元画像ごとゴミ箱フォルダへ移る。
 * タグを付けると grid と元画像が保管庫 (Saved) へ移り、全部外すと出力フォルダへ戻る。
 * 上部には 1 つ前 (古い方) の生成から変えたところを小さく出す (タップで情報パネル)
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
  const [diffView, setDiffView] = usePersistentState("ruiz.gallery.diff", { overlay: true });

  // 比べるのは grid / 単体画像どうし。grid の元画像を見ているときはその grid で比べる
  // (grid のプロンプトは Dynamic Prompts の展開前、元画像は展開後なので、混ぜると違いだらけになる)
  const subject = useMemo(() => (file && items.find((f) => f.sources?.some((s) => s.path === file.path))) ?? file, [items, file]);
  const sourcePaths = useMemo(() => new Set(items.flatMap((f) => f.sources?.map((s) => s.path) ?? [])), [items]);
  const prevFile = useMemo(() => subject && items.slice(items.indexOf(subject) + 1).find((f) => !sourcePaths.has(f.path)), [items, subject, sourcePaths]);
  const subjectInfo = subject && infos[subject.path];
  const prevInfo = prevFile && infos[prevFile.path];
  const changes = useMemo(
    () => (subjectInfo && prevInfo ? diffInfotext(parseInfotext(subjectInfo.geninfo), parseInfotext(prevInfo.geninfo)) : null),
    [subjectInfo, prevInfo],
  );

  const requested = useRef(new Set<string>());
  useEffect(() => {
    setMessage(null);
    setMenu(null);
    if (!file) return;
    for (const f of [file, subject, prevFile]) {
      if (!f || requested.current.has(f.path)) continue;
      requested.current.add(f.path);
      api.galleryInfo(f.path, f.grid ? "grid" : "image").then(
        (i) => setInfos((m) => ({ ...m, [f.path]: i })),
        (e) => {
          requested.current.delete(f.path);
          if (f === file) setMessage({ text: (e as Error).message, error: true });
        },
      );
    }
    if (index >= items.length - 6) onNearEnd();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.path, prevFile?.path]);

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
  // grid は Dynamic Prompts の構文のまま、単体画像はその画像を作ったときの展開後のプロンプトを出す
  const prompt = parsed && (file.grid ? (parsed.params["Template"] ?? parsed.prompt) : parsed.prompt);
  const negative = parsed && (file.grid ? (parsed.params["Negative Template"] ?? parsed.negative) : parsed.negative);
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
          {diffView.overlay && changes && !panel && (
            <button
              onClick={() => setPanel(true)}
              aria-label="前の生成との違い"
              className="absolute inset-x-0 top-[calc(max(0.75rem,env(safe-area-inset-top))+1.1rem)] mx-auto w-fit max-w-[min(36rem,calc(100%-5rem))] rounded-lg bg-black/45 px-2 py-0.5 text-left text-[11px] leading-snug text-white/75 backdrop-blur-sm"
            >
              <ChangeSummary changes={changes} />
            </button>
          )}

          {panel && (
            <div className="absolute inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] mx-auto max-h-[62%] max-w-xl overflow-y-auto rounded-t-2xl border-t border-line bg-bg/95 p-4 backdrop-blur">
              {!parsed && <p className="text-sm text-muted">読み込み中…</p>}
              {parsed && (
                <>
                  {changes && (
                    <Section
                      title="前の生成との違い"
                      aside={
                        <label className="flex items-center gap-1.5 normal-case">
                          <input type="checkbox" checked={diffView.overlay} onChange={(e) => setDiffView({ overlay: e.target.checked })} className="accent-accent" />
                          画像の上に出す
                        </label>
                      }
                    >
                      <ChangeDetails changes={changes} />
                    </Section>
                  )}
                  <Section title="Prompt">
                    <PromptBlock key={`${file.path}-p`} value={prompt ?? ""} />
                  </Section>
                  {negative && (
                    <Section title="Negative">
                      <PromptBlock key={`${file.path}-n`} value={negative} />
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

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 flex items-center justify-between text-[10px] tracking-wider text-muted uppercase">
        {title}
        {aside}
      </div>
      {children}
    </div>
  );
}

/** 表示専用のプロンプト。右上にコピーボタン */
function PromptBlock({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (await copyText(value)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <div className="relative rounded-lg border border-line bg-surface/60 py-2 pr-10 pl-2.5">
      <PromptEditor value={value} readOnly />
      <button
        onClick={copy}
        aria-label="コピー"
        className={`absolute top-1 right-1 flex size-8 items-center justify-center rounded-md ${copied ? "text-ok" : "text-muted active:bg-surface2"}`}
      >
        <FontAwesomeIcon icon={copied ? faCheck : faCopy} className="text-sm" />
      </button>
    </div>
  );
}

/** Clipboard API は https (か localhost) でしか使えないので、LAN の http では textarea を選択してコピーする */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 下のやり方で */
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  const ok = document.execCommand("copy");
  ta.remove();
  return ok;
}

function BarButton({ icon, label, onClick, active = false, disabled = false }: { icon: IconDefinition; label: string; onClick: (e: MouseEvent<HTMLButtonElement>) => void; active?: boolean; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className={`flex w-16 flex-col items-center gap-1 py-1 text-[10px] disabled:opacity-40 ${active ? "text-accent" : ""}`}>
      <FontAwesomeIcon icon={icon} className="text-lg" />
      {label}
    </button>
  );
}

const short = (v: string | undefined, n = 28) => (v === undefined ? "—" : v.length > n ? `${v.slice(0, n - 1)}…` : v);

/** 画像の上に出す 1〜2 行の要約。パラメータ → プロンプトの順 */
function ChangeSummary({ changes }: { changes: Change[] }) {
  if (!changes.length) return <span className="text-white/45">前と同じ設定 (Seed 以外)</span>;
  return (
    <span className="line-clamp-2 break-words">
      {changes.map((c, i) => (
        <span key={i} className="mr-2">
          {c.kind === "param" ? (
            <>
              <span className="text-white/50">{c.key}</span> {short(c.from)}→<span className="text-white">{short(c.to)}</span>
            </>
          ) : (
            <>
              {c.kind === "negative" && <span className="text-white/50">Neg </span>}
              {c.added.length + c.removed.length > 8 ? (
                // 多すぎると要約にならないので数だけ (中身は情報パネルで)
                <span className="mr-1">
                  {c.kind === "prompt" && <span className="text-white/50">Prompt </span>}
                  <span className="text-ok">+{c.added.length}</span> <span className="text-danger">−{c.removed.length}</span>
                </span>
              ) : (
                [
                  ...c.added.map((t) => (
                    <span key={`+${t}`} className="mr-1 text-ok">
                      +{short(t, 24)}
                    </span>
                  )),
                  ...c.removed.map((t) => (
                    <span key={`-${t}`} className="mr-1 text-danger">
                      −{short(t, 24)}
                    </span>
                  )),
                ]
              )}
              {c.reweighted.map((r) => (
                <span key={`~${r.tag}`} className="mr-1 text-[#e8c27a]">
                  {short(r.tag, 24)} {r.from}→{r.to}
                </span>
              ))}
            </>
          )}
        </span>
      ))}
    </span>
  );
}

/** 情報パネルの中の全部入り */
function ChangeDetails({ changes }: { changes: Change[] }) {
  if (!changes.length) return <p className="text-xs text-muted">前と同じ設定です (Seed 以外)</p>;
  return (
    <div className="space-y-1 font-mono text-[11px]">
      {changes.map((c, i) =>
        c.kind === "param" ? (
          <div key={i} className="break-all">
            <span className="text-muted">{c.key}</span> {c.from ?? "—"} → <span className="text-accent">{c.to ?? "—"}</span>
          </div>
        ) : (
          <div key={i} className="break-all">
            <span className="text-muted">{c.kind === "prompt" ? "Prompt" : "Negative"}</span>{" "}
            {c.added.map((t) => (
              <span key={`+${t}`} className="mr-1.5 text-ok">
                +{t}
              </span>
            ))}
            {c.removed.map((t) => (
              <span key={`-${t}`} className="mr-1.5 text-danger">
                −{t}
              </span>
            ))}
            {c.reweighted.map((r) => (
              <span key={`~${r.tag}`} className="mr-1.5 text-[#e8c27a]">
                {r.tag} {r.from}→{r.to}
              </span>
            ))}
          </div>
        ),
      )}
    </div>
  );
}
