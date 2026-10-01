import { api, type JobView, type Progress } from "../api";

/** 生成中はライブプレビュー、完了後は結果画像を並べる */
export function ResultView({ job, progress, onUseSeed }: { job: JobView | null; progress: Progress | null; onUseSeed: (seed: number) => void }) {
  if (!job) return null;

  if (job.status === "running") {
    return (
      <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-surface">
        {progress?.preview ? (
          <img src={progress.preview} alt="生成中のプレビュー" className="mx-auto max-h-[60vh] w-auto" />
        ) : (
          <div className="flex h-40 items-center justify-center text-sm text-muted">{job.status === "running" && progress?.step === 0 ? "モデルを準備中…" : "生成中…"}</div>
        )}
      </div>
    );
  }

  if (job.status === "error") {
    return <div className="mt-4 rounded-2xl border border-danger/50 bg-danger/10 p-3 text-sm break-words text-danger">生成に失敗しました: {job.error}</div>;
  }

  const seconds = job.finishedAt ? ((job.finishedAt - job.startedAt) / 1000).toFixed(1) : null;
  return (
    <div className="mt-4 space-y-3">
      {job.interrupted && <p className="text-xs text-muted">中断しました</p>}
      <div className={job.imageCount > 1 ? "grid grid-cols-2 gap-2" : ""}>
        {Array.from({ length: job.imageCount }, (_, i) => {
          const seed = job.seeds[i];
          return (
            <figure key={i} className="relative overflow-hidden rounded-2xl border border-line bg-surface">
              <a href={api.imageUrl(job.id, i)} target="_blank" rel="noreferrer">
                <img src={api.imageUrl(job.id, i)} alt={`生成結果 ${i + 1}`} className="w-full" />
              </a>
              {seed !== undefined && (
                <figcaption className="absolute bottom-2 left-2 flex items-center gap-2 rounded-md bg-black/60 px-2 py-1 font-mono text-[10px] text-white">
                  {i === 0 && seconds && <span>{seconds}s ·</span>}
                  <span>seed {seed}</span>
                  <button className="text-accent" onClick={() => onUseSeed(seed)} aria-label="このシードを使う">
                    ♻
                  </button>
                </figcaption>
              )}
            </figure>
          );
        })}
      </div>
    </div>
  );
}
