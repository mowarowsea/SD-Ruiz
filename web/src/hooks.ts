import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ForgeStatus, type JobState, type ModelKind, type Prefs, type RecommendView } from "./api";

/** localStorage に保存される state。読み書きに失敗しても (プライベートモード等) 普通の state として動く */
export function usePersistentState<T extends object>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : { ...initial, ...JSON.parse(raw) };
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* 保存できなくても動作は続ける */
    }
  }, [key, value]);
  return [value, setValue] as const;
}

/** Forge の状態を定期的に確認する */
export function useForgeStatus(intervalMs = 10_000) {
  const [status, setStatus] = useState<ForgeStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [launcher, setLauncher] = useState(false);
  const [serverDown, setServerDown] = useState(false);
  const check = useCallback(
    () =>
      api.health().then(
        (h) => (setStatus(h.forge), setStarting(h.starting), setLauncher(h.launcher), setServerDown(false)),
        () => setServerDown(true),
      ),
    [],
  );
  useEffect(() => {
    void check();
    // 起動待ちの間は早めに確認する
    const t = setInterval(check, starting ? 3_000 : intervalMs);
    return () => clearInterval(t);
  }, [check, intervalMs, starting]);
  return { status, starting, launcher, serverDown, refresh: check };
}

/**
 * 直近の生成ジョブを追いかける。生成中だけ短い間隔でポーリングする。
 * 画面を開き直したときも BFF 側のジョブを拾うので、生成中にスマホを閉じても結果は失われない。
 */
export function useJob() {
  const [state, setState] = useState<JobState & { loaded: boolean }>({ job: null, progress: null, last: null, loaded: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      const s = await api.job();
      setState({ ...s, loaded: true });
      if (s.job?.status === "running") timer.current = setTimeout(poll, 700);
    } catch {
      timer.current = setTimeout(poll, 3000);
    }
  }, []);

  useEffect(() => {
    poll();
    // スマホでタブに戻ってきたときにすぐ最新化する
    const onVisible = () => document.visibilityState === "visible" && poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [poll]);

  return { ...state, refresh: poll };
}

/** 端末をまたいで共有する設定 (お気に入り・最近使ったモデル・ベースモデルとモデルごとの設定)。生成画面と Extras で共有する */
export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const reload = useCallback(() => api.prefs().then(setPrefs, () => {}), []);
  useEffect(() => void reload(), [reload]);
  const setFavorite = useCallback((kind: "checkpoint" | "lora", id: string, on: boolean) => {
    // 先に見た目だけ切り替えておく
    setPrefs((p) => {
      if (!p) return p;
      const key = kind === "checkpoint" ? "favoriteCheckpoints" : "favoriteLoras";
      return { ...p, [key]: on ? [...p[key], id] : p[key].filter((x) => x !== id) };
    });
    api.setFavorite(kind, id, on).then(setPrefs, () => void reload());
  }, [reload]);
  return { prefs, reload, setFavorite, setPrefs };
}

/** キーボードが出る入力欄 (CodeMirror のプロンプト欄は contenteditable) */
const EDITABLE = 'textarea, [contenteditable="true"], .cm-editor, input:not([type="checkbox"], [type="radio"], [type="range"], [type="button"], [type="submit"], [type="file"], [type="color"])';

/**
 * スマホで文字を打っている (キーボードが出ている) 間か。下部ナビと生成ボタンを隠すのに使う。
 *
 * イベントの順番や覚えておいた状態から推し量ると、画面ロック・アプリ切り替え・回転などで
 * イベントが 1 つ抜けただけで食い違ったまま戻らなくなる (隠れっぱなし・出っぱなし)。
 * そこで毎回「今フォーカスが入力欄にあるか」と「今の画面の高さがキーボードの出ている高さか」から決め直し、
 * イベントのほかに定期的にも決め直す (届かなかったイベントがあっても、すぐ正しい状態に戻る)。
 *
 * 例外として、時間を区切って次の 2 つだけ見た目を先回りする。
 * - 入力欄に触れた直後: キーボードが上がりきる前に隠す (キーボードと一緒にせり上がらないよう)
 * - 入力欄からフォーカスが外れた直後: キーボードが閉じきるまで隠したままにする (閉じかけのキーボードの上でちらつかないよう)
 */
export function useTyping() {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!matchMedia("(pointer: coarse)").matches) return;
    const height = () => window.visualViewport?.height ?? window.innerHeight;
    let width = window.innerWidth;
    let base = height(); // キーボードが出ていないときの高さ (見た中でいちばん高いもの。画面の向きが変わったら測り直す)
    let openUntil = 0; // 入力欄に触れてから、キーボードが上がりきるのを待つ期限
    let closeUntil = 0; // 入力欄から離れてから、キーボードが閉じきるのを待つ期限
    const editable = (t: EventTarget | null) => t instanceof Element && !!t.closest(EDITABLE);
    // キーボードが出ている高さか。測っておいた高さとの比較に加えて、画面そのものの高さとも比べる
    // (キーボードが出たまま回転したり読み込んだりすると、測っておいた高さが低いままになるため)
    const keyboardOpen = () => {
      const h = height();
      const landscape = screen.orientation?.type.startsWith("landscape") ?? window.innerWidth > base;
      const screenHeight = landscape ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
      return h < base - 120 || h < screenHeight * 0.6;
    };
    const update = () => {
      if (window.innerWidth !== width) {
        width = window.innerWidth;
        base = 0;
      }
      const h = height();
      if (h > base) base = h;
      const now = Date.now();
      const open = keyboardOpen();
      if (editable(document.activeElement)) setTyping(open || now < openUntil);
      else setTyping(open && now < closeUntil);
    };

    // 触れただけ (pointerdown) で隠すと、入力欄の上からスクロールするたびにちらつくので、フォーカスとタップ (click) で見る。
    // click は、戻るボタンでキーボードだけ閉じた後にもう一度タップしたとき用 (フォーカスは残っているので focusin が来ない)。
    // click はスクロールでは起きない
    const onStart = (e: Event) => {
      if (!editable(e.target)) return;
      openUntil = Date.now() + 1500;
      setTyping(true);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (!editable(e.target) || editable(e.relatedTarget)) return;
      closeUntil = Date.now() + 1000;
      // focusout の最中は activeElement がまだ切り替わっていないことがあるので、一呼吸おいてから見る
      window.setTimeout(update);
    };
    const onVisible = () => document.visibilityState === "visible" && update();

    const vv = window.visualViewport;
    document.addEventListener("focusin", onStart);
    document.addEventListener("click", onStart, true);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("visibilitychange", onVisible);
    (vv ?? window).addEventListener("resize", update);
    // 届かなかったイベントの穴埋め。高さとフォーカスを見るだけで、変わらなければ再描画もしない
    const timer = window.setInterval(update, 300);
    return () => {
      clearInterval(timer);
      document.removeEventListener("focusin", onStart);
      document.removeEventListener("click", onStart, true);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("visibilitychange", onVisible);
      (vv ?? window).removeEventListener("resize", update);
    };
  }, []);
  return typing;
}

/** モデルの推奨設定と作例。取得待ちのあいだは少しずつ問い合わせ直す */
export function useRecommend(checkpoint: string, kind: ModelKind = "checkpoint") {
  const [view, setView] = useState<RecommendView | null>(null);
  const [version, bump] = useState(0);
  useEffect(() => {
    setView(null);
    if (!checkpoint) return;
    let alive = true;
    let timer = 0;
    const load = async (tries: number) => {
      const v = await api.recommend(checkpoint, kind).catch(() => null);
      if (!alive) return;
      setView(v);
      // ほかのモデルの順番待ちもあるので、長めに待つ
      if (v?.status === "pending" && tries < 60) timer = window.setTimeout(() => load(tries + 1), 5000);
    };
    void load(0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [checkpoint, kind, version]);
  const refresh = useCallback(async () => {
    setView(await api.refreshRecommend(checkpoint, kind));
    bump((n) => n + 1);
  }, [checkpoint, kind]);
  return { view, refresh };
}
