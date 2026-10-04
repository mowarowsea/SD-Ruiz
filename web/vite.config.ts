import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5940,
    // 本番を動かしたまま別ポートで試すときは SD_RUIZ_PORT に合わせる
    proxy: { "/api": `http://127.0.0.1:${process.env.SD_RUIZ_PORT ?? 3940}` },
  },
});
