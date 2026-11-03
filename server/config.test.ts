import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { tempDir } from "./testing/tmp.js";

let tmp: ReturnType<typeof tempDir> | null = null;
afterEach(() => tmp?.remove());

describe("loadConfig", () => {
  it("config.json が無ければ既定", () => {
    const cfg = loadConfig("/nonexistent/config.json", {});
    expect(cfg.port).toBe(3940);
    expect(cfg.forgeUrl).toBe("http://127.0.0.1:7862");
    expect(cfg.forgeDir).toBeNull();
    expect(cfg.groqApiKey).toBeNull();
  });

  it("config.json の項目で既定を上書きし、forgeUrl の末尾の / は落とす", () => {
    tmp = tempDir();
    const path = join(tmp.dir, "config.json");
    writeFileSync(path, JSON.stringify({ forgeUrl: "http://forge:7860///", forgeDir: "D:/Forge", port: 4000, pinnedCivitaiUsers: [] }));
    const cfg = loadConfig(path, {});
    expect(cfg.forgeUrl).toBe("http://forge:7860");
    expect(cfg.forgeDir).toBe("D:/Forge");
    expect(cfg.port).toBe(4000);
    expect(cfg.pinnedCivitaiUsers).toEqual([]);
    expect(cfg.tagFile).toBe("danbooru.csv");
  });

  it("環境変数: SD_RUIZ_PORT はポートを差し替え、GROQ_API_KEY は config に無いときだけ使う", () => {
    tmp = tempDir();
    const path = join(tmp.dir, "config.json");
    writeFileSync(path, JSON.stringify({ port: 4000 }));
    expect(loadConfig(path, { SD_RUIZ_PORT: "5000", GROQ_API_KEY: "env-key" })).toMatchObject({ port: 5000, groqApiKey: "env-key" });
    writeFileSync(path, JSON.stringify({ groqApiKey: "file-key" }));
    expect(loadConfig(path, { GROQ_API_KEY: "env-key" }).groqApiKey).toBe("file-key");
    expect(loadConfig(path, { GROQ_API_KEY: "" }).groqApiKey).toBe("file-key");
  });
});
