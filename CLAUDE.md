# SD-Ruiz

Forge Neo を生成エンジンとして使う、スマホファーストの txt2img 専用フロントエンド + BFF。仕様は SPEC.md。

- Forge Neo 本体のコードは変更しない。連携は REST API (`/sdapi/v1/*`) 経由のみ
- 会話・ドキュメント・コミットメッセージは日本語
- 仕様が決まったら SPEC.md を更新する
- Forge の生成処理に手を入れるときは、本体ではなく拡張として `forge-extensions/<名前>/` に置き、Forge の `extensions/` からジャンクションでつなぐ (読み込みには Forge の再起動が要る)
- 生成の速さ・画質の比較は `npx tsx tools/bench.ts <spec.json>` (seed 固定で設定違いを生成し、時間・PSNR・WD14 tagger でのプロンプト追従の採点・比較グリッドを `data/bench/` に出す。使い方はファイル先頭。採点の準備は `tools/score/score.py` の先頭)
- Forge が落ちた原因を調べたら、`server/forge-knowledge.ts` に足す (見分け方・原因・対処と、seen に日付と状況。`server/forge-knowledge.test.ts` の実際のログの行にも足す)
- テストは `npm test` (vitest。`server/*.test.ts` と `web/src/**/*.test.ts`)。ロジックを直したら同じ名前の `.test.ts` も直す。テストから `data/` `config.json` には触らない (`server/test-fs.ts` でメモリ上に置き換える)
