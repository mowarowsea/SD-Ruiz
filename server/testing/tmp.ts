// テスト用の一時フォルダ

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** テストごとの一時フォルダ。afterEach などで remove() を呼ぶ */
export function tempDir(prefix = "sd-ruiz-test-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}
