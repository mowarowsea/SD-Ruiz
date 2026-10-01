import { useEffect, useRef } from "react";

/**
 * 全画面の画像ビューア (Forge に入れていた改造と同じ操作)
 * - 画面の左右 25% をタップ: 前 / 次の画像 (端まで行くと反対側に戻る)
 * - 真ん中をタップ: 閉じる
 * - キーボード: ← → で送り、Esc で閉じる。スマホの「戻る」でも閉じる
 */
export function ImageViewer({ images, index, onIndex, onClose }: { images: string[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const count = images.length;
  const step = (d: number) => onIndex((index + d + count) % count);
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

  return (
    <div className="fixed inset-0 z-50 bg-black select-none" role="dialog" aria-modal="true">
      <img src={images[index]} alt={`画像 ${index + 1}`} className="pointer-events-none absolute inset-0 m-auto max-h-full max-w-full object-contain" draggable={false} />
      {count > 1 && (
        <div className="pointer-events-none absolute inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] text-center font-mono text-xs text-white/60">
          {index + 1} / {count}
        </div>
      )}
      {/* 透明のタップ領域: 左 25% / 真ん中 / 右 25% */}
      <button className="absolute inset-y-0 left-0 w-1/4 cursor-w-resize" aria-label="前の画像" onClick={() => (count > 1 ? step(-1) : close())} />
      <button className="absolute inset-y-0 left-1/4 w-1/2 cursor-zoom-out" aria-label="閉じる" onClick={close} />
      <button className="absolute inset-y-0 right-0 w-1/4 cursor-e-resize" aria-label="次の画像" onClick={() => (count > 1 ? step(1) : close())} />
    </div>
  );
}
