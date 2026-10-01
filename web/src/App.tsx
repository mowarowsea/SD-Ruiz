import { useEffect, useRef, useState } from "react";
import { api, type ForgeStatus, type GenerateParams, type Meta } from "./api";
import { defaultForm, toForm } from "./form";
import { BottomNav, type Tab } from "./components/BottomNav";
import { useForgeStatus, useJob, usePersistentState } from "./hooks";
import { GeneratePage } from "./pages/GeneratePage";
import { GalleryPage } from "./pages/GalleryPage";
import { MorePage } from "./pages/MorePage";

export function App() {
  const [nav, setNav] = usePersistentState<{ tab: Tab }>("ruiz.nav", { tab: "generate" });
  const { status, serverDown } = useForgeStatus();
  const [meta, setMeta] = useState<Meta | null>(null);
  const jobState = useJob();
  const galleryOpened = useRef(false);
  if (nav.tab === "gallery") galleryOpened.current = true;
  const [form, setForm] = useState<GenerateParams>(defaultForm);

  // 開いたときは「最後に成功した生成」の設定に戻す (生成中ならその設定)。PC でもスマホでも同じ状態になる
  const restored = useRef(false);
  useEffect(() => {
    if (!jobState.loaded || restored.current) return;
    restored.current = true;
    const src = jobState.job?.status === "running" ? jobState.job.params : jobState.last?.params;
    if (src) setForm(toForm(src));
  }, [jobState]);

  // ギャラリーなどから設定を受け取って生成画面へ
  const applySettings = (p: Partial<GenerateParams>) => {
    setForm((f) => ({ ...f, ...p }));
    setNav({ tab: "generate" });
    scrollTo(0, 0);
  };

  // Forge が使える状態になったらモデル一覧などを取りにいく
  useEffect(() => {
    if (status?.online && !meta) api.meta().then(setMeta).catch(() => {});
  }, [status, meta]);

  return (
    <>
      <header className="mx-auto flex max-w-xl items-center justify-between px-4 pt-[max(0.9rem,env(safe-area-inset-top))] pb-2">
        <div className="font-serif text-2xl tracking-wide">
          Ru<span className="text-accent">i</span>z<span className="ml-1.5 font-sans text-[10px] text-muted">ルイス</span>
        </div>
        <ForgeBadge status={status} serverDown={serverDown} />
      </header>

      <main className="mx-auto max-w-xl px-4 pt-2">
        {serverDown ? (
          <Notice>SD-Ruiz サーバーに接続できません</Notice>
        ) : (
          status && !status.online && <Notice>{forgeMessage(status)}</Notice>
        )}
        {/* 生成とギャラリーは一度開いたら保持しておく (入力中の内容やスクロール位置を失わない) */}
        <div hidden={nav.tab !== "generate"}>
          <GeneratePage meta={meta} forge={status} form={form} setForm={setForm} jobState={jobState} />
        </div>
        {(nav.tab === "gallery" || galleryOpened.current) && (
          <div hidden={nav.tab !== "gallery"}>
            <GalleryPage meta={meta} onUseSettings={applySettings} />
          </div>
        )}
        {nav.tab === "more" && <MorePage />}
      </main>

      <BottomNav tab={nav.tab} onChange={(tab) => setNav({ tab })} />
    </>
  );
}

function ForgeBadge({ status, serverDown }: { status: ForgeStatus | null; serverDown: boolean }) {
  const color = serverDown || (status && !status.online) ? "bg-danger" : status?.online ? (status.busy ? "bg-accent" : "bg-ok") : "bg-muted";
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-muted">
      <span className={`size-2 rounded-full ${color}`} />
      Forge
    </div>
  );
}

function forgeMessage(status: Extract<ForgeStatus, { online: false }>) {
  return {
    unreachable: "Forge が起動していません",
    "api-disabled": "Forge は動いていますが API が無効です（--api を付けて再起動してください）",
    error: `Forge でエラーが発生しました: ${status.detail ?? ""}`,
  }[status.reason];
}

function Notice({ children }: { children: string }) {
  return <div className="mb-3 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{children}</div>;
}
