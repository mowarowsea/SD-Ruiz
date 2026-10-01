// Checkpoint / LoRA ファイルの横にある付随ファイル (プレビュー画像・Civitai のメタデータ) を読む

import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

export interface Sidecar {
  /** "Illustrious" / "Pony" / "SDXL 1.0" など。分からなければ null */
  base: string | null;
  trainedWords: string[];
  preview: string | null;
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
    if (text.includes("double_blocks")) return "Flux";
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

export function readSidecar(modelPath: string): Sidecar {
  const stem = modelPath.replace(/\.(safetensors|ckpt|pt|gguf)$/i, "");
  const preview = previewSuffixes.map((s) => stem + s).find((p) => existsSync(p)) ?? null;
  // StabilityMatrix の cm-info.json を優先し、無ければ Civitai Helper の civitai.info
  const cm = readJson(`${stem}.cm-info.json`);
  const civ = cm ? null : readJson(`${stem}.civitai.info`);
  const declared = (cm?.BaseModel ?? civ?.baseModel) as string | undefined;
  const base = declared && !/^(other|unknown)$/i.test(declared) ? declared : (guessBase(modelPath) ?? declared ?? null);
  const trainedWords = asWords(cm ? cm.TrainedWords : civ?.trainedWords);
  return { base, trainedWords, preview };
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
