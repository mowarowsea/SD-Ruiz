// Forge Neo の診断: LocalLauncher のログを起動ごと (セッション) に分け、どう終わったかと、
// 同じ時間帯の Windows のイベント (クラッシュ・メモリ不足) をナレッジに照らし合わせる

import { execFile } from "node:child_process";
import { type Knowledge, type WinEvent, knowledge } from "./forge-knowledge.js";

export interface Finding {
  id: string;
  title: string;
  level: Knowledge["level"];
  cause: string;
  remedy: string;
  /** 根拠 (該当したログの行やイベント) */
  evidence: string[];
}

export interface Session {
  /** LocalLauncher の起動 / 再起動 */
  label: string;
  startedAt: number;
  /** 次の起動 (または今)。この間の Windows のイベントをこのセッションのものとみなす */
  endedAt: number | null;
  /**
   * running: 動いている / exited: プロセスが終わった (落ちた) / restarted: 再起動で止めた /
   * stopped: 終了の記録なしに止まった (停止ボタン・PC の再起動など)
   */
  end: "running" | "exited" | "restarted" | "stopped";
  findings: Finding[];
  /** 最後の数十行 (ネイティブのスタックや警告の繰り返しは畳む) */
  tail: string[];
}

export interface Memory {
  ramTotal: number;
  ramFree: number;
  commitLimit: number;
  commitFree: number;
  forgePid: number | null;
  /** Forge (7862 で待ち受けているプロセス) の仮想メモリ */
  forgeBytes: number | null;
  /** 仮想メモリ (コミット) を多く使っているプロセス */
  top: { name: string; pid: number; bytes: number }[];
}

const exitMarker = /続行するには何かキーを押してください|Press any key to continue/;
const nativeFrame = /^0x[0-9A-F]{16}, /i;
// 生成のたびに出る VRAM の警告 (6 行で 1 組)
const gpuWarning = /sampling_function\.py :: WARNING|^This (number is lower|may cause extreme)|^larger headroom|^"--disable-gpu-warning"/;

/** LocalLauncher が起動のたびにログへ書く見出し (= の行・起動: 日時・コマンド・cwd・= の行) で区切る */
export function splitSessions(log: string): { label: string; startedAt: number; lines: string[] }[] {
  const lines = log.split(/\r?\n/);
  const sessions: { label: string; startedAt: number; lines: string[] }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = /^(起動|再起動): (\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d(?:\.\d{1,3})?)/.exec(lines[i + 1] ?? "");
    if (/^={20,}$/.test(lines[i]) && head && /^={20,}$/.test(lines[i + 4] ?? "")) {
      sessions.push({ label: head[1], startedAt: new Date(`${head[2]}T${head[3]}`).getTime(), lines: [] });
      i += 4;
    } else sessions.at(-1)?.lines.push(lines[i]);
  }
  return sessions;
}

/** 読みやすい末尾: ネイティブのスタックは 1 行に畳み、VRAM の警告と空行は除く */
function readableTail(lines: string[], n: number) {
  const out: string[] = [];
  let frames = 0;
  const flush = () => {
    if (frames) out.push(`… ネイティブのスタック ${frames} 行 (省略)`);
    frames = 0;
  };
  for (const l of lines) {
    if (nativeFrame.test(l)) {
      frames++;
      continue;
    }
    flush();
    if (!l.trim() || gpuWarning.test(l)) continue;
    const t = l.trimEnd();
    out.push(t.length > 300 ? `${t.slice(0, 300)}…` : t);
  }
  flush();
  return out.slice(-n);
}

function describeEvent(e: WinEvent) {
  const time = new Date(e.time).toLocaleString("sv-SE");
  if (e.kind === "app-crash") return `${time} python.exe がクラッシュ (${e.module} / ${e.code})`;
  // メッセージは Windows の表示言語によって変わるので、プロセス名・PID・バイト数だけ拾う
  const users = [...(e.message ?? "").matchAll(/([\w.-]+) \((\d+)\)\D+?(\d{7,})/g)].map((m) => `${m[1]} ${(Number(m[3]) / 1024 ** 3).toFixed(1)}GB`);
  return `${time} 仮想メモリ不足を検出 (${users.join(", ") || "内訳不明"})`;
}

function diagnose(lines: string[], end: Session["end"], events: WinEvent[]): Finding[] {
  const tail = readableTail(lines, 6).filter((l) => !exitMarker.test(l) && !l.startsWith("… ") && !/^Exception Code:/.test(l));
  const found: Finding[] = [];
  for (const k of knowledge) {
    const evidence: string[] = [];
    if (k.log) {
      const hit = lines.find((l) => k.log!.test(l));
      if (hit) evidence.push(hit.trim().slice(0, 300));
    }
    if (k.last && end === "exited") {
      const hit = tail.slice(-3).find((l) => k.last!.test(l));
      if (hit) evidence.push(`最後のログ: ${hit.trim().slice(0, 200)}`);
    }
    if (k.event) evidence.push(...events.filter(k.event).map(describeEvent));
    if (evidence.length) found.push({ id: k.id, title: k.title, level: k.level, cause: k.cause, remedy: k.remedy, evidence: evidence.slice(0, 5) });
  }
  const order = { crash: 0, warn: 1, info: 2 };
  return found.sort((a, b) => order[a.level] - order[b.level]);
}

/** ログを起動ごとに分けて、新しい順に診断する */
export function analyze(log: string, online: boolean, events: WinEvent[], limit = 6): Session[] {
  const raw = splitSessions(log);
  const sessions: Session[] = raw.map((s, i) => {
    const next = raw[i + 1];
    const exited = s.lines.some((l) => exitMarker.test(l));
    const end: Session["end"] = exited ? "exited" : next ? (next.label === "再起動" ? "restarted" : "stopped") : online ? "running" : "stopped";
    const until = next?.startedAt ?? Date.now();
    const inWindow = events.filter((e) => {
      const t = new Date(e.time).getTime();
      return t >= s.startedAt && t <= until;
    });
    return { label: s.label, startedAt: s.startedAt, endedAt: next?.startedAt ?? null, end, findings: diagnose(s.lines, end, inWindow), tail: readableTail(s.lines, 40) };
  });
  return sessions.reverse().slice(0, limit);
}

// Windows のイベントログ (直近 7 日) とメモリの状況を PowerShell で取る
const windowsScript = String.raw`
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'
$since = (Get-Date).AddDays(-7)
$app = @(Get-WinEvent -FilterHashtable @{LogName='Application'; Id=1000; StartTime=$since} -MaxEvents 300 | Where-Object { $_.Properties[0].Value -eq 'python.exe' } | ForEach-Object { [ordered]@{ time = $_.TimeCreated.ToString('o'); kind = 'app-crash'; module = [string]$_.Properties[3].Value; code = '0x' + [string]$_.Properties[6].Value; pid = [string]$_.Properties[8].Value } })
$res = @(Get-WinEvent -FilterHashtable @{LogName='System'; Id=2004; StartTime=$since} -MaxEvents 100 | ForEach-Object { [ordered]@{ time = $_.TimeCreated.ToString('o'); kind = 'commit-exhausted'; message = $_.Message } })
$os = Get-CimInstance Win32_OperatingSystem
$forgePid = (Get-NetTCPConnection -LocalPort __PORT__ -State Listen | Select-Object -First 1).OwningProcess
$forgeBytes = if ($forgePid) { (Get-Process -Id $forgePid).PrivateMemorySize64 } else { $null }
$top = @(Get-Process | Sort-Object PrivateMemorySize64 -Descending | Select-Object -First 5 | ForEach-Object { [ordered]@{ name = $_.ProcessName; pid = $_.Id; bytes = $_.PrivateMemorySize64 } })
[ordered]@{ events = @($app + $res); memory = [ordered]@{ ramTotal = $os.TotalVisibleMemorySize * 1KB; ramFree = $os.FreePhysicalMemory * 1KB; commitLimit = $os.TotalVirtualMemorySize * 1KB; commitFree = $os.FreeVirtualMemory * 1KB; forgePid = $forgePid; forgeBytes = $forgeBytes; top = $top } } | ConvertTo-Json -Depth 4 -Compress
`;

export function windowsInfo(forgePort: number): Promise<{ events: WinEvent[]; memory: Memory | null }> {
  if (process.platform !== "win32") return Promise.resolve({ events: [], memory: null });
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", windowsScript.replace("__PORT__", String(forgePort))],
      { encoding: "utf8", maxBuffer: 8 << 20, windowsHide: true, timeout: 30_000 },
      (err, out) => {
        try {
          if (err) throw err;
          const j = JSON.parse(out) as { events: WinEvent[]; memory: Memory };
          resolve({ events: j.events ?? [], memory: { ...j.memory, forgePid: j.memory.forgePid ?? null, forgeBytes: j.memory.forgeBytes ?? null, top: j.memory.top ?? [] } });
        } catch {
          resolve({ events: [], memory: null });
        }
      },
    );
  });
}

/** いま気を付けること (落ちる前の予兆) */
export function currentWarnings(memory: Memory | null): Finding[] {
  if (!memory) return [];
  const free = memory.commitFree / 1024 ** 3;
  if (free >= 6) return [];
  const k = knowledge.find((x) => x.id === "commit-exhausted")!;
  return [
    {
      id: "commit-low",
      title: `仮想メモリの空きが残り ${free.toFixed(1)}GB`,
      level: "warn",
      cause: `この状態でモデルを切り替えると落ちやすい。${k.cause}`,
      remedy: k.remedy,
      evidence: memory.top.map((p) => `${p.name} (${p.pid}) ${(p.bytes / 1024 ** 3).toFixed(1)}GB`),
    },
  ];
}
