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

export type GalleryKind = "grid" | "image";

export interface GalleryTag {
  id: number;
  name: string;
}

export interface GalleryFile {
  path: string;
  name: string;
  /** 更新日時 (ms) */
  mtime: number;
  bytes: number;
  /** 保管庫 (Saved) にあるもの (タグ付き) */
  saved?: boolean;
  /** Grid 表示で grid として出すもの (元画像が sources に付く)。grid の無い単体画像は false */
  grid?: boolean;
  sources?: GalleryFile[];
  tags?: GalleryTag[];
}

export interface GalleryInfo {
  geninfo: string;
  tags: GalleryTag[];
  /** grid の元画像 */
  sources: GalleryFile[];
}

export interface CleanupPreview {
  grids: number;
  images: number;
  bytes: number;
  keptGrids: number;
  keptImages: number;
  /** 出力フォルダに残っているタグ付き (保管庫を使う前に IIB で付けた分) */
  taggedGrids: number;
  taggedImages: number;
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
  gallery: (opts: { kind: GalleryKind; offset?: number; q?: string; tag?: number | "none" | "any" | null }) => {
    const p = new URLSearchParams({ kind: opts.kind });
    if (opts.offset) p.set("offset", String(opts.offset));
    if (opts.q) p.set("q", opts.q);
    if (opts.tag !== undefined && opts.tag !== null) p.set("tag", String(opts.tag));
    return request<{ files: GalleryFile[]; next: number | null; total: number }>(`/api/gallery?${p}`);
  },
  galleryTags: () => request<{ tags: GalleryTag[] }>("/api/gallery/tags"),
  galleryInfo: (path: string, kind: GalleryKind) => request<GalleryInfo>(`/api/gallery/info?kind=${kind}&path=${encodeURIComponent(path)}`),
  /** タグを付けると保管庫へ移り、全部外すと出力フォルダへ戻る。付け外し後の状態 (移った先・タグ・元画像) が file で返る */
  toggleGalleryTag: (path: string, kind: GalleryKind, tagId: number) => post<{ on: boolean; count: number; file: GalleryFile }>("/api/gallery/tag", { path, kind, tagId }),
  deleteGalleryFile: (path: string, kind: GalleryKind) => post<{ moved: number; bytes: number }>("/api/gallery/delete", { path, kind }),
  galleryImageUrl: (f: GalleryFile, thumb: boolean) => `/api/gallery/image/${thumb ? "thumb" : "file"}?path=${encodeURIComponent(f.path)}&t=${Math.round(f.mtime)}`,
  cleanupPreview: (keepSince: number) => post<CleanupPreview>("/api/cleanup/preview", { keepSince }),
  cleanupRun: (keepSince: number) => post<{ moved: number; bytes: number }>("/api/cleanup/run", { keepSince }),
  migrateTagged: () => post<{ moved: number }>("/api/cleanup/migrate-tagged", {}),
  trash: () => request<{ dir: string; files: number; bytes: number }>("/api/trash"),
  emptyTrash: () => post<{ ok: boolean }>("/api/trash/empty", {}),
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

export function formatBytes(n: number) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}
