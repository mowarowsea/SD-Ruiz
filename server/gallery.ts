// ギャラリー
//
// - ファイル一覧: 出力フォルダ (grid / 単体画像) を直接読む (IIB の検索 API は重く、ページ送りで重複も出るため)
// - タグ: IIB の DB (iib.db) を読み取り専用で参照し、付け外しは IIB の API で行う (IIB / IIB Manager と共有される)
// - サムネイル・生成情報・プロンプト検索: IIB の API
// - 削除・整理: SD-Ruiz のゴミ箱フォルダへ移動する (完全に消すのは「ゴミ箱を空にする」だけ)
// - 保管庫 (Saved): Like したものを移しておくフォルダ (Forge の「Save」ボタンの保存先と同じ)。整理の対象にはならない。
//   ここにあるものは Like 扱い。Like を外すと出力フォルダへ戻す。
//   名前は Forge の Save に合わせ、grid は "2026-10-01_grid-0020.jpg"、元画像は "<grid の名前>_<元の名前>"
//
// grid の元画像は「1 つ前の grid から、この grid までの間に保存された単体画像」とみなす (Forge は単体画像を書いたあとに grid を書く)。
// バッチ 1 の生成 (grid なし) を取り違えないよう、grid との時間差と Seed でも絞る。

import { closeSync, existsSync, mkdirSync, openSync, readSync, realpathSync, renameSync, rmSync, statSync } from "node:fs";
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
  /** 保管庫 (Saved) にあるもの */
  saved?: boolean;
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
  savedDir: string | null;
}

const imageExt = /\.(png|jpe?g|webp|avif)$/i;
/** grid と元画像の保存時刻の差の上限 */
const sourceWindowMs = 2 * 60 * 1000;
/** 1 回の生成で作る枚数の上限 (Seed での絞り込み用) */
const maxBatch = 16;
const key = (p: string) => p.toLowerCase();
const under = (p: string, root: string) => key(p).startsWith(key(root) + "\\") || key(p).startsWith(key(root) + "/");
/** 保管庫の中で grid とみなす名前 ("grid-0205.png" "2026-04-02_grid-0079.png" など) */
const isGridName = (name: string) => /(^|[_-])grid-\d+\.(png|jpe?g|webp|avif)$/i.test(name);
/** "2026-10-01_grid-0020.jpg" → 日付フォルダと残りの名前 */
const splitDay = (name: string) => {
  const m = /^(\d{4}-\d{2}-\d{2})_(.+)$/.exec(name);
  return m ? { day: m[1], rest: m[2] } : { day: null, rest: name };
};

/** 同じ名前があれば "1_" "2_" … を前に付けて空いている名前にする */
function freePath(dir: string, name: string) {
  let p = join(dir, name);
  for (let n = 1; existsSync(p); n++) p = join(dir, `${n}_${name}`);
  return p;
}

/** PNG の生成情報 (tEXt / iTXt の parameters)。先頭の方だけ読む */
function pngParameters(path: string): string | null {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(512 * 1024);
    const n = readSync(fd, buf, 0, buf.length, 0);
    let p = 8;
    while (p + 8 <= n) {
      const len = buf.readUInt32BE(p);
      const type = buf.toString("latin1", p + 4, p + 8);
      if (type === "IDAT" || type === "IEND" || p + 8 + len > n) break;
      if (type === "tEXt" || type === "iTXt") {
        const d = buf.subarray(p + 8, p + 8 + len);
        const z = d.indexOf(0);
        if (d.toString("latin1", 0, z) === "parameters") {
          if (type === "tEXt") return d.toString("latin1", z + 1);
          // iTXt: keyword(NUL) 圧縮フラグ 圧縮方式 言語(NUL) 翻訳キーワード(NUL) 本文
          let q = z + 3;
          q = d.indexOf(0, q) + 1;
          q = d.indexOf(0, q) + 1;
          return d.toString("utf8", q);
        }
      }
      p += 12 + len;
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

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

  /** 保管庫。設定が無ければ単体画像フォルダの実体の隣の Saved (Forge の「Save」の保存先) */
  async savedDir() {
    if (this.opts.savedDir) return this.opts.savedDir;
    const first = (await this.getFolders()).image[0];
    if (!first) throw new ForgeError("保管庫のフォルダを決められません (config.json の savedDir を設定してください)");
    return join(dirname(realpathSync(first)), "Saved");
  }

  private async isSaved(path: string) {
    return under(path, await this.savedDir());
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

  private likeTag() {
    return this.tags().all.find((t) => t.name === "like") ?? null;
  }

  /** ファイルのタグ。保管庫にあるものは Like が付いている扱い */
  tagsOf(path: string, saved = false) {
    const tags = this.tags().map.get(key(path)) ?? [];
    const like = saved && this.likeTag();
    return like ? [like, ...tags.filter((t) => t.id !== like.id)] : tags;
  }

  // ---- 一覧 ----

  /** 出力フォルダの grid / 単体画像 (保管庫は含まない) */
  async files(kind: Kind) {
    const f = await this.getFolders();
    return this.scanner.scan(kind === "grid" ? f.grid : f.image);
  }

  /** 保管庫の中身を grid・単体画像・grid ごとの元画像に分ける */
  private async savedIndex() {
    const dir = await this.savedDir();
    const all = (await this.scanner.scan([dir])).map((f) => ({ ...f, saved: true }));
    const grids = all.filter((f) => isGridName(f.name));
    const images = all.filter((f) => !isGridName(f.name));
    const plain = (name: string) => name.replace(/^(images_)+/i, "");
    const byName = new Map(grids.map((g) => [key(plain(g.name)), g]));
    const children = new Map<string, GalleryFile[]>();
    const orphans: GalleryFile[] = [];
    for (const img of images) {
      // "<grid の名前>_<元の名前>"。古い Save には先頭に "images_" が付いたものもある
      const name = plain(img.name);
      let parent: GalleryFile | undefined;
      for (const m of name.matchAll(/\.(png|jpe?g|webp|avif)_/gi)) {
        parent = byName.get(key(name.slice(0, m.index + m[0].length - 1)));
        if (parent) break;
      }
      if (!parent) orphans.push(img);
      else children.set(key(parent.path), [...(children.get(key(parent.path)) ?? []), img]);
    }
    return { grids, images, orphans, children };
  }

  /** 一覧に出す全件 (出力フォルダ + 保管庫)。grid 表示では grid の無い単体画像も保管庫から出す */
  private async allFiles(kind: Kind) {
    const s = await this.savedIndex();
    const saved = kind === "grid" ? [...s.grids, ...s.orphans] : s.images;
    return [...(await this.files(kind)), ...saved].sort((a, b) => b.mtime - a.mtime);
  }

  /**
   * 新しい順に 1 ページ分。tag: カスタムタグ ID か "none" (タグなし)。q: プロンプトの部分一致
   * cursor は「何件目から」
   */
  async list(opts: { kind: Kind; offset: number; limit: number; tag?: number | "none"; q?: string }) {
    let files = await this.allFiles(opts.kind);
    const tagsOf = (f: GalleryFile) => this.tagsOf(f.path, f.saved);
    if (opts.tag === "none") files = files.filter((f) => tagsOf(f).length === 0);
    else if (opts.tag !== undefined) files = files.filter((f) => tagsOf(f).some((t) => t.id === opts.tag));
    if (opts.q) {
      const q = opts.q.toLowerCase();
      const hits = await this.search(opts.kind, opts.q);
      const matched = await Promise.all(files.map(async (f) => (f.saved ? (await this.savedText(f)).toLowerCase().includes(q) : hits.has(key(f.path)))));
      files = files.filter((_, i) => matched[i]);
    }
    const page = files.slice(opts.offset, opts.offset + opts.limit);
    return {
      files: page.map((f) => ({ ...f, tags: tagsOf(f) })),
      next: opts.offset + opts.limit < files.length ? opts.offset + opts.limit : null,
      total: files.length,
    };
  }

  /** 保管庫の画像の生成情報 (検索用)。保管庫は IIB の索引に入っていないので自前で読む */
  private textCache = new Map<string, { mtime: number; text: string }>();
  private async savedText(f: GalleryFile) {
    const c = this.textCache.get(f.path);
    if (c?.mtime === f.mtime) return c.text;
    let text: string | null = null;
    try {
      if (/\.png$/i.test(f.name)) text = pngParameters(f.path);
    } catch {
      /* 読めなければ IIB に頼る */
    }
    text ??= await this.geninfo(f.path).catch(() => "");
    this.textCache.set(f.path, { mtime: f.mtime, text });
    return text;
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
    if (await this.isSaved(gridPath)) {
      if (!isGridName(basename(gridPath))) return [];
      return ((await this.savedIndex()).children.get(key(gridPath)) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    }
    if (!(await this.getFolders()).grid.some((r) => under(gridPath, r))) return [];
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

  async info(path: string) {
    const [geninfo, sources] = await Promise.all([this.geninfo(path), this.sources(path)]);
    return { geninfo, tags: this.tagsOf(path, await this.isSaved(path)), sources };
  }

  /**
   * タグの付け外し。grid のときは元画像にも同じように付け外しする
   * Like は保管庫への出し入れになる (付けると grid と元画像を保管庫へ移し、外すと出力フォルダへ戻す)。移した先は file で返す
   */
  async toggleTag(path: string, tagId: number) {
    const saved = await this.isSaved(path);
    const paths = [path, ...(await this.sources(path)).map((s) => s.path)];
    if (tagId === this.likeTag()?.id) {
      const file = saved ? await this.unsave(path, paths) : await this.save(path, paths);
      return { on: !saved, count: paths.length, file };
    }
    const on = !this.tagsOf(path).some((t) => t.id === tagId);
    await this.post("/db/batch_update_image_tag", { img_paths: paths, action: on ? "add" : "remove", tag_id: tagId });
    this.invalidateTags();
    return { on, count: paths.length, file: null };
  }

  // ---- 保管庫への出し入れ ----

  /** ファイルを移し、付いていたタグを移動先にも付け直す (Like は保管庫にあること自体で表すので付けない) */
  private async relocate(moves: { from: string; to: string }[]) {
    const like = this.likeTag();
    const retag = new Map<number, string[]>();
    for (const { from, to } of moves) {
      mkdirSync(dirname(to), { recursive: true });
      renameSync(from, to);
      for (const t of this.tagsOf(from)) if (t.id !== like?.id) retag.set(t.id, [...(retag.get(t.id) ?? []), to]);
    }
    for (const [tag_id, img_paths] of retag) await this.post("/db/batch_update_image_tag", { img_paths, action: "add", tag_id }).catch(() => {});
    this.invalidateTags();
  }

  private async fileAt(path: string, saved: boolean): Promise<GalleryFile> {
    const s = statSync(path);
    return { path, name: basename(path), mtime: s.mtimeMs, bytes: s.size, saved, tags: this.tagsOf(path, saved) } as GalleryFile;
  }

  /** 出力フォルダ → 保管庫。paths[0] が本体 (grid なら続きが元画像) */
  private async save(path: string, paths: string[]) {
    const f = await this.getFolders();
    const dir = await this.savedDir();
    const root = [...f.grid, ...f.image].find((r) => under(path, r));
    if (!root) throw new ForgeError("出力フォルダの外の画像は保管できません");
    // "2026-10-01\grid-0020.jpg" → "2026-10-01_grid-0020.jpg"
    const main = freePath(dir, relative(root, path).replace(/[\\/]/g, "_"));
    const moves = [{ from: path, to: main }, ...paths.slice(1).map((p) => ({ from: p, to: freePath(dir, `${basename(main)}_${basename(p)}`) }))];
    await this.relocate(moves);
    return this.fileAt(main, true);
  }

  /** 保管庫 → 出力フォルダ (日付フォルダの中へ戻す) */
  private async unsave(path: string, paths: string[]) {
    const f = await this.getFolders();
    const grid = isGridName(basename(path));
    const root = grid ? f.grid[0] : f.image[0];
    if (!root) throw new ForgeError("戻し先の出力フォルダがありません");
    const place = (r: string, day: string | null, name: string) => {
      const d = day ? join(r, day) : r;
      mkdirSync(d, { recursive: true });
      return freePath(d, name);
    };
    const { day, rest } = splitDay(basename(path));
    const main = place(root, day, rest);
    const moves = [{ from: path, to: main }];
    for (const p of paths.slice(1)) {
      // "<grid の名前>_<元の名前>" → 元の名前
      const name = basename(p).replace(/^(images_)+/i, "");
      const parent = basename(path).replace(/^(images_)+/i, "") + "_";
      const orig = name.startsWith(parent) ? name.slice(parent.length) : name;
      moves.push({ from: p, to: place(f.image[0], day, orig) });
    }
    // 出力フォルダに Like のタグが残っていれば外す (戻した途端に Like 扱いにならないように)
    const like = this.likeTag();
    await this.relocate(moves);
    if (like) await this.post("/db/batch_update_image_tag", { img_paths: moves.map((m) => m.to), action: "remove", tag_id: like.id }).catch(() => {});
    this.invalidateTags();
    return this.fileAt(main, false);
  }

  /** 出力フォルダで IIB の Like が付いているものをまとめて保管庫へ (Like の付け方を変える前の分) */
  async likedInOutput() {
    this.invalidateTags();
    const like = this.likeTag();
    if (!like) return { grids: [], images: [] };
    const has = (f: GalleryFile) => this.tagsOf(f.path).some((t) => t.id === like.id);
    return { grids: (await this.files("grid")).filter(has), images: (await this.files("image")).filter(has) };
  }

  async migrateLiked() {
    const { grids, images } = await this.likedInOutput();
    const done = new Set<string>();
    let moved = 0;
    for (const g of grids) {
      const paths = [g.path, ...(await this.sources(g.path)).map((s) => s.path)];
      await this.save(g.path, paths);
      paths.forEach((p) => done.add(key(p)));
      moved += paths.length;
    }
    for (const img of images) {
      if (done.has(key(img.path)) || !existsSync(img.path)) continue;
      await this.save(img.path, [img.path]);
      moved++;
    }
    return { moved };
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
    const roots = [...f.grid, ...f.image, await this.savedDir()];
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const dest = join(await this.trashDir(), `${stamp}-${label}`);
    let moved = 0;
    let bytes = 0;
    for (const p of paths) {
      const root = roots.find((r) => under(p, r));
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
  async remove(path: string) {
    const paths = [path, ...(await this.sources(path)).map((s) => s.path)];
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
