// ギャラリー
//
// - ファイル一覧: 出力フォルダ (grid / 単体画像) を直接読む (IIB の検索 API は重く、ページ送りで重複も出るため)
// - 出力フォルダのタグ: IIB の DB (iib.db) を読み取り専用で参照する (保管庫を使う前に IIB で付けた分)
// - サムネイル・生成情報・プロンプト検索: IIB の API
// - 削除・整理: SD-Ruiz のゴミ箱フォルダへ移動する (完全に消すのは「ゴミ箱を空にする」だけ)
// - 保管庫 (Saved): タグ (Like / useful / temp など) を付けたものを移しておくフォルダ (Forge の「Save」ボタンの保存先と同じ)。
//   整理の対象にはならない。タグが全部外れたら出力フォルダへ戻す。保管庫のタグは保管庫の中の JSON に持つ (IIB では付けられないため)
//   名前は Forge の Save に合わせ、grid は "2026-10-01_grid-0020.jpg"、元画像は "<grid の名前>_<元の名前>"
//
// grid の元画像は「1 つ前の grid から、この grid までの間に保存された単体画像」とみなす (Forge は単体画像を書いたあとに grid を書く)。
// バッチ 1 の生成 (grid なし) を取り違えないよう、grid との時間差と Seed でも絞る。

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  /** 一覧で grid として扱うもの (元画像が sources に付く) */
  grid?: boolean;
  sources?: GalleryFile[];
  tags?: CustomTag[];
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

/**
 * 保管庫のタグ。保管庫は IIB のスキャン対象外でタグを付けられないので、保管庫の中の JSON に持つ
 * (ファイル名 → タグ ID)。記録の無いもの (Forge の Save で保存した分) は Like とみなす
 */
class SavedTags {
  private file: string;
  private data: Record<string, number[]>;

  constructor(dir: string) {
    this.file = join(dir, ".sd-ruiz-tags.json");
    try {
      this.data = JSON.parse(readFileSync(this.file, "utf8"));
    } catch {
      this.data = {};
    }
  }

  get(name: string): number[] | undefined {
    return this.data[key(name)];
  }

  set(name: string, ids: number[]) {
    this.data[key(name)] = [...new Set(ids)];
    this.write();
  }

  delete(name: string) {
    if (!(key(name) in this.data)) return;
    delete this.data[key(name)];
    this.write();
  }

  private write() {
    writeFileSync(this.file, JSON.stringify(this.data, null, 1));
  }
}

export class Gallery {
  private readonly iib: string;
  private folders: { grid: string[]; image: string[] } | null = null;
  private readonly scanner = new FolderScanner();
  private tagCache: { at: number; map: Map<string, CustomTag[]>; all: CustomTag[] } | null = null;
  private mapCache: { sig: string; strict: Map<string, GalleryFile[]>; wide: Map<string, GalleryFile[]>; gridOfImage: Map<string, GalleryFile>; orphans: GalleryFile[] } | null = null;

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

  /**
   * パス → カスタムタグ。読み直しは 1 秒ほどかかる (image_tag に tag_id の索引が無い) ので、
   * SD-Ruiz から付け外ししたときは patchTags() で手元の分だけ直す
   */
  private tags() {
    if (this.tagCache && Date.now() - this.tagCache.at < 60_000) return this.tagCache;
    const db = new DatabaseSync(this.dbPath(), { readOnly: true });
    try {
      const all = db.prepare("SELECT id, name FROM tag WHERE type = 'custom' ORDER BY id").all() as unknown as CustomTag[];
      const byId = new Map(all.map((t) => [t.id, t]));
      const rows = all.length
        ? (db.prepare(`SELECT i.path AS path, it.tag_id AS id FROM image_tag it JOIN image i ON i.id = it.image_id WHERE it.tag_id IN (${all.map((t) => t.id).join(",")})`).all() as unknown as { path: string; id: number }[])
        : [];
      const map = new Map<string, CustomTag[]>();
      for (const r of rows) {
        const k = key(r.path);
        map.set(k, [...(map.get(k) ?? []), byId.get(r.id)!]);
      }
      this.tagCache = { at: Date.now(), map, all };
      return this.tagCache;
    } finally {
      db.close();
    }
  }

  /** IIB に書き込んだ付け外しを手元の一覧にも反映する */
  private patchTags(paths: string[], tagId: number, on: boolean) {
    const c = this.tagCache;
    const tag = c?.all.find((t) => t.id === tagId);
    if (!c || !tag) return;
    for (const p of paths) {
      const rest = (c.map.get(key(p)) ?? []).filter((t) => t.id !== tagId);
      c.map.set(key(p), on ? [...rest, tag] : rest);
    }
  }

  invalidateTags() {
    this.tagCache = null;
  }

  customTags() {
    return this.tags().all;
  }

  private savedTagStore: SavedTags | null = null;
  private async savedTags() {
    return (this.savedTagStore ??= new SavedTags(await this.savedDir()));
  }

  /** ファイルのタグ。出力フォルダのものは IIB、保管庫のものは保管庫の記録 (記録が無ければ Like) */
  tagsOf(path: string, saved = false): CustomTag[] {
    const all = this.tags().all;
    if (!saved) return this.tags().map.get(key(path)) ?? [];
    const ids = this.savedTagStore?.get(basename(path));
    if (!ids) return all.filter((t) => t.name === "like");
    return all.filter((t) => ids.includes(t.id));
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
    await this.savedTags();
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

  /** 一覧に出す全件 (出力フォルダ + 保管庫)。grid 表示では grid の無い単体画像 (バッチ 1 の生成など) も混ぜる */
  private async allFiles(kind: Kind): Promise<GalleryFile[]> {
    const s = await this.savedIndex();
    if (kind === "image") return [...(await this.files("image")), ...s.images].sort((a, b) => b.mtime - a.mtime);
    const asGrid = (f: GalleryFile) => ({ ...f, grid: true });
    const out = [...(await this.files("grid")).map(asGrid), ...(await this.outputMap()).orphans, ...s.grids.map(asGrid), ...s.orphans];
    return out.sort((a, b) => b.mtime - a.mtime);
  }

  /**
   * 新しい順に 1 ページ分。tag: カスタムタグ ID か "none" (タグなし)。q: プロンプトの部分一致
   * cursor は「何件目から」
   */
  async list(opts: { kind: Kind; offset: number; limit: number; tag?: number | "none" | "any"; q?: string }) {
    let files = await this.allFiles(opts.kind);
    const tagsOf = (f: GalleryFile) => this.tagsOf(f.path, f.saved);
    if (opts.tag === "none") files = files.filter((f) => tagsOf(f).length === 0);
    else if (opts.tag === "any") files = files.filter((f) => tagsOf(f).length > 0);
    else if (opts.tag !== undefined) files = files.filter((f) => tagsOf(f).some((t) => t.id === opts.tag));
    if (opts.q) {
      const q = opts.q.toLowerCase();
      const hits = await this.search(opts.kind, opts.q);
      const matched = await Promise.all(files.map(async (f) => (f.saved ? (await this.savedText(f)).toLowerCase().includes(q) : hits.has(key(f.path)))));
      files = files.filter((_, i) => matched[i]);
    }
    const page = files.slice(opts.offset, opts.offset + opts.limit);
    return {
      // grid には元画像も付けて返す (ビューアで grid → 元画像 → 次の grid … と送るため)
      files: await Promise.all(
        page.map(async (f) => ({ ...f, tags: tagsOf(f), ...(f.grid && { sources: (await this.sources(f.path)).map((x) => ({ ...x, tags: tagsOf(x) })) }) })),
      ),
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
    const f = await this.getFolders();
    const folder_paths = kind === "grid" ? [...f.grid, ...f.image] : f.image;
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

  /**
   * 出力フォルダの grid ごとの元画像と、grid の無い単体画像 (バッチ 1 の生成)。フォルダが変わったときだけ作り直す
   * - wide: 「1 つ前の grid から、この grid までの間」かつ grid との時間差 2 分以内の画像 (整理で取りこぼさないよう広め)
   * - strict: wide のうち、最後の画像から Seed が 1 ずつ (または同じ値で) 続いている部分 (直前のバッチ 1 の画像を除く)
   */
  private async outputMap() {
    const grids = await this.files("grid");
    const images = await this.files("image");
    const sig = `${grids.length}:${grids[0]?.mtime}:${images.length}:${images[0]?.mtime}`;
    if (this.mapCache?.sig === sig) return this.mapCache;
    const gridsAsc = [...grids].reverse();
    const imagesAsc = [...images].reverse();
    const strict = new Map<string, GalleryFile[]>();
    const wide = new Map<string, GalleryFile[]>();
    const gridOfImage = new Map<string, GalleryFile>();
    const used = new Set<string>();
    let j = 0;
    let prev = 0;
    for (const g of gridsAsc) {
      while (j < imagesAsc.length && imagesAsc[j].mtime <= prev) j++;
      const win: GalleryFile[] = [];
      for (let k = j; k < imagesAsc.length && imagesAsc[k].mtime <= g.mtime + 1000; k++) {
        if (g.mtime - imagesAsc[k].mtime <= sourceWindowMs) win.push(imagesAsc[k]);
      }
      const seeds = win.map((f) => fileSeed(f.name));
      let start = 0;
      if (win.length > 1 && seeds.every((s) => s !== null)) {
        start = win.length - 1;
        // 6 月以前は名前の数字が Seed ではなく日時 ("00052-20260630093422.png") で、バッチ内で同じ値になる
        while (start > 0 && (seeds[start - 1] === seeds[start]! - 1 || seeds[start - 1] === seeds[start])) start--;
      }
      const run = win.slice(start);
      strict.set(key(g.path), run);
      wide.set(key(g.path), win);
      for (const f of win) gridOfImage.set(key(f.path), g);
      for (const f of run) used.add(key(f.path));
      prev = g.mtime;
    }
    const orphans = images.filter((f) => !used.has(key(f.path)));
    this.mapCache = { sig, strict, wide, gridOfImage, orphans };
    return this.mapCache;
  }

  /** grid の元画像 (wide: 整理のときは取りこぼさないよう広めに取る) */
  async sources(gridPath: string, wide = false): Promise<GalleryFile[]> {
    if (await this.isSaved(gridPath)) {
      if (!isGridName(basename(gridPath))) return [];
      return ((await this.savedIndex()).children.get(key(gridPath)) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    }
    if (!(await this.getFolders()).grid.some((r) => under(gridPath, r))) return [];
    const m = await this.outputMap();
    return [...((wide ? m.wide : m.strict).get(key(gridPath)) ?? [])].sort((a, b) => a.name.localeCompare(b.name));
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
   * - 出力フォルダのものにタグを付けると、grid と元画像を保管庫へ移す
   * - 保管庫のもののタグが全部外れたら、出力フォルダへ戻す
   * 付け外し後の状態 (移した先・タグ・元画像) を file で返す
   */
  async toggleTag(path: string, tagId: number) {
    const saved = await this.isSaved(path);
    const paths = [path, ...(await this.sources(path)).map((s) => s.path)];
    const current = this.tagsOf(path, saved).map((t) => t.id);
    const on = !current.includes(tagId);
    const next = on ? [...current, tagId] : current.filter((id) => id !== tagId);
    let file: GalleryFile;
    if (saved) {
      if (next.length) {
        const store = await this.savedTags();
        for (const p of paths) store.set(basename(p), next);
        file = await this.fileAt(path, true);
      } else file = await this.unsave(path, paths);
    } else if (on) file = await this.save(path, paths, next);
    else {
      // 出力フォルダに残っている IIB のタグを外す (保管庫を使う前に付けた分)
      await this.post("/db/batch_update_image_tag", { img_paths: paths, action: "remove", tag_id: tagId });
      this.patchTags(paths, tagId, false);
      file = await this.fileAt(path, false);
    }
    return { on, count: paths.length, file };
  }

  // ---- 保管庫への出し入れ ----

  private relocate(moves: { from: string; to: string }[]) {
    for (const { from, to } of moves) {
      mkdirSync(dirname(to), { recursive: true });
      renameSync(from, to);
    }
  }

  private async fileAt(path: string, saved: boolean): Promise<GalleryFile> {
    const s = statSync(path);
    const grid = saved ? isGridName(basename(path)) : (await this.getFolders()).grid.some((r) => under(path, r));
    const sources = grid ? (await this.sources(path)).map((x) => ({ ...x, tags: this.tagsOf(x.path, saved) })) : undefined;
    return { path, name: basename(path), mtime: s.mtimeMs, bytes: s.size, saved, grid, sources, tags: this.tagsOf(path, saved) };
  }

  /** 出力フォルダ → 保管庫。paths[0] が本体 (grid なら続きが元画像)。tagIds を保管庫側のタグとして記録する */
  private async save(path: string, paths: string[], tagIds: number[]) {
    const f = await this.getFolders();
    const dir = await this.savedDir();
    const root = [...f.grid, ...f.image].find((r) => under(path, r));
    if (!root) throw new ForgeError("出力フォルダの外の画像は保管できません");
    // "2026-10-01\grid-0020.jpg" → "2026-10-01_grid-0020.jpg"
    const main = freePath(dir, relative(root, path).replace(/[\\/]/g, "_"));
    const moves = [{ from: path, to: main }, ...paths.slice(1).map((p) => ({ from: p, to: freePath(dir, `${basename(main)}_${basename(p)}`) }))];
    this.relocate(moves);
    const store = await this.savedTags();
    for (const m of moves) store.set(basename(m.to), tagIds);
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
    this.relocate(moves);
    const store = await this.savedTags();
    for (const m of moves) store.delete(basename(m.from));
    // 戻した先に IIB のタグが残っていれば外す (戻した途端にタグ付き扱いにならないように)
    for (const t of this.customTags()) {
      const hit = moves.map((m) => m.to).filter((p) => this.tagsOf(p).some((x) => x.id === t.id));
      if (!hit.length) continue;
      await this.post("/db/batch_update_image_tag", { img_paths: hit, action: "remove", tag_id: t.id }).catch(() => {});
      this.patchTags(hit, t.id, false);
    }
    return this.fileAt(main, false);
  }

  /** 出力フォルダで IIB のタグが付いているもの (保管庫を使う前に付けた分) */
  async taggedInOutput() {
    this.invalidateTags();
    const has = (f: GalleryFile) => this.tagsOf(f.path).length > 0;
    return { grids: (await this.files("grid")).filter(has), images: (await this.files("image")).filter(has) };
  }

  /** taggedInOutput() をタグごと保管庫へ移す (grid は元画像ごと) */
  async migrateTagged() {
    const { grids, images } = await this.taggedInOutput();
    const done = new Set<string>();
    let moved = 0;
    for (const g of grids) {
      const paths = [g.path, ...(await this.sources(g.path)).map((s) => s.path)];
      await this.save(g.path, paths, this.tagsOf(g.path).map((t) => t.id));
      paths.forEach((p) => done.add(key(p)));
      moved += paths.length;
    }
    for (const img of images) {
      if (done.has(key(img.path)) || !existsSync(img.path)) continue;
      await this.save(img.path, [img.path], this.tagsOf(img.path).map((t) => t.id));
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
    const saved = await this.savedDir();
    const roots = [...f.grid, ...f.image, saved];
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
        if (root === saved) (await this.savedTags()).delete(basename(p));
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
    const map = await this.outputMap();
    const tagged = (f: GalleryFile) => this.tagsOf(f.path).length > 0;

    const keep = new Set<string>();
    for (const g of grids.filter(tagged)) {
      keep.add(key(g.path));
      for (const s of map.wide.get(key(g.path)) ?? []) keep.add(key(s.path));
    }
    for (const img of images.filter(tagged)) {
      keep.add(key(img.path));
      const g = map.gridOfImage.get(key(img.path));
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
