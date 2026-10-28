import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Gallery } from "./gallery.js";

// 出力フォルダ (grid / 単体画像)・保管庫・ゴミ箱を一時フォルダに作り、IIB の DB も小さく作る。IIB の API は呼ばない範囲を確かめる
let dir: string;
let grids: string;
let images: string;
let saved: string;
let trash: string;
let g: Gallery;

const t0 = 1_700_000_000;
const day = "2026-10-01";
/** ファイルを作って更新日時 (秒) を決める */
const put = (root: string, name: string, at: number) => {
  const p = join(root, day, name);
  mkdirSync(join(root, day), { recursive: true });
  writeFileSync(p, name);
  utimesSync(p, at, at);
  return p;
};
const names = (fs: { name: string }[]) => fs.map((f) => f.name);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ruiz-gallery-"));
  grids = join(dir, "txt2img-grids");
  images = join(dir, "txt2img-images");
  saved = join(dir, "Saved");
  trash = join(dir, "Trash");
  mkdirSync(saved);

  // 生成 ID (job_timestamp) 付き: grid と元画像は ID で対応する
  put(grids, "grid-0001-111-20261004153012.jpg", t0 + 3000);
  put(images, "00001-111-20261004153012.png", t0 + 2990);
  put(images, "00002-112-20261004153012.png", t0 + 2995);
  // ID 付きのバッチ 1 (grid 無し)
  put(images, "00003-222-20261004153100.png", t0 + 2500);
  // ID の無い古いもの: 「1 つ前の grid からこの grid まで」で 2 分以内、Seed が 1 ずつ続く部分が元画像
  put(grids, "grid-0002.jpg", t0 + 1000);
  put(images, "00011-501.png", t0 + 950);
  put(images, "00010-500.png", t0 + 920);
  put(images, "00009-300.png", t0 + 900); // Seed が続かない直前のバッチ 1
  put(images, "00008-100.png", t0 + 600); // 2 分より前

  // IIB の DB: カスタムタグ like (id 1) が 00010 に付いている
  const dbPath = join(dir, "iib.db");
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE tag (id INTEGER PRIMARY KEY, name TEXT, type TEXT); CREATE TABLE image (id INTEGER PRIMARY KEY, path TEXT); CREATE TABLE image_tag (image_id INTEGER, tag_id INTEGER)");
  db.exec("INSERT INTO tag VALUES (1, 'like', 'custom'), (2, 'useful', 'custom'), (3, 'png', 'ext')");
  db.prepare("INSERT INTO image VALUES (1, ?)").run(join(images, day, "00010-500.png"));
  db.exec("INSERT INTO image_tag VALUES (1, 1)");
  db.close();

  g = new Gallery("http://forge", { gridFolders: [grids], imageFolders: [images], iibDb: dbPath, trashDir: trash, savedDir: saved });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("grid と元画像の対応", () => {
  test("生成 ID 付きは同じ ID の単体画像", async () => {
    expect(names(await g.sources(join(grids, day, "grid-0001-111-20261004153012.jpg")))).toEqual(["00001-111-20261004153012.png", "00002-112-20261004153012.png"]);
  });

  test("ID の無い古い grid は、2 分以内で Seed が 1 ずつ続く部分。wide なら直前のバッチ 1 も含める", async () => {
    const legacy = join(grids, day, "grid-0002.jpg");
    expect(names(await g.sources(legacy))).toEqual(["00010-500.png", "00011-501.png"]);
    expect(names(await g.sources(legacy, true))).toEqual(["00009-300.png", "00010-500.png", "00011-501.png"]);
  });

  test("grid でないもの・管理の外のパスは元画像なし", async () => {
    expect(await g.sources(join(images, day, "00001-111-20261004153012.png"))).toEqual([]);
    expect(await g.sources("/somewhere/else/grid-0001.jpg")).toEqual([]);
  });
});

describe("list", () => {
  test("Grid 表示は grid と grid の無い画像を新しい順に。grid には元画像とタグが付く", async () => {
    const r = await g.list({ kind: "grid", offset: 0, limit: 10 });
    expect(names(r.files)).toEqual(["grid-0001-111-20261004153012.jpg", "00003-222-20261004153100.png", "grid-0002.jpg", "00009-300.png", "00008-100.png"]);
    expect(r.files.map((f) => !!f.grid)).toEqual([true, false, true, false, false]);
    expect(r.total).toBe(5);
    expect(r.next).toBeNull();
    const legacy = r.files[2];
    expect(names(legacy.sources!)).toEqual(["00010-500.png", "00011-501.png"]);
    expect(legacy.sources![0].tags).toEqual([{ id: 1, name: "like" }]);
    expect(legacy.tags).toEqual([]);
  });

  test("画像表示は単体画像だけ。ページ送りとタグでの絞り込み", async () => {
    const all = await g.list({ kind: "image", offset: 0, limit: 3 });
    expect(all.total).toBe(7);
    expect(all.next).toBe(3);
    expect(names(all.files)).toEqual(["00002-112-20261004153012.png", "00001-111-20261004153012.png", "00003-222-20261004153100.png"]);
    expect(names((await g.list({ kind: "image", offset: 0, limit: 10, tag: 1 })).files)).toEqual(["00010-500.png"]);
    expect(names((await g.list({ kind: "image", offset: 0, limit: 10, tag: "any" })).files)).toEqual(["00010-500.png"]);
    expect((await g.list({ kind: "image", offset: 0, limit: 10, tag: "none" })).total).toBe(6);
    expect(await g.customTags()).toEqual([{ id: 1, name: "like" }, { id: 2, name: "useful" }]);
  });
});

describe("保管庫への出し入れ", () => {
  test("出力フォルダの grid にタグを付けると、元画像ごと保管庫へ移り、名前は Forge の Save に合わせる", async () => {
    const r = await g.toggleTag(join(grids, day, "grid-0001-111-20261004153012.jpg"), 2);
    expect(r).toMatchObject({ on: true, count: 3 });
    expect(r.file).toMatchObject({ saved: true, grid: true, name: "2026-10-01_grid-0001-111-20261004153012.jpg", tags: [{ id: 2, name: "useful" }] });
    expect(names(r.file.sources!)).toEqual(["2026-10-01_grid-0001-111-20261004153012.jpg_00001-111-20261004153012.png", "2026-10-01_grid-0001-111-20261004153012.jpg_00002-112-20261004153012.png"]);
    expect(r.file.sources![0].tags).toEqual([{ id: 2, name: "useful" }]);
    expect(existsSync(join(grids, day, "grid-0001-111-20261004153012.jpg"))).toBe(false);
    expect(readdirSync(saved).sort()).toEqual([".sd-ruiz-tags.json", "2026-10-01_grid-0001-111-20261004153012.jpg", "2026-10-01_grid-0001-111-20261004153012.jpg_00001-111-20261004153012.png", "2026-10-01_grid-0001-111-20261004153012.jpg_00002-112-20261004153012.png"]);
    expect(JSON.parse(readFileSync(join(saved, ".sd-ruiz-tags.json"), "utf8"))).toEqual({
      "2026-10-01_grid-0001-111-20261004153012.jpg": [2],
      "2026-10-01_grid-0001-111-20261004153012.jpg_00001-111-20261004153012.png": [2],
      "2026-10-01_grid-0001-111-20261004153012.jpg_00002-112-20261004153012.png": [2],
    });

    // 一覧には保管庫の分として出て、元画像も付く
    const list = await g.list({ kind: "grid", offset: 0, limit: 10 });
    expect(list.files[0]).toMatchObject({ saved: true, grid: true, name: "2026-10-01_grid-0001-111-20261004153012.jpg" });
    expect(list.files[0].sources).toHaveLength(2);
  });

  test("保管庫のタグの付け外し。全部外れたら日付フォルダへ元の名前で戻す", async () => {
    const gridPath = join(grids, day, "grid-0001-111-20261004153012.jpg");
    const savedGrid = (await g.toggleTag(gridPath, 1)).file.path;
    // もう 1 つ付ける → 外す → 残りを外す
    expect((await g.toggleTag(savedGrid, 2)).file.tags).toEqual([{ id: 1, name: "like" }, { id: 2, name: "useful" }]);
    expect((await g.toggleTag(savedGrid, 1)).file.tags).toEqual([{ id: 2, name: "useful" }]);
    const back = await g.toggleTag(savedGrid, 2);
    expect(back).toMatchObject({ on: false, count: 3 });
    expect(back.file).toMatchObject({ saved: false, grid: true, path: gridPath, tags: [] });
    expect(names(back.file.sources!)).toEqual(["00001-111-20261004153012.png", "00002-112-20261004153012.png"]);
    expect(existsSync(join(images, day, "00001-111-20261004153012.png"))).toBe(true);
    expect(readdirSync(saved)).toEqual([".sd-ruiz-tags.json"]);
    expect(JSON.parse(readFileSync(join(saved, ".sd-ruiz-tags.json"), "utf8"))).toEqual({});
  });

  test("記録の無い保管庫の画像 (Forge の Save で保存した分) は Like 扱い", async () => {
    writeFileSync(join(saved, "2026-04-02_grid-0079.png"), "x");
    writeFileSync(join(saved, "2026-04-02_grid-0079.png_images_00012-999.png"), "x");
    const r = await g.list({ kind: "grid", offset: 0, limit: 10, tag: 1 });
    expect(names(r.files)).toEqual(["2026-04-02_grid-0079.png"]);
    expect(r.files[0].tags).toEqual([{ id: 1, name: "like" }]);
    expect(names(r.files[0].sources!)).toEqual(["2026-04-02_grid-0079.png_images_00012-999.png"]);
  });
});

describe("削除と整理", () => {
  test("remove は grid を元画像ごとゴミ箱へ (元のフォルダ構成のまま)", async () => {
    const r = await g.remove(join(grids, day, "grid-0002.jpg"));
    expect(r.moved).toBe(3);
    const [folder] = readdirSync(trash);
    expect(folder).toMatch(/^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-delete$/);
    expect(readdirSync(join(trash, folder, "txt2img-grids", day))).toEqual(["grid-0002.jpg"]);
    expect(readdirSync(join(trash, folder, "txt2img-images", day)).sort()).toEqual(["00010-500.png", "00011-501.png"]);
    expect(existsSync(join(images, day, "00009-300.png"))).toBe(true);
    expect((await g.trashInfo()).files).toBe(3);
  });

  test("整理の対象はタグの付いていないもの。タグ付きの画像を含む grid と、keepSince より新しいものは残す", async () => {
    const t = await g.cleanupTargets((t0 + 2800) * 1000);
    // 00010 に IIB のタグがあるので、その grid (grid-0002) は残る。新しい grid-0001 と元画像は今日の分として残る
    expect(names(t.grids)).toEqual([]);
    expect(names(t.images).sort()).toEqual(["00003-222-20261004153100.png", "00008-100.png", "00009-300.png", "00011-501.png"]);
    expect(t.keptGrids).toBe(2);
    expect(t.keptImages).toBe(3);
    expect(t.bytes).toBeGreaterThan(0);

    const all = await g.cleanupTargets(Number.MAX_SAFE_INTEGER);
    expect(names(all.grids)).toEqual(["grid-0001-111-20261004153012.jpg"]);
    expect(names(all.images).sort()).toEqual(["00001-111-20261004153012.png", "00002-112-20261004153012.png", "00003-222-20261004153100.png", "00008-100.png", "00009-300.png", "00011-501.png"]);
  });

  test("cleanup はゴミ箱へ移し、emptyTrash で消える。保管庫は対象にならない", async () => {
    const savedGrid = (await g.toggleTag(join(grids, day, "grid-0001-111-20261004153012.jpg"), 1)).file.path;
    const r = await g.cleanup(Number.MAX_SAFE_INTEGER);
    expect(r.moved).toBe(4);
    expect(existsSync(savedGrid)).toBe(true);
    expect(basename(readdirSync(trash)[0])).toMatch(/-cleanup$/);
    await g.emptyTrash();
    expect(existsSync(trash)).toBe(false);
    expect(await g.trashInfo()).toEqual({ dir: trash, files: 0, bytes: 0 });
  });
});
