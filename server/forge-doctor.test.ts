import { describe, expect, it } from "vitest";
import { analyze, currentWarnings, exitedSinceLastStart, splitSessions } from "./forge-doctor.js";
import type { WinEvent } from "./forge-knowledge.js";

const header = (label: string, time: string) => ["=".repeat(40), `${label}: ${time}`, "cmd: webui.bat", "cwd: C:/Forge", "=".repeat(40)].join("\n");

const log = [
  header("起動", "2026-10-01 10:00:00"),
  "Startup time: 20s",
  "Loading Model: foo.safetensors",
  "0x00007FF8AAAA0000, torch_cpu.dll",
  "0x00007FF8AAAA0001, torch_cpu.dll",
  "続行するには何かキーを押してください . . .",
  header("再起動", "2026-10-01 11:00:00.123"),
  "Startup time: 21s",
  "",
  "sampling_function.py :: WARNING",
  "Running on local URL",
].join("\n");

describe("splitSessions", () => {
  it("LocalLauncher の見出しで起動ごとに分ける", () => {
    const s = splitSessions(log);
    expect(s.map((x) => x.label)).toEqual(["起動", "再起動"]);
    expect(s[0].startedAt).toBe(new Date("2026-10-01T10:00:00").getTime());
    expect(s[1].startedAt).toBe(new Date("2026-10-01T11:00:00.123").getTime());
    expect(s[0].lines[0]).toBe("Startup time: 20s");
    expect(s[1].lines).toHaveLength(4);
  });

  it("見出しの前の行は捨て、見出しが無ければ空", () => {
    expect(splitSessions("garbage\n" + header("起動", "2026-10-01 10:00:00") + "\nx")).toHaveLength(1);
    expect(splitSessions("garbage")).toEqual([]);
  });
});

describe("exitedSinceLastStart", () => {
  it("最後の起動のあとに pause が出ていれば終了している", () => {
    expect(exitedSinceLastStart(log)).toBe(false);
    expect(exitedSinceLastStart(log.split("再起動:")[0])).toBe(true);
    expect(exitedSinceLastStart("Press any key to continue . . .")).toBe(true);
  });
});

describe("analyze", () => {
  it("新しい順に、どう終わったか・該当するナレッジ・読みやすい末尾を返す", () => {
    const [cur, prev] = analyze(log, true, []);
    expect(cur).toMatchObject({ label: "再起動", end: "running", endedAt: null, findings: [] });
    // VRAM の警告と空行は除く
    expect(cur.tail).toEqual(["Startup time: 21s", "Running on local URL"]);
    expect(prev).toMatchObject({ label: "起動", end: "exited", endedAt: cur.startedAt });
    expect(prev.findings.map((f) => f.id)).toEqual(["died-loading-model"]);
    expect(prev.findings[0].evidence[0]).toContain("Loading Model: foo.safetensors");
    expect(prev.tail).toContain("… ネイティブのスタック 2 行 (省略)");
  });

  it("終了の記録が無いまま次の起動があれば stopped、次が再起動なら restarted、動いていなければ stopped", () => {
    const l = [header("起動", "2026-10-01 10:00:00"), "a", header("起動", "2026-10-01 11:00:00"), "b", header("再起動", "2026-10-01 12:00:00"), "c"].join("\n");
    expect(analyze(l, false, []).map((s) => s.end)).toEqual(["stopped", "restarted", "stopped"]);
  });

  it("同じ時間帯の Windows のイベントをそのセッションの根拠にし、crash を先に並べる", () => {
    const events: WinEvent[] = [
      { time: "2026-10-01T10:30:00", kind: "commit-exhausted", message: "python.exe (1234) consumed 25000000000 bytes" },
      { time: "2026-10-01T09:00:00", kind: "app-crash", module: "torch_cpu.dll", code: "0xc0000005" },
    ];
    const l = [header("起動", "2026-10-01 10:00:00"), "The current free memory for GPU is 1GB", "DefaultCPUAllocator: not enough memory"].join("\n");
    const [s] = analyze(l, false, events);
    expect(s.findings.map((f) => f.id)).toEqual(["commit-exhausted", "low-vram-warning"]);
    const commit = s.findings[0];
    expect(commit.level).toBe("crash");
    expect(commit.evidence).toHaveLength(2);
    expect(commit.evidence[1]).toContain("python.exe 23.3GB");
  });

  it("limit で件数を絞る", () => {
    const l = Array.from({ length: 8 }, (_, i) => header("起動", `2026-10-01 1${i}:00:00`)).join("\n");
    expect(analyze(l, true, [])).toHaveLength(6);
    expect(analyze(l, true, [], 2)).toHaveLength(2);
  });
});

describe("currentWarnings", () => {
  const memory = { ramTotal: 0, ramFree: 0, commitLimit: 0, commitFree: 0, forgePid: null, forgeBytes: null, top: [{ name: "python", pid: 1, bytes: 20 * 1024 ** 3 }] };

  it("メモリの情報が無い・空きが十分なら無し", () => {
    expect(currentWarnings(null)).toEqual([]);
    expect(currentWarnings({ ...memory, commitFree: 6 * 1024 ** 3 })).toEqual([]);
  });

  it("仮想メモリの空きが 6GB を切ったら警告", () => {
    const [w] = currentWarnings({ ...memory, commitFree: 2.5 * 1024 ** 3 });
    expect(w).toMatchObject({ id: "commit-low", level: "warn", title: "仮想メモリの空きが残り 2.5GB" });
    expect(w.evidence).toEqual(["python (1) 20.0GB"]);
  });
});
