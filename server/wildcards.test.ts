import { existsSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tempDir } from "./testing/tmp.js";
import { WildcardError, Wildcards } from "./wildcards.js";

let tmp: ReturnType<typeof tempDir>;
let root: string;
let trash: string;
beforeEach(() => {
  tmp = tempDir();
  root = join(tmp.dir, "wildcards");
  trash = join(tmp.dir, "Trash");
  mkdirSync(join(root, "chara"), { recursive: true });
  writeFileSync(join(root, "color.txt"), "# 色\nred\nblue\n\n  green  \n");
  writeFileSync(join(root, "chara", "fate.txt"), "saber\r\nrin\r\n");
  writeFileSync(join(root, "chara", "notes.md"), "ignored");
});
afterEach(() => tmp.remove());

const wc = () => new Wildcards(root, async () => trash);

describe("Wildcards", () => {
  describe("list", () => {
    it(".txt を名前順に、候補の数と更新日時つきで返す (フォルダは / 区切り、拡張子なし)", async () => {
      const files = await wc().list();
      expect(files.map((f) => [f.name, f.entries])).toEqual([
        ["chara/fate", 2],
        ["color", 3],
      ]);
      expect(files[0].mtime).toBeGreaterThan(0);
    });

    it("フォルダが無い・未設定なら空", async () => {
      expect(await new Wildcards(null, async () => trash).list()).toEqual([]);
      expect(await new Wildcards(join(tmp.dir, "nope"), async () => trash).list()).toEqual([]);
    });
  });

  describe("read", () => {
    it("改行を LF にそろえ、BOM を外す", async () => {
      writeFileSync(join(root, "bom.txt"), "﻿a\r\nb");
      expect(await wc().read("bom")).toMatchObject({ name: "bom", text: "a\nb" });
      expect((await wc().read("chara/fate.txt")).text).toBe("saber\nrin\n");
    });

    it("無ければ 404、フォルダが無ければ 404", async () => {
      await expect(wc().read("nope")).rejects.toMatchObject({ statusCode: 404 });
      await expect(new Wildcards(join(tmp.dir, "nope"), async () => trash).read("color")).rejects.toMatchObject({ statusCode: 404 });
      await expect(new Wildcards(null, async () => trash).read("color")).rejects.toThrow(WildcardError);
    });
  });

  describe("名前の検査", () => {
    it.each(["../etc", "a/../../b", "..", "a//b", " ", "a:b", 'a"b', "a?b"])("使えない名前は 400: %j", async (name) => {
      await expect(wc().read(name)).rejects.toMatchObject({ statusCode: 400 });
    });

    it("バックスラッシュは / に、.txt は外す", async () => {
      expect((await wc().read("chara\\fate.txt")).name).toBe("chara/fate");
    });
  });

  describe("write", () => {
    it("mtime が null なら新規作成 (フォルダも作る)。同じ名前があれば 409", async () => {
      const r = await wc().write("new/deep/file", "a\n# c\nb", null);
      expect(r).toMatchObject({ name: "new/deep/file", entries: 2 });
      expect(readFileSync(join(root, "new/deep/file.txt"), "utf8")).toBe("a\n# c\nb");
      await expect(wc().write("color", "x", null)).rejects.toMatchObject({ statusCode: 409 });
    });

    it("開いたときの mtime と違えば上書きしない (ほかで書き換えられている)", async () => {
      const { mtime } = await wc().read("color");
      utimesSync(join(root, "color.txt"), new Date(), new Date(mtime + 5000));
      await expect(wc().write("color", "x", mtime)).rejects.toMatchObject({ statusCode: 409 });
      expect(readFileSync(join(root, "color.txt"), "utf8")).toContain("red");
    });

    it("消えていたら 409", async () => {
      await expect(wc().write("gone", "x", 1)).rejects.toMatchObject({ statusCode: 409 });
    });

    it("改行コードは元のファイルに合わせる (CRLF のファイルは CRLF のまま)", async () => {
      const f = await wc().read("chara/fate");
      const r = await wc().write("chara/fate", "saber\nrin\narcher\n", f.mtime);
      expect(readFileSync(join(root, "chara/fate.txt"), "utf8")).toBe("saber\r\nrin\r\narcher\r\n");
      expect(r.entries).toBe(3);
      expect(r.mtime).toBeGreaterThan(0);
      const c = await wc().read("color");
      await wc().write("color", "a\r\nb", c.mtime);
      expect(readFileSync(join(root, "color.txt"), "utf8")).toBe("a\nb");
    });
  });

  describe("rename", () => {
    it("移して、空になったフォルダは消す。先にあれば 409、元が無ければ 404", async () => {
      expect(await wc().rename("chara/fate", "series/fate")).toEqual({ name: "series/fate" });
      expect(existsSync(join(root, "series/fate.txt"))).toBe(true);
      // notes.md が残っているので chara/ は消さない
      expect(existsSync(join(root, "chara"))).toBe(true);
      await wc().rename("series/fate", "fate");
      expect(existsSync(join(root, "series"))).toBe(false);
      await expect(wc().rename("fate", "color")).rejects.toMatchObject({ statusCode: 409 });
      await expect(wc().rename("nope", "x")).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe("remove", () => {
    it("ゴミ箱フォルダの wildcards/ へ移し、同じ名前があれば日時を付ける", async () => {
      expect(await wc().remove("color")).toEqual({ ok: true });
      expect(existsSync(join(root, "color.txt"))).toBe(false);
      expect(readFileSync(join(trash, "wildcards/color.txt"), "utf8")).toContain("red");
      await wc().write("color", "again", null);
      await wc().remove("color");
      const names = readdirSync(join(trash, "wildcards")).sort();
      expect(names).toHaveLength(2);
      expect(names.find((n) => n !== "color.txt")).toMatch(/^color-\d{4}-\d{2}-\d{2}T.*\.txt$/);
      await expect(wc().remove("color")).rejects.toMatchObject({ statusCode: 404 });
    });

    it("空になったフォルダは消す (wildcards/ そのものは残す)", async () => {
      await wc().write("solo/one", "x", null);
      await wc().remove("solo/one");
      expect(existsSync(join(root, "solo"))).toBe(false);
      expect(existsSync(root)).toBe(true);
    });
  });
});
