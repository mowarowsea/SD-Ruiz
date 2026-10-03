import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from "react";
import { api, baseLabel, type ForgeStatus, type GenerateParams, type Meta, modelFolder, modelLabel, type Progress } from "../api";
import { CheckpointSheet } from "../components/CheckpointSheet";
import { LoraChips } from "../components/LoraChips";
import { LoraSheet } from "../components/LoraSheet";
import { BaseBadge, Thumb } from "../components/Thumb";
import { addLora, findLoras, removeLora } from "../prompt/lora";
import { PromptEditor } from "../components/PromptEditor";
import { ParamsAccordion } from "../components/ParamsAccordion";
import { ResultView } from "../components/ResultView";
import { type useJob, usePrefs } from "../hooks";

export function GeneratePage({
  meta,
  forge,
  form,
  setForm,
  jobState,
  onCheckpointDeleted,
}: {
  meta: Meta | null;
  forge: ForgeStatus | null;
  form: GenerateParams;
  setForm: Dispatch<SetStateAction<GenerateParams>>;
  jobState: ReturnType<typeof useJob>;
  onCheckpointDeleted: (title: string) => void;
}) {
  const patch = (p: Partial<GenerateParams>) => setForm((f) => ({ ...f, ...p }));
  const { job, last, progress, refresh } = jobState;
  const { prefs, reload: reloadPrefs, setFavorite } = usePrefs();
  const [sheet, setSheet] = useState<"checkpoint" | "lora" | null>(null);
  const usedLoras = useMemo(() => new Set(findLoras(form.prompt).map((u) => u.name)), [form.prompt]);
  const model = meta?.models.find((m) => m.title === form.checkpoint);

  // モデルを切り替えたら、そのモデルで最後に使ったパラメータに戻す
  const [restored, setRestored] = useState<string | null>(null);
  const selectCheckpoint = (checkpoint: string) => {
    const saved = prefs?.modelParams[checkpoint];
    patch({ checkpoint, ...saved });
    setRestored(saved ? `前回の設定に戻しました: ${saved.width}×${saved.height} · ${saved.steps}st · CFG ${saved.cfg} · ${saved.sampler}` : null);
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
    <div className="pb-20">
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

      {restored && <p className="mt-2 px-1 text-[11px] text-accent">{restored}</p>}

      <Label>Prompt</Label>
      <PromptEditor value={form.prompt} onChange={(prompt) => patch({ prompt })} placeholder="masterpiece, best quality, 1girl, ..." minHeight="9rem" />
      <LoraChips prompt={form.prompt} onChange={(prompt) => patch({ prompt })} onAdd={() => setSheet("lora")} />

      <Label>Negative</Label>
      <PromptEditor value={form.negative} onChange={(negative) => patch({ negative })} placeholder="lowres, bad anatomy, ..." minHeight="6rem" />

      <div className="mt-4">
        <ParamsAccordion value={form} onChange={patch} meta={meta} lastSeed={lastSeed} />
      </div>

      {/* 生成ボタン (生成画像の上。下に固定するとスマホでプロンプトを打つときにキーボードと重なって邪魔なので) */}
      <div className="mt-4">
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
      <LoraSheet
        open={sheet === "lora"}
        onClose={() => setSheet(null)}
        used={usedLoras}
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

function Label({ children }: { children: string }) {
  return <div className="mt-4 mb-1.5 px-0.5 text-[11px] tracking-wider text-muted uppercase">{children}</div>;
}
