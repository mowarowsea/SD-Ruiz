import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface Config {
  host: string;
  port: number;
  /** Forge Neo の URL。`--api` 付きで起動しておくこと */
  forgeUrl: string;
}

const defaults: Config = {
  host: "0.0.0.0",
  port: 3940,
  forgeUrl: "http://127.0.0.1:7862",
};

// config.json (git 管理外) があれば defaults を上書きする
export function loadConfig(): Config {
  const path = fileURLToPath(new URL("../config.json", import.meta.url));
  if (!existsSync(path)) return defaults;
  const user = JSON.parse(readFileSync(path, "utf8")) as Partial<Config>;
  return { ...defaults, ...user, forgeUrl: (user.forgeUrl ?? defaults.forgeUrl).replace(/\/+$/, "") };
}
