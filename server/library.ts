// Checkpoint / LoRA ファイルの横にある付随ファイル (プレビュー画像・Civitai のメタデータ) を読む

import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

export interface Sidecar {
  /** "Illustrious" / "Pony" / "SDXL 1.0" など。分からなければ null */
  base: string | null;
  trainedWords: string[];
  preview: string | null;
  /** モデルファイルの更新日時 (ms)。ダウンロードした日の目安 */
  mtime: number;
}

// StabilityMatrix / Forge / Civitai Helper が置くプレビュー画像の名前
const previewSuffixes = [".preview.png", ".preview.jpeg", ".preview.jpg", ".preview.webp", ".png", ".jpeg", ".jpg", ".webp", ".thumb.jpg"];

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function asWords(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((w): w is string => typeof w === "string" && w.trim() !== "").map((w) => w.trim());
  return [];
}

/** メタデータが無いときに safetensors のヘッダ (テンソル名) からアーキテクチャを推定する */
function guessBase(modelPath: string): string | null {
  if (!modelPath.endsWith(".safetensors")) return null;
  let fd: number | undefined;
  try {
    fd = openSync(modelPath, "r");
    const lenBuf = Buffer.alloc(8);
    readSync(fd, lenBuf, 0, 8, 0);
    const len = Number(lenBuf.readBigUInt64LE());
    if (len <= 0 || len > 64 * 1024 * 1024) return null;
    const head = Buffer.alloc(len);
    readSync(fd, head, 0, len, 8);
    const text = head.toString("utf8");
    const meta = (JSON.parse(text).__metadata__ ?? {}) as Record<string, string>;
    const v = meta.ss_base_model_version ?? "";
    if (/sdxl/i.test(v)) return "SDXL";
    if (/sd_?v?1/i.test(v)) return "SD 1.5";
    if (/flux/i.test(v)) return "Flux";
    if (/anima/i.test(v)) return "Anima";
    if (text.includes("double_blocks")) return "Flux";
    // Anima (Cosmos-Predict2 系の DiT)。Checkpoint は llm_adapter、LoRA は blocks.N.self_attn.q_proj (kohya 形式は _ 区切り) で見分ける
    if (text.includes("llm_adapter") || /blocks[._]\d+[._](self|cross)_attn[._][qkv]_proj/.test(text)) return "Anima";
    if (text.includes("joint_blocks")) return "SD 3";
    if (text.includes("conditioner.embedders.1") || text.includes("lora_te2_")) return "SDXL";
    if (text.includes("cond_stage_model.") || text.includes("lora_te_")) return "SD 1.5";
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

const stemOf = (modelPath: string) => modelPath.replace(/\.(safetensors|ckpt|pt|gguf)$/i, "");

export function readSidecar(modelPath: string): Sidecar {
  const stem = stemOf(modelPath);
  const preview = previewSuffixes.map((s) => stem + s).find((p) => existsSync(p)) ?? null;
  // StabilityMatrix の cm-info.json を優先し、無ければ Civitai Helper の civitai.info
  const cm = readJson(`${stem}.cm-info.json`);
  const civ = cm ? null : readJson(`${stem}.civitai.info`);
  const declared = (cm?.BaseModel ?? civ?.baseModel) as string | undefined;
  const base = declared && !/^(other|unknown)$/i.test(declared) ? declared : (guessBase(modelPath) ?? declared ?? null);
  const trainedWords = asWords(cm ? cm.TrainedWords : civ?.trainedWords);
  let mtime = 0;
  try {
    mtime = statSync(modelPath).mtimeMs;
  } catch {
    /* 消えたファイルは 0 (一覧の最後) */
  }
  return { base, trainedWords, preview, mtime };
}

/** モデル一覧ごとに付随ファイルを読むのは重いので、パス単位で覚えておく (メタ再取得のときに作り直す) */
export class SidecarCache {
  private map = new Map<string, Sidecar>();
  get(path: string) {
    let s = this.map.get(path);
    if (!s) this.map.set(path, (s = readSidecar(path)));
    return s;
  }
  clear() {
    this.map.clear();
  }
}

const thumbDir = fileURLToPath(new URL("../cache/thumbs", import.meta.url));

/** プレビュー画像を一覧用に縮小した webp を返す (元画像の更新日時ごとにディスクへキャッシュ) */
export async function thumbnail(previewPath: string, width = 384): Promise<Buffer> {
  const { mtimeMs } = statSync(previewPath);
  const key = createHash("sha1").update(`${previewPath}|${mtimeMs}|${width}`).digest("hex");
  const cached = `${thumbDir}/${key}.webp`;
  if (existsSync(cached)) return readFile(cached);
  const buf = await sharp(previewPath).resize({ width, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  mkdirSync(thumbDir, { recursive: true });
  await writeFile(cached, buf);
  return buf;
}

/**
 * モデルファイルを付随ファイル (プレビュー・メタデータ) ごとゴミ箱フォルダの dest/ へ移す。
 * 付随ファイルは名前が決まっているものだけ (「foo.」で始まる別のモデル foo.v2.safetensors を巻き込まない)
 */
export async function moveModelToTrash(modelPath: string, dest: string) {
  const stem = stemOf(modelPath);
  const sidecars = [...previewSuffixes, ".cm-info.json", ".civitai.info", ".json"].map((s) => stem + s).filter((p) => p !== modelPath && existsSync(p));
  // 同じ名前を前にも捨てていたら日時を付けたフォルダに分ける
  if (existsSync(join(dest, basename(modelPath)))) dest = join(dest, new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));
  await mkdir(dest, { recursive: true });
  // 本体を先に動かす。読み込み中で動かせなければここで失敗し、付随ファイルも残る
  for (const p of [modelPath, ...sidecars]) {
    const to = join(dest, basename(p));
    try {
      await rename(p, to);
    } catch (e) {
      // 別のドライブなら rename できないので、コピーしてから消す
      if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
      await copyFile(p, to);
      await unlink(p);
    }
  }
  return { files: 1 + sidecars.length };
}
