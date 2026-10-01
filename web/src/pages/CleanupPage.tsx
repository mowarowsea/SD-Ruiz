import { useCallback, useEffect, useState } from "react";
import { api, type CleanupPreview, formatBytes } from "../api";

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/**
 * 整理: タグ (Like など) の付いていない grid と画像をまとめてゴミ箱フォルダへ移す。
 * タグ付きの grid の元画像や、タグ付きの画像を含む grid は残る。ゴミ箱を空にするまでは元に戻せる
 */
export function CleanupPage({ onBack }: { onBack: () => void }) {
  const [keepToday, setKeepToday] = useState(true);
  const [preview, setPreview] = useState<CleanupPreview | null>(null);
  const [trash, setTrash] = useState<{ dir: string; files: number; bytes: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const keepSince = () => (keepToday ? startOfToday() : Date.now());

  const refresh = useCallback(async () => {
    setPreview(null);
    try {
      const [p, t] = await Promise.all([api.cleanupPreview(keepToday ? startOfToday() : Date.now()), api.trash()]);
      setPreview(p);
      setTrash(t);
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    }
  }, [keepToday]);
  useEffect(() => void refresh(), [refresh]);

  const run = async () => {
    if (!preview || !confirm(`タグの付いていない grid ${preview.grids.toLocaleString()} 枚と画像 ${preview.images.toLocaleString()} 枚をゴミ箱フォルダへ移します。よろしいですか？`)) return;
    setBusy("移動中…");
    setMessage(null);
    try {
      const r = await api.cleanupRun(keepSince());
      setMessage({ text: `${r.moved.toLocaleString()} 件 (${formatBytes(r.bytes)}) をゴミ箱フォルダへ移しました` });
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const migrate = async () => {
    if (!preview || !confirm(`Like 付きの grid ${preview.likedGrids} 枚と画像 ${preview.likedImages} 枚 (grid の元画像を含む) を保管庫へ移します。よろしいですか？`)) return;
    setBusy("移動中…");
    setMessage(null);
    try {
      const r = await api.migrateLiked();
      setMessage({ text: `${r.moved.toLocaleString()} 件を保管庫へ移しました` });
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const empty = async () => {
    if (!trash || !confirm(`ゴミ箱フォルダの ${trash.files.toLocaleString()} 件 (${formatBytes(trash.bytes)}) を完全に削除します。元に戻せません。よろしいですか？`)) return;
    setBusy("削除中…");
    setMessage(null);
    try {
      await api.emptyTrash();
      setMessage({ text: "ゴミ箱を空にしました" });
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  return (
    <div className="pb-24">
      <button onClick={onBack} className="mb-2 text-xs text-muted">
        ‹ メニュー
      </button>
      <h1 className="mb-1 font-serif text-2xl">整理</h1>
      <p className="mb-4 text-xs leading-relaxed text-muted">
        タグが付いていない grid と画像を、まとめてゴミ箱フォルダへ移します。Like したものは保管庫 (Saved) にあるので対象外です。ほかのタグ付きの grid の元画像と、タグ付きの画像を含む grid も残ります。
      </p>

      {preview && preview.likedGrids + preview.likedImages > 0 && (
        <section className="mb-4 rounded-2xl border border-accent/50 bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold">保管庫へ移していない Like</h2>
          <p className="mb-3 text-xs leading-relaxed text-muted">
            出力フォルダに Like 付きの grid {preview.likedGrids} 枚・画像 {preview.likedImages} 枚が残っています (IIB で Like したもの)。元画像ごと保管庫へ移せます。
          </p>
          <button onClick={migrate} disabled={!!busy} className="w-full rounded-xl border border-accent py-2.5 text-sm text-accent disabled:opacity-40">
            保管庫へ移す
          </button>
        </section>
      )}

      <section className="mb-4 rounded-2xl border border-line bg-surface p-4">
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={keepToday} onChange={(e) => setKeepToday(e.target.checked)} className="size-4 accent-[#c99bab]" />
          今日の分は残す
        </label>
        {preview ? (
          <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">移す grid</dt>
            <dd>{preview.grids.toLocaleString()} 枚</dd>
            <dt className="text-muted">移す画像</dt>
            <dd>{preview.images.toLocaleString()} 枚</dd>
            <dt className="text-muted">合計</dt>
            <dd>{formatBytes(preview.bytes)}</dd>
            <dt className="text-muted">残る</dt>
            <dd>
              grid {preview.keptGrids.toLocaleString()} / 画像 {preview.keptImages.toLocaleString()}
            </dd>
          </dl>
        ) : (
          <p className="mb-4 text-sm text-muted">数えています…</p>
        )}
        <button onClick={run} disabled={!preview || !!busy || preview.grids + preview.images === 0} className="w-full rounded-xl bg-accent py-2.5 text-sm text-accent-ink disabled:opacity-40">
          {busy ?? "ゴミ箱フォルダへ移す"}
        </button>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4">
        <h2 className="mb-1 text-sm font-semibold">ゴミ箱フォルダ</h2>
        {trash && (
          <>
            <p className="mb-1 font-mono text-[10px] break-all text-muted">{trash.dir}</p>
            <p className="mb-3 text-sm">
              {trash.files.toLocaleString()} 件 · {formatBytes(trash.bytes)}
            </p>
          </>
        )}
        <button onClick={empty} disabled={!trash?.files || !!busy} className="w-full rounded-xl border border-danger/60 py-2.5 text-sm text-danger disabled:opacity-40">
          ゴミ箱を空にする (完全に削除)
        </button>
      </section>

      {message && <p className={`mt-3 text-xs break-words ${message.error ? "text-danger" : "text-accent"}`}>{message.text}</p>}
    </div>
  );
}
