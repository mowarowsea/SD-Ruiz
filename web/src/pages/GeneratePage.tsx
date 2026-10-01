import { useEffect, useState } from "react";
import { api, type ForgeStatus, type GenerateParams, type Meta, modelFolder, modelLabel } from "../api";
import { CheckpointSheet } from "../components/CheckpointSheet";
import { ParamsAccordion } from "../components/ParamsAccordion";
import { ResultView } from "../components/ResultView";
import { useJob, usePersistentState } from "../hooks";

const defaults: GenerateParams = {
  checkpoint: "",
  prompt: "",
  negative: "",
  width: 832,
  height: 1216,
  steps: 28,
  cfg: 5,
  sampler: "Euler a",
  scheduler: "automatic",
  seed: -1,
  batch: 1,
};

export function GeneratePage({ meta, forge }: { meta: Meta | null; forge: ForgeStatus | null }) {
  // 入力内容は端末に保存しておき、リロードやタブを閉じても残す
  const [form, setForm] = usePersistentState("ruiz.generate", defaults);
  const patch = (p: Partial<GenerateParams>) => setForm((f) => ({ ...f, ...p }));
  const { job, progress, refresh } = useJob();
  const [sheet, setSheet] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 未選択 or 消えたモデルなら Forge 側で現在選ばれているものに合わせる
  useEffect(() => {
    if (!meta) return;
    if (!meta.models.some((m) => m.title === form.checkpoint) && meta.current) patch({ checkpoint: meta.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta]);

  const running = job?.status === "running";
  const canGenerate = !!forge?.online && !!form.checkpoint && !running;

  const generate = async () => {
    setSubmitError(null);
    try {
      await api.generate(form);
      refresh();
    } catch (e) {
      setSubmitError((e as Error).message);
    }
  };

  const lastSeed = job?.status === "done" && job.seeds.length ? job.seeds[0] : null;

  return (
    <div className="pb-44">
      <button onClick={() => setSheet(true)} className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-left" disabled={!meta}>
        <div className="size-11 flex-none rounded-xl bg-gradient-to-br from-accent/70 to-surface2" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{form.checkpoint ? modelLabel(form.checkpoint) : "Checkpoint を選択"}</div>
          <div className="truncate text-[11px] text-muted">{form.checkpoint ? modelFolder(form.checkpoint) : meta ? "" : "読み込み中…"}</div>
        </div>
        <span className="text-lg text-muted">›</span>
      </button>

      <Label>Prompt</Label>
      <textarea
        className="field block min-h-36 w-full resize-y font-mono text-[13px] leading-relaxed"
        value={form.prompt}
        onChange={(e) => patch({ prompt: e.target.value })}
        placeholder="masterpiece, best quality, 1girl, ..."
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />

      <Label>Negative</Label>
      <textarea
        className="field block min-h-24 w-full resize-y font-mono text-[13px] leading-relaxed"
        value={form.negative}
        onChange={(e) => patch({ negative: e.target.value })}
        placeholder="lowres, bad anatomy, ..."
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />

      <div className="mt-4">
        <ParamsAccordion value={form} onChange={patch} meta={meta} lastSeed={lastSeed} />
      </div>

      <ResultView job={job} progress={progress} onUseSeed={(seed) => patch({ seed })} />

      {/* 生成ボタン (下部ナビの上に固定) */}
      <div className="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-20 bg-gradient-to-t from-bg from-60% to-transparent px-4 pt-6 pb-3">
        <div className="mx-auto max-w-xl">
          {submitError && <p className="mb-2 text-xs break-words text-danger">{submitError}</p>}
          {running ? (
            <div className="flex gap-2">
              <div className="relative flex-1 overflow-hidden rounded-2xl bg-accent/25 py-3.5 text-center font-serif text-lg">
                <div className="absolute inset-y-0 left-0 bg-accent/60 transition-[width] duration-500" style={{ width: `${Math.round((progress?.ratio ?? 0) * 100)}%` }} />
                <span className="relative">
                  生成中{progress && progress.steps > 0 ? ` ${progress.step} / ${progress.steps}` : "…"}
                </span>
              </div>
              <button onClick={() => api.interrupt()} className="rounded-2xl border border-line bg-surface px-4 text-sm text-muted">
                中断
              </button>
            </div>
          ) : (
            <button onClick={generate} disabled={!canGenerate} className="w-full rounded-2xl bg-accent py-3.5 font-serif text-lg tracking-wide text-accent-ink disabled:opacity-40">
              生成
            </button>
          )}
        </div>
      </div>

      {meta && <CheckpointSheet open={sheet} onClose={() => setSheet(false)} models={meta.models} value={form.checkpoint} onSelect={(checkpoint) => patch({ checkpoint })} />}
    </div>
  );
}

function Label({ children }: { children: string }) {
  return <div className="mt-4 mb-1.5 px-0.5 text-[11px] tracking-wider text-muted uppercase">{children}</div>;
}
