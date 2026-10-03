import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ForgeStatus, type JobState, type Prefs } from "./api";

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

/** 端末をまたいで共有する設定 (お気に入り・最近使ったモデル・モデルごとのパラメータ) */
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
  return { prefs, reload, setFavorite };
}

/** キーボードが出る入力欄 (CodeMirror のプロンプト欄は contenteditable) */
const EDITABLE = 'textarea, [contenteditable="true"], .cm-editor, input:not([type="checkbox"], [type="radio"], [type="range"], [type="button"], [type="submit"], [type="file"], [type="color"])';

/**
 * スマホで文字を打っている (キーボードが出ている) 間か。下部ナビを隠すのに使う。
 * 入力欄にフォーカスが入った時点で true にし (キーボードと一緒にナビがせり上がらないよう先に隠す)、
 * キーボードが閉じた (画面の高さが戻った) かフォーカスが外れたら false に戻す。
 * フォーカスだけで判定すると、キーボードを閉じても編集欄にフォーカスが残る・戻ることがあり、ナビが出てこなくなるため
 */
export function useTyping() {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!matchMedia("(pointer: coarse)").matches) return;
    const height = () => window.visualViewport?.height ?? window.innerHeight;
    let width = window.innerWidth;
    let base = height(); // キーボードが出ていないときの高さ (画面の向きが変わったら測り直す)
    let open = false; // キーボードが出ているか
    let timer = 0;
    const isOpen = (h: number) => h < base - 120;
    const editable = (t: EventTarget | null) => t instanceof Element && !!t.closest(EDITABLE);

    // 触れただけ (pointerdown) で隠すと、入力欄の上からスクロールするたびにちらつくので、フォーカスとタップ (click) で見る。
    // click は、戻るボタンでキーボードだけ閉じた後にもう一度タップしたとき用 (フォーカスは残っているので focusin が来ない)。
    // click はスクロールでは起きない
    const onStart = (e: Event) => {
      if (!editable(e.target)) return;
      setTyping(true);
      // キーボードが出ないまま (外付けキーボードや、スクリプトでフォーカスが戻っただけなど) なら戻す
      clearTimeout(timer);
      timer = window.setTimeout(() => !open && setTyping(false), 1000);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (!editable(e.relatedTarget)) setTyping(false);
    };
    const onResize = () => {
      if (window.innerWidth !== width) {
        width = window.innerWidth;
        base = 0;
      }
      const h = height();
      if (h > base) base = h;
      const wasOpen = open;
      open = isOpen(h);
      if (wasOpen && !open) setTyping(false);
    };

    const vv = window.visualViewport;
    document.addEventListener("focusin", onStart);
    document.addEventListener("click", onStart, true);
    document.addEventListener("focusout", onFocusOut);
    (vv ?? window).addEventListener("resize", onResize);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("focusin", onStart);
      document.removeEventListener("click", onStart, true);
      document.removeEventListener("focusout", onFocusOut);
      (vv ?? window).removeEventListener("resize", onResize);
    };
  }, []);
  return typing;
}
