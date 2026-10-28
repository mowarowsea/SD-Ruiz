import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { WildcardError, Wildcards } from "./wildcards.js";

let dir: string;
let wc: string;
let trash: string;
let w: Wildcards;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ruiz-wildcards-"));
  wc = join(dir, "wildcards");
  trash = join(dir, "trash");
  mkdirSync(join(wc, "chara"), { recursive: true });
  writeFileSync(join(wc, "chara", "fate.txt"), "saber\r\n# comment\r\n\r\narcher\r\n");
  writeFileSync(join(wc, "colors.txt"), "\uFEFFred\nblue\n");
  w = new Wildcards(wc, async () => trash);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const fails = async (p: Promise<unknown>, status: number, message: RegExp) => {
  const e = (await p.catch((e: unknown) => e)) as WildcardError;
  expect(e).toBeInstanceOf(WildcardError);
  expect(e.statusCode).toBe(status);
  expect(e.message).toMatch(message);
};

describe("list / read", () => {
  test("フォルダごとの名前 (拡張子なし、/ 区切り) と、コメントと空行を除いた候補の数", async () => {
    expect((await w.list()).map((f) => [f.name, f.entries])).toEqual([
      ["chara/fate", 2],
      ["colors", 2],
    ]);
  });

  test("フォルダが無ければ空の一覧。読むと 404", async () => {
    const none = new Wildcards(join(dir, "nope"), async () => trash);
    expect(await none.list()).toEqual([]);
    await fails(none.read("x"), 404, /forgeDir/);
    expect(await new Wildcards(null, async () => trash).list()).toEqual([]);
  });

  test("読むときは改行を LF にそろえ、BOM を外す。名前は \\ や .txt 付きでもよい", async () => {
    expect(await w.read("chara\\fate.txt")).toMatchObject({ name: "chara/fate", text: "saber\n# comment\n\narcher\n" });
    expect((await w.read("colors")).text).toBe("red\nblue\n");
    await fails(w.read("nope"), 404, /見つかりません/);
  });

  test("フォルダの外や使えない文字は弾く", async () => {
    await fails(w.read("../x"), 400, /使えない文字/);
    await fails(w.read("a:b"), 400, /使えない文字/);
    await fails(w.read(""), 400, /使えない文字/);
    await fails(w.read("a//b"), 400, /使えない文字/);
  });
});

describe("write", () => {
  test("元の改行 (CRLF) に合わせて保存し、新しい mtime と候補の数を返す", async () => {
    const r = await w.read("chara/fate");
    const out = await w.write("chara/fate", "saber\nlancer\n", r.mtime);
    expect(out).toMatchObject({ name: "chara/fate", entries: 2 });
    expect(readFileSync(join(wc, "chara", "fate.txt"), "utf8")).toBe("saber\r\nlancer\r\n");
    expect((await w.read("chara/fate")).mtime).toBe(out.mtime);
  });

  test("開いたあとにほかで書き換えられていたら上書きしない", async () => {
    const r = await w.read("colors");
    writeFileSync(join(wc, "colors.txt"), "green\n");
    await fails(w.write("colors", "x", r.mtime - 5000), 409, /ほかで書き換え/);
    expect(readFileSync(join(wc, "colors.txt"), "utf8")).toBe("green\n");
  });

  test("新規作成 (mtime null) はフォルダも作る。同じ名前があればエラー、消されていた名前の保存もエラー", async () => {
    expect(await w.write("new/one", "a\nb", null)).toMatchObject({ name: "new/one", entries: 2 });
    expect(readFileSync(join(wc, "new", "one.txt"), "utf8")).toBe("a\nb");
    await fails(w.write("colors", "x", null), 409, /同じ名前/);
    await fails(w.write("gone", "x", 1), 409, /見つかりません/);
  });
});

describe("rename / remove", () => {
  test("名前変更で空になったフォルダは消す (wildcards/ そのものは残す)", async () => {
    expect(await w.rename("chara/fate", "fate2")).toEqual({ name: "fate2" });
    expect(existsSync(join(wc, "fate2.txt"))).toBe(true);
    expect(existsSync(join(wc, "chara"))).toBe(false);
    expect(existsSync(wc)).toBe(true);
    await fails(w.rename("nope", "x"), 404, /見つかりません/);
    await fails(w.rename("fate2", "colors"), 409, /同じ名前/);
  });

  test("削除はゴミ箱フォルダの wildcards/ へ移す。同じ名前があれば日時を付ける", async () => {
    expect(await w.remove("chara/fate")).toEqual({ ok: true });
    expect(existsSync(join(trash, "wildcards", "chara", "fate.txt"))).toBe(true);
    expect(existsSync(join(wc, "chara"))).toBe(false);
    await w.write("chara/fate", "again", null);
    await w.remove("chara/fate");
    const names = await (await import("node:fs/promises")).readdir(join(trash, "wildcards", "chara"));
    expect(names).toHaveLength(2);
    expect(names).toEqual(expect.arrayContaining(["fate.txt", expect.stringMatching(/^fate-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.txt$/)]));
    await fails(w.remove("nope"), 404, /見つかりません/);
  });
});
