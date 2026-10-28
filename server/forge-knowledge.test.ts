import { expect, test } from "vitest";
import { knowledge } from "./forge-knowledge.js";

test("id は重複せず、level は crash / warn / info のどれか", () => {
  const ids = knowledge.map((k) => k.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const k of knowledge) expect(["crash", "warn", "info"]).toContain(k.level);
});

test("見分け方 (log / last / event) がどれか 1 つはある", () => {
  for (const k of knowledge) expect(!!(k.log || k.last || k.event), k.id).toBe(true);
});

// 実際に Forge のログに出た行 (seen に書いた状況から)。ナレッジの見分け方を直したときに、これまでの例が当たらなくならないように
const examples: Record<string, string[]> = {
  "commit-exhausted": ["RuntimeError: [enforce fail at alloc_cpu.cpp:117] data. DefaultCPUAllocator: not enough memory: you tried to allocate 1073741824 bytes."],
  "native-crash": ["Exception Code: 0xC0000005"],
  "cuda-oom": ["torch.cuda.OutOfMemoryError: CUDA out of memory. Tried to allocate 2.00 GiB"],
  "llm-te-batch-stack": ["RuntimeError: stack expects each tensor to be equal size, but got [1, 1267, 1024] at entry 0 and [1, 1260, 1024] at entry 1"],
  "spectrum-cond-batch": ["RuntimeError: output with shape [1, 4, 180, 120] doesn't match the broadcast shape [2, 4, 180, 120]"],
  "port-in-use": ["ERROR:    [Errno 10048] error while attempting to bind on address ('127.0.0.1', 7862)", "OSError: Cannot find empty port in range: 7862-7862"],
  "low-vram-warning": ["sampling_function.py :: WARNING     :: The current free memory for GPU is 1234.56 MB"],
  "stale-gradio-tab": ["    block = app.get_blocks().blocks_config.blocks[key]"],
};

test("log の見分け方は、これまでに見た行に当たる", () => {
  for (const [id, lines] of Object.entries(examples)) {
    const k = knowledge.find((x) => x.id === id)!;
    expect(k, id).toBeDefined();
    for (const line of lines) expect(k.log!.test(line), `${id}: ${line}`).toBe(true);
  }
});

test("died-loading-model は最後の行が Loading Model: のとき", () => {
  const k = knowledge.find((x) => x.id === "died-loading-model")!;
  expect(k.last!.test("Loading Model: novaMoeXL_v2.safetensors [abcd1234]")).toBe(true);
  expect(k.last!.test("Model loaded in 3.0s")).toBe(false);
});

test("Windows のイベントの見分け方", () => {
  const commit = knowledge.find((x) => x.id === "commit-exhausted")!;
  const crash = knowledge.find((x) => x.id === "native-crash")!;
  expect(commit.event!({ time: "", kind: "commit-exhausted" })).toBe(true);
  expect(commit.event!({ time: "", kind: "app-crash" })).toBe(false);
  expect(crash.event!({ time: "", kind: "app-crash" })).toBe(true);
});
