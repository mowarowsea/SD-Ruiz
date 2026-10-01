import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { type ReactNode, useEffect, useRef } from "react";

/**
 * 全画面の画像ビューア (Forge に入れていた改造と同じ操作)
 * - 画面の左右 25% をタップ: 前 / 次の画像
 * - 真ん中をタップ / 右上の ×: 閉じる
 * - キーボード: ← → で送り、Esc で閉じる。スマホの「戻る」でも閉じる
 *
 * loop: 端まで行ったら反対側に戻る (生成結果用)。ギャラリーのように続きを読み込む一覧では false にする
 * placeholders: 元画像を読み込むまで下に敷いておく画像 (サムネイル)
 * overlay: 画像の上に重ねる操作バーなど (タップ領域より手前に出る)
 * showCounter: 上部に「1 / 3」を出す (続きを読み込む一覧では件数に意味がないので消す)
 */
export function ImageViewer({
  images,
  index,
  onIndex,
  onClose,
  loop = true,
  placeholders,
  overlay,
  showCounter = true,
}: {
  images: string[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  loop?: boolean;
  placeholders?: string[];
  overlay?: ReactNode;
  showCounter?: boolean;
}) {
  const count = images.length;
  const step = (d: number) => {
    const next = index + d;
    if (loop) onIndex((next + count) % count);
    else if (next >= 0 && next < count) onIndex(next);
  };
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // 開いている間は履歴を 1 つ積んでおき、「戻る」で閉じられるようにする
  useEffect(() => {
    history.pushState({ ruizViewer: true }, "");
    const onPop = () => closeRef.current();
    addEventListener("popstate", onPop);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      removeEventListener("popstate", onPop);
      document.body.style.overflow = overflow;
    };
  }, []);
  const close = () => history.back();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft" && count > 1) step(-1);
      else if (e.key === "ArrowRight" && count > 1) step(1);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  const imgClass = "pointer-events-none absolute inset-0 size-full object-contain";
  return (
    <div className="fixed inset-0 z-50 bg-black select-none" role="dialog" aria-modal="true">
      {placeholders?.[index] && <img src={placeholders[index]} alt="" className={imgClass} draggable={false} />}
      <img key={images[index]} src={images[index]} alt={`画像 ${index + 1}`} className={imgClass} draggable={false} />
      {showCounter && count > 1 && (
        <div className="pointer-events-none absolute inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] text-center font-mono text-xs text-white/60">
          {index + 1} / {count}
        </div>
      )}
      {/* 透明のタップ領域: 左 25% / 真ん中 / 右 25% */}
      <button className="absolute inset-y-0 left-0 w-1/4 cursor-w-resize" aria-label="前の画像" onClick={() => (count > 1 ? step(-1) : close())} />
      <button className="absolute inset-y-0 left-1/4 w-1/2 cursor-zoom-out" aria-label="閉じる" onClick={close} />
      <button className="absolute inset-y-0 right-0 w-1/4 cursor-e-resize" aria-label="次の画像" onClick={() => (count > 1 ? step(1) : close())} />
      {overlay}
      <button
        onClick={close}
        aria-label="閉じる"
        className="absolute top-[max(0.5rem,env(safe-area-inset-top))] right-3 flex size-6 items-center justify-center rounded-full bg-black/50 text-white/80"
      >
        <FontAwesomeIcon icon={faXmark} className="text-sm" />
      </button>
    </div>
  );
}
