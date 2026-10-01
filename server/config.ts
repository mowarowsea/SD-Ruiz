import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface Config {
  host: string;
  port: number;
  /** Forge Neo の URL。`--api` 付きで起動しておくこと */
  forgeUrl: string;
  /** Forge Neo のインストール先。タグ補完の CSV とワイルドカードをここから読む (未設定なら補完なし) */
  forgeDir: string | null;
  /** a1111-sd-webui-tagcomplete の tags/ にあるタグ CSV */
  tagFile: string;
  /** タグの和訳 CSV (`tag,訳` 形式、tags/ からの相対パス)。任意 */
  translationFile: string | null;
}

const defaults: Config = {
  host: "0.0.0.0",
  port: 3940,
  forgeUrl: "http://127.0.0.1:7862",
  forgeDir: null,
  tagFile: "danbooru.csv",
  translationFile: null,
};

// config.json (git 管理外) があれば defaults を上書きする
// 環境変数 SD_RUIZ_PORT があればポートだけ差し替える (本番を動かしたまま別ポートで試すとき用)
export function loadConfig(): Config {
  const path = fileURLToPath(new URL("../config.json", import.meta.url));
  const user = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Partial<Config>) : {};
  const cfg = { ...defaults, ...user, forgeUrl: (user.forgeUrl ?? defaults.forgeUrl).replace(/\/+$/, "") };
  if (process.env.SD_RUIZ_PORT) cfg.port = Number(process.env.SD_RUIZ_PORT);
  return cfg;
}
