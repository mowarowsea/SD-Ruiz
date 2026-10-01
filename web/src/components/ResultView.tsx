import { useState } from "react";
import { api, type JobView, type Progress } from "../api";
import { ImageViewer } from "./ImageViewer";

/** 生成にかかった時間 ("23.4 秒" / "1 分 05 秒") */
function formatDuration(ms: number) {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} 秒`;
  return `${Math.floor(s / 60)} 分 ${String(Math.round(s % 60)).padStart(2, "0")} 秒`;
}

/**
 * 生成結果。Forge と同じく
 * - 生成中: 画面にはライブプレビュー (まだ出ていなければ前回の画像を薄く)、ビューアは前回生成したもの
 * - 生成完了: 画面もビューアも生成したもの (ビューアを開いたままでも切り替わる)
 * 失敗・中断したときはその旨を出したうえで、最後に成功した画像を残しておく
 */
export function ResultView({ job, last, progress }: { job: JobView | null; last: JobView | null; progress: Progress | null }) {
  const [viewing, setViewing] = useState<number | null>(null);
  const count = last?.imageCount ?? 0;
  // Forge は grid を先頭に返すが、画面とビューアでは 画像 1, 画像 2, …, grid の順に並べる
  const hasGrid = !!last && count > last.seeds.length && last.seeds.length > 1;
  const order = Array.from({ length: count }, (_, i) => i);
  if (hasGrid) order.push(order.shift()!);
  const urls = last ? order.map((i) => api.imageUrl(last.id, i)) : [];
  const open = (i: number) => count > 0 && setViewing(i);

  const viewer = viewing !== null && count > 0 && (
    <ImageViewer images={urls} index={Math.min(viewing, count - 1)} onIndex={setViewing} onClose={() => setViewing(null)} />
  );

  const thumbs = (dim: boolean) => (
    <div className={count > 1 ? "grid grid-cols-2 gap-2" : ""}>
      {urls.map((url, i) => (
        <figure key={url} className={`relative overflow-hidden rounded-2xl border border-line bg-surface ${hasGrid && i === count - 1 ? "col-span-2" : ""}`}>
          <button className="block w-full" onClick={() => open(i)}>
            <img src={url} alt={`生成結果 ${i + 1}`} className={`w-full transition-opacity ${dim ? "opacity-35" : ""}`} />
          </button>
        </figure>
      ))}
    </div>
  );

  if (job?.status === "running") {
    return (
      <div className="mt-4">
        {progress?.preview ? (
          <button className="block w-full overflow-hidden rounded-2xl border border-line bg-surface" onClick={() => open(0)}>
            <img src={progress.preview} alt="生成中のプレビュー" className="mx-auto max-h-[60vh] w-auto" />
          </button>
        ) : count > 0 ? (
          thumbs(true)
        ) : (
          <div className="h-40 rounded-2xl border border-line bg-surface" />
        )}
        {viewer}
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
          {thumbs(false)}
          {last.finishedAt && <p className="text-right font-mono text-[11px] text-muted">生成時間 {formatDuration(last.finishedAt - last.startedAt)}</p>}
        </>
      )}
      {viewer}
    </div>
  );
}
