// 生成ジョブの管理。Forge は 1 件ずつしか生成しないので、ジョブも同時に 1 件だけ持つ。
// スマホの画面を閉じても生成は BFF 側で走り続け、再度開いたときに結果を取りに来られる。

import { randomUUID } from "node:crypto";
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

export class JobManager {
  private job: Job | null = null;

  constructor(private readonly forge: ForgeClient) {}

  get current() {
    return this.job;
  }

  start(params: GenerateParams): Job {
    if (this.job?.status === "running") throw new JobBusyError("生成中です");
    const job: Job = { id: randomUUID(), status: "running", params, startedAt: Date.now(), images: [], seeds: [], prompts: [], interrupted: false };
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
      batch_size: p.batch,
      save_images: p.save,
      // Checkpoint は生成時に切り替え、そのまま Forge 側の選択として残す
      override_settings: { sd_model_checkpoint: p.checkpoint },
      override_settings_restore_afterwards: false,
    };
    try {
      const res = await this.forge.txt2img(req);
      const info = JSON.parse(res.info) as { all_seeds?: number[]; all_prompts?: string[] };
      job.images = res.images.map((b64) => Buffer.from(b64, "base64"));
      job.seeds = info.all_seeds ?? [];
      job.prompts = info.all_prompts ?? [];
      job.status = "done";
    } catch (e) {
      job.status = "error";
      job.error = (e as Error).message;
    } finally {
      job.finishedAt = Date.now();
    }
  }
}
