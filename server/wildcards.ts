// ワイルドカード (Dynamic Prompts の wildcards/ 以下の .txt) の編集。名前は `chara/foo` のように拡張子なしの相対パス

import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

export class WildcardError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

export interface WildcardFile {
  name: string;
  /** コメントと空行を除いた候補の数 */
  entries: number;
  mtime: number;
}

const countEntries = (text: string) => text.split(/\r?\n/).filter((l) => l.trim() && !l.trimStart().startsWith("#")).length;

export class Wildcards {
  constructor(
    readonly dir: string | null,
    /** 削除したものを移すフォルダ (ギャラリーと同じゴミ箱フォルダの中) */
    private trashDir: () => Promise<string>,
  ) {}

  private root() {
    if (!this.dir || !existsSync(this.dir)) throw new WildcardError("ワイルドカードのフォルダがありません (config.json の forgeDir を確認してください)", 404);
    return this.dir;
  }

  /** 名前 → 実際のパス。フォルダの外を指す名前や、ファイル名に使えない文字は弾く */
  private path(name: string) {
    const n = name.trim().replace(/\\/g, "/").replace(/\.txt$/i, "");
    if (!n || n.split("/").some((s) => !s.trim() || s === "." || s === ".." || /[<>:"|?*\x00-\x1f]/.test(s)))
      throw new WildcardError(`名前に使えない文字があります: ${name}`);
    const root = this.root();
    const p = resolve(root, `${n}.txt`);
    if (!p.startsWith(resolve(root) + sep)) throw new WildcardError(`フォルダの外は指定できません: ${name}`);
    return { name: n, path: p };
  }

  /** 移動・削除で空になったフォルダを消す (wildcards/ そのものは残す) */
  private async pruneEmpty(dir: string) {
    const root = resolve(this.root());
    for (let d = resolve(dir); d.startsWith(root + sep); d = dirname(d)) {
      if ((await readdir(d)).length) break;
      await rmdir(d);
    }
  }

  async list(): Promise<WildcardFile[]> {
    if (!this.dir || !existsSync(this.dir)) return [];
    const entries = await readdir(this.dir, { recursive: true, withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((e) => e.isFile() && e.name.endsWith(".txt"))
        .map(async (e) => {
          const p = join(e.parentPath, e.name);
          const [text, st] = await Promise.all([readFile(p, "utf8"), stat(p)]);
          return { name: relative(this.dir!, p).split(sep).join("/").replace(/\.txt$/, ""), entries: countEntries(text), mtime: st.mtimeMs };
        }),
    );
    return files.sort((a, b) => a.name.localeCompare(b.name));
  }

  async read(name: string) {
    const { name: n, path } = this.path(name);
    if (!existsSync(path)) throw new WildcardError(`見つかりません: ${n}`, 404);
    const [text, st] = await Promise.all([readFile(path, "utf8"), stat(path)]);
    // 改行は LF にそろえて渡し、保存するときに元の改行 (CRLF / LF) に戻す
    return { name: n, text: text.replace(/^﻿/, "").replace(/\r\n/g, "\n"), mtime: st.mtimeMs };
  }

  /**
   * 保存する。mtime は読み込んだときの更新日時で、ほかで書き換えられていたら上書きしない。
   * mtime が null なら新規作成 (同じ名前があればエラー)
   */
  async write(name: string, text: string, mtime: number | null) {
    const { name: n, path } = this.path(name);
    const exists = existsSync(path);
    let crlf = false;
    if (mtime === null) {
      if (exists) throw new WildcardError(`同じ名前があります: ${n}`, 409);
    } else {
      if (!exists) throw new WildcardError(`見つかりません (ほかで削除されたかもしれません): ${n}`, 409);
      const st = await stat(path);
      if (Math.abs(st.mtimeMs - mtime) > 1) throw new WildcardError("ほかで書き換えられています。開き直してから編集してください", 409);
      crlf = (await readFile(path, "utf8")).includes("\r\n");
    }
    const body = text.replace(/\r\n/g, "\n");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, crlf ? body.replace(/\n/g, "\r\n") : body, "utf8");
    return { name: n, mtime: (await stat(path)).mtimeMs, entries: countEntries(body) };
  }

  async rename(from: string, to: string) {
    const a = this.path(from);
    const b = this.path(to);
    if (!existsSync(a.path)) throw new WildcardError(`見つかりません: ${a.name}`, 404);
    if (existsSync(b.path)) throw new WildcardError(`同じ名前があります: ${b.name}`, 409);
    await mkdir(dirname(b.path), { recursive: true });
    await rename(a.path, b.path);
    await this.pruneEmpty(dirname(a.path));
    return { name: b.name };
  }

  /** ゴミ箱フォルダの wildcards/ へ移す (同じ名前があれば日時を付ける) */
  async remove(name: string) {
    const { name: n, path } = this.path(name);
    if (!existsSync(path)) throw new WildcardError(`見つかりません: ${n}`, 404);
    let dest = join(await this.trashDir(), "wildcards", `${n}.txt`);
    if (existsSync(dest)) dest = dest.replace(/\.txt$/, `-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.txt`);
    await mkdir(dirname(dest), { recursive: true });
    // 別のドライブなら rename できないので、コピーしてから消す
    try {
      await rename(path, dest);
    } catch {
      await copyFile(path, dest);
      await unlink(path);
    }
    await this.pruneEmpty(dirname(path));
    return { ok: true };
  }
}
