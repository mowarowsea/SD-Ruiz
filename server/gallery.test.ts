import { existsSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Gallery } from "./gallery.js";
import { fakeForge } from "./testing/forge.js";
import { tinyPng } from "./testing/png.js";
import { tempDir } from "./testing/tmp.js";

let tmp: ReturnType<typeof tempDir>;
let forge: ReturnType<typeof fakeForge>;
let root: string;
let grids: string;
let images: string;
let saved: string;
let trash: string;
let db: string;

const T = Date.parse("2026-10-01T10:00:00Z");
const min = 60_000;

/** ファイルを作って更新日時を決める */
function put(path: string, mtime: number, body: Buffer | string = "x") {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body);
  utimesSync(path, new Date(mtime), new Date(mtime));
  return path;
}

const files = {
  // 生成 ID 付き (2026-10-04 以降の名前): grid と元画像は ID で結び付く
  grid1: "",
  img1a: "",
  img1b: "",
  // grid の無いバッチ 1 の生成
  solo: "",
  // ID の無い古い grid: 直前 2 分以内で Seed が続いている画像が元画像
  legacyGrid: "",
  legacyA: "",
  legacyB: "",
  /** 2 分以内だが Seed が続いていない (wide にだけ入る) */
  legacyFar: "",
  /** 2 分より前 (どちらにも入らない) */
  legacyOut: "",
};

beforeEach(() => {
  tmp = tempDir();
  root = tmp.dir;
  grids = join(root, "output", "grids");
  images = join(root, "output", "images");
  saved = join(root, "Saved");
  trash = join(root, "Trash");
  mkdirSync(saved);
  files.grid1 = put(join(grids, "2026-10-01", "grid-0001-111-20261001100000.jpg"), T);
  files.img1a = put(join(images, "2026-10-01", "00001-111-20261001100000.png"), T - 2000, tinyPng("1girl, red\nSteps: 20, Model: foo"));
  files.img1b = put(join(images, "2026-10-01", "00002-112-20261001100000.png"), T - 1000, tinyPng("1girl, blue\nSteps: 20, Model: bar"));
  files.solo = put(join(images, "2026-10-01", "00003-200-20261001090000.png"), T - 60 * min, tinyPng("solo\nSteps: 20, Model: foo"));
  const L = T - 30 * 24 * 60 * min;
  files.legacyGrid = put(join(grids, "2026-09-01", "grid-0002.png"), L);
  files.legacyA = put(join(images, "2026-09-01", "00010-500.png"), L - 20_000, tinyPng("legacy a\nSteps: 20, Model: foo"));
  files.legacyB = put(join(images, "2026-09-01", "00011-501.png"), L - 10_000, tinyPng("legacy b\nSteps: 20, Model: foo"));
  files.legacyFar = put(join(images, "2026-09-01", "00008-100.png"), L - 60_000);
  files.legacyOut = put(join(images, "2026-09-01", "00009-300.png"), L - 3 * min);

  db = join(root, "iib.db");
  const d = new DatabaseSync(db);
  d.exec("CREATE TABLE tag (id INTEGER PRIMARY KEY, name TEXT, type TEXT); CREATE TABLE image (id INTEGER PRIMARY KEY, path TEXT); CREATE TABLE image_tag (image_id INTEGER, tag_id INTEGER)");
  d.exec("INSERT INTO tag VALUES (1, 'like', 'custom'), (2, 'useful', 'custom'), (3, 'png', 'file-type')");
  d.prepare("INSERT INTO image VALUES (1, ?), (2, ?)").run(files.legacyGrid, files.legacyA);
  d.exec("INSERT INTO image_tag VALUES (1, 1), (2, 1), (1, 3)");
  d.close();

  forge = fakeForge({
    extra: {
      "/infinite_image_browsing/image_geninfo": (c) => new Response(JSON.stringify(`info of ${basename(new URL(c.url).searchParams.get("path")!)}`)),
      "/infinite_image_browsing/db/batch_update_image_tag": () => new Response("null"),
      "/infinite_image_browsing/global_setting": () => new Response(JSON.stringify({ extra_paths: [{ path: images }, { path: grids }] })),
    },
  });
});
afterEach(() => {
  forge.restore();
  tmp.remove();
});

const gallery = (opts: Partial<ConstructorParameters<typeof Gallery>[1]> = {}) =>
  new Gallery("http://forge.test", { gridFolders: [grids], imageFolders: [images], iibDb: db, trashDir: trash, savedDir: saved, ...opts });

const names = (list: { name: string }[]) => list.map((f) => f.name);

describe("Gallery", () => {
  describe("フォルダ", () => {
    it("設定が無ければ IIB の追加パスを grid とそれ以外に分け、保管庫とゴミ箱は単体画像フォルダの隣", async () => {
      const g = gallery({ gridFolders: null, imageFolders: null, trashDir: null, savedDir: null });
      expect(await g.getFolders()).toEqual({ grid: [grids], image: [images] });
      expect(await g.savedDir()).toBe(join(root, "output", "Saved"));
      expect(await g.trashDir()).toBe(join(root, "output", "SD-Ruiz-Trash"));
      expect(forge.callsTo("/infinite_image_browsing/global_setting")).toHaveLength(1);
    });
  });

  describe("一覧", () => {
    it("出力フォルダの画像を新しい順に読む", async () => {
      const g = gallery();
      expect(names(await g.files("grid"))).toEqual(["grid-0001-111-20261001100000.jpg", "grid-0002.png"]);
      expect(names(await g.files("image"))).toEqual(["00002-112-20261001100000.png", "00001-111-20261001100000.png", "00003-200-20261001090000.png", "00011-501.png", "00010-500.png", "00008-100.png", "00009-300.png"]);
    });

    it("grid の元画像: 生成 ID が同じ画像。古い grid は直前 2 分以内で Seed が続いているもの (wide は Seed を見ない)", async () => {
      const g = gallery();
      expect(names(await g.sources(files.grid1))).toEqual(["00001-111-20261001100000.png", "00002-112-20261001100000.png"]);
      expect(names(await g.sources(files.legacyGrid))).toEqual(["00010-500.png", "00011-501.png"]);
      expect(names(await g.sources(files.legacyGrid, true))).toEqual(["00008-100.png", "00010-500.png", "00011-501.png"]);
      expect(await g.sources(files.img1a)).toEqual([]);
    });

    it("grid 表示は grid と、grid の無い単体画像を混ぜて新しい順。タグは IIB の DB から", async () => {
      const r = await gallery().list({ kind: "grid", offset: 0, limit: 90 });
      expect(r.total).toBe(5);
      expect(r.next).toBeNull();
      expect(r.files.map((f) => [f.name, !!f.grid, f.tags?.map((t) => t.name)])).toEqual([
        ["grid-0001-111-20261001100000.jpg", true, []],
        ["00003-200-20261001090000.png", false, []],
        ["grid-0002.png", true, ["like"]],
        ["00008-100.png", false, []],
        ["00009-300.png", false, []],
      ]);
      expect(names(r.files[0].sources!)).toEqual(["00001-111-20261001100000.png", "00002-112-20261001100000.png"]);
      expect(r.files[2].sources!.map((s) => s.tags?.map((t) => t.name))).toEqual([["like"], []]);
    });

    it("ページ送りとタグでの絞り込み (ID / none / any)", async () => {
      const g = gallery();
      const page = await g.list({ kind: "image", offset: 0, limit: 3 });
      expect(page.files).toHaveLength(3);
      expect(page.next).toBe(3);
      expect(page.total).toBe(7);
      expect(names((await g.list({ kind: "image", offset: 3, limit: 3 })).files)).toEqual(["00011-501.png", "00010-500.png", "00008-100.png"]);
      expect(names((await g.list({ kind: "grid", offset: 0, limit: 90, tag: 1 })).files)).toEqual(["grid-0002.png"]);
      expect(names((await g.list({ kind: "grid", offset: 0, limit: 90, tag: "any" })).files)).toEqual(["grid-0002.png"]);
      expect((await g.list({ kind: "grid", offset: 0, limit: 90, tag: "none" })).total).toBe(4);
      expect(names((await g.list({ kind: "image", offset: 0, limit: 90, tag: 1 })).files)).toEqual(["00010-500.png"]);
    });

    it("カスタムタグの一覧 (IIB の custom だけ)", async () => {
      expect(await gallery().customTags()).toEqual([
        { id: 1, name: "like" },
        { id: 2, name: "useful" },
      ]);
    });

    it("詳細: IIB の生成情報・タグ・元画像", async () => {
      const r = await gallery().info(files.legacyGrid);
      expect(r.geninfo).toBe("info of grid-0002.png");
      expect(r.tags.map((t) => t.name)).toEqual(["like"]);
      expect(names(r.sources)).toEqual(["00010-500.png", "00011-501.png"]);
    });

    it("プロンプトの検索は IIB の索引で絞る (保管庫のものは自前で PNG を読む)", async () => {
      forge.state.extra["/infinite_image_browsing/db/search_by_substr"] = () =>
        new Response(JSON.stringify({ files: [{ fullpath: files.solo }], cursor: { has_next: false, next: "" } }));
      const g = gallery();
      expect(names((await g.list({ kind: "image", offset: 0, limit: 90, q: "solo" })).files)).toEqual(["00003-200-20261001090000.png"]);
      const [call] = forge.callsTo("/infinite_image_browsing/db/search_by_substr");
      expect(call.body).toMatchObject({ surstr: "solo", folder_paths: [images] });
    });
  });

  describe("保管庫 (タグの付け外し)", () => {
    it("出力フォルダの grid にタグを付けると、元画像ごと保管庫へ移り、保管庫のタグとして記録する", async () => {
      const g = gallery();
      const r = await g.toggleTag(files.grid1, 2);
      expect(r.on).toBe(true);
      expect(r.count).toBe(3);
      const main = join(saved, "2026-10-01_grid-0001-111-20261001100000.jpg");
      expect(r.file).toMatchObject({ path: main, saved: true, grid: true });
      expect(r.file.tags?.map((t) => t.name)).toEqual(["useful"]);
      expect(names(r.file.sources!)).toEqual(["2026-10-01_grid-0001-111-20261001100000.jpg_00001-111-20261001100000.png", "2026-10-01_grid-0001-111-20261001100000.jpg_00002-112-20261001100000.png"]);
      expect(existsSync(files.grid1)).toBe(false);
      expect(existsSync(files.img1a)).toBe(false);
      const store = JSON.parse(readFileSync(join(saved, ".sd-ruiz-tags.json"), "utf8"));
      expect(Object.values(store)).toEqual([[2], [2], [2]]);
      expect(forge.callsTo("/infinite_image_browsing/db/batch_update_image_tag")).toHaveLength(0);

      // 一覧には保管庫の分として出て、元画像も付く
      const list = await g.list({ kind: "grid", offset: 0, limit: 90, tag: 2 });
      expect(list.files.map((f) => [f.name, f.saved, f.sources?.length])).toEqual([["2026-10-01_grid-0001-111-20261001100000.jpg", true, 2]]);
      expect((await g.list({ kind: "image", offset: 0, limit: 90, tag: 2 })).total).toBe(2);
    });

    it("保管庫のものにタグを足す・外す。全部外れたら出力フォルダの日付フォルダへ元の名前で戻す", async () => {
      const g = gallery();
      const main = (await g.toggleTag(files.grid1, 2)).file.path;
      const added = await g.toggleTag(main, 1);
      expect(added.on).toBe(true);
      expect(added.file.tags?.map((t) => t.id)).toEqual([1, 2]);
      expect(added.file.path).toBe(main);
      await g.toggleTag(main, 2);
      const r = await g.toggleTag(main, 1);
      expect(r.on).toBe(false);
      expect(r.file).toMatchObject({ path: files.grid1, saved: false, grid: true });
      expect(existsSync(files.img1a)).toBe(true);
      expect(existsSync(files.img1b)).toBe(true);
      expect(readdirSync(saved)).toEqual([".sd-ruiz-tags.json"]);
      expect(JSON.parse(readFileSync(join(saved, ".sd-ruiz-tags.json"), "utf8"))).toEqual({});
      expect(names(await g.sources(files.grid1))).toHaveLength(2);
    });

    it("記録の無い保管庫のもの (Forge の Save で保存した分) は Like 扱い", async () => {
      put(join(saved, "2026-08-01_grid-0005.png"), T);
      put(join(saved, "2026-08-01_grid-0005.png_00050-1.png"), T);
      const r = await gallery().list({ kind: "grid", offset: 0, limit: 90, tag: 1 });
      expect(r.files.map((f) => [f.name, f.saved, f.tags?.map((t) => t.name), f.sources?.length])).toEqual([
        ["2026-08-01_grid-0005.png", true, ["like"], 1],
        ["grid-0002.png", undefined, ["like"], 2],
      ]);
    });

    it("出力フォルダに残っている IIB のタグを外すときは IIB に頼み、手元の一覧も直す", async () => {
      const g = gallery();
      const r = await g.toggleTag(files.legacyGrid, 1);
      expect(r.on).toBe(false);
      expect(r.file.path).toBe(files.legacyGrid);
      const [call] = forge.callsTo("/infinite_image_browsing/db/batch_update_image_tag");
      expect(call.body).toEqual({ img_paths: [files.legacyGrid, files.legacyA, files.legacyB], action: "remove", tag_id: 1 });
      expect(r.file.tags).toEqual([]);
      expect((await g.list({ kind: "grid", offset: 0, limit: 90, tag: "any" })).total).toBe(0);
    });

    it("出力フォルダで IIB のタグが付いたものを、タグごと保管庫へ移す (移行)", async () => {
      const g = gallery();
      expect(await g.migrateTagged()).toEqual({ moved: 3 });
      expect(existsSync(files.legacyGrid)).toBe(false);
      const list = await g.list({ kind: "grid", offset: 0, limit: 90, tag: 1 });
      expect(list.files.map((f) => [f.name, f.saved, f.sources?.length])).toEqual([["2026-09-01_grid-0002.png", true, 2]]);
      expect((await g.taggedInOutput()).grids).toEqual([]);
    });

    it("タグ付きの単体画像のうち、生成情報が当てはまる枚数 (モデルを消す前の確認)", async () => {
      const g = gallery();
      await g.toggleTag(files.grid1, 2);
      expect(await g.countTaggedUsing((s) => /Model: foo/.test(s))).toBe(2); // 保管庫の 00001 と、IIB のタグ付きの 00010
      expect(await g.countTaggedUsing((s) => /Model: bar/.test(s))).toBe(1);
      expect(await g.countTaggedUsing(() => false)).toBe(0);
    });
  });

  describe("削除と整理 (ゴミ箱フォルダへの移動)", () => {
    it("1 枚消すと元画像ごとゴミ箱へ (フォルダの構造を保つ)。ゴミ箱の中身を数えて、空にできる", async () => {
      const g = gallery();
      const r = await g.remove(files.grid1);
      expect(r.moved).toBe(3);
      expect(r.bytes).toBeGreaterThan(0);
      const [dir] = readdirSync(trash);
      expect(dir).toMatch(/-delete$/);
      expect(existsSync(join(trash, dir, "grids", "2026-10-01", basename(files.grid1)))).toBe(true);
      expect(existsSync(join(trash, dir, "images", "2026-10-01", basename(files.img1a)))).toBe(true);
      expect(await g.trashInfo()).toMatchObject({ dir: trash, files: 3 });
      expect((await g.list({ kind: "grid", offset: 0, limit: 90 })).total).toBe(4);
      await g.emptyTrash();
      expect(existsSync(trash)).toBe(false);
      expect(await g.trashInfo()).toEqual({ dir: trash, files: 0, bytes: 0 });
    });

    it("管理しているフォルダの外は触らない", async () => {
      const outside = put(join(root, "elsewhere", "x.png"), T);
      expect(await gallery().remove(outside)).toEqual({ moved: 0, bytes: 0 });
      expect(existsSync(outside)).toBe(true);
    });

    it("整理の対象: keepSince より古く、タグの付いていないもの。タグ付き grid の元画像 (広め) とタグ付き画像の grid は残す", async () => {
      const g = gallery();
      const t = await g.cleanupTargets(T - 30 * min);
      expect(names(t.grids)).toEqual([]);
      expect(names(t.images)).toEqual(["00003-200-20261001090000.png", "00009-300.png"]);
      expect(t).toMatchObject({ keptGrids: 2, keptImages: 5 });
      expect(t.bytes).toBeGreaterThan(0);
      // 残す日時を未来にすれば、タグの付いていない新しい grid も対象になる (元画像ごと)
      const all = await g.cleanupTargets(T + 1);
      expect(names(all.grids)).toEqual(["grid-0001-111-20261001100000.jpg"]);
      expect(names(all.images)).toEqual(["00002-112-20261001100000.png", "00001-111-20261001100000.png", "00003-200-20261001090000.png", "00009-300.png"]);
    });

    it("整理を実行するとゴミ箱へ移り、一覧から消える", async () => {
      const g = gallery();
      expect(await g.cleanup(T - 30 * min)).toMatchObject({ moved: 2 });
      expect(names((await g.list({ kind: "image", offset: 0, limit: 90 })).files)).toEqual(["00002-112-20261001100000.png", "00001-111-20261001100000.png", "00011-501.png", "00010-500.png", "00008-100.png"]);
      expect(readdirSync(trash)[0]).toMatch(/-cleanup$/);
    });
  });
});
