// モデルの推奨設定と作例。Civitai の説明文を LLM (Groq) で JSON にまとめ、data/recommended.json に覚えておく。
// 作例の画像も data/recommend-images/ に保存する (Civitai から消えても見られるように)

import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

export interface Range {
  min: number | null;
  max: number | null;
  /** おすすめの値 (書かれていなければ null) */
  best: number | null;
}

export interface Recommendation {
  steps: Range | null;
  cfg: Range | null;
  /** Forge の Sampler 名 (合うものが無ければ原文のまま) */
  samplers: string[];
  /** Forge の Scheduler 名 (name。合うものが無ければ原文のまま) */
  schedulers: string[];
  /** "832x1216" の形 */
  sizes: string[];
  clipSkip: number | null;
  /** Hires fix について (日本語で短く) */
  hires: string | null;
  /** プロンプトに入れるクオリティタグ */
  quality: string | null;
  negative: string | null;
  /** そのほかの注意 (日本語、1 行 1 つ) */
  notes: string[];
  /** LoRA の重み (Checkpoint では null。前に取ったものには無い) */
  weight?: Range | null;
  /** LoRA のトリガーワード (使い分けがあれば説明つき) */
  triggers?: string[];
}

/** 作例。作者のもの (生成情報の無いものも) と、足りなければほかの人の投稿 (生成情報のあるものだけ) */
export interface Sample {
  url: string;
  width: number;
  height: number;
  /** 0〜: 1 PG, 2 PG-13, 4 R, 8 X, 16 XXX */
  nsfwLevel: number;
  prompt: string;
  negative: string;
  steps: number | null;
  cfg: number | null;
  sampler: string | null;
  scheduler: string | null;
  seed: number | null;
  clipSkip: number | null;
  /** 手元に保存した画像 ("{versionId}/{取った日時}/{n}"。前の作りでは "{versionId}/{n}"。保存できていなければ無い) */
  file?: string;
  /** 生成情報が無い (見るだけ) */
  noInfo?: true;
  /** ほかの人の投稿なら投稿者 (作者の作例には無い) */
  by?: string;
  /** 必ず取る投稿者 (pinnedCivitaiUsers) の投稿 */
  pinned?: true;
}

export interface Entry {
  versionId: number;
  modelId: number;
  name: string;
  fetchedAt: number;
  /** ok: 推奨あり / no-llm: キーが無いので作例だけ / gone: Civitai から消えている / error: 取れなかった (1 時間後に取り直す) */
  status: "ok" | "no-llm" | "gone" | "error";
  error: string | null;
  rec: Recommendation | null;
  samples: Sample[];
  /** 作例の画像を保存しようとした日時 (古い Entry には無い) */
  imagesTriedAt?: number;
  /** 作例の集め方 (samplesKey と違えば作例だけ集め直す) */
  samplesKey?: string;
}

/** Forge の選択肢 (LLM に名前を合わせてもらう) */
export interface ForgeNames {
  samplers: string[];
  schedulers: { name: string; label: string }[];
}

export interface CivitaiIds {
  modelId: number;
  versionId: number;
}

/** 付随ファイルの無いモデルを、中身のハッシュから Civitai で引いた結果 (ファイルの大きさと更新日時が変わったら引き直す) */
interface HashLookup {
  size: number;
  mtime: number;
  sha256: string;
  /** Civitai に無ければ null */
  ids: CivitaiIds | null;
  checkedAt: number;
  /** Civitai に聞けなかった (落ちていたなど)。ids は null で、1 時間後に聞き直す (ハッシュは計算し直さない) */
  error?: string;
}

const path = fileURLToPath(new URL("../data/recommended.json", import.meta.url));
const hashPath = fileURLToPath(new URL("../data/model-hashes.json", import.meta.url));
const imageDir = fileURLToPath(new URL("../data/recommend-images", import.meta.url));
const retryAfterError = 60 * 60_000;
const ua = { "user-agent": "SD-Ruiz (personal txt2img frontend)" };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 読めなければ (書いている途中で止まって壊れていれば) 脇へ退けて空から始める (起動できなくならないよう) */
function readJson<T>(file: string, empty: T): T {
  if (!existsSync(file)) return empty;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (e) {
    console.warn(`${file} を読めないので ${file}.broken に退けて空から始めます: ${(e as Error).message}`);
    renameSync(file, `${file}.broken`);
    return empty;
  }
}

/** 一時ファイルに書いてから入れ替える (書いている途中で止まっても壊れないよう) */
function writeJson(file: string, data: unknown) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2));
  renameSync(`${file}.tmp`, file);
}

/** 説明文の HTML をテキストにする (段落と箇条書きは改行に) */
export function htmlToText(html: string) {
  return html
    .replace(/<br\s*\/?>|<\/(p|li|h\d|div|tr|blockquote|pre)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

class CivitaiError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`Civitai ${status}: ${url}`);
  }
}

async function civitai(url: string) {
  const res = await fetch(url, { headers: ua, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new CivitaiError(res.status, url);
  return (await res.json()) as Record<string, any>;
}

function sha256File(file: string) {
  return new Promise<string>((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(file, { highWaterMark: 4 * 1024 * 1024 })
      .on("data", (d) => h.update(d))
      .on("end", () => resolve(h.digest("hex").toUpperCase()))
      .on("error", reject);
  });
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/** /api/v1/images の nsfwLevel は文字 (None / Soft / Mature / X) */
const nsfwLevels: Record<string, number> = { None: 1, Soft: 2, Mature: 4, X: 8 };

/** 生成情報が無ければ noInfo にする (見るだけ)。画像でないもの (動画) は null */
function toSample(img: Record<string, any>): Sample | null {
  if (img.type !== "image") return null;
  const base = {
    url: String(img.url),
    width: Number(img.width) || 0,
    height: Number(img.height) || 0,
    nsfwLevel: typeof img.nsfwLevel === "string" ? (nsfwLevels[img.nsfwLevel] ?? 0) : Number(img.nsfwLevel) || 0,
  };
  const m = img.meta as Record<string, unknown> | null;
  if (!m || typeof m.prompt !== "string" || m.prompt.length < 10)
    return { ...base, prompt: "", negative: "", steps: null, cfg: null, sampler: null, scheduler: null, seed: null, clipSkip: null, noInfo: true };
  return {
    ...base,
    prompt: m.prompt,
    negative: typeof m.negativePrompt === "string" ? m.negativePrompt : "",
    steps: num(m.steps),
    cfg: num(m.cfgScale),
    sampler: typeof m.sampler === "string" ? m.sampler : null,
    scheduler: typeof m["Schedule type"] === "string" ? (m["Schedule type"] as string) : null,
    seed: num(m.seed),
    clipSkip: num(m.clipSkip),
  };
}

/** 作例の集め方。版を上げるか必ず取る投稿者を変えると、取ってあるモデルの作例を集め直す (推奨はそのまま) */
const samplesKey = (pinnedUsers: string[]) => `3:${pinnedUsers.join(",")}`;
/** 生成情報のある作例がこれより少なければ、ほかの人の投稿から足す */
const wantSamples = 10;

const imageId = (url: string) => url.match(/\/(\d+)\.\w+$/)?.[1] ?? url;

/** /api/v1/images (withMeta=true が無いと生成情報を返さない。nsfw=X が無いと全年齢のものしか返さない)。落ちていたら空 */
async function civitaiPosts(versionId: number, query: string) {
  try {
    return ((await civitai(`https://civitai.com/api/v1/images?modelVersionId=${versionId}&withMeta=true&nsfw=X&${query}`)).items ?? []) as Record<string, any>[];
  } catch {
    return [];
  }
}

/**
 * 作例を集める。
 * 1. 必ず取る投稿者の投稿 (生成情報が無くても、ほかが足りていても)
 * 2. 作者の作例 (バージョンに付いている画像)。生成情報が無くても入れる
 * 3. 生成情報のあるものが足りなければ、ほかの人の投稿 (反応の多い順) から足す
 */
async function collectSamples(versionId: number, versionImages: Record<string, any>[], pinnedUsers: string[]): Promise<Sample[]> {
  const posts = await civitaiPosts(versionId, "limit=50&sort=Most%20Reactions");
  const pinnedPosts: Record<string, any>[] = [];
  for (const user of pinnedUsers) pinnedPosts.push(...(await civitaiPosts(versionId, `limit=20&username=${encodeURIComponent(user)}`)));
  const postById = new Map([...posts, ...pinnedPosts].map((p) => [imageId(String(p.url)), p]));
  const seen = new Set<string>();
  const pinned: Sample[] = [];
  for (const p of pinnedPosts) {
    const s = toSample(p);
    if (!s || seen.has(imageId(s.url))) continue;
    seen.add(imageId(s.url));
    pinned.push({ ...s, by: typeof p.username === "string" ? p.username : "?", pinned: true });
  }
  // 作者の作例でも、バージョンの API には生成情報が無く、画像の API にはあることがある
  const author = versionImages
    .map((img) => {
      const s = toSample(img);
      const post = postById.get(imageId(String(img.url)));
      return s?.noInfo && post ? (toSample({ ...post, url: img.url }) ?? s) : s;
    })
    .filter((s): s is Sample => !!s && !seen.has(imageId(s.url)));
  for (const s of author) seen.add(imageId(s.url));
  const others: Sample[] = [];
  const withInfo = [...pinned, ...author].filter((s) => !s.noInfo).length;
  for (const p of posts) {
    if (withInfo + others.length >= wantSamples) break;
    const s = toSample(p);
    if (!s || s.noInfo || seen.has(imageId(s.url))) continue;
    seen.add(imageId(s.url));
    others.push({ ...s, by: typeof p.username === "string" ? p.username : "?" });
  }
  return [...pinned, ...author, ...others];
}

/** 作例の設定を LLM に渡す形にまとめる (多いものから)。LoRA ならプロンプトの <lora:名前:重み> も */
function summarizeSamples(all: Sample[], isLora: boolean) {
  const samples = all.filter((s) => !s.noInfo);
  if (!samples.length) return "(作例の生成情報なし)";
  const count = (vals: (string | number | null)[]) => {
    const m = new Map<string, number>();
    for (const v of vals) if (v !== null && v !== "") m.set(String(v), (m.get(String(v)) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v} ×${n}`).join(", ") || "-";
  };
  return [
    `作例 ${samples.length} 枚の設定`,
    `steps: ${count(samples.map((s) => s.steps))}`,
    `cfg: ${count(samples.map((s) => s.cfg))}`,
    `sampler: ${count(samples.map((s) => s.sampler))}`,
    `scheduler: ${count(samples.map((s) => s.scheduler))}`,
    `size: ${count(samples.map((s) => `${s.width}x${s.height}`).filter(isGenerationSize))}`,
    `clip skip: ${count(samples.map((s) => s.clipSkip))}`,
    `negative の例: ${samples.find((s) => s.negative)?.negative.slice(0, 300) ?? "-"}`,
    ...(isLora ? [`プロンプトの LoRA と重み: ${count(samples.flatMap((s) => [...s.prompt.matchAll(/<lora:([^:>]+):([\d.]+)/gi)].map((m) => `${m[1]}:${m[2]}`)))}`] : []),
  ].join("\n");
}

const schemaHint = `{
  "steps": {"min": number|null, "max": number|null, "best": number|null} | null,
  "cfg": {"min": number|null, "max": number|null, "best": number|null} | null,
  "samplers": string[],
  "schedulers": string[],
  "sizes": string[],
  "clipSkip": number|null,
  "hires": string|null,
  "quality": string|null,
  "negative": string|null,
  "notes": string[],
  "weight": {"min": number|null, "max": number|null, "best": number|null} | null,
  "triggers": string[]
}`;

/** isLora: LoRA なら重みとトリガーワードも読み取る。trainedWords は Civitai に登録されたトリガーワード */
function buildPrompt(name: string, description: string, samples: Sample[], names: ForgeNames, isLora: boolean, trainedWords: string[]) {
  return `Stable Diffusion の${isLora ? " LoRA" : "モデル"}「${name}」の Civitai の説明文と、作例の設定から、推奨の生成設定を読み取って JSON で答えてください。

形式:
${schemaHint}

決まり:
- 説明文に書かれていることを優先する。説明文に無い項目だけ作例の設定 (多いもの) から埋める。どちらにも無ければ null か []
- steps / cfg: 範囲なら min と max、おすすめが 1 つ書かれていれば best。値が 1 つだけなら min = max = best
- samplers: 次の Forge の Sampler 名から選ぶ (「DPM++ 2M Karras」のように Scheduler が付いていたら Sampler と Scheduler に分ける)。合うものが無ければ原文のまま
  ${names.samplers.join(" / ")}
- schedulers: 次の name から選ぶ (括弧の中は表示名)。合うものが無ければ原文のまま
  ${names.schedulers.map((s) => `${s.name} (${s.label})`).join(" / ")}
- sizes: "幅x高さ" の形 (例 "832x1216")。説明文で勧めている生成サイズ。無ければ作例で多いもの最大 3 つ。Hires fix やアップスケールの後のサイズ (SDXL 系で一辺 1600 を超えるもの) は入れない
- quality: プロンプトの先頭に入れるよう勧めているクオリティタグをそのまま (例 "masterpiece, best quality, newest")
- negative: 勧めているネガティブプロンプトをそのまま
- hires: Hires fix の勧め (倍率・Denoise・アップスケーラーなど) を日本語で短く
${
  isLora
    ? `- weight: LoRA の重み (<lora:名前:重み> の数字)。範囲なら min と max、おすすめが 1 つなら best。説明文に無ければ作例のプロンプトの重み (多いもの) から
- triggers: プロンプトに入れるトリガーワード。説明文で使い分け (衣装ごとなど) が書かれていれば「word (日本語で短く用途)」の形。Civitai に登録されたもの: ${trainedWords.join(" / ") || "なし"}
- LoRA の説明文に生成設定 (steps / cfg / sampler など) が書かれていなければ、作例の設定から埋めず null か [] にする (作例は作者がたまたま使った設定のことが多いので)`
    : `- weight: null、triggers: [] (Checkpoint なので)`
}
- notes: そのほか生成に関わる大事な注意 (VAE、プロンプトの書き方、苦手なこと、合うベースモデルなど) を日本語で 1 つ 40 字以内、最大 5 つ。ほかの項目 (steps / cfg / sampler / scheduler / サイズ / clip skip / hires / quality / negative / weight / triggers) と同じことは書かない。宣伝・更新履歴・お礼・ライセンス・規約は入れない

説明文:
"""
${description.slice(0, 12_000)}
"""

${summarizeSamples(samples, isLora)}`;
}

async function askGroq(apiKey: string, model: string, prompt: string): Promise<Recommendation> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You extract recommended generation settings for Stable Diffusion models. Answer with a single JSON object only." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        ...(model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}),
      }),
      signal: AbortSignal.timeout(120_000),
    });
    // 無料枠の上限。言われた秒数だけ待って続ける
    if (res.status === 429 && attempt < 5) {
      const wait = Number(res.headers.get("retry-after")) || 30;
      await sleep(Math.min(wait, 600) * 1000 + 500);
      continue;
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) throw new Error(`Groq ${res.status}: ${body.error?.message ?? ""}`);
    return normalizeRec(JSON.parse(body.choices?.[0]?.message?.content ?? "{}"));
  }
}

/**
 * 返すときに整える (保存してあるのは LLM の答えのまま)。
 * Sampler / Scheduler を Forge の名前にそろえ (大文字小文字違いの "Karras" など)、
 * 注意からほかの項目と同じこと・ライセンスや宣伝の話を落とす (LLM に言っても書いてくるので)
 */
export function tidy(rec: Recommendation, names: ForgeNames): Recommendation {
  const lc = (s: string) => s.trim().toLowerCase();
  const uniq = (xs: string[]) => [...new Set(xs)];
  return {
    ...rec,
    samplers: uniq(rec.samplers.map((s) => names.samplers.find((x) => lc(x) === lc(s)) ?? s)),
    schedulers: uniq(rec.schedulers.map((s) => names.schedulers.find((x) => lc(x.name) === lc(s) || lc(x.label) === lc(s))?.name ?? s)),
    weight: rec.weight ?? null,
    triggers: rec.triggers ?? [],
    notes: rec.notes
      .filter((n) => !/clip ?skip|steps?\b|cfg|sampler|サンプラ|scheduler|スケジューラ|サイズ|解像度|\d+\s*[x×]\s*\d+/i.test(n))
      .filter((n) => !(rec.weight && /重み|強さ|weight/i.test(n)))
      .filter((n) => !/商用|共有|宣伝|広告|ライセンス|規約|責任|アップロード|転載|クレジット|報告/.test(n))
      .slice(0, 5),
  };
}

/** Hires fix やアップスケールの後のサイズ (一辺 1600 超) は生成サイズとして勧めない */
const isGenerationSize = (size: string) => size.split("x").every((n) => Number(n) <= 1600);

function normalizeRange(v: unknown): Range | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const out = { min: num(r.min), max: num(r.max), best: num(r.best) };
  return out.min === null && out.max === null && out.best === null ? null : out;
}

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : []);
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** LLM の答えを型に合わせる (知らない項目は捨て、形の違うものは null にする) */
function normalizeRec(j: Record<string, unknown>): Recommendation {
  return {
    steps: normalizeRange(j.steps),
    cfg: normalizeRange(j.cfg),
    samplers: strings(j.samplers),
    schedulers: strings(j.schedulers),
    sizes: strings(j.sizes)
      .map((s) => s.replace(/\s*[×*]\s*/, "x").replace(/\s+/g, ""))
      .filter((s) => /^\d+x\d+$/.test(s) && isGenerationSize(s)),
    clipSkip: num(j.clipSkip),
    hires: text(j.hires),
    quality: text(j.quality),
    negative: text(j.negative),
    notes: strings(j.notes).slice(0, 8),
    weight: normalizeRange(j.weight),
    triggers: strings(j.triggers),
  };
}

/** Checkpoint の実ファイルと、付随ファイルから読んだ Civitai の ID */
export interface ModelRef {
  file: string;
  civitai: CivitaiIds | null;
}

/** fetch の keepSamples: 作例はそのままで推奨だけ取り直す (自動の取り直しで、作例の集め方が変わっていないとき) */
type Job = { kind: "fetch"; ids: CivitaiIds; keepSamples?: boolean } | { kind: "hash"; file: string } | { kind: "samples"; versionId: number };

const jobVersion = (j: Job) => (j.kind === "fetch" ? j.ids.versionId : j.kind === "samples" ? j.versionId : null);

/** 保存した作例の画像 (full は長辺 1024、thumb は幅 450) のパス。名前がおかしければ null */
export function sampleImagePath(file: string, size: "full" | "thumb") {
  if (!/^\d+\/(\d+\/)?\d+$/.test(file)) return null;
  return join(imageDir, `${file}${size === "thumb" ? "-thumb" : ""}.webp`);
}

/**
 * 作例の画像を Civitai から落として webp で保存する。落とせなかったものは file を付けない (画面では Civitai から直接読む)。
 * 取るたびに別のフォルダ ({versionId}/{取った日時}/) に入れ、前の画像は Entry を保存してから pruneImages() で消す
 * (先に入れ替えると、Entry を保存するまでの間 (と、その間に止まったらずっと) 古い作例の情報に新しい画像が並ぶため)
 */
async function saveSampleImages(versionId: number, samples: Sample[]): Promise<Sample[]> {
  const stamp = Date.now();
  const dir = join(imageDir, String(versionId), String(stamp));
  mkdirSync(dir, { recursive: true });
  const out: Sample[] = [];
  for (const [i, { file: _, ...s }] of samples.entries()) {
    try {
      const res = await fetch(s.url.replace(/\/(original=true|width=\d+)\//, "/width=1024/"), { headers: ua, signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(String(res.status));
      const buf = Buffer.from(await res.arrayBuffer());
      await sharp(buf).resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toFile(join(dir, `${i}.webp`));
      await sharp(buf).resize({ width: 450, withoutEnlargement: true }).webp({ quality: 80 }).toFile(join(dir, `${i}-thumb.webp`));
      out.push({ ...s, file: `${versionId}/${stamp}/${i}` });
    } catch {
      out.push(s);
    }
    await sleep(300);
  }
  return out;
}

/** 保存した作例の画像のうち、いまの Entry が使っていないもの (前に取った分・途中で止まった分) を消す */
function pruneImages(versionId: number, entry: Entry | undefined) {
  const dir = join(imageDir, String(versionId));
  const remove = (p: string) => {
    try {
      rmSync(p, { recursive: true, force: true });
    } catch {
      /* 開いている途中などで消せなかったものは次の機会に */
    }
  };
  // 前の作りの、入れ替え用のフォルダ
  remove(`${dir}.new`);
  let list;
  try {
    list = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // まだ画像を保存していない
  }
  const used = new Set((entry?.samples ?? []).flatMap((s) => (s.file ? [s.file] : [])));
  const usedDirs = new Set([...used].map((f) => f.split("/")).flatMap((p) => (p.length === 3 ? [p[1]] : [])));
  for (const e of list) {
    // 前の作りの画像 ("{versionId}/{n}") はフォルダの直下にある
    const keep = e.isDirectory() ? usedDirs.has(e.name) : used.has(`${versionId}/${e.name.replace(/(-thumb)?\.webp$/, "")}`);
    if (!keep) remove(join(dir, e.name));
  }
}

export class RecommendStore {
  private entries: Record<string, Entry> = readJson(path, {});
  private hashes: Record<string, HashLookup> = readJson(hashPath, {});
  private queue: Job[] = [];
  /** いま処理しているもの */
  private current: Job | null = null;
  private names: ForgeNames = { samplers: [], schedulers: [] };

  constructor(
    private groq: { apiKey: string | null; model: string },
    private pinnedUsers: string[],
  ) {}

  /**
   * このモデルの推奨と作例。status は Entry の status か、
   * pending (取得待ち。付随ファイルの無いモデルはハッシュの計算から) / none (Civitai に無い) / error (ハッシュから Civitai に聞けなかった。理由は error)
   */
  view(ref: ModelRef) {
    const ids = this.idsOf(ref);
    const h = this.hashes[ref.file];
    const url = ids && `https://civitai.com/models/${ids.modelId}?modelVersionId=${ids.versionId}`;
    const saved = ids ? (this.entries[ids.versionId] ?? null) : null;
    const entry = saved && { ...saved, rec: saved.rec && tidy(saved.rec, this.names) };
    const pending = this.isQueued(ref) || (!ids && !h);
    const lookupError = !ids && h?.error ? `ハッシュから Civitai で探せませんでした (${h.error})` : null;
    const status = pending ? "pending" : lookupError ? "error" : !ids ? "none" : (saved?.status ?? "pending");
    return { status, url, entry, error: lookupError };
  }

  private idsOf(ref: ModelRef): CivitaiIds | null {
    if (ref.civitai) return ref.civitai;
    const h = this.hashes[ref.file];
    return h && this.hashFresh(ref.file, h) ? h.ids : null;
  }

  private hashFresh(file: string, h: HashLookup) {
    try {
      const st = statSync(file);
      return st.size === h.size && Math.round(st.mtimeMs) === h.mtime;
    } catch {
      return false;
    }
  }

  /** そのモデルのジョブか */
  private jobFor(j: Job, ref: ModelRef, ids: CivitaiIds | null) {
    return j.kind === "hash" ? j.file === ref.file : jobVersion(j) === ids?.versionId;
  }

  private isQueued(ref: ModelRef) {
    const ids = this.idsOf(ref);
    return [this.current, ...this.queue].some((j) => j && this.jobFor(j, ref, ids));
  }

  /**
   * まだ取っていない (か、失敗してから時間が経った) モデルを取りにいく。付随ファイルの無いものはハッシュから Civitai の ID を引く。
   * first: 開いたものを先に取る (もう列にあっても先頭へ)。LoRA は数が多いので、開いたときにだけ取る
   */
  ensure(refs: ModelRef[], names: ForgeNames | null, first = false) {
    if (names) this.names = names;
    const key = samplesKey(this.pinnedUsers);
    const jobs: Job[] = [];
    const hashJobs: Job[] = [];
    for (const ref of refs) {
      if (this.isQueued(ref)) continue;
      const ids = this.idsOf(ref);
      if (!ids) {
        const h = this.hashes[ref.file];
        // ハッシュは重い (数 GB を読む) ので、Civitai の取得より後に回す。
        // Civitai に無かったものは 1 週間後、聞けなかったもの (落ちていたなど) は 1 時間後に聞き直す (中身が変わっていなければハッシュは計算し直さない)
        const recheck = h?.error ? retryAfterError : 7 * 24 * 60 * 60_000;
        if (!h || !this.hashFresh(ref.file, h) || (!h.ids && Date.now() - h.checkedAt > recheck)) hashJobs.push({ kind: "hash", file: ref.file });
        continue;
      }
      const e = this.entries[ids.versionId];
      // キーを後から足したら、作例だけのものも取り直す
      const stale = !e || (e.status === "error" && Date.now() - e.fetchedAt > retryAfterError) || (e.status === "no-llm" && this.groq.apiKey);
      // 自動の取り直しは、作例の集め方が変わっていなければ推奨だけ (失敗のたびに作例の画像を落とし直さないよう)
      if (stale) jobs.push({ kind: "fetch", ids, keepSamples: !!e && e.samplesKey === key });
      // 作例の集め方を変える前に取ったものは、作例だけ集め直す (画像の保存も)
      else if (e.samplesKey !== key && e.status !== "gone") jobs.push({ kind: "samples", versionId: ids.versionId });
    }
    if (first) {
      const opened = refs.map((r) => [r, this.idsOf(r)] as const);
      const queued = this.queue.filter((j) => opened.some(([r, ids]) => this.jobFor(j, r, ids)));
      this.queue = [...jobs, ...hashJobs, ...queued, ...this.queue.filter((j) => !queued.includes(j))];
    } else this.queue.push(...jobs, ...hashJobs);
    void this.drain();
  }

  /** 手で取り直す (先頭に入れる)。Civitai の ID が分からないもの (ハッシュから聞けなかったもの) は聞き直すところから */
  refresh(ref: ModelRef, names: ForgeNames) {
    this.names = names;
    const ids = this.idsOf(ref);
    const job: Job = ids ? { kind: "fetch", ids } : { kind: "hash", file: ref.file };
    this.queue = [job, ...this.queue.filter((j) => !this.jobFor(j, ref, ids))];
    void this.drain();
  }

  private async drain() {
    if (this.current) return;
    try {
      for (let job = this.queue.shift(); job; job = this.queue.shift()) {
        this.current = job;
        if (job.kind === "fetch") {
          this.entries[job.ids.versionId] = await this.fetchOne(job.ids, job.keepSamples);
          // 前の画像は、保存できてから消す (保存できないまま消すと、起動し直したときに前の Entry の画像が無くなる)
          if (this.save()) pruneImages(job.ids.versionId, this.entries[job.ids.versionId]);
        } else if (job.kind === "samples") {
          const e = this.entries[job.versionId];
          if (e) {
            let saved = true;
            try {
              const version = await civitai(`https://civitai.com/api/v1/model-versions/${job.versionId}`);
              const samples = await saveSampleImages(job.versionId, await collectSamples(job.versionId, version.images ?? [], this.pinnedUsers));
              // 集めている間に取り直されていたら、そちらを残す
              if (this.entries[job.versionId] === e) {
                this.entries[job.versionId] = { ...e, samples, imagesTriedAt: Date.now(), samplesKey: samplesKey(this.pinnedUsers) };
                saved = this.save();
              }
            } catch {
              // 落ちていたら次の機会に
            }
            if (saved) pruneImages(job.versionId, this.entries[job.versionId]);
          }
        } else {
          const ids = await this.lookupHash(job.file);
          // 見つかったらそのまま取りにいく
          if (ids && !this.entries[ids.versionId]) this.queue.unshift({ kind: "fetch", ids });
        }
        // Civitai に続けて投げすぎない
        await sleep(1500);
      }
    } finally {
      this.current = null;
    }
  }

  private async lookupHash(file: string): Promise<CivitaiIds | null> {
    try {
      const st = statSync(file);
      // 中身が変わっていなければ、前に計算したハッシュで聞き直すだけにする (数 GB を読み直さないよう)
      const prev = this.hashes[file];
      const sha256 = prev && this.hashFresh(file, prev) ? prev.sha256 : await sha256File(file);
      let ids: CivitaiIds | null = null;
      let error: string | null = null;
      try {
        const v = await civitai(`https://civitai.com/api/v1/model-versions/by-hash/${sha256}`);
        if (v.modelId && v.id) ids = { modelId: Number(v.modelId), versionId: Number(v.id) };
      } catch (e) {
        // 404 は Civitai に無いモデル。それ以外 (落ちているなど) は error を付けて、1 時間後に聞き直す
        if (!(e instanceof CivitaiError && e.status === 404)) error = (e as Error).message;
      }
      this.hashes[file] = { size: st.size, mtime: Math.round(st.mtimeMs), sha256, ids, checkedAt: Date.now(), ...(error && { error }) };
      writeJson(hashPath, this.hashes);
      return ids;
    } catch {
      return null;
    }
  }

  /** keepSamples: 前に取った作例がいまの集め方のものなら、作例はそのままにする */
  private async fetchOne({ modelId, versionId }: CivitaiIds, keepSamples = false): Promise<Entry> {
    const base = { versionId, modelId, fetchedAt: Date.now() };
    const prev = this.entries[versionId];
    const key = samplesKey(this.pinnedUsers);
    let name = prev?.name ?? String(versionId);
    let samples: Sample[] | null = null;
    let imagesTriedAt = prev?.imagesTriedAt;
    try {
      const version = await civitai(`https://civitai.com/api/v1/model-versions/${versionId}`);
      const model = await civitai(`https://civitai.com/api/v1/models/${modelId}`);
      name = `${model.name ?? version.model?.name ?? ""} ${version.name ?? ""}`.trim();
      if (keepSamples && prev?.samplesKey === key) samples = prev.samples;
      else {
        samples = await saveSampleImages(versionId, await collectSamples(versionId, version.images ?? [], this.pinnedUsers));
        imagesTriedAt = Date.now();
      }
      const done = { ...base, name, samples, imagesTriedAt, samplesKey: key };
      if (!this.groq.apiKey) return { ...done, status: "no-llm", error: null, rec: null };
      const description = [htmlToText(String(model.description ?? "")), htmlToText(String(version.description ?? ""))].filter(Boolean).join("\n\n--- このバージョンの説明 ---\n");
      // Civitai のモデルの種類 (Checkpoint / LORA / LoCon / DoRA ...)
      const isLora = /lora|locon|dora|lycoris/i.test(String(model.type ?? ""));
      const trainedWords = Array.isArray(version.trainedWords) ? version.trainedWords.map(String) : [];
      const rec = await askGroq(this.groq.apiKey, this.groq.model, buildPrompt(name, description, samples, this.names, isLora, trainedWords));
      return { ...done, status: "ok", error: null, rec };
    } catch (e) {
      // 消されたモデルは取り直さない。取れなかったときは、前に取ってあった推奨と作例を残す
      const gone = e instanceof CivitaiError && e.status === 404;
      return { ...base, name, status: gone ? "gone" : "error", error: (e as Error).message, rec: prev?.rec ?? null, samples: samples ?? prev?.samples ?? [], imagesTriedAt, samplesKey: samples ? key : prev?.samplesKey };
    }
  }

  /** 保存できなければ false (次に保存するときにまとめて書く。ここで投げると裏の取得が止まり、プロセスも落ちるので) */
  private save() {
    try {
      writeJson(path, this.entries);
      return true;
    } catch (e) {
      console.warn(`${path} に保存できませんでした: ${(e as Error).message}`);
      return false;
    }
  }
}
