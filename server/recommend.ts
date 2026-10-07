// モデルの推奨設定と作例。Civitai の説明文を LLM (Groq) で JSON にまとめ、data/recommended.json に覚えておく。
// 作例の画像も data/recommend-images/ に保存する (Civitai から消えても見られるように)

import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
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
}

/** 作者の作例 (生成情報のあるもの) */
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
  /** 手元に保存した画像 ("{versionId}/{n}"。保存できていなければ無い) */
  file?: string;
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
}

const path = fileURLToPath(new URL("../data/recommended.json", import.meta.url));
const hashPath = fileURLToPath(new URL("../data/model-hashes.json", import.meta.url));
const imageDir = fileURLToPath(new URL("../data/recommend-images", import.meta.url));
const retryAfterError = 60 * 60_000;
const ua = { "user-agent": "SD-Ruiz (personal txt2img frontend)" };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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

function toSample(img: Record<string, any>): Sample | null {
  const m = img.meta as Record<string, unknown> | null;
  if (img.type !== "image" || !m || typeof m.prompt !== "string" || m.prompt.length < 10) return null;
  return {
    url: String(img.url),
    width: Number(img.width) || 0,
    height: Number(img.height) || 0,
    nsfwLevel: Number(img.nsfwLevel) || 0,
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

/** 作例の設定を LLM に渡す形にまとめる (多いものから) */
function summarizeSamples(samples: Sample[]) {
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
  "notes": string[]
}`;

function buildPrompt(name: string, description: string, samples: Sample[], names: ForgeNames) {
  return `Stable Diffusion のモデル「${name}」の Civitai の説明文と、作者の作例の設定から、推奨の生成設定を読み取って JSON で答えてください。

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
- notes: そのほか生成に関わる大事な注意 (VAE、プロンプトの書き方、苦手なことなど) を日本語で 1 つ 40 字以内、最大 5 つ。ほかの項目 (steps / cfg / sampler / scheduler / サイズ / clip skip / hires / quality / negative) と同じことは書かない。宣伝・更新履歴・お礼・ライセンス・規約は入れない

説明文:
"""
${description.slice(0, 12_000)}
"""

${summarizeSamples(samples)}`;
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
    notes: rec.notes
      .filter((n) => !/clip ?skip|steps?\b|cfg|sampler|サンプラ|scheduler|スケジューラ|サイズ|解像度|\d+\s*[x×]\s*\d+/i.test(n))
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
  };
}

/** Checkpoint の実ファイルと、付随ファイルから読んだ Civitai の ID */
export interface ModelRef {
  file: string;
  civitai: CivitaiIds | null;
}

type Job = { kind: "fetch"; ids: CivitaiIds } | { kind: "hash"; file: string } | { kind: "images"; versionId: number };

const jobVersion = (j: Job) => (j.kind === "fetch" ? j.ids.versionId : j.kind === "images" ? j.versionId : null);

/** 保存した作例の画像 (full は長辺 1024、thumb は幅 450) のパス。名前がおかしければ null */
export function sampleImagePath(file: string, size: "full" | "thumb") {
  if (!/^\d+\/\d+$/.test(file)) return null;
  return join(imageDir, `${file}${size === "thumb" ? "-thumb" : ""}.webp`);
}

/** 作例の画像を Civitai から落として webp で保存する。落とせなかったものは file を付けない (画面では Civitai から直接読む) */
async function saveSampleImages(versionId: number, samples: Sample[]): Promise<Sample[]> {
  // 別のフォルダに落としてから入れ替える (途中で止まっても前の画像が残るように)
  const dir = join(imageDir, String(versionId));
  const tmp = `${dir}.new`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const out: Sample[] = [];
  for (const [i, { file: _, ...s }] of samples.entries()) {
    try {
      const res = await fetch(s.url.replace(/\/(original=true|width=\d+)\//, "/width=1024/"), { headers: ua, signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(String(res.status));
      const buf = Buffer.from(await res.arrayBuffer());
      const file = `${versionId}/${i}`;
      await sharp(buf).resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toFile(join(tmp, `${i}.webp`));
      await sharp(buf).resize({ width: 450, withoutEnlargement: true }).webp({ quality: 80 }).toFile(join(tmp, `${i}-thumb.webp`));
      out.push({ ...s, file });
    } catch {
      out.push(s);
    }
    await sleep(300);
  }
  rmSync(dir, { recursive: true, force: true });
  renameSync(tmp, dir);
  return out;
}

export class RecommendStore {
  private entries: Record<string, Entry> = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  private hashes: Record<string, HashLookup> = existsSync(hashPath) ? JSON.parse(readFileSync(hashPath, "utf8")) : {};
  private queue: Job[] = [];
  /** いま処理しているもの */
  private current: Job | null = null;
  private names: ForgeNames = { samplers: [], schedulers: [] };

  constructor(private groq: { apiKey: string | null; model: string }) {}

  /**
   * このモデルの推奨と作例。status は Entry の status か、
   * pending (取得待ち。付随ファイルの無いモデルはハッシュの計算から) / none (Civitai に無い)
   */
  view(ref: ModelRef) {
    const ids = this.idsOf(ref);
    const url = ids && `https://civitai.com/models/${ids.modelId}?modelVersionId=${ids.versionId}`;
    const saved = ids ? (this.entries[ids.versionId] ?? null) : null;
    const entry = saved && { ...saved, rec: saved.rec && tidy(saved.rec, this.names) };
    const pending = this.isQueued(ref) || (!ids && !this.hashes[ref.file]);
    const status = pending ? "pending" : !ids ? "none" : (saved?.status ?? "pending");
    return { status, url, entry };
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

  private isQueued(ref: ModelRef) {
    const ids = this.idsOf(ref);
    return [this.current, ...this.queue].some((j) => j && (j.kind === "hash" ? j.file === ref.file : jobVersion(j) === ids?.versionId));
  }

  /** まだ取っていない (か、失敗してから時間が経った) モデルを取りにいく。付随ファイルの無いものはハッシュから Civitai の ID を引く */
  ensure(refs: ModelRef[], names: ForgeNames) {
    this.names = names;
    const hashJobs: Job[] = [];
    for (const ref of refs) {
      if (this.isQueued(ref)) continue;
      const ids = this.idsOf(ref);
      if (!ids) {
        const h = this.hashes[ref.file];
        // ハッシュは重い (数 GB を読む) ので、Civitai の取得より後に回す。Civitai に無かったものは 1 週間後に引き直す
        if (!h || !this.hashFresh(ref.file, h) || (!h.ids && Date.now() - h.checkedAt > 7 * 24 * 60 * 60_000)) hashJobs.push({ kind: "hash", file: ref.file });
        continue;
      }
      const e = this.entries[ids.versionId];
      // キーを後から足したら、作例だけのものも取り直す
      const stale = !e || (e.status === "error" && Date.now() - e.fetchedAt > retryAfterError) || (e.status === "no-llm" && this.groq.apiKey);
      if (stale) this.queue.push({ kind: "fetch", ids });
      // 画像を保存するようになる前に取ったものは、画像だけ落とす
      else if (!e.imagesTriedAt && e.samples.length) this.queue.push({ kind: "images", versionId: ids.versionId });
    }
    this.queue.push(...hashJobs);
    void this.drain();
  }

  /** 手で取り直す (先頭に入れる) */
  refresh(ref: ModelRef, names: ForgeNames) {
    this.names = names;
    const ids = this.idsOf(ref);
    if (!ids) return;
    this.queue = [{ kind: "fetch", ids }, ...this.queue.filter((j) => jobVersion(j) !== ids.versionId)];
    void this.drain();
  }

  private async drain() {
    if (this.current) return;
    try {
      for (let job = this.queue.shift(); job; job = this.queue.shift()) {
        this.current = job;
        if (job.kind === "fetch") {
          this.entries[job.ids.versionId] = await this.fetchOne(job.ids);
          this.save();
        } else if (job.kind === "images") {
          const e = this.entries[job.versionId];
          if (e) {
            const samples = await saveSampleImages(job.versionId, e.samples);
            // 落としている間に取り直されていたら、そちらを残す
            if (this.entries[job.versionId] === e) {
              this.entries[job.versionId] = { ...e, samples, imagesTriedAt: Date.now() };
              this.save();
            }
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
      const sha256 = await sha256File(file);
      let ids: CivitaiIds | null = null;
      try {
        const v = await civitai(`https://civitai.com/api/v1/model-versions/by-hash/${sha256}`);
        if (v.modelId && v.id) ids = { modelId: Number(v.modelId), versionId: Number(v.id) };
      } catch (e) {
        // 404 は Civitai に無いモデル。それ以外 (落ちているなど) は記録せずに次の機会に
        if (!(e instanceof CivitaiError && e.status === 404)) return null;
      }
      this.hashes[file] = { size: st.size, mtime: Math.round(st.mtimeMs), sha256, ids, checkedAt: Date.now() };
      mkdirSync(dirname(hashPath), { recursive: true });
      writeFileSync(hashPath, JSON.stringify(this.hashes, null, 2));
      return ids;
    } catch {
      return null;
    }
  }

  private async fetchOne({ modelId, versionId }: CivitaiIds): Promise<Entry> {
    const base = { versionId, modelId, fetchedAt: Date.now() };
    const prev = this.entries[versionId];
    let name = prev?.name ?? String(versionId);
    let samples: Sample[] | null = null;
    try {
      const version = await civitai(`https://civitai.com/api/v1/model-versions/${versionId}`);
      const model = await civitai(`https://civitai.com/api/v1/models/${modelId}`);
      name = `${model.name ?? version.model?.name ?? ""} ${version.name ?? ""}`.trim();
      samples = await saveSampleImages(versionId, ((version.images ?? []) as Record<string, any>[]).map(toSample).filter((s): s is Sample => !!s));
      const done = { ...base, name, samples, imagesTriedAt: Date.now() };
      if (!this.groq.apiKey) return { ...done, status: "no-llm", error: null, rec: null };
      const description = [htmlToText(String(model.description ?? "")), htmlToText(String(version.description ?? ""))].filter(Boolean).join("\n\n--- このバージョンの説明 ---\n");
      const rec = await askGroq(this.groq.apiKey, this.groq.model, buildPrompt(name, description, samples, this.names));
      return { ...done, status: "ok", error: null, rec };
    } catch (e) {
      // 消されたモデルは取り直さない。取れなかったときは、前に取ってあった推奨と作例を残す
      const gone = e instanceof CivitaiError && e.status === 404;
      return { ...base, name, status: gone ? "gone" : "error", error: (e as Error).message, rec: prev?.rec ?? null, samples: samples ?? prev?.samples ?? [], imagesTriedAt: samples ? Date.now() : prev?.imagesTriedAt };
    }
  }

  private save() {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(this.entries, null, 2));
  }
}
