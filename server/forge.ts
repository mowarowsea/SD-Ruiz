// Forge Neo REST API (/sdapi/v1/*) の薄いクライアント

import { Agent } from "undici";

export class ForgeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface ForgeModel {
  title: string;
  model_name: string;
  filename: string;
}

export interface ForgeLora {
  name: string;
  alias: string;
  path: string;
}

export interface ForgeProgress {
  progress: number;
  eta_relative: number;
  state: { job_count: number; sampling_step: number; sampling_steps: number; interrupted: boolean };
  current_image: string | null;
}

export type ForgeStatus =
  | { online: true; busy: boolean }
  | { online: false; reason: "unreachable" | "api-disabled" | "error"; detail?: string };

export interface Txt2ImgRequest {
  prompt: string;
  negative_prompt: string;
  width: number;
  height: number;
  steps: number;
  cfg_scale: number;
  sampler_name: string;
  scheduler: string;
  seed: number;
  batch_size: number;
  save_images: boolean;
  override_settings: Record<string, unknown>;
  override_settings_restore_afterwards: boolean;
}

export interface Txt2ImgResponse {
  images: string[];
  /** processed.js() の JSON 文字列 */
  info: string;
}

// txt2img は大きいバッチだと数分かかるので、undici 既定のヘッダ待ち 300 秒を外す
const longRunning = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

export class ForgeClient {
  constructor(readonly baseUrl: string) {}

  private async request<T>(path: string, init: RequestInit & { dispatcher?: Agent }): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, init);
    } catch (e) {
      throw new ForgeError(`Forge に接続できません: ${(e as Error).message}`);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new ForgeError(`Forge が ${res.status} を返しました: ${path} ${detail.slice(0, 300)}`, res.status);
    }
    return (await res.json()) as T;
  }

  get<T>(path: string, timeoutMs = 10_000): Promise<T> {
    return this.request<T>(path, { signal: AbortSignal.timeout(timeoutMs) });
  }

  post<T>(path: string, body: unknown, timeoutMs: number | null = 10_000): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      ...(timeoutMs === null ? { dispatcher: longRunning } : { signal: AbortSignal.timeout(timeoutMs) }),
    });
  }

  /** 起動しているか、API が有効か、生成中か */
  async status(): Promise<ForgeStatus> {
    try {
      const p = await this.progress(false, 3_000);
      return { online: true, busy: p.state.job_count > 0 };
    } catch (e) {
      if (!(e instanceof ForgeError)) throw e;
      // WebUI は動いているが --api 無しだと /sdapi/* が 404 になる
      if (e.status === 404) return { online: false, reason: "api-disabled" };
      if (e.status === undefined) return { online: false, reason: "unreachable" };
      return { online: false, reason: "error", detail: e.message };
    }
  }

  progress(withImage: boolean, timeoutMs = 5_000) {
    return this.get<ForgeProgress>(`/sdapi/v1/progress?skip_current_image=${!withImage}`, timeoutMs);
  }

  models() {
    return this.get<ForgeModel[]>("/sdapi/v1/sd-models");
  }

  samplers() {
    return this.get<{ name: string }[]>("/sdapi/v1/samplers");
  }

  schedulers() {
    return this.get<{ name: string; label: string }[]>("/sdapi/v1/schedulers");
  }

  loras() {
    return this.get<ForgeLora[]>("/sdapi/v1/loras", 30_000);
  }

  async currentCheckpoint(): Promise<string | null> {
    const opts = await this.get<{ sd_model_checkpoint?: string | null }>("/sdapi/v1/options");
    return opts.sd_model_checkpoint ?? null;
  }

  txt2img(req: Txt2ImgRequest) {
    return this.post<Txt2ImgResponse>("/sdapi/v1/txt2img", req, null);
  }

  async interrupt() {
    await this.post("/sdapi/v1/interrupt", {});
  }
}
