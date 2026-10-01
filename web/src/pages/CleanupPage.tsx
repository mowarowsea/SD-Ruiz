import { useCallback, useEffect, useState } from "react";
import { api, type CleanupPreview, formatBytes } from "../api";
import { Heading } from "../components/Heading";

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/**
 * ギャラリー整理: タグの付いていない grid と画像をまとめてゴミ箱フォルダへ移す。
 * タグを付けたものは保管庫にあるので対象外。ゴミ箱を空にするまでは元に戻せる
 */
export function CleanupPage() {
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

  const act = async (label: string, fn: () => Promise<string>) => {
    setBusy(label);
    setMessage(null);
    try {
      setMessage({ text: await fn() });
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const run = () => {
    if (!preview || !confirm(`タグの付いていない grid ${preview.grids.toLocaleString()} 枚と画像 ${preview.images.toLocaleString()} 枚をゴミ箱フォルダへ移します。よろしいですか？`)) return;
    void act("移動中…", async () => {
      const r = await api.cleanupRun(keepSince());
      return `${r.moved.toLocaleString()} 件 (${formatBytes(r.bytes)}) をゴミ箱フォルダへ移しました`;
    });
  };

  const migrate = () => {
    if (!preview || !confirm(`タグ付きの grid ${preview.taggedGrids} 枚と画像 ${preview.taggedImages} 枚を、元画像ごと保管庫へ移します。よろしいですか？`)) return;
    void act("移動中…", async () => `${(await api.migrateTagged()).moved.toLocaleString()} 件を保管庫へ移しました`);
  };

  const empty = () => {
    if (!trash || !confirm(`ゴミ箱フォルダの ${trash.files.toLocaleString()} 件 (${formatBytes(trash.bytes)}) を完全に削除します。元に戻せません。よろしいですか？`)) return;
    void act("削除中…", async () => {
      await api.emptyTrash();
      return "ゴミ箱を空にしました";
    });
  };

  return (
    <div className="pb-24">
      <Heading as="h1" info="タグの付いていない grid と画像を、まとめてゴミ箱フォルダへ移します。タグを付けたもの (Like / useful / temp など) は保管庫 (Saved) にあるので対象外です。ゴミ箱を空にするまでは元に戻せます。">
        ギャラリー整理
      </Heading>

      {preview && preview.taggedGrids + preview.taggedImages > 0 && (
        <section className="mb-4 rounded-2xl border border-accent/50 bg-surface p-4">
          <Heading info="保管庫を使う前に IIB でタグを付けたものが、出力フォルダに残っています。grid は元画像ごと、タグも付けたまま保管庫へ移せます。">
            出力フォルダに残っているタグ付き
          </Heading>
          <p className="mb-3 text-sm">
            grid {preview.taggedGrids} 枚 · 画像 {preview.taggedImages} 枚
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
            <dt>移す grid</dt>
            <dd>{preview.grids.toLocaleString()} 枚</dd>
            <dt>移す画像</dt>
            <dd>{preview.images.toLocaleString()} 枚</dd>
            <dt>合計</dt>
            <dd>{formatBytes(preview.bytes)}</dd>
          </dl>
        ) : (
          <p className="mb-4 text-sm">数えています…</p>
        )}
        <button onClick={run} disabled={!preview || !!busy || preview.grids + preview.images === 0} className="w-full rounded-xl bg-accent py-2.5 text-sm text-accent-ink disabled:opacity-40">
          {busy ?? "ゴミ箱フォルダへ移す"}
        </button>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4">
        <Heading info={`場所: ${trash?.dir ?? "…"}\n「ゴミ箱を空にする」で完全に削除します。`}>ゴミ箱フォルダ</Heading>
        {trash && (
          <p className="mb-3 text-sm">
            {trash.files.toLocaleString()} 件 · {formatBytes(trash.bytes)}
          </p>
        )}
        <button onClick={empty} disabled={!trash?.files || !!busy} className="w-full rounded-xl border border-danger/60 py-2.5 text-sm text-danger disabled:opacity-40">
          ゴミ箱を空にする (完全に削除)
        </button>
      </section>

      {message && <p className={`mt-3 text-sm break-words ${message.error ? "text-danger" : "text-accent"}`}>{message.text}</p>}
    </div>
  );
}
