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
  /** "Illustrious" / "Pony" / "SD 1.5" など */
  base: string | null;
  preview: boolean;
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
  base: string | null;
  trainedWords: string[];
  preview: boolean;
}

export type ModelParams = Pick<GenerateParams, "width" | "height" | "steps" | "cfg" | "sampler" | "scheduler">;

export interface Prefs {
  favoriteCheckpoints: string[];
  favoriteLoras: string[];
  recentCheckpoints: string[];
  modelParams: Record<string, ModelParams>;
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
  /** 最後に成功したジョブ (サーバー再起動後も残る) */
  last: JobView | null;
}

export interface GalleryFile {
  path: string;
  name: string;
  date: string;
  bytes: number;
}

export interface GalleryTag {
  id: number;
  name: string;
  type: string;
  count: number;
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
  prefs: () => request<Prefs>("/api/prefs"),
  setFavorite: (kind: "checkpoint" | "lora", id: string, on: boolean) =>
    request<Prefs>("/api/prefs/favorite", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, id, on }) }),
  thumbUrl: (kind: "checkpoint" | "lora", id: string) => `/api/thumb/${kind}?id=${encodeURIComponent(id)}`,
  gallery: (opts: { cursor?: string | null; q?: string; tags?: number[]; refresh?: boolean }) => {
    const p = new URLSearchParams();
    if (opts.cursor) p.set("cursor", opts.cursor);
    if (opts.q) p.set("q", opts.q);
    if (opts.tags?.length) p.set("tags", opts.tags.join(","));
    if (opts.refresh) p.set("refresh", "1");
    return request<{ files: GalleryFile[]; next: string | null }>(`/api/gallery?${p}`);
  },
  galleryTags: () => request<{ tags: GalleryTag[] }>("/api/gallery/tags"),
  galleryInfo: (path: string) => request<{ geninfo: string; tags: GalleryTag[] }>(`/api/gallery/info?path=${encodeURIComponent(path)}`),
  toggleGalleryTag: (path: string, tagId: number) => post<{ on: boolean }>("/api/gallery/tag", { path, tagId }),
  deleteGalleryFile: (path: string) => post<{ ok: boolean }>("/api/gallery/delete", { path }),
  galleryImageUrl: (f: GalleryFile, thumb: boolean) => `/api/gallery/${thumb ? "thumb" : "file"}?path=${encodeURIComponent(f.path)}&t=${encodeURIComponent(f.date)}`,
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

/** LoRA 一覧はページを開いている間キャッシュする (失敗したら次回取り直す) */
let lorasCache: Promise<Lora[]> | null = null;
export function loadLoras(): Promise<Lora[]> {
  return (lorasCache ??= api
    .loras()
    .then((r) => r.loras)
    .catch((e) => {
      lorasCache = null;
      throw e;
    }));
}

/** ベースモデル名をバッジ用に短くする */
export function baseLabel(base: string | null) {
  if (!base) return null;
  if (/illustrious/i.test(base)) return "IL";
  if (/noob/i.test(base)) return "Noob";
  if (/pony/i.test(base)) return "Pony";
  if (/sdxl/i.test(base)) return "XL";
  if (/flux/i.test(base)) return "Flux";
  const m = /^SD ?(\d(?:\.\d)?)/i.exec(base);
  return m ? m[1] : base;
}
