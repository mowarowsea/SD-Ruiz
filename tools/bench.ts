// Forge の生成ベンチマーク (Claude 用のツール。UI は無い)。
// seed とプロンプトを固定して、設定違い (variant) ごとに生成し、時間・VRAM と画像の比較グリッドを残す。
//
//   npx tsx tools/bench.ts <spec.json> [--out <dir>]
//   npx tsx tools/bench.ts --resummarize <出力 dir> [--score]   (グリッドと summary.md を作り直す。--score で採点もやり直す)
//
// spec.json:
//   {
//     "base": "last",              // "last" (data/last/job.json) か job.json のパス。Dynamic Prompts を展開済みのプロンプトと seed を使う
//     "images": 2,                 // 何枚使うか (省略で base の枚数)。base より多いと、同じプロンプトで seed をずらして足す
//     "repeat": 1,                 // 1 枚を何回測るか (時間の中央値をとる)
//     "variants": [
//       { "name": "baseline" },
//       { "name": "steps12", "params": { "steps": 12 } },
//       { "name": "spectrum", "scripts": { "Spectrum Integrated": [true, 0.25, 6, 0.5, 2, 0, 6, 0.9] } },
//       { "name": "lora", "promptAppend": ", <lora:dmd2:1>", "params": { "steps": 8, "cfg": 1 } }
//     ]
//   }
//
// variant に書けるもの:
//   params:          checkpoint / negative / width / height / steps / cfg / sampler / scheduler を上書き
//   promptAppend:    プロンプトの末尾に足す
//   promptReplace:   [[from, to], ...] プロンプトの置き換え (正規表現ではなく文字列)
//   modules:         Forge の VAE / Text Encoder (forge_additional_modules) を上書き
//   scripts:         alwayson_scripts。{ "<スクリプトの title>": [args...] }
//   overrideSettings: override_settings に足す
//
// 出力 (既定は data/bench/<日時>/): 画像 <variant>_<i>.png、grid.jpg (列が variant、行が画像)、results.json、
// scores.json (WD14 tagger での採点。tools/score/score.py)、summary.md (時間・先頭の variant との PSNR・採点・VRAM)

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { Agent } from "undici";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface BaseJob {
  params: {
    checkpoint: string;
    negative: string;
    width: number;
    height: number;
    steps: number;
    cfg: number;
    sampler: string;
    scheduler: string;
  };
  modules: string[];
  seeds: number[];
  prompts: string[];
}

interface Variant {
  name: string;
  params?: Partial<BaseJob["params"]>;
  promptAppend?: string;
  promptReplace?: [string, string][];
  modules?: string[];
  scripts?: Record<string, unknown[]>;
  overrideSettings?: Record<string, unknown>;
}

interface Spec {
  base?: string;
  images?: number;
  repeat?: number;
  variants: Variant[];
}

interface Run {
  image: number;
  seed: number;
  seconds: number[];
  /** その画像を作ったあとの VRAM 確保量のピーク (Forge 起動からの累計なので、増えたときだけ意味がある) */
  peakAllocatedGB: number;
  retries: number;
  oom: number;
  file: string;
}

interface Memory {
  cuda?: { allocated: { peak: number }; events: { retries: number; oom: number } };
}

const longRunning = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

function loadConfig() {
  try {
    const c = JSON.parse(readFileSync(join(root, "config.json"), "utf8")) as { forgeUrl?: string };
    return (c.forgeUrl ?? "http://127.0.0.1:7862").replace(/\/+$/, "");
  } catch {
    return "http://127.0.0.1:7862";
  }
}

const forgeUrl = loadConfig();

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${forgeUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    dispatcher: longRunning,
  });
  if (!res.ok) throw new Error(`Forge が ${res.status} を返しました: ${path} ${(await res.text()).slice(0, 500)}`);
  return (await res.json()) as T;
}

/** Ruiz などほかの生成が走っていたら終わるまで待つ (時間が混ざらないように) */
async function waitIdle() {
  for (let warned = false; ; warned = true) {
    const p = await api<{ state: { job_count: number } }>("/sdapi/v1/progress?skip_current_image=true");
    if (p.state.job_count === 0) return;
    if (!warned) console.log("  (ほかの生成が終わるのを待っています)");
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/** base の枚数を超えた分は、同じプロンプトで seed をずらす */
const seedOf = (base: BaseJob, i: number) => base.seeds[i % base.seeds.length] + Math.floor(i / base.seeds.length) * 7919;

function buildRequest(base: BaseJob, v: Variant, i: number, steps?: number) {
  const p = { ...base.params, ...v.params };
  let prompt = base.prompts[i % base.prompts.length];
  for (const [from, to] of v.promptReplace ?? []) prompt = prompt.split(from).join(to);
  if (v.promptAppend) prompt += v.promptAppend;
  return {
    prompt,
    negative_prompt: p.negative,
    width: p.width,
    height: p.height,
    steps: steps ?? p.steps,
    cfg_scale: p.cfg,
    sampler_name: p.sampler,
    scheduler: p.scheduler,
    seed: seedOf(base, i),
    batch_size: 1,
    n_iter: 1,
    save_images: false,
    alwayson_scripts: Object.fromEntries(Object.entries(v.scripts ?? {}).map(([k, args]) => [k, { args }])),
    override_settings: {
      sd_model_checkpoint: p.checkpoint,
      forge_additional_modules: v.modules ?? base.modules,
      ...v.overrideSettings,
    },
    override_settings_restore_afterwards: false,
  };
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const escapeXml = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);

async function makeGrid(variants: Variant[], runs: Run[][], outDir: string) {
  const cellW = 384;
  const first = await sharp(join(outDir, runs[0][0].file)).metadata();
  const cellH = Math.round((cellW * first.height!) / first.width!);
  const headH = 44;
  const rows = runs[0].length;
  const width = cellW * variants.length;
  const height = headH + cellH * rows;
  const header = variants
    .map((v, c) => {
      const sec = median(runs[c].map((r) => median(r.seconds))).toFixed(1);
      return `<text x="${c * cellW + 8}" y="20" font-size="16" font-family="sans-serif" fill="#fff">${escapeXml(v.name)}</text>
<text x="${c * cellW + 8}" y="38" font-size="14" font-family="sans-serif" fill="#aaa">${sec}s / 枚</text>`;
    })
    .join("");
  const cells = await Promise.all(
    runs.flatMap((col, c) =>
      col.map(async (r, row) => ({
        input: await sharp(join(outDir, r.file)).resize(cellW, cellH).toBuffer(),
        left: c * cellW,
        top: headH + row * cellH,
      })),
    ),
  );
  await sharp({ create: { width, height, channels: 3, background: "#222" } })
    .composite([{ input: Buffer.from(`<svg width="${width}" height="${headH}">${header}</svg>`), left: 0, top: 0 }, ...cells])
    .jpeg({ quality: 88 })
    .toFile(join(outDir, "grid.jpg"));
}

async function main() {
  const args = process.argv.slice(2);
  const re = args.indexOf("--resummarize");
  if (re >= 0) {
    // 測り終わった出力から、グリッドと summary.md だけ作り直す
    const dir = resolve(args[re + 1]);
    const saved = JSON.parse(readFileSync(join(dir, "results.json"), "utf8")) as { variant: Variant; runs: Run[] }[];
    await makeGrid(saved.map((s) => s.variant), saved.map((s) => s.runs), dir);
    if (args.includes("--score")) score(dir);
    await writeSummary(dir, saved.map((s) => s.variant), saved.map((s) => s.runs));
    return;
  }
  const specPath = args.find((a) => !a.startsWith("--"));
  if (!specPath) throw new Error("使い方: npx tsx tools/bench.ts <spec.json> [--out <dir>]");
  const spec = JSON.parse(readFileSync(specPath, "utf8")) as Spec;
  const basePath = !spec.base || spec.base === "last" ? join(root, "data/last/job.json") : resolve(spec.base);
  const base = JSON.parse(readFileSync(basePath, "utf8")) as BaseJob;
  if (!base.prompts?.length || !base.seeds?.length) throw new Error(`${basePath} に展開済みのプロンプトと seed がありません`);
  const count = spec.images ?? base.prompts.length;
  const repeat = spec.repeat ?? 1;

  const outIdx = args.indexOf("--out");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const outDir = outIdx >= 0 ? resolve(args[outIdx + 1]) : join(root, "data/bench", stamp);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "spec.json"), JSON.stringify({ ...spec, base: basePath }, null, 2));

  console.log(`Forge: ${forgeUrl} / ${base.params.checkpoint} / ${base.params.width}x${base.params.height} / 画像 ${count} 枚 × ${spec.variants.length} 通り × ${repeat} 回`);
  const results: Run[][] = [];
  for (const v of spec.variants) {
    console.log(`\n[${v.name}]`);
    // 1 回捨てて、Checkpoint / LoRA の読み込みと初回の準備を時間に入れない
    await waitIdle();
    await api("/sdapi/v1/txt2img", buildRequest(base, v, 0, 3));
    const runs: Run[] = [];
    for (let i = 0; i < count; i++) {
      const seconds: number[] = [];
      let image = "";
      for (let k = 0; k < repeat; k++) {
        await waitIdle();
        const t = performance.now();
        const res = await api<{ images: string[] }>("/sdapi/v1/txt2img", buildRequest(base, v, i));
        seconds.push((performance.now() - t) / 1000);
        image = res.images[0];
      }
      const mem = await api<Memory>("/sdapi/v1/memory");
      const file = `${v.name.replace(/[^\w.-]+/g, "_")}_${i}.png`;
      writeFileSync(join(outDir, file), Buffer.from(image, "base64"));
      const run: Run = {
        image: i,
        seed: seedOf(base, i),
        seconds: seconds.map((s) => Math.round(s * 100) / 100),
        peakAllocatedGB: Math.round(((mem.cuda?.allocated.peak ?? 0) / 2 ** 30) * 100) / 100,
        retries: mem.cuda?.events.retries ?? 0,
        oom: mem.cuda?.events.oom ?? 0,
        file,
      };
      runs.push(run);
      console.log(`  画像 ${i} (seed ${run.seed}): ${run.seconds.join(" / ")} 秒`);
    }
    results.push(runs);
  }

  await makeGrid(spec.variants, results, outDir);
  writeFileSync(join(outDir, "results.json"), JSON.stringify(spec.variants.map((v, c) => ({ variant: v, runs: results[c] })), null, 2));
  score(outDir);

  await writeSummary(outDir, spec.variants, results);
}

const scorePython = join(root, "tools/score/.venv/Scripts/python.exe");

/** WD14 tagger でプロンプトへの追従を採点して scores.json を作る (tools/score/score.py)。venv が無ければ飛ばす */
function score(outDir: string) {
  if (!existsSync(scorePython)) {
    console.log("採点用の venv (tools/score/.venv) が無いので採点を飛ばします");
    return;
  }
  console.log("\n採点中 (WD14 tagger)…");
  const r = spawnSync(scorePython, [join(root, "tools/score/score.py"), outDir], { stdio: ["ignore", "inherit", "pipe"], encoding: "utf8" });
  if (r.status !== 0) console.log(`採点に失敗しました: ${r.stderr.slice(-1000)}`);
}

interface Scores {
  variants: { variant: string; posRecall: number | null; negHitRate: number | null; images: { negHit: string[]; posMissed: string[] }[] }[];
}

/** 先頭の variant の同じ画像との PSNR (dB)。縮小したグレースケールで比べる。高いほど近い (30 を超えると見た目はほぼ同じ) */
async function psnr(a: string, b: string) {
  const load = (f: string) => sharp(f).resize(384, 384, { fit: "fill" }).grayscale().raw().toBuffer();
  const [x, y] = await Promise.all([load(a), load(b)]);
  let se = 0;
  for (let i = 0; i < x.length; i++) se += (x[i] - y[i]) ** 2;
  const mse = se / x.length;
  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
}

async function writeSummary(outDir: string, variants: Variant[], results: Run[][]) {
  const scoresPath = join(outDir, "scores.json");
  const scores = existsSync(scoresPath) ? (JSON.parse(readFileSync(scoresPath, "utf8")) as Scores) : null;
  const pct = (x: number | null | undefined) => (x === null || x === undefined ? "-" : `${(x * 100).toFixed(1)}%`);
  const baseSec = median(results[0].map((r) => median(r.seconds)));
  const rows = await Promise.all(
    variants.map(async (v, c) => {
      const sec = median(results[c].map((r) => median(r.seconds)));
      const last = results[c].at(-1)!;
      const ps = await Promise.all(results[c].map((r, i) => psnr(join(outDir, results[0][i].file), join(outDir, r.file))));
      const mean = c === 0 ? "-" : (ps.reduce((a, b) => a + b, 0) / ps.length).toFixed(1);
      const sc = scores?.variants[c];
      return `| ${v.name} | ${sec.toFixed(2)} | ×${(baseSec / sec).toFixed(2)} | ${mean} | ${pct(sc?.posRecall)} | ${pct(sc?.negHitRate)} | ${last.peakAllocatedGB} / ${last.retries} / ${last.oom} |`;
    }),
  );
  const lines = [
    `| variant | 秒/枚 (中央値) | 対 ${variants[0].name} | PSNR dB | Positive 一致率 | Negative 混入率 | VRAM GB / retries / OOM |`,
    "|---|---|---|---|---|---|---|",
    ...rows,
  ];
  if (scores) {
    // どのタグで差が付いたか: Negative に書いたのに出たタグと、先頭の variant では出ていたのに消えたタグ (何枚で起きたか)
    const count = (lists: string[][]) => {
      const m = new Map<string, number>();
      for (const l of lists) for (const t of l) m.set(t, (m.get(t) ?? 0) + 1);
      return [...m].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}×${n}`);
    };
    const base = scores.variants[0].images;
    lines.push("", `採点: WD14 tagger。PSNR は ${variants[0].name} との近さ (高いほど近い)`);
    for (const sc of scores.variants) {
      const neg = count(sc.images.map((im) => im.negHit));
      const lost = count(sc.images.map((im, i) => im.posMissed.filter((t) => !base[i]?.posMissed.includes(t))));
      const gained = count(sc.images.map((im, i) => (base[i]?.posMissed ?? []).filter((t) => !im.posMissed.includes(t))));
      lines.push(``, `- **${sc.variant}**`, `  - Negative なのに出た: ${neg.slice(0, 15).join(", ") || "なし"}`);
      if (sc !== scores.variants[0]) {
        lines.push(`  - ${variants[0].name} より消えた: ${lost.slice(0, 15).join(", ") || "なし"}`);
        lines.push(`  - ${variants[0].name} より出た: ${gained.slice(0, 15).join(", ") || "なし"}`);
      }
    }
  }
  writeFileSync(join(outDir, "summary.md"), lines.join("\n") + "\n");
  console.log(`\n${lines.join("\n")}\n\n出力: ${outDir}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
