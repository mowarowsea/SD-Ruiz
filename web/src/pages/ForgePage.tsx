import { faArrowsRotate, faPowerOff } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useCallback, useEffect, useState } from "react";
import { api, type Diagnosis, type Finding, type ForgeSession, type ForgeStatus } from "../api";
import { Heading } from "../components/Heading";

const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)}GB`;
const time = (ms: number) => new Date(ms).toLocaleString("sv-SE").slice(5, 16);

const endLabel: Record<ForgeSession["end"], { text: string; cls: string }> = {
  running: { text: "動作中", cls: "text-ok" },
  exited: { text: "落ちた", cls: "text-danger" },
  restarted: { text: "再起動で停止", cls: "text-muted" },
  stopped: { text: "停止", cls: "text-muted" },
};

/**
 * Forge の起動・診断: LocalLauncher 経由で Forge Neo を起動 / 再起動し、
 * 落ちたときはログと Windows のイベントからナレッジ (server/forge-knowledge.ts) に照らして原因の見当を出す
 */
export function ForgePage({ status, starting, launcher, onChanged }: { status: ForgeStatus | null; starting: boolean; launcher: boolean; onChanged: () => void }) {
  const [diag, setDiag] = useState<Diagnosis | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDiag(await api.forgeDiagnose());
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void load(), [load]);

  // 起動し終わったら診断も新しくする
  const online = !!status?.online;
  useEffect(() => {
    if (online && diag && !diag.status.online) void load();
  }, [online, diag, load]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setMessage({ text: label });
      onChanged();
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const start = () => act("起動を頼みました。使えるようになるまで 1〜2 分かかります", api.forgeStart);
  const restart = () => {
    if (!confirm("Forge を再起動しますか？ (Forge の画面で作業中のものは消えます)")) return;
    void act("再起動を頼みました。使えるようになるまで 1〜2 分かかります", api.forgeRestart);
  };

  const state = starting ? { text: "起動中…", dot: "bg-accent animate-pulse" } : online ? { text: status!.online && status!.busy ? "動作中 (生成中)" : "動作中", dot: "bg-ok" } : { text: status ? "停止中" : "確認中…", dot: status ? "bg-danger" : "bg-muted" };
  const m = diag?.memory;

  return (
    <div className="pb-24">
      <Heading
        as="h1"
        info={"LocalLauncher に頼んで Forge Neo を起動・再起動します (PID の管理とログは LocalLauncher のまま)。\n落ちたときは、LocalLauncher のログを起動ごとに分けて、どう終わったかと、同じ時間帯の Windows のイベント (クラッシュ・メモリ不足) から原因の見当を出します。"}
        aside={
          <button onClick={load} disabled={loading} aria-label="診断し直す" className="text-sm text-muted disabled:opacity-40">
            <FontAwesomeIcon icon={faArrowsRotate} spin={loading} />
          </button>
        }
      >
        Forge 起動・診断
      </Heading>

      <section className="mb-4 rounded-2xl border border-line bg-surface p-4">
        <div className="mb-3 flex items-center gap-2 text-sm">
          <span className={`size-2.5 rounded-full ${state.dot}`} />
          {state.text}
        </div>
        {!launcher ? (
          <p className="text-xs text-muted">config.json の launcherUrl が無いので、ここからは起動できません</p>
        ) : online ? (
          <button onClick={restart} disabled={busy} className="w-full rounded-xl border border-line py-2.5 text-sm disabled:opacity-40">
            <FontAwesomeIcon icon={faArrowsRotate} className="mr-2" />
            再起動
          </button>
        ) : (
          <button onClick={start} disabled={busy || starting || !status} className="w-full rounded-xl bg-accent py-2.5 text-sm text-accent-ink disabled:opacity-40">
            <FontAwesomeIcon icon={faPowerOff} className="mr-2" />
            {starting ? "起動中…" : "起動"}
          </button>
        )}
        {message && <p className={`mt-3 text-xs break-words ${message.error ? "text-danger" : "text-accent"}`}>{message.text}</p>}
      </section>

      {m && (
        <section className="mb-4 rounded-2xl border border-line bg-surface p-4">
          <Heading info={`RAM ${gb(m.ramTotal)} とページファイルを合わせた上限まで使い切ると、Forge は落ちます。\n多く使っているもの:\n${m.top.map((p) => `・${p.name} (${p.pid}) ${gb(p.bytes)}`).join("\n")}`}>
            メモリ
          </Heading>
          <Meter label="仮想メモリ" used={m.commitLimit - m.commitFree} total={m.commitLimit} />
          <Meter label="RAM" used={m.ramTotal - m.ramFree} total={m.ramTotal} />
          {m.forgeBytes !== null && <p className="mt-2 text-xs text-muted">うち Forge {gb(m.forgeBytes)}</p>}
          {diag.warnings.map((f) => (
            <FindingCard key={f.id} f={f} />
          ))}
        </section>
      )}

      {diag?.logError && <p className="mb-4 text-sm text-danger">{diag.logError}</p>}
      {diag && diag.sessions.length > 0 && (
        <section className="rounded-2xl border border-line bg-surface p-4">
          <Heading info="LocalLauncher のログ (末尾の 512KB) に残っている起動の新しい順。落ちたものは、ナレッジに当てはまる原因を出します。">起動の履歴</Heading>
          {diag.sessions.map((s, i) => (
            <SessionRow key={s.startedAt} s={s} initiallyOpen={i === diag.sessions.findIndex((x) => x.end === "exited")} />
          ))}
        </section>
      )}
      {!diag && loading && <p className="text-sm text-muted">診断しています…</p>}
    </div>
  );
}

function Meter({ label, used, total }: { label: string; used: number; total: number }) {
  const ratio = used / total;
  return (
    <div className="mb-2">
      <div className="mb-1 flex justify-between text-xs">
        <span>{label}</span>
        <span className="font-mono text-muted">
          {gb(used)} / {gb(total)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface2">
        <div className={`h-full rounded-full ${ratio > 0.88 ? "bg-danger" : ratio > 0.75 ? "bg-accent" : "bg-ok"}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
    </div>
  );
}

function SessionRow({ s, initiallyOpen }: { s: ForgeSession; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [showLog, setShowLog] = useState(false);
  const main = s.findings.filter((f) => f.level !== "info");
  const info = s.findings.filter((f) => f.level === "info");
  const end = endLabel[s.end];
  return (
    <div className="border-t border-line py-2.5 first-of-type:border-t-0">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-left text-sm">
        <span className="font-mono text-xs text-muted">{time(s.startedAt)}</span>
        <span className={end.cls}>{end.text}</span>
        <span className="min-w-0 flex-1 truncate text-right text-xs text-muted">{main[0]?.title ?? (s.end === "exited" ? "原因不明" : "")}</span>
      </button>
      {open && (
        <div className="mt-2">
          <p className="mb-2 text-xs text-muted">
            {s.label}
            {s.endedAt ? ` · 次の起動 ${time(s.endedAt)}` : ""}
          </p>
          {s.end === "exited" && !main.length && <p className="mb-2 text-xs">ナレッジに当てはまるものがありません。ログを見て原因を調べ、ナレッジに足しましょう</p>}
          {main.map((f) => (
            <FindingCard key={f.id} f={f} />
          ))}
          {info.length > 0 && (
            <details className="mb-2 text-xs">
              <summary className="text-muted">気にしなくてよいもの {info.length} 件</summary>
              {info.map((f) => (
                <FindingCard key={f.id} f={f} />
              ))}
            </details>
          )}
          <button onClick={() => setShowLog((v) => !v)} className="text-xs text-accent">
            {showLog ? "ログを閉じる" : "ログの最後を見る"}
          </button>
          {showLog && <pre ref={(el) => void (el && (el.scrollTop = el.scrollHeight))} className="mt-2 max-h-80 overflow-auto rounded-lg bg-bg p-2 font-mono text-[10px] leading-snug whitespace-pre-wrap break-all text-ink/80">{s.tail.join("\n")}</pre>}
        </div>
      )}
    </div>
  );
}

function FindingCard({ f }: { f: Finding }) {
  const color = f.level === "crash" ? "border-danger/50" : f.level === "warn" ? "border-accent/50" : "border-line";
  return (
    <div className={`mt-2 mb-2 rounded-xl border ${color} bg-bg/40 p-3 text-xs leading-relaxed`}>
      <div className={`mb-1 text-sm font-semibold ${f.level === "crash" ? "text-danger" : f.level === "warn" ? "text-accent" : ""}`}>{f.title}</div>
      <p className="mb-1">{f.cause}</p>
      <p className="mb-1 text-accent">→ {f.remedy}</p>
      {f.evidence.length > 0 && (
        <ul className="mt-1 font-mono text-[10px] break-all text-muted">
          {f.evidence.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
