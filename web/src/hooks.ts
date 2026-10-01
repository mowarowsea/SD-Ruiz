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
  const [serverDown, setServerDown] = useState(false);
  useEffect(() => {
    let alive = true;
    const check = () =>
      api
        .health()
        .then((h) => alive && (setStatus(h.forge), setServerDown(false)))
        .catch(() => alive && setServerDown(true));
    check();
    const t = setInterval(check, intervalMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [intervalMs]);
  return { status, serverDown };
}

/**
 * 直近の生成ジョブを追いかける。生成中だけ短い間隔でポーリングする。
 * 画面を開き直したときも BFF 側のジョブを拾うので、生成中にスマホを閉じても結果は失われない。
 */
export function useJob() {
  const [state, setState] = useState<JobState>({ job: null, progress: null });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      const s = await api.job();
      setState(s);
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
