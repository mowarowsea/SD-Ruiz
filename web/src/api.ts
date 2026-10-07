// BFF (/api/*) の呼び出しと型

export type ForgeStatus =
  | { online: true; busy: boolean }
  | { online: false; reason: "unreachable" | "api-disabled" | "error"; detail?: string };

export interface Health {
  ok: boolean;
  forge: ForgeStatus;
  /** 起動を頼んでから、まだ応答が無い */
  starting: boolean;
  /** LocalLauncher 経由で起動できる */
  launcher: boolean;
}

export interface Finding {
  id: string;
  title: string;
  level: "crash" | "warn" | "info";
  cause: string;
  remedy: string;
  evidence: string[];
}

export interface ForgeSession {
  label: string;
  startedAt: number;
  endedAt: number | null;
  end: "running" | "exited" | "restarted" | "stopped";
  findings: Finding[];
  tail: string[];
}

export interface Diagnosis {
  status: ForgeStatus;
  logError: string | null;
  sessions: ForgeSession[];
  memory: { ramTotal: number; ramFree: number; commitLimit: number; commitFree: number; forgePid: number | null; forgeBytes: number | null; top: { name: string; pid: number; bytes: number }[] } | null;
  warnings: Finding[];
}

export interface WildcardFile {
  name: string;
  entries: number;
  mtime: number;
}

export interface Model {
  title: string;
  name: string;
  /** "Illustrious" / "Pony" / "SD 1.5" など */
  base: string | null;
  /** 設定をまとめる単位にそろえたベースモデル名 ("Illustrious" / "Pony" / "SDXL" / "Anima" ...) */
  family: string | null;
  /** 中身の構造 ("sdxl" / "sd1" / "anima" ...)。同じなら LoRA が使える */
  arch: string | null;
  preview: boolean;
  /** ファイルの更新日時 (ms) */
  mtime: number;
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

export interface Range {
  min: number | null;
  max: number | null;
  best: number | null;
}

/** Civitai の説明文から LLM で読み取ったモデルの推奨設定 */
export interface Recommendation {
  steps: Range | null;
  cfg: Range | null;
  /** Forge の名前 (合うものが無ければ原文のまま) */
  samplers: string[];
  schedulers: string[];
  /** "832x1216" */
  sizes: string[];
  clipSkip: number | null;
  hires: string | null;
  quality: string | null;
  negative: string | null;
  notes: string[];
}

/** 作者の作例 (生成情報のあるもの) */
export interface Sample {
  url: string;
  width: number;
  height: number;
  nsfwLevel: number;
  prompt: string;
  negative: string;
  steps: number | null;
  cfg: number | null;
  sampler: string | null;
  scheduler: string | null;
  seed: number | null;
  clipSkip: number | null;
  /** BFF に保存した画像 (無ければ Civitai から直接読む) */
  file?: string;
}

export interface RecommendView {
  /** pending: 取得待ち / none: Civitai に無い / gone: Civitai から消えている / no-llm: Groq のキーが無いので作例だけ */
  status: "ok" | "no-llm" | "gone" | "error" | "pending" | "none";
  url: string | null;
  entry: { name: string; fetchedAt: number; error: string | null; rec: Recommendation | null; samples: Sample[]; imagesTriedAt?: number } | null;
}

export interface TagHit {
  name: string;
  category: number;
  count: number;
  alias?: string;
  translation?: string;
  /** 訳を自分で直したもの */
  edited?: boolean;
  /** タグの CSV に無い語 */
  unknown?: boolean;
}

export interface Lora {
  name: string;
  alias: string;
  folder: string;
  base: string | null;
  family: string | null;
  arch: string | null;
  trainedWords: string[];
  preview: boolean;
  mtime: number;
}

export type ModelParams = Pick<GenerateParams, "width" | "height" | "steps" | "cfg" | "sampler" | "scheduler">;

/** ベースモデルごとの既定。custom は自分で変えた項目 (変えていなければ組み込みの既定) */
export interface BaseSettings {
  params: ModelParams | null;
  modules: string[];
  custom: { params: boolean; modules: boolean };
}

export interface Prefs {
  favoriteCheckpoints: string[];
  favoriteLoras: string[];
  recentCheckpoints: string[];
  modelParams: Record<string, ModelParams>;
  modelModules: Record<string, string[]>;
  bases: Record<string, BaseSettings>;
}

/** ベースモデルの既定 (組み込みも自分の設定も無ければ空) */
export function baseSettingsOf(prefs: Prefs | null, family: string | null): BaseSettings {
  return (family && prefs?.bases[family]) || { params: null, modules: [], custom: { params: false, modules: false } };
}

/** TE / VAE に選べるファイル。folder は "VAE" / "text_encoder" など */
export interface ForgeModule {
  name: string;
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
  lookupTags: (names: string[], signal?: AbortSignal) =>
    request<{ tags: TagHit[] }>("/api/tags/lookup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ names }), signal }),
  translations: (q: string, edited: boolean) => request<{ tags: TagHit[]; total: number }>(`/api/tags/translations?q=${encodeURIComponent(q)}&edited=${edited ? 1 : 0}`),
  setTranslation: (name: string, text: string) =>
    request<{ tag: TagHit }>("/api/tags/translation", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, text }) }),
  wildcards: () => request<{ wildcards: string[] }>("/api/wildcards"),
  loras: () => request<{ loras: Lora[] }>("/api/loras"),
  prefs: () => request<Prefs>("/api/prefs"),
  setFavorite: (kind: "checkpoint" | "lora", id: string, on: boolean) =>
    request<Prefs>("/api/prefs/favorite", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, id, on }) }),
  /** null の項目は組み込みの既定に戻す */
  setBaseSettings: (family: string, patch: { params?: ModelParams | null; modules?: string[] | null }) =>
    request<Prefs>("/api/prefs/base", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ family, ...patch }) }),
  /** null の項目は消してベースモデルの既定に戻す */
  setModelSettings: (id: string, patch: { params?: null; modules?: string[] | null }) =>
    request<Prefs>("/api/prefs/model", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, ...patch }) }),
  modules: () => request<{ modules: ForgeModule[] }>("/api/modules"),
  recommend: (id: string) => request<RecommendView>(`/api/recommend?id=${encodeURIComponent(id)}`),
  refreshRecommend: (id: string) => post<RecommendView>("/api/recommend/refresh", { id }),
  /** 付随ファイルごとゴミ箱フォルダの models/ へ移す */
  deleteModel: (kind: "checkpoint" | "lora", id: string) => post<{ files: number }>("/api/models/delete", { kind, id }),
  /** タグの付いた画像のうち、そのモデルで生成された枚数 */
  modelUsage: (kind: "checkpoint" | "lora", id: string) => request<{ tagged: number }>(`/api/models/usage?kind=${kind}&id=${encodeURIComponent(id)}`),
  /** Forge に一覧を読み直してもらう (フォルダに足したモデルを出す) */
  refreshModels: (kind: "checkpoint" | "lora") => post<{ ok: boolean }>("/api/models/refresh", { kind }),
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
  /** 生成画面とビューアで見る用の軽い WebP (原寸の PNG は Forge の保存ファイルにある) */
  imageViewUrl: (jobId: string, index: number) => `/api/job/${jobId}/image/${index}?view=1`,
  forgeStart: () => post<{ pid: number }>("/api/forge/start", {}),
  forgeRestart: () => post<{ pid: number }>("/api/forge/restart", {}),
  forgeDiagnose: () => request<Diagnosis>("/api/forge/diagnose"),
  wildcardFiles: () => request<{ files: WildcardFile[] }>("/api/wildcards/files"),
  wildcardFile: (name: string) => request<{ name: string; text: string; mtime: number }>(`/api/wildcards/file?name=${encodeURIComponent(name)}`),
  /** mtime は開いたときの更新日時 (ほかで書き換えられていたら失敗する)。null なら新規作成 */
  saveWildcard: (name: string, text: string, mtime: number | null) =>
    request<{ name: string; mtime: number; entries: number }>("/api/wildcards/file", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, text, mtime }) }),
  renameWildcard: (from: string, to: string) => post<{ name: string }>("/api/wildcards/rename", { from, to }),
  deleteWildcard: (name: string) => post<{ ok: boolean }>("/api/wildcards/delete", { name }),
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

/** Forge に読み直してもらってから LoRA 一覧を取り直す */
export async function reloadLoras(): Promise<Lora[]> {
  await api.refreshModels("lora");
  lorasCache = null;
  return loadLoras();
}

/** 消した LoRA をキャッシュからも外す */
export function forgetLora(name: string) {
  lorasCache = lorasCache?.then((ls) => ls.filter((l) => l.name !== name)) ?? null;
}

/** ベースモデル名をバッジ用に短くする */
export function baseLabel(base: string | null) {
  if (!base) return null;
  if (/illustrious/i.test(base)) return "IL";
  if (/noob/i.test(base)) return "Noob";
  if (/pony/i.test(base)) return "Pony";
  if (/sdxl/i.test(base)) return "XL";
  if (/flux/i.test(base)) return "Flux";
  if (/anima/i.test(base)) return "Anima";
  const m = /^SD ?(\d(?:\.\d)?)/i.exec(base);
  return m ? m[1] : base;
}

export function formatBytes(n: number) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

/** 推奨の範囲を "25–30 (おすすめ 28)" の形にする。片方だけなら "15 以上" / "30 以下" */
export function formatRange(r: Range | null) {
  if (!r) return null;
  const span =
    r.min !== null && r.max !== null ? (r.min === r.max ? String(r.min) : `${r.min}–${r.max}`) : r.min !== null ? `${r.min} 以上` : r.max !== null ? `${r.max} 以下` : String(r.best);
  return r.best !== null && span !== String(r.best) ? `${span} (おすすめ ${r.best})` : span;
}

/** Civitai の画像を幅を指定して読む (original=true のままだと数 MB ある) */
export function civitaiImage(url: string, width: number) {
  return url.replace(/\/(original=true|width=\d+)\//, `/width=${width}/`);
}

/** 作例の画像。BFF に保存してあればそれを、無ければ Civitai から (v は取り直したときにキャッシュを外す用) */
export function sampleImage(s: Sample, size: "thumb" | "full", v = 0) {
  return s.file ? `/api/recommend/image?f=${encodeURIComponent(s.file)}&size=${size}&v=${v}` : civitaiImage(s.url, size === "thumb" ? 450 : 1024);
}
