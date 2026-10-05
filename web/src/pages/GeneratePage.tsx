import { faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { type Dispatch, type ReactNode, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import { api, baseLabel, baseSettingsOf, type ForgeStatus, type GenerateParams, type Lora, loadLoras, type Meta, modelFolder, modelLabel, type Progress } from "../api";
import { CheckpointSheet } from "../components/CheckpointSheet";
import { LoraChips } from "../components/LoraChips";
import { LoraSheet } from "../components/LoraSheet";
import { BaseBadge, Thumb } from "../components/Thumb";
import { addLora, findLoras, removeLora } from "../prompt/lora";
import { PromptEditor } from "../components/PromptEditor";
import { ParamsAccordion } from "../components/ParamsAccordion";
import { RecommendSheet } from "../components/RecommendSheet";
import { RecommendTip, TipValue } from "../components/RecommendTip";
import { ResultView } from "../components/ResultView";
import { type useJob, type usePrefs, useRecommend } from "../hooks";
import { setPromptPresets } from "../prompt/complete";

export function GeneratePage({
  meta,
  forge,
  form,
  setForm,
  jobState,
  prefsState,
  typing,
  active,
  onCheckpointDeleted,
}: {
  meta: Meta | null;
  forge: ForgeStatus | null;
  form: GenerateParams;
  setForm: Dispatch<SetStateAction<GenerateParams>>;
  jobState: ReturnType<typeof useJob>;
  prefsState: ReturnType<typeof usePrefs>;
  /** スマホで文字を打っている間 (生成ボタンを隠す) */
  typing: boolean;
  /** 生成画面を開いているか (隠れているときは Ctrl+Enter で生成しない) */
  active: boolean;
  onCheckpointDeleted: (title: string) => void;
}) {
  const patch = (p: Partial<GenerateParams>) => setForm((f) => ({ ...f, ...p }));
  const { job, last, progress, refresh } = jobState;
  const { prefs, reload: reloadPrefs, setFavorite } = prefsState;
  const [sheet, setSheet] = useState<"checkpoint" | "lora" | "recommend" | null>(null);
  const usedLoras = useMemo(() => new Set(findLoras(form.prompt).map((u) => u.name)), [form.prompt]);
  const model = meta?.models.find((m) => m.title === form.checkpoint);

  // モデルを切り替えたら、そのモデルで最後に使ったパラメータに戻す。まだ使ったことが無ければベースモデルの既定にする
  const [restored, setRestored] = useState<string | null>(null);
  const selectCheckpoint = (checkpoint: string) => {
    const mine = prefs?.modelParams[checkpoint];
    const family = meta?.models.find((m) => m.title === checkpoint)?.family ?? null;
    const saved = mine ?? baseSettingsOf(prefs, family).params;
    patch({ checkpoint, ...saved });
    const summary = saved && `${saved.width}×${saved.height} · ${saved.steps}st · CFG ${saved.cfg} · ${saved.sampler}`;
    setRestored(mine ? `前回の設定に戻しました: ${summary}` : saved ? `${family} の既定にしました: ${summary}` : null);
  };

  // このモデルの推奨設定と作例 (見るだけ。値は勝手に変えない)。/quality /negative の補完にも渡す
  const recommend = useRecommend(form.checkpoint);
  const rec = recommend.view?.entry?.rec ?? null;
  const sampleCount = recommend.view?.entry?.samples.length ?? 0;
  useEffect(() => setPromptPresets({ quality: rec?.quality ?? null, negative: rec?.negative ?? null }), [rec]);
  const applySample = (p: Partial<GenerateParams>, skipped: string[]) => {
    if ((form.prompt.trim() || form.negative.trim()) && !confirm("いまの Prompt / Negative を作例のもので上書きします")) return;
    patch(p);
    setRestored(skipped.length ? `作例を入れました (そのまま使えないので変えなかった: ${skipped.join("、")})` : "作例を入れました");
  };

  // 使っている LoRA がこのモデルに合うか (ベースモデルの構造が違うと効かない)。どちらかが分からなければ合うことにする
  const [loras, setLoras] = useState<Lora[] | null>(null);
  useEffect(() => {
    if (!loras && usedLoras.size) loadLoras().then(setLoras, () => {});
  }, [loras, usedLoras]);
  const loraProblem = (name: string) => {
    const l = loras?.find((x) => x.name === name);
    if (!l?.arch || !model?.arch || l.arch === model.arch) return null;
    return `${l.family} 用の LoRA なので ${model.family} では効きません`;
  };
  useEffect(() => {
    if (!restored) return;
    const t = setTimeout(() => setRestored(null), 4000);
    return () => clearTimeout(t);
  }, [restored]);

  const toggleLora = (name: string) => {
    const use = findLoras(form.prompt).find((u) => u.name === name);
    patch({ prompt: use ? removeLora(form.prompt, use) : addLora(form.prompt, name) });
  };
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 未選択 or 消えたモデルなら Forge 側で現在選ばれているものに合わせる
  useEffect(() => {
    if (!meta) return;
    if (!meta.models.some((m) => m.title === form.checkpoint) && meta.current) patch({ checkpoint: meta.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta]);

  // 押したらすぐ生成中の表示にする (前の画像の読み込みで回線が詰まっていると、受け付けの応答が遅れて押せたのか分からなくなるので)
  const [submitting, setSubmitting] = useState(false);
  const running = job?.status === "running" || submitting;
  const canGenerate = !!forge?.online && !!form.checkpoint && !running;

  const generate = async () => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      await api.generate(form);
      await refresh();
      void reloadPrefs();
    } catch (e) {
      setSubmitError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  // PC 向けに Ctrl+Enter (Mac は ⌘+Enter) でも生成する。プロンプト欄 (CodeMirror の Mod-Enter は空行の挿入) より先に取るので capture で聞く。
  // シートを開いている間はしない
  const onShortcut = useRef<() => void>(() => {});
  onShortcut.current = () => canGenerate && void generate();
  useEffect(() => {
    if (!active || sheet) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      onShortcut.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, sheet]);

  // 進捗は 1 回の生成の中では戻さない (終わり際に Forge が 0 を返すとバーが右から左へ縮んで、エラーで戻ったように見えるので)。
  // 始まった直後は前の生成の値が残っていることがあるので、ステップが進み始めるまでは使わない
  const [seen, setSeen] = useState({ id: "", ratio: 0, stepped: false });
  const cur = running && job && seen.id === job.id ? seen : { id: job?.id ?? "", ratio: 0, stepped: false };
  const stepped = cur.stepped || (progress?.step ?? 0) > 0;
  const ratio = stepped ? Math.max(cur.ratio, progress?.ratio ?? 0) : 0;
  useEffect(() => {
    if (running && job && (seen.id !== job.id || seen.ratio !== ratio || seen.stepped !== stepped)) setSeen({ id: job.id, ratio, stepped });
  }, [running, job, ratio, stepped, seen]);

  const lastSeed = last?.seeds.length ? last.seeds[0] : null;

  return (
    <div className="pb-36">
      <button onClick={() => setSheet("checkpoint")} className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-2.5 text-left" disabled={!meta}>
        <Thumb kind="checkpoint" id={form.checkpoint} has={!!model?.preview} className="size-14 flex-none rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{form.checkpoint ? modelLabel(form.checkpoint) : "Checkpoint を選択"}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
            <BaseBadge label={baseLabel(model?.base ?? null)} className="bg-surface2 text-muted" />
            <span className="truncate">{form.checkpoint ? modelFolder(form.checkpoint) : meta ? "" : "読み込み中…"}</span>
          </div>
        </div>
        <span className="text-lg text-muted">›</span>
      </button>

      <div className="mt-2 flex items-start gap-3 px-1">
        <p className="min-w-0 flex-1 text-[11px] text-accent">{restored}</p>
        {form.checkpoint && (
          <button onClick={() => setSheet("recommend")} className="flex-none text-[11px] text-muted">
            {recommend.view?.status === "pending" ? "推奨を取得中…" : rec || sampleCount ? `推奨と作例${sampleCount ? ` (${sampleCount})` : ""}` : "推奨と作例"}{" "}
            <FontAwesomeIcon icon={faChevronRight} className="text-[9px]" />
          </button>
        )}
      </div>

      <Label tip={rec?.quality ? <PromptTip text={rec.quality} command="/quality" /> : null}>Prompt</Label>
      <PromptEditor value={form.prompt} onChange={(prompt) => patch({ prompt })} placeholder="masterpiece, best quality, 1girl, ..." minHeight="9rem" />
      <LoraChips prompt={form.prompt} onChange={(prompt) => patch({ prompt })} onAdd={() => setSheet("lora")} problem={loraProblem} />

      <Label tip={rec?.negative ? <PromptTip text={rec.negative} command="/negative" /> : null}>Negative</Label>
      <PromptEditor value={form.negative} onChange={(negative) => patch({ negative })} placeholder="lowres, bad anatomy, ..." minHeight="6rem" />

      <div className="mt-4">
        <ParamsAccordion value={form} onChange={patch} meta={meta} lastSeed={lastSeed} rec={rec} />
      </div>

      {/* 生成ボタン (下部ナビの上に浮かせる。スマホで文字を打っている間は、キーボードと一緒にせり上がらないよう下部ナビと一緒に隠す) */}
      <div hidden={typing} className="fixed inset-x-0 bottom-[calc(3rem+env(safe-area-inset-bottom))] z-20 bg-gradient-to-t from-bg from-60% to-transparent px-4 pt-6 pb-3">
        <div className="mx-auto max-w-xl">
          {submitError && <p className="mb-2 text-xs break-words text-danger">{submitError}</p>}
          {running ? (
            <div className="flex gap-2">
              <div className="relative flex-1 overflow-hidden rounded-2xl bg-accent/25 py-3.5 text-center text-base font-semibold">
                <div className="absolute inset-y-0 left-0 bg-accent/60 transition-[width] duration-500" style={{ width: `${Math.round(ratio * 100)}%` }} />
                <span className="relative">{job?.status === "running" ? runningLabel(progress, stepped) : "送信中…"}</span>
              </div>
              <button onClick={() => api.interrupt()} className="rounded-2xl border border-line bg-surface px-4 text-sm text-muted">
                中断
              </button>
            </div>
          ) : (
            <button onClick={generate} disabled={!canGenerate} className="w-full rounded-2xl bg-accent py-3.5 text-base font-semibold tracking-wide text-accent-ink disabled:opacity-40">
              生成
            </button>
          )}
        </div>
      </div>

      <ResultView job={job} last={last} progress={progress} />

      {meta && (
        <CheckpointSheet
          open={sheet === "checkpoint"}
          onClose={() => setSheet(null)}
          models={meta.models}
          value={form.checkpoint}
          prefs={prefs}
          onSelect={selectCheckpoint}
          onFavorite={(id, on) => setFavorite("checkpoint", id, on)}
          onDeleted={(title) => {
            onCheckpointDeleted(title);
            void reloadPrefs();
          }}
        />
      )}
      <RecommendSheet open={sheet === "recommend"} onClose={() => setSheet(null)} view={recommend.view} meta={meta} onRefresh={recommend.refresh} onUse={applySample} />
      <LoraSheet
        open={sheet === "lora"}
        onClose={() => setSheet(null)}
        used={usedLoras}
        arch={model?.arch ?? null}
        family={model?.family ?? null}
        prefs={prefs}
        onToggle={(l) => toggleLora(l.name)}
        onFavorite={(id, on) => setFavorite("lora", id, on)}
        onDeleted={() => void reloadPrefs()}
      />
    </div>
  );
}

/** 生成中のボタンの表示 (始まる前のモデルの読み込み中と、終わり際の VAE デコード・保存中はステップが 0) */
function runningLabel(progress: Progress | null, stepped: boolean) {
  if (!progress) return "生成中…";
  if (progress.step === 0) return stepped ? "仕上げ中…" : "準備中…";
  return progress.steps > 0 ? `生成中 ${progress.step} / ${progress.steps}` : "生成中…";
}

function Label({ tip, children }: { tip?: ReactNode; children: string }) {
  return (
    <div className="mt-4 mb-1.5 px-0.5 text-[11px] tracking-wider text-muted uppercase">
      {children}
      {tip}
    </div>
  );
}

/** Prompt / Negative の (i)。推奨のタグと、補完で呼び出すコマンド */
function PromptTip({ text, command }: { text: string; command: string }) {
  return (
    <RecommendTip>
      <TipValue>{text}</TipValue>
      <div className="mt-1.5 text-[11px] text-muted">プロンプト欄で {command} と打つと補完に出ます</div>
    </RecommendTip>
  );
}
