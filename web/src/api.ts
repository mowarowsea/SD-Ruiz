// BFF (/api/*) の呼び出しと型

export type ForgeStatus =
  | { online: true; busy: boolean }
  | { online: false; reason: "unreachable" | "api-disabled" | "error"; detail?: string };

export interface Health {
  ok: boolean;
  forge: ForgeStatus;
}

export interface Model {
  title: string;
  name: string;
  filename: string;
}

export interface Meta {
  current: string | null;
  models: Model[];
  samplers: string[];
  schedulers: { name: string; label: string }[];
}

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
}

export interface TagHit {
  name: string;
  category: number;
  count: number;
  alias?: string;
  translation?: string;
}

export interface Lora {
  name: string;
  alias: string;
  folder: string;
}

export interface JobView {
  id: string;
  status: "running" | "done" | "error";
  params: GenerateParams;
  startedAt: number;
  finishedAt: number | null;
  imageCount: number;
  seeds: number[];
  prompts: string[];
  interrupted: boolean;
  error: string | null;
}

export interface Progress {
  ratio: number;
  eta: number;
  step: number;
  steps: number;
  preview: string | null;
}

export interface JobState {
  job: JobView | null;
  progress: Progress | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  health: () => request<Health>("/api/health"),
  meta: () => request<Meta>("/api/meta"),
  generate: (params: GenerateParams) => post<{ id: string }>("/api/generate", params),
  interrupt: () => post<{ ok: boolean }>("/api/interrupt", {}),
  job: () => request<JobState>("/api/job"),
  tags: (q: string, signal?: AbortSignal) => request<{ tags: TagHit[] }>(`/api/tags?q=${encodeURIComponent(q)}`, { signal }),
  wildcards: () => request<{ wildcards: string[] }>("/api/wildcards"),
  loras: () => request<{ loras: Lora[] }>("/api/loras"),
  imageUrl: (jobId: string, index: number) => `/api/job/${jobId}/image/${index}`,
};

/** "sd\\anime\\foo_v2.safetensors" → "foo_v2" */
export function modelLabel(title: string) {
  return title.split(/[\\/]/).pop()!.replace(/\.(safetensors|ckpt|gguf|pt)$/i, "");
}

/** "sd\\anime\\foo.safetensors" → "sd/anime" */
export function modelFolder(title: string) {
  return title.split(/[\\/]/).slice(0, -1).join("/");
}
