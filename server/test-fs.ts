// テスト用: data/ や config.json のように、リポジトリの決まった場所を読み書きするモジュールのための node:fs の差し替え。
// 決まった場所 (matches に当たるパス) だけをメモリ上に持ち、それ以外は本物の fs に流す。
// 使い方: vi.hoisted でこれを作り、vi.mock("node:fs", ...) の factory から fake() を返す

import type * as fs from "node:fs";
import { basename, dirname } from "node:path";

export function memoryFs(matches: (path: string) => boolean) {
  const files = new Map<string, Buffer>();
  const p = (x: fs.PathLike | number) => String(x);
  const fake = (actual: typeof fs): typeof fs => ({
    ...actual,
    existsSync: (x) => (matches(p(x)) ? files.has(p(x)) || [...files.keys()].some((k) => k.startsWith(p(x) + "/") || k.startsWith(p(x) + "\\")) : actual.existsSync(x)),
    readFileSync: ((x: fs.PathLike | number, opt?: unknown) => {
      if (!matches(p(x))) return (actual.readFileSync as (a: unknown, b: unknown) => unknown)(x, opt);
      const buf = files.get(p(x));
      if (!buf) throw Object.assign(new Error(`ENOENT: ${p(x)}`), { code: "ENOENT" });
      return opt && (typeof opt === "string" || (opt as { encoding?: string }).encoding) ? buf.toString("utf8") : buf;
    }) as typeof fs.readFileSync,
    writeFileSync: ((x: fs.PathLike | number, data: string | NodeJS.ArrayBufferView, opt?: unknown) => {
      if (!matches(p(x))) return (actual.writeFileSync as (a: unknown, b: unknown, c: unknown) => void)(x, data, opt);
      files.set(p(x), Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(String(data)));
    }) as typeof fs.writeFileSync,
    mkdirSync: ((x: fs.PathLike, opt?: unknown) => (matches(p(x)) ? undefined : (actual.mkdirSync as (a: unknown, b: unknown) => unknown)(x, opt))) as typeof fs.mkdirSync,
    rmSync: ((x: fs.PathLike, opt?: unknown) => {
      if (!matches(p(x))) return (actual.rmSync as (a: unknown, b: unknown) => void)(x, opt);
      for (const k of [...files.keys()]) if (k === p(x) || k.startsWith(p(x) + "/") || k.startsWith(p(x) + "\\")) files.delete(k);
    }) as typeof fs.rmSync,
    readdirSync: ((x: fs.PathLike, opt?: unknown) => {
      if (!matches(p(x))) return (actual.readdirSync as (a: unknown, b: unknown) => unknown)(x, opt);
      return [...files.keys()].filter((k) => dirname(k) === p(x)).map((k) => basename(k));
    }) as typeof fs.readdirSync,
  });
  return {
    files,
    fake,
    text: (path: string) => files.get(path)?.toString("utf8"),
    json: <T = unknown>(path: string) => JSON.parse(files.get(path)!.toString("utf8")) as T,
    reset: () => files.clear(),
  };
}
