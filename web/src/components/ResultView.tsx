import { type ReactNode, useEffect, useState } from "react";
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
  // Forge は複数枚のとき grid を先頭に返すが、画面とビューアには 1 枚ずつの画像だけ出す (grid はギャラリーで見る)
  const total = last?.imageCount ?? 0;
  const skip = last && total > last.seeds.length && last.seeds.length > 1 ? 1 : 0;
  const count = total - skip;
  // 画面もビューアも同じ WebP を使う (画面で読み込み済みなので、ビューアは通信なしで開く)
  const urls = last ? Array.from({ length: count }, (_, i) => api.imageViewUrl(last.id, i + skip)) : [];
  const open = (i: number) => count > 0 && setViewing(i);

  // 生成が終わっても、新しい画像が読み込み終わるまでは最後のライブプレビューを出したままにする (一瞬空になってちらつかないように)
  const [held, setHeld] = useState<{ id: string; src: string } | null>(null);
  const [loaded, setLoaded] = useState<Set<string>>(() => new Set());
  const runningId = job?.status === "running" ? job.id : null;
  const preview = progress?.preview ?? null;
  useEffect(() => {
    if (runningId && preview) setHeld({ id: runningId, src: preview });
  }, [runningId, preview]);
  const onLoaded = (url: string) => setLoaded((s) => (s.has(url) ? s : new Set(s).add(url)));
  const holding = !runningId && held !== null && held.id === last?.id && !urls.every((u) => loaded.has(u));

  const viewer = viewing !== null && count > 0 && (
    <ImageViewer images={urls} index={Math.min(viewing, count - 1)} onIndex={setViewing} onClose={() => setViewing(null)} />
  );

  // 枠は生成サイズの縦横比で先に高さを取っておく (画像の読み込み前や、生成中 → 完了で高さが変わってガタつかないように)
  const tiles = (n: number, params: { width: number; height: number }, tile: (i: number) => ReactNode) => (
    <div className={n > 1 ? "grid grid-cols-2 gap-2" : ""}>
      {Array.from({ length: n }, (_, i) => (
        <figure key={i} className="relative overflow-hidden rounded-2xl border border-line bg-surface" style={{ aspectRatio: `${params.width} / ${params.height}` }}>
          {tile(i)}
        </figure>
      ))}
    </div>
  );

  // 生成中も前回の生成時間を出したままにし、生成が終わった時点で新しい値に切り替える
  const duration = last?.finishedAt && (
    <p className="text-right font-mono text-[11px] text-muted">生成時間 {formatDuration(last.finishedAt - last.startedAt)}</p>
  );

  if (job?.status === "running") {
    // 完成したときと同じ並び・大きさの枠を置き、その上にライブプレビュー (バッチのときは全部まとめた 1 枚) を重ねる
    return (
      <div className="mt-4 space-y-3">
        <div className="relative">
          {tiles(Math.max(1, job.params.batch), job.params, (i) =>
            !progress?.preview && i < count ? (
              <button className="block size-full" onClick={() => open(i)}>
                <img src={urls[i]} alt={`前回の生成結果 ${i + 1}`} className="size-full object-contain opacity-35" onLoad={() => onLoaded(urls[i])} />
              </button>
            ) : null,
          )}
          {progress?.preview && (
            <button className="absolute inset-0 overflow-hidden rounded-2xl bg-surface" onClick={() => open(0)}>
              <img src={progress.preview} alt="生成中のプレビュー" className="size-full object-contain" />
            </button>
          )}
        </div>
        {duration}
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
          <div className="relative">
            {tiles(count, last.params, (i) => (
              <button className="block size-full" onClick={() => open(i)}>
                <img src={urls[i]} alt={`生成結果 ${i + 1}`} className="size-full object-contain" onLoad={() => onLoaded(urls[i])} onError={() => onLoaded(urls[i])} />
              </button>
            ))}
            {holding && (
              <div className="absolute inset-0 overflow-hidden rounded-2xl bg-surface">
                <img src={held.src} alt="" className="size-full object-contain" />
              </div>
            )}
          </div>
          {duration}
        </>
      )}
      {viewer}
    </div>
  );
}
