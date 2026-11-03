import { createApp, defaultDeps } from "./app.js";
import { loadConfig } from "./config.js";

const cfg = loadConfig();
const deps = defaultDeps(cfg);
const server = await createApp(cfg, deps);

await server.listen({ port: cfg.port, host: cfg.host });
server.log.info(`Forge: ${cfg.forgeUrl}`);
server.log.info(cfg.forgeDir ? `タグ ${deps.tags.size} 件・訳 ${deps.tags.translationCount} 件を読み込みました` : "forgeDir が未設定なのでタグ補完は無効です");

// ギャラリーを初めて開いたときに待たせないよう、フォルダの一覧とタグを先に読んでおく (Forge が落ちていれば開いたときに読む)
void Promise.all([deps.gallery.list({ kind: "grid", offset: 0, limit: 1 }), deps.gallery.list({ kind: "image", offset: 0, limit: 1 })]).catch(() => {});
