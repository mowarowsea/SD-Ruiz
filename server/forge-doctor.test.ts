import { describe, expect, test } from "vitest";
import { analyze, currentWarnings, exitedSinceLastStart, splitSessions } from "./forge-doctor.js";
import type { WinEvent } from "./forge-knowledge.js";

/** LocalLauncher が起動のたびに書く見出し (main.py の _launch_service と同じ形) */
const header = (label: "起動" | "再起動", time: string) => ["", "=".repeat(60), `${label}: ${time}`, "コマンド: webui.bat", "cwd: C:\\forge", "=".repeat(60)];
const t1 = "2026-10-01 10:00:00.123456";
const t2 = "2026-10-01 11:00:00";
const started1 = new Date("2026-10-01T10:00:00.123").getTime();
const started2 = new Date("2026-10-01T11:00:00").getTime();

const log = [
  ...header("起動", t1),
  "Loading Model: foo.safetensors",
  "sampling_function.py :: WARNING     :: The current free memory for GPU is 1234.56 MB",
  "DefaultCPUAllocator: not enough memory: you tried to allocate 1000 bytes",
  "Exception Code: 0xC0000005",
  "0x00007FFB12345678, torch_cpu.dll",
  "0x00007FFB12345679, torch_cpu.dll",
  "続行するには何かキーを押してください . . .",
  ...header("再起動", t2),
  "Loading Model: bar.safetensors",
  "Model loaded in 3.0s",
  "",
].join("\r\n");

describe("splitSessions", () => {
  test("見出しごとに分け、日時はローカル時刻として読む (Python の 6 桁のマイクロ秒も)", () => {
    const s = splitSessions(log);
    expect(s.map((x) => [x.label, x.startedAt, x.lines.length])).toEqual([
      // 次の見出しの前の空行も前のセッションの行に入る
      ["起動", started1, 8],
      ["再起動", started2, 3],
    ]);
    expect(s[0].lines[0]).toBe("Loading Model: foo.safetensors");
  });

  test("見出しの前の行と、見出しの無いログは捨てる", () => {
    expect(splitSessions("garbage\n" + log)).toHaveLength(2);
    expect(splitSessions("just some lines\nno header")).toEqual([]);
    expect(splitSessions("")).toEqual([]);
  });
});

describe("exitedSinceLastStart", () => {
  test("最後の起動のあとに webui.bat の pause が出ていれば終了している", () => {
    expect(exitedSinceLastStart(log)).toBe(false);
    expect(exitedSinceLastStart(log.slice(0, log.indexOf("再起動")))).toBe(true);
    expect(exitedSinceLastStart("Press any key to continue . . .")).toBe(true);
    expect(exitedSinceLastStart("")).toBe(false);
  });
});

describe("analyze", () => {
  const events: WinEvent[] = [
    { time: new Date(started1 + 30 * 60_000).toISOString(), kind: "commit-exhausted", message: "python.exe (1234) consumed 25000000000 bytes, vmmemWSL (99) consumed 8000000000 bytes" },
    { time: new Date(started1 + 31 * 60_000).toISOString(), kind: "app-crash", module: "torch_cpu.dll", code: "0xc0000005" },
    { time: new Date(started2 + 60_000).toISOString(), kind: "app-crash", module: "x.dll", code: "0x1" },
  ];

  test("新しい順に、どう終わったかと原因を出す", () => {
    const [cur, prev] = analyze(log, true, events);
    expect(cur).toMatchObject({ label: "再起動", startedAt: started2, endedAt: null, end: "running", tail: ["Loading Model: bar.safetensors", "Model loaded in 3.0s"] });
    expect(prev).toMatchObject({ label: "起動", startedAt: started1, endedAt: started2, end: "exited" });
  });

  test("原因は crash → warn → info の順。根拠にはログの行と同じ時間帯の Windows のイベントを付ける", () => {
    const prev = analyze(log, true, events)[1];
    expect(prev.findings.map((f) => f.id)).toEqual(["commit-exhausted", "native-crash", "died-loading-model", "low-vram-warning"]);
    const commit = prev.findings[0];
    expect(commit.level).toBe("crash");
    expect(commit.evidence[0]).toContain("DefaultCPUAllocator");
    expect(commit.evidence[1]).toMatch(/仮想メモリ不足を検出 \(python\.exe 23\.3GB, vmmemWSL 7\.5GB\)/);
    expect(prev.findings[1].evidence).toContainEqual(expect.stringContaining("python.exe がクラッシュ (torch_cpu.dll / 0xc0000005)"));
    expect(prev.findings[2].evidence).toEqual(["最後のログ: Loading Model: foo.safetensors"]);
  });

  test("動いているセッションの Windows のイベントは、そのセッションのものにする", () => {
    const cur = analyze(log, true, events)[0];
    expect(cur.findings.map((f) => f.id)).toEqual(["native-crash"]);
    expect(cur.findings[0].evidence).toEqual([expect.stringContaining("x.dll / 0x1")]);
  });

  test("ネイティブのスタックは 1 行に畳み、VRAM の警告と空行は除く", () => {
    const prev = analyze(log, true, [])[1];
    expect(prev.tail).toEqual([
      "Loading Model: foo.safetensors",
      "DefaultCPUAllocator: not enough memory: you tried to allocate 1000 bytes",
      "Exception Code: 0xC0000005",
      "… ネイティブのスタック 2 行 (省略)",
      "続行するには何かキーを押してください . . .",
    ]);
  });

  test("Forge がオフラインなら最後のセッションは stopped。次が「起動」なら前のは stopped、「再起動」なら restarted", () => {
    expect(analyze(log, false, []).map((s) => s.end)).toEqual(["stopped", "exited"]);
    const twice = [...header("起動", t1), "a", ...header("起動", t2), "b"].join("\n");
    expect(analyze(twice, true, []).map((s) => s.end)).toEqual(["running", "stopped"]);
    const restarted = [...header("起動", t1), "a", ...header("再起動", t2), "b"].join("\n");
    expect(analyze(restarted, true, []).map((s) => s.end)).toEqual(["running", "restarted"]);
  });

  test("limit で新しい方から絞る。空のログは空", () => {
    expect(analyze(log, true, [], 1).map((s) => s.label)).toEqual(["再起動"]);
    expect(analyze("", true, [])).toEqual([]);
  });
});

describe("currentWarnings", () => {
  const memory = { ramTotal: 32 * 1024 ** 3, ramFree: 1, commitLimit: 52 * 1024 ** 3, commitFree: 0, forgePid: null, forgeBytes: null, top: [{ name: "python", pid: 1, bytes: 23 * 1024 ** 3 }] };

  test("仮想メモリの空きが 6GB を切ったら注意。6GB 以上と、取れなかったときは何も出さない", () => {
    const [w] = currentWarnings({ ...memory, commitFree: 3 * 1024 ** 3 });
    expect(w).toMatchObject({ id: "commit-low", level: "warn", title: "仮想メモリの空きが残り 3.0GB", evidence: ["python (1) 23.0GB"] });
    expect(currentWarnings({ ...memory, commitFree: 6 * 1024 ** 3 })).toEqual([]);
    expect(currentWarnings(null)).toEqual([]);
  });
});
