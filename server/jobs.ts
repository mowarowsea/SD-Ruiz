// 生成ジョブの管理。Forge は 1 件ずつしか生成しないので、ジョブも同時に 1 件だけ持つ。
// スマホの画面を閉じても生成は BFF 側で走り続け、再度開いたときに結果を取りに来られる。

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ForgeClient, Txt2ImgRequest } from "./forge.js";

export interface GenerateParams {
  checkpoint: string;
  prompt: string;
  negative: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  seed: number;
  batch: number;
  save: boolean;
}

export interface Job {
  id: string;
  status: "running" | "done" | "error";
  params: GenerateParams;
  /** Forge の「VAE / Text Encoder」に渡したファイル名 (Checkpoint とベースモデルの設定から決まる) */
  modules: string[];
  startedAt: number;
  finishedAt?: number;
  images: Buffer[];
  seeds: number[];
  /** Dynamic Prompts 展開後の実際のプロンプト */
  prompts: string[];
  interrupted: boolean;
  error?: string;
}

export class JobBusyError extends Error {}

// 最後に成功したジョブは data/last/ に保存し、サーバーを再起動しても復元する
const lastDir = fileURLToPath(new URL("../data/last", import.meta.url));

function saveLast(job: Job) {
  rmSync(lastDir, { recursive: true, force: true });
  mkdirSync(lastDir, { recursive: true });
  job.images.forEach((img, i) => writeFileSync(`${lastDir}/${i}.png`, img));
  const { images: _images, ...meta } = job;
  writeFileSync(`${lastDir}/job.json`, JSON.stringify(meta, null, 2));
}

function loadLast(): Job | null {
  try {
    if (!existsSync(`${lastDir}/job.json`)) return null;
    const meta = JSON.parse(readFileSync(`${lastDir}/job.json`, "utf8")) as Omit<Job, "images">;
    const count = readdirSync(lastDir).filter((f) => /^\d+\.png$/.test(f)).length;
    const images = Array.from({ length: count }, (_, i) => readFileSync(`${lastDir}/${i}.png`));
    return { ...meta, modules: meta.modules ?? [], images };
  } catch {
    return null;
  }
}

export class JobManager {
  private job: Job | null = null;
  /** 最後に画像ができたジョブ (中断でも 1 枚以上できていれば成功扱い) */
  private lastSuccess: Job | null = loadLast();

  constructor(private readonly forge: ForgeClient) {}

  get current() {
    return this.job;
  }

  get last() {
    return this.lastSuccess;
  }

  /** 画像を引くときは実行中 / 直近のジョブと、最後に成功したジョブの両方から探す */
  find(id: string) {
    return [this.job, this.lastSuccess].find((j) => j?.id === id) ?? null;
  }

  start(params: GenerateParams, modules: string[]): Job {
    if (this.job?.status === "running") throw new JobBusyError("生成中です");
    const job: Job = { id: randomUUID(), status: "running", params, modules, startedAt: Date.now(), images: [], seeds: [], prompts: [], interrupted: false };
    this.job = job;
    void this.run(job);
    return job;
  }

  async interrupt() {
    if (this.job?.status !== "running") return;
    this.job.interrupted = true;
    await this.forge.interrupt();
  }

  private async run(job: Job) {
    const p = job.params;
    const req: Txt2ImgRequest = {
      prompt: p.prompt,
      negative_prompt: p.negative,
      width: p.width,
      height: p.height,
      steps: p.steps,
      cfg_scale: p.cfg,
      sampler_name: p.sampler,
      scheduler: p.scheduler,
      seed: p.seed,
      // 枚数は 1 枚ずつ n_iter で作る。batch_size を増やすと、LLM 系の TE (Anima) でプロンプトの長さが画像ごとに違うときに Forge が落ちる (forge-knowledge の llm-te-batch-stack)
      batch_size: 1,
      n_iter: p.batch,
      save_images: p.save,
      // Checkpoint と TE / VAE は生成時に切り替え、そのまま Forge 側の選択として残す。
      // TE / VAE は要らないモデルでも [] を毎回送る (送らないと前に使った Anima の TE / VAE が残る)。
      // dp_write_raw_template: 書いたままのプロンプトを PNG に Template として残す (# のコメントは Dynamic Prompts が消すため、これが無いと to t2i で戻せない)
      // samples_filename_pattern / grid_extended_filename: grid と元画像の名前の末尾に同じ生成 ID (job_timestamp) を付け、ギャラリーで紐付ける
      //   ("00123-<seed>-20261004153012.png" と "grid-0020-<seed>-20261004153012.jpg")
      override_settings: {
        sd_model_checkpoint: p.checkpoint,
        forge_additional_modules: job.modules,
        dp_write_raw_template: true,
        samples_filename_pattern: "[seed]-[job_timestamp]",
        grid_extended_filename: true,
      },
      override_settings_restore_afterwards: false,
    };
    try {
      const res = await this.forge.txt2img(req);
      const info = JSON.parse(res.info) as { all_seeds?: number[]; all_prompts?: string[] };
      job.images = res.images.map((b64) => Buffer.from(b64, "base64"));
      job.seeds = info.all_seeds ?? [];
      job.prompts = info.all_prompts ?? [];
      job.status = "done";
      if (job.images.length) {
        job.finishedAt = Date.now();
        this.lastSuccess = job;
        saveLast(job);
      }
    } catch (e) {
      job.status = "error";
      job.error = (e as Error).message;
    } finally {
      job.finishedAt = Date.now();
    }
  }
}
