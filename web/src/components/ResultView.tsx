import { useState } from "react";
import { api, type JobView, type Progress } from "../api";
import { ImageViewer } from "./ImageViewer";

/**
 * 生成中はライブプレビュー、それ以外は最後に成功したジョブの画像を並べる。
 * 失敗・中断したときはその旨を出したうえで、最後に成功した画像を残しておく
 */
export function ResultView({ job, last, progress }: { job: JobView | null; last: JobView | null; progress: Progress | null }) {
  const [viewing, setViewing] = useState<number | null>(null);

  if (job?.status === "running") {
    return (
      <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-surface">
        {progress?.preview ? (
          <img src={progress.preview} alt="生成中のプレビュー" className="mx-auto max-h-[60vh] w-auto" />
        ) : (
          <div className="flex h-40 items-center justify-center text-sm text-muted">{progress?.step === 0 ? "モデルを準備中…" : "生成中…"}</div>
        )}
      </div>
    );
  }

  const failed = job?.status === "error";
  const interruptedEmpty = job && job.id !== last?.id && job.interrupted;

  return (
    <div className="mt-4 space-y-3">
      {failed && <div className="rounded-2xl border border-danger/50 bg-danger/10 p-3 text-sm break-words text-danger">生成に失敗しました: {job.error}</div>}
      {interruptedEmpty && <p className="text-xs text-muted">中断しました</p>}
      {last && (
        <>
          {(failed || interruptedEmpty) && <p className="text-[11px] text-muted">最後に成功した結果:</p>}
          {last.interrupted && last.id === job?.id && <p className="text-xs text-muted">中断しました (途中までの結果)</p>}
          <div className={last.imageCount > 1 ? "grid grid-cols-2 gap-2" : ""}>
            {Array.from({ length: last.imageCount }, (_, i) => {
              return (
                <figure key={`${last.id}-${i}`} className="relative overflow-hidden rounded-2xl border border-line bg-surface">
                  <button className="block w-full" onClick={() => setViewing(i)}>
                    <img src={api.imageUrl(last.id, i)} alt={`生成結果 ${i + 1}`} className="w-full" />
                  </button>
                </figure>
              );
            })}
          </div>
          {viewing !== null && (
            <ImageViewer images={Array.from({ length: last.imageCount }, (_, i) => api.imageUrl(last.id, i))} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
          )}
        </>
      )}
    </div>
  );
}
