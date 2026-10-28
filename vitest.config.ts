import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// BFF (server/) とフロント (web/src/) の純粋なロジックのテスト。`npm test` で両方走る
// - server: Node。ファイルを触るものは一時フォルダに書く (data/ や config.json には触らない)
// - web: DOM の要らないモジュール (プロンプトの解析・検索置換・infotext など) だけ。CodeMirror や React の描画は対象外
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "server",
          root: fileURLToPath(new URL("./server", import.meta.url)),
          include: ["**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "web",
          root: fileURLToPath(new URL("./web/src", import.meta.url)),
          include: ["**/*.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});
