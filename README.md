# SD-Ruiz (ルイス)

Stable Diffusion WebUI Forge Neo を生成エンジンとして使う、スマホファーストの txt2img 専用フロントエンド。

名前の由来は、世界一多作な画家 Pablo **Ruiz** Picasso から。

> 🚧 設計中。仕様は [SPEC.md](SPEC.md) を参照。

## 使い方

1. Forge Neo を `--api` 付きで起動しておく
2. `config.example.json` を `config.json` にコピーし、`forgeDir` に Forge Neo のインストール先を書く
3. `start.bat` で起動 (初回は依存のインストールとビルドを行う)。`http://<ホスト>:3940/` を開く

開発時は `npm run dev` (Vite dev server: 5940)。
