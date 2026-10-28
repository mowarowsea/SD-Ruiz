import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// リポジトリ直下の config.json は本物に触らず、メモリ上に持つ
const mem = await vi.hoisted(async () => (await import("./test-fs.js")).memoryFs((p) => /[\\/]config\.json$/.test(p)));
vi.mock("node:fs", async (orig) => mem.fake(await orig()));

import { loadConfig } from "./config.js";

const configPath = new URL("../config.json", import.meta.url).pathname;
beforeEach(() => {
  mem.reset();
  vi.stubEnv("GROQ_API_KEY", "");
  vi.stubEnv("SD_RUIZ_PORT", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("loadConfig", () => {
  test("config.json が無ければ既定", () => {
    const c = loadConfig();
    expect(c).toMatchObject({ host: "0.0.0.0", port: 3940, forgeUrl: "http://127.0.0.1:7862", forgeDir: null, launcherUrl: "http://127.0.0.1:8765", launcherServiceId: "sd-forge-neo", groqApiKey: null, dmd2Lora: "dmd2_sdxl_4step_lora_fp16" });
  });

  test("config.json は既定を上書きし、forgeUrl の末尾の / は外す", () => {
    mem.files.set(configPath, Buffer.from(JSON.stringify({ port: 4000, forgeUrl: "http://10.0.0.2:7862///", forgeDir: "C:\\forge", pinnedCivitaiUsers: [] })));
    const c = loadConfig();
    expect(c).toMatchObject({ port: 4000, forgeUrl: "http://10.0.0.2:7862", forgeDir: "C:\\forge", pinnedCivitaiUsers: [], host: "0.0.0.0" });
  });

  test("Groq のキーは環境変数でもよい (config.json が優先)。SD_RUIZ_PORT はポートだけ差し替える", () => {
    vi.stubEnv("GROQ_API_KEY", "env-key");
    vi.stubEnv("SD_RUIZ_PORT", "3941");
    expect(loadConfig()).toMatchObject({ groqApiKey: "env-key", port: 3941 });
    mem.files.set(configPath, Buffer.from(JSON.stringify({ groqApiKey: "file-key", port: 4000 })));
    expect(loadConfig()).toMatchObject({ groqApiKey: "file-key", port: 3941 });
  });
});
