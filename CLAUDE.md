# SD-Ruiz

Forge Neo を生成エンジンとして使う、スマホファーストの txt2img 専用フロントエンド + BFF。仕様は SPEC.md。

- Forge Neo 本体のコードは変更しない。連携は REST API (`/sdapi/v1/*`) 経由のみ
- 会話・ドキュメント・コミットメッセージは日本語
- 仕様が決まったら SPEC.md を更新する
- Forge が落ちた原因を調べたら、`server/forge-knowledge.ts` に足す (見分け方・原因・対処と、seen に日付と状況)
