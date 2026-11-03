import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/**/*.test.ts", "web/src/**/*.test.ts"],
    environment: "node",
    // node:sqlite (ギャラリーのタグ) の ExperimentalWarning を出さない
    execArgv: ["--no-warnings=ExperimentalWarning"],
  },
});
