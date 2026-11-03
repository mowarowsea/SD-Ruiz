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

// ---- 展開プレビュー ----

/** コメント (# で始まる行) と空行を除いた候補。前後の空白は落とす */
export function wildcardEntries(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

export interface PreviewOptions {
  /** 引く件数 */
  count?: number;
  /** ほかのファイルへの参照 (__name__) を何段まで展開するか */
  depth?: number;
  /** 乱数 (テストで固定するため) */
  random?: () => number;
}

/** __name__ (Dynamic Prompts のワイルドカード参照。* と ** のグロブも) */
const refRe = /__([\w\-/*.!]+?)__/g;
/** 入れ子の無い {a|b|c} (${var} の { は除く) */
const variantRe = /(?<!\$)\{([^{}]*)\}/;

/** "chara/*" → chara/ の直下、"chara/**" → chara/ 以下すべて */
function globToRegExp(glob: string) {
  const re = glob
    .split("**")
    .map((part) => part.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*"))
    .join(".*");
  return new RegExp(`^${re}$`, "i");
}

/** {2$$a|b|c} や {1-2$$ and $$a|b} の中身を 1 つ (か数個) 選ぶ */
function pickVariant(body: string, random: () => number) {
  let min = 1;
  let max = 1;
  let sep = ", ";
  let rest = body;
  const m = /^(\d+)?(?:-(\d+))?\$\$(?:([^$|]*)\$\$)?/.exec(body);
  if (m) {
    // "2$$" は 2 個、"1-3$$" は 1〜3 個、"$$" だけなら 1 個 (区切りだけ変えるとき)
    min = m[1] !== undefined ? Number(m[1]) : 1;
    max = m[2] !== undefined ? Number(m[2]) : min;
    if (m[3] !== undefined) sep = m[3];
    rest = body.slice(m[0].length);
  }
  const options = rest.split("|").map((o) => {
    // "3::option" は重み付き
    const w = /^\s*(\d+(?:\.\d+)?)::/.exec(o);
    return { text: (w ? o.slice(w[0].length) : o).trim(), weight: w ? Number(w[1]) : 1 };
  });
  const n = Math.min(options.length, max > min ? min + Math.floor(random() * (max - min + 1)) : min);
  const picked: string[] = [];
  const pool = [...options];
  for (let i = 0; i < n && pool.length; i++) {
    const total = pool.reduce((s, o) => s + o.weight, 0);
    let r = random() * total;
    let idx = pool.findIndex((o) => (r -= o.weight) < 0);
    if (idx < 0) idx = pool.length - 1;
    picked.push(pool.splice(idx, 1)[0].text);
  }
  return picked.join(sep);
}

/** ランダムに n 件 (重複なし)。候補が足りなければ全部 */
function sample<T>(items: T[], n: number, random: () => number) {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  return out;
}

export class WildcardPreview {
  constructor(private readonly wildcards: Wildcards) {}

  /**
   * 編集中の内容 (保存前のバッファ) からランダムに数件引いて展開する。
   * name は編集中のファイルの名前 (新規なら null)。自分自身への参照は編集中の内容から引く。
   * ほかのファイルへの参照は depth 段まで展開し、無いファイルや深すぎるものはそのまま残す
   */
  async preview(text: string, name: string | null, opts: PreviewOptions = {}) {
    const { count = 4, depth = 3, random = Math.random } = opts;
    const entries = wildcardEntries(text);
    const self = name ? this.normalize(name) : null;
    const files = new Map<string, Promise<string[] | null>>();
    const entriesOf = (ref: string): Promise<string[] | null> => {
      const n = this.normalize(ref);
      if (n === self) return Promise.resolve(entries);
      let p = files.get(n);
      if (!p) files.set(n, (p = this.load(n)));
      return p;
    };
    const expand = async (line: string, left: number): Promise<string> => {
      let out = line;
      // 入れ子の {a|{b|c}} は内側から
      for (let i = 0; i < 50; i++) {
        const m = variantRe.exec(out);
        if (!m) break;
        out = out.slice(0, m.index) + pickVariant(m[1], random) + out.slice(m.index + m[0].length);
      }
      if (left <= 0) return out;
      const parts: (string | Promise<string>)[] = [];
      let at = 0;
      for (const m of out.matchAll(refRe)) {
        parts.push(out.slice(at, m.index));
        at = m.index + m[0].length;
        parts.push(
          entriesOf(m[1]).then((list) => {
            if (!list?.length) return m[0];
            return expand(list[Math.floor(random() * list.length)], left - 1);
          }),
        );
      }
      parts.push(out.slice(at));
      return (await Promise.all(parts)).join("");
    };
    const picked = sample(entries, Math.max(0, count), random);
    return { samples: await Promise.all(picked.map((l) => expand(l, depth))), entries: entries.length };
  }

  private normalize(name: string) {
    return name.trim().replace(/\\/g, "/").replace(/\.txt$/i, "").toLowerCase();
  }

  /** 参照先のファイルの候補。グロブならあてはまるファイルを全部。無ければ null */
  private async load(name: string): Promise<string[] | null> {
    try {
      if (name.includes("*")) {
        const re = globToRegExp(name);
        const hits = (await this.wildcards.list()).filter((f) => re.test(f.name));
        const texts = await Promise.all(hits.map((f) => this.wildcards.read(f.name)));
        return texts.flatMap((t) => wildcardEntries(t.text));
      }
      return wildcardEntries((await this.wildcards.read(name)).text);
    } catch (e) {
      if (e instanceof WildcardError) return null;
      throw e;
    }
  }
}
