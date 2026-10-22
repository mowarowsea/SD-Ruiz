import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { type PointerEvent, type ReactNode, type TouchEvent, useEffect, useLayoutEffect, useRef } from "react";

/**
 * 全画面の画像ビューア (Forge に入れていた改造と同じ操作)
 * - 左右にフリック: 前 / 次の画像
 * - 画面の左右 25% をタップ: 前 / 次の画像
 * - 真ん中をタップ / 右上の ×: 閉じる
 * - キーボード: ← → で送り、Esc で閉じる。スマホの「戻る」でも閉じる
 *
 * 画像は横一列に並べ、1 画面 = 1 マスでブラウザのスクロールに止めさせる (pinax のリーダーと同じ作り)。
 * **払う動きはブラウザに任せる** — 指を自前で追うと、ブラウザがスクロールとして引き取った時点で
 * pointercancel が来て何も起きない。勢いよく払っても 1 枚で止まる (scroll-snap-stop: always)
 *
 * loop: 端まで行ったら反対側に戻る (生成結果用)。端から更に払っても戻る。ギャラリーのように続きを読み込む一覧では false にする
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
  const stage = useRef<HTMLDivElement>(null);
  const cellAt = () => {
    const s = stage.current;
    return s ? Math.round(s.scrollLeft / Math.max(1, s.clientWidth)) : index;
  };

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

  // タップ・キーで index が変わったら、そのマスへ一気に飛ぶ (今までどおり)。
  // 払って変わったときは既にそのマスにいるので何もしない (開いた直後は描く前に合わせる)
  useLayoutEffect(() => {
    const s = stage.current;
    if (s && cellAt() !== index) s.scrollTo({ left: index * s.clientWidth, behavior: "instant" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, count]);

  // 画面が回るとマスの幅が変わり、同じ scrollLeft が別のマスを指すので、見ていたマスへ戻す
  const indexRef = useRef(index);
  indexRef.current = index;
  useEffect(() => {
    const onResize = () => stage.current?.scrollTo({ left: indexRef.current * stage.current.clientWidth, behavior: "instant" });
    addEventListener("resize", onResize);
    return () => removeEventListener("resize", onResize);
  }, []);

  const onScroll = () => {
    const at = cellAt();
    if (at !== index && at >= 0 && at < count) onIndex(at);
  };

  /**
   * 押した時の扱い。**なぞった時は何もしない** (払って送った)。
   * 左 25% が前へ、右 25% が次へ、真ん中は閉じる。1 枚しかなければどこでも閉じる
   */
  const down = useRef<{ x: number; y: number; t: number; sx: number } | null>(null);
  const zone = (clientX: number) => {
    const fx = clientX / Math.max(1, innerWidth);
    return fx < 0.25 ? -1 : fx > 0.75 ? 1 : 0;
  };
  const onPointerUp = (e: PointerEvent) => {
    const d = down.current;
    down.current = null;
    if (!d) return;
    const moved = Math.abs(e.clientX - d.x) > 12 || Math.abs(e.clientY - d.y) > 12 || Math.abs((stage.current?.scrollLeft ?? 0) - d.sx) > 4;
    if (moved || Date.now() - d.t > 500) return;
    const z = zone(e.clientX);
    if (z === 0 || count <= 1) close();
    else step(z);
  };

  /**
   * 端のマスから更に外へ払った。スクロールはもう動かないので、指の動きだけ見て反対の端へ戻る (loop のとき)。
   * touchend はスクロールに引き取られても来る
   */
  const edge = useRef<number | null>(null);
  const onTouchStart = (e: TouchEvent) => {
    const at = cellAt();
    edge.current = loop && count > 1 && e.touches.length === 1 && (at === 0 || at === count - 1) ? e.touches[0].clientX : null;
  };
  const onTouchEnd = (e: TouchEvent) => {
    if (edge.current === null) return;
    const dx = e.changedTouches[0].clientX - edge.current;
    edge.current = null;
    const at = cellAt();
    if (dx < -60 && at === count - 1) onIndex(0);
    else if (dx > 60 && at === 0) onIndex(count - 1);
  };

  const imgClass = "pointer-events-none absolute inset-0 size-full object-contain";
  return (
    <div className="fixed inset-0 z-50 bg-black select-none" role="dialog" aria-modal="true">
      <div
        ref={stage}
        className="absolute inset-0 flex snap-x snap-mandatory touch-manipulation overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onScroll={onScroll}
        onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY, t: Date.now(), sx: stage.current?.scrollLeft ?? 0 })}
        onPointerCancel={() => (down.current = null)}
        onPointerUp={onPointerUp}
        onPointerMove={(e) => {
          // PC ではマウスの位置で、押すと何が起きるかをカーソルで示す
          if (e.pointerType !== "mouse") return;
          const z = count > 1 ? zone(e.clientX) : 0;
          e.currentTarget.style.cursor = z < 0 ? "w-resize" : z > 0 ? "e-resize" : "zoom-out";
        }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onDragStart={(e) => e.preventDefault()}
      >
        {/* マスは全部置くが、絵を入れるのは見ている画像と両隣だけ (ギャラリーは何百枚にもなる) */}
        {images.map((src, i) => (
          <div key={i} className="relative h-full w-full shrink-0 snap-start snap-always">
            {Math.abs(i - index) <= 1 && (
              <>
                {placeholders?.[i] && <img src={placeholders[i]} alt="" className={imgClass} draggable={false} />}
                <img key={src} src={src} alt={`画像 ${i + 1}`} className={imgClass} draggable={false} />
              </>
            )}
          </div>
        ))}
      </div>
      {showCounter && count > 1 && (
        <div className="pointer-events-none absolute inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] text-center font-mono text-xs text-white/60">
          {index + 1} / {count}
        </div>
      )}
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
