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
 * loop: 端まで行ったら反対側に戻る (生成結果用)。ギャラリーのように続きを読み込む一覧では false にする。
 *   両端に反対側の複製のマスを置き (終端の複製・全部・始端の複製)、払えばそのまま反対側の絵が出てくる。
 *   複製のマスに止まったら、同じ絵の本物のマスへ黙って飛び移る。枚数が少ないので絵は全部読んでおく
 * placeholders: 元画像を読み込むまで下に敷いておく画像 (サムネイル)
 * overlay: 画像の上に重ねる操作バーなど (タップ領域より手前に出る)
 * showCounter: 上部に「1 / 3」を出す (続きを読み込む一覧では件数に意味がないので消す)
 */
const hasScrollEnd = "onscrollend" in window;

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
  // マスごとに何枚目の画像を出すか。ring のときは先頭と末尾が反対側の複製
  const ring = loop && count > 1;
  const pad = ring ? 1 : 0;
  const cells = ring ? [count - 1, ...images.keys(), 0] : [...images.keys()];
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
  // 払って変わったときは既にそのマス (か複製のマス) にいるので何もしない。開いた直後は描く前に本物のマスへ合わせる
  const opened = useRef(false);
  useLayoutEffect(() => {
    const s = stage.current;
    if (!s) return;
    if (!opened.current || cells[cellAt()] !== index) s.scrollTo({ left: (index + pad) * s.clientWidth, behavior: "instant" });
    opened.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, count]);

  // 画面が回るとマスの幅が変わり、同じ scrollLeft が別のマスを指すので、見ていたマスへ戻す
  const at = useRef({ index, pad });
  at.current = { index, pad };
  useEffect(() => {
    const onResize = () => stage.current?.scrollTo({ left: (at.current.index + at.current.pad) * stage.current.clientWidth, behavior: "instant" });
    addEventListener("resize", onResize);
    return () => removeEventListener("resize", onResize);
  }, []);

  const onScroll = () => {
    const i = cells[cellAt()];
    if (i !== undefined && i !== index) onIndex(i);
    if (!hasScrollEnd) {
      clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(settle, 150);
    }
  };

  /**
   * 止まった。複製のマスなら本物のマスへ飛び移る (絵は同じなので見た目は変わらない)。
   * 指で押さえている間は飛ばない (scrollend が無いブラウザは scroll が途切れたら止まったとみなすので、押さえて止めただけのこともある)
   */
  const touching = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const settle = () => {
    const s = stage.current;
    const c = cellAt();
    if (!s || !ring || touching.current || (c !== 0 && c !== count + 1)) return;
    s.scrollTo({ left: (cells[c] + pad) * s.clientWidth, behavior: "instant" });
  };
  const settleRef = useRef(settle);
  settleRef.current = settle;
  useEffect(() => {
    const s = stage.current;
    if (!s || !hasScrollEnd) return;
    const onEnd = () => settleRef.current();
    s.addEventListener("scrollend", onEnd);
    return () => s.removeEventListener("scrollend", onEnd);
  }, []);
  useEffect(() => () => clearTimeout(settleTimer.current), []);

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

  const onTouch = (e: TouchEvent) => {
    touching.current = e.touches.length > 0;
    if (!touching.current && !hasScrollEnd) {
      clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(settle, 150);
    }
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
        onTouchStart={onTouch}
        onTouchEnd={onTouch}
        onTouchCancel={onTouch}
        onDragStart={(e) => e.preventDefault()}
      >
        {/* マスは全部置くが、絵を入れるのは見ている画像と両隣だけ (ギャラリーは何百枚にもなる。ring のときは全部) */}
        {cells.map((i, c) => (
          <div key={c} className="relative h-full w-full shrink-0 snap-start snap-always">
            {(ring || Math.abs(i - index) <= 1) && (
              <>
                {placeholders?.[i] && <img src={placeholders[i]} alt="" className={imgClass} draggable={false} />}
                <img key={images[i]} src={images[i]} alt={`画像 ${i + 1}`} className={imgClass} draggable={false} />
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
