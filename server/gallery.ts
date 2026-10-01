// ギャラリー
//
// - ファイル一覧: 出力フォルダ (grid / 単体画像) を直接読む (IIB の検索 API は重く、ページ送りで重複も出るため)
// - タグ: IIB の DB (iib.db) を読み取り専用で参照し、付け外しは IIB の API で行う (IIB / IIB Manager と共有される)
// - サムネイル・生成情報・プロンプト検索: IIB の API
// - 削除・整理: SD-Ruiz のゴミ箱フォルダへ移動する (完全に消すのは「ゴミ箱を空にする」だけ)
//
// grid の元画像は「1 つ前の grid から、この grid までの間に保存された単体画像」とみなす (Forge は単体画像を書いたあとに grid を書く)。
// バッチ 1 の生成 (grid なし) を取り違えないよう、grid との時間差と Seed でも絞る。

import { existsSync, mkdirSync, realpathSync, renameSync, rmSync, statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ForgeError } from "./forge.js";

export type Kind = "grid" | "image";

export interface GalleryFile {
  path: string;
  name: string;
  /** 更新日時 (ms) */
  mtime: number;
  bytes: number;
}

export interface CustomTag {
  id: number;
  name: string;
}

export interface GalleryOptions {
  gridFolders: string[] | null;
  imageFolders: string[] | null;
  iibDb: string | null;
  trashDir: string | null;
}

const imageExt = /\.(png|jpe?g|webp|avif)$/i;
/** grid と元画像の保存時刻の差の上限 */
const sourceWindowMs = 2 * 60 * 1000;
/** 1 回の生成で作る枚数の上限 (Seed での絞り込み用) */
const maxBatch = 16;
const key = (p: string) => p.toLowerCase();

/** ファイル名 "00025-2534786345.png" の Seed */
function fileSeed(name: string) {
  const m = /^\d+-(\d+)/.exec(name);
  return m ? Number(m[1]) : null;
}

/** フォルダ (日付フォルダを含む) の中の画像。フォルダの更新日時が変わっていなければ前回の結果を使う */
class FolderScanner {
  private dirs = new Map<string, { mtime: number; files: GalleryFile[] }>();

  async scan(roots: string[]): Promise<GalleryFile[]> {
    const out: GalleryFile[] = [];
    const walk = async (dir: string) => {
      let st;
      try {
        st = await stat(dir);
      } catch {
        return;
      }
      const cached = this.dirs.get(dir);
      const entries = await readdir(dir, { withFileTypes: true });
      const subdirs = entries.filter((e) => e.isDirectory()).map((e) => join(dir, e.name));
      let files: GalleryFile[];
      if (cached && cached.mtime === st.mtimeMs) files = cached.files;
      else {
        files = [];
        for (const e of entries) {
          if (!e.isFile() || !imageExt.test(e.name)) continue;
          const p = join(dir, e.name);
          try {
            const s = await stat(p);
            files.push({ path: p, name: e.name, mtime: s.mtimeMs, bytes: s.size });
          } catch {
            /* 途中で消えたファイル */
          }
        }
        this.dirs.set(dir, { mtime: st.mtimeMs, files });
      }
      out.push(...files);
      for (const d of subdirs) await walk(d);
    };
    for (const r of roots) await walk(r);
    return out.sort((a, b) => b.mtime - a.mtime);
  }
}

export class Gallery {
  private readonly iib: string;
  private folders: { grid: string[]; image: string[] } | null = null;
  private readonly scanner = new FolderScanner();
  private tagCache: { at: number; map: Map<string, CustomTag[]>; all: CustomTag[] } | null = null;
  private seedCache = new Map<string, number | null>();

  constructor(
    forgeUrl: string,
    private readonly opts: GalleryOptions,
  ) {
    this.iib = `${forgeUrl}/infinite_image_browsing`;
  }

  // ---- IIB API ----

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.iib}${path}`, { signal: AbortSignal.timeout(60_000), ...init });
    } catch (e) {
      throw new ForgeError(`IIB に接続できません: ${(e as Error).message}`);
    }
    if (!res.ok) throw new ForgeError(`IIB が ${res.status} を返しました: ${path} ${(await res.text().catch(() => "")).slice(0, 300)}`, res.status);
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  private post<T>(path: string, body: unknown) {
    return this.request<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }

  /** 表示するフォルダ。設定が無ければ IIB に登録されている追加パスを grid とそれ以外に分けて使う */
  async getFolders() {
    if (this.folders) return this.folders;
    let grid = this.opts.gridFolders;
    let image = this.opts.imageFolders;
    if (!grid || !image) {
      const s = await this.request<{ extra_paths: { path: string }[] }>("/global_setting");
      const paths = s.extra_paths.map((p) => p.path);
      grid ??= paths.filter((p) => /grid/i.test(p));
      image ??= paths.filter((p) => !/grid/i.test(p));
    }
    this.folders = { grid, image };
    return this.folders;
  }

  // ---- タグ (iib.db を読み取り専用で参照) ----

  private dbPath() {
    if (!this.opts.iibDb || !existsSync(this.opts.iibDb)) throw new ForgeError("IIB の DB (iib.db) が見つかりません。config.json の forgeDir を確認してください");
    return this.opts.iibDb;
  }

  /** パス → カスタムタグ。タグを付け外ししたら invalidateTags() で捨てる */
  private tags() {
    if (this.tagCache && Date.now() - this.tagCache.at < 60_000) return this.tagCache;
    const db = new DatabaseSync(this.dbPath(), { readOnly: true });
    try {
      const all = db.prepare("SELECT id, name FROM tag WHERE type = 'custom' ORDER BY id").all() as unknown as CustomTag[];
      const rows = db
        .prepare("SELECT i.path AS path, t.id AS id, t.name AS name FROM image_tag it JOIN tag t ON t.id = it.tag_id JOIN image i ON i.id = it.image_id WHERE t.type = 'custom'")
        .all() as unknown as { path: string; id: number; name: string }[];
      const map = new Map<string, CustomTag[]>();
      for (const r of rows) {
        const k = key(r.path);
        map.set(k, [...(map.get(k) ?? []), { id: r.id, name: r.name }]);
      }
      this.tagCache = { at: Date.now(), map, all };
      return this.tagCache;
    } finally {
      db.close();
    }
  }

  invalidateTags() {
    this.tagCache = null;
  }

  customTags() {
    return this.tags().all;
  }

  tagsOf(path: string) {
    return this.tags().map.get(key(path)) ?? [];
  }

  // ---- 一覧 ----

  async files(kind: Kind) {
    const f = await this.getFolders();
    return this.scanner.scan(kind === "grid" ? f.grid : f.image);
  }

  /**
   * 新しい順に 1 ページ分。tag: カスタムタグ ID か "none" (タグなし)。q: プロンプトの部分一致 (IIB で検索)
   * cursor は「何件目から」
   */
  async list(opts: { kind: Kind; offset: number; limit: number; tag?: number | "none"; q?: string }) {
    let files = await this.files(opts.kind);
    if (opts.tag === "none") files = files.filter((f) => this.tagsOf(f.path).length === 0);
    else if (opts.tag !== undefined) files = files.filter((f) => this.tagsOf(f.path).some((t) => t.id === opts.tag));
    if (opts.q) {
      const hits = await this.search(opts.kind, opts.q);
      files = files.filter((f) => hits.has(key(f.path)));
    }
    const page = files.slice(opts.offset, opts.offset + opts.limit);
    return {
      files: page.map((f) => ({ ...f, tags: this.tagsOf(f.path) })),
      next: opts.offset + opts.limit < files.length ? opts.offset + opts.limit : null,
      total: files.length,
    };
  }

  /** IIB の索引からプロンプトなどの部分一致で探す (該当パスの集合を返す) */
  private async search(kind: Kind, q: string) {
    const folder_paths = (await this.getFolders())[kind];
    const hits = new Set<string>();
    let cursor = "";
    for (let i = 0; i < 20; i++) {
      const r = await this.post<{ files: { fullpath: string }[]; cursor: { has_next: boolean; next: string } }>("/db/search_by_substr", {
        surstr: q,
        cursor,
        folder_paths,
        size: 1000,
        path_only: false,
        media_type: "image",
      });
      for (const f of r.files) hits.add(key(f.fullpath));
      if (!r.cursor.has_next || r.cursor.next === cursor) break;
      cursor = r.cursor.next;
    }
    return hits;
  }

  // ---- grid と元画像 ----

  private async gridSeed(gridPath: string) {
    if (this.seedCache.has(gridPath)) return this.seedCache.get(gridPath)!;
    const info = await this.geninfo(gridPath).catch(() => "");
    const m = /\bSeed:\s*(\d+)/.exec(info);
    const seed = m ? Number(m[1]) : null;
    this.seedCache.set(gridPath, seed);
    return seed;
  }

  /** grid の元画像 (useSeed: grid の Seed でも絞る。整理のときは取りこぼさないよう false で広めに取る) */
  async sources(gridPath: string, useSeed = true): Promise<GalleryFile[]> {
    const grids = await this.files("grid");
    const images = await this.files("image");
    const i = grids.findIndex((g) => key(g.path) === key(gridPath));
    if (i === -1) return [];
    const grid = grids[i];
    const prev = grids[i + 1]?.mtime ?? 0; // 新しい順なので 1 つ後ろが直前の grid
    let found = images.filter((img) => img.mtime > prev && img.mtime <= grid.mtime + 1000 && grid.mtime - img.mtime <= sourceWindowMs);
    if (useSeed) {
      const seed = await this.gridSeed(grid.path);
      if (seed !== null) found = found.filter((img) => {
        const s = fileSeed(img.name);
        return s === null || (s >= seed && s < seed + maxBatch);
      });
    }
    return found.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** 単体画像からそれを含む grid を探す (保存時刻の直後にある grid) */
  private gridOf(img: GalleryFile, gridsAsc: GalleryFile[]) {
    const g = gridsAsc.find((x) => x.mtime + 1000 >= img.mtime);
    return g && g.mtime - img.mtime <= sourceWindowMs ? g : null;
  }

  // ---- 詳細・タグ付け ----

  geninfo(path: string) {
    return this.request<string>(`/image_geninfo?path=${encodeURIComponent(path)}`).then((s) => s ?? "");
  }

  async info(path: string, kind: Kind) {
    const [geninfo, sources] = await Promise.all([this.geninfo(path), kind === "grid" ? this.sources(path) : Promise.resolve([])]);
    return { geninfo, tags: this.tagsOf(path), sources };
  }

  /** タグの付け外し。grid のときは元画像にも同じように付け外しする */
  async toggleTag(path: string, tagId: number, kind: Kind) {
    const on = !this.tagsOf(path).some((t) => t.id === tagId);
    const paths = [path, ...(kind === "grid" ? (await this.sources(path)).map((s) => s.path) : [])];
    await this.post("/db/batch_update_image_tag", { img_paths: paths, action: on ? "add" : "remove", tag_id: tagId });
    this.invalidateTags();
    return { on, count: paths.length };
  }

  // ---- 削除・整理 (ゴミ箱フォルダへの移動) ----

  /** ゴミ箱フォルダ。設定が無ければ単体画像フォルダの実体の隣 (同じドライブなので移動は一瞬) */
  async trashDir() {
    if (this.opts.trashDir) return this.opts.trashDir;
    const first = (await this.getFolders()).image[0];
    if (!first) throw new ForgeError("ゴミ箱フォルダを決められません (config.json の trashDir を設定してください)");
    return join(dirname(realpathSync(first)), "SD-Ruiz-Trash");
  }

  private async moveToTrash(paths: string[], label: string) {
    const f = await this.getFolders();
    const roots = [...f.grid, ...f.image];
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const dest = join(await this.trashDir(), `${stamp}-${label}`);
    let moved = 0;
    let bytes = 0;
    for (const p of paths) {
      const root = roots.find((r) => key(p).startsWith(key(r) + "\\") || key(p).startsWith(key(r) + "/"));
      if (!root) continue; // 管理しているフォルダの外は触らない
      const to = join(dest, basename(root), relative(root, p));
      try {
        const size = statSync(p).size;
        mkdirSync(dirname(to), { recursive: true });
        renameSync(p, to);
        moved++;
        bytes += size;
      } catch {
        /* 使用中などで動かせなかったものは残す */
      }
    }
    return { moved, bytes };
  }

  /** 1 枚 (grid なら元画像ごと) をゴミ箱へ */
  async remove(path: string, kind: Kind) {
    const paths = [path, ...(kind === "grid" ? (await this.sources(path)).map((s) => s.path) : [])];
    return this.moveToTrash(paths, "delete");
  }

  /**
   * 整理の対象: タグの付いていない grid と単体画像。ただし
   * - タグ付きの grid の元画像、タグ付きの単体画像を含む grid は残す
   * - keepSince より新しいもの (今日の分など) は残す
   */
  async cleanupTargets(keepSince: number) {
    this.invalidateTags();
    const grids = await this.files("grid");
    const images = await this.files("image");
    const gridsAsc = [...grids].sort((a, b) => a.mtime - b.mtime);
    const tagged = (f: GalleryFile) => this.tagsOf(f.path).length > 0;

    const keep = new Set<string>();
    for (const g of grids.filter(tagged)) {
      keep.add(key(g.path));
      for (const s of await this.sources(g.path, false)) keep.add(key(s.path));
    }
    for (const img of images.filter(tagged)) {
      keep.add(key(img.path));
      const g = this.gridOf(img, gridsAsc);
      if (g) keep.add(key(g.path));
    }
    const target = (f: GalleryFile) => f.mtime < keepSince && !keep.has(key(f.path));
    const g = grids.filter(target);
    const i = images.filter(target);
    return { grids: g, images: i, bytes: [...g, ...i].reduce((s, f) => s + f.bytes, 0), keptGrids: grids.length - g.length, keptImages: images.length - i.length };
  }

  async cleanup(keepSince: number) {
    const t = await this.cleanupTargets(keepSince);
    return this.moveToTrash([...t.grids, ...t.images].map((f) => f.path), "cleanup");
  }

  async trashInfo() {
    const dir = await this.trashDir();
    if (!existsSync(dir)) return { dir, files: 0, bytes: 0 };
    let files = 0;
    let bytes = 0;
    for (const e of await readdir(dir, { recursive: true, withFileTypes: true })) {
      if (!e.isFile()) continue;
      files++;
      bytes += statSync(join(e.parentPath, e.name)).size;
    }
    return { dir, files, bytes };
  }

  /** ゴミ箱を空にする (ここだけは完全に消える) */
  async emptyTrash() {
    const dir = await this.trashDir();
    rmSync(dir, { recursive: true, force: true });
  }

  /** サムネイル / 元画像をそのまま流す */
  fetchImage(path: string, mtime: string, thumb: boolean) {
    const q = `path=${encodeURIComponent(path)}&t=${encodeURIComponent(mtime)}`;
    return fetch(`${this.iib}${thumb ? `/image-thumbnail?${q}&size=512x512` : `/file?${q}`}`);
  }
}
