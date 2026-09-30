# SD-Ruiz — 仕様書 (SPEC.md)

> ドラフト。設計相談で決まった内容を記録していく。

## 1. 概要 & コンセプト

### 1.1 プロジェクト名
**SD-Ruiz (ルイス)** — 世界一多作な画家 P. Ruiz (Picasso) から。

### 1.2 コンセプト
Forge Neo の Gradio UI を使わず、生成エンジンとしてだけ利用する自作フロントエンド。
本体には一切手を入れないので、Forge Neo 側は `git pull` / 更新をそのまま行える。

### 1.3 既存 UI の不満 (= 解決したいこと)
- プロンプトが長いと読みにくい (強調構文・Dynamic Prompts 構文のハイライトが欲しい、簡易翻訳が欲しい)
- UI のロードが重い
- 余計な機能が多い
- Checkpoint の切り替えが直感的でない
- 見た目がダサい

---

## 2. 構成

```
スマホのブラウザ ─(Tailscale)→ [SD-Ruiz: フロント配信 + BFF] ─(localhost)→ [Forge Neo --api]
```

- 形態: ブラウザアプリ (スマホからの操作がメイン)
- フロント: 軽量 SPA
- BFF: Forge Neo の REST API (`/sdapi/v1/*`) を中継。モデルのプレビュー画像・ワイルドカード・タグ辞書などのファイルもここで読む
- Forge Neo は `--api` 付きで起動する
- 運用: LocalLauncher に 1 サービスとして登録する (`/api/health` でヘルスチェック)
- Forge Neo が停止中の場合は「Forge オフライン」状態を表示する

---

## 3. 機能要件 (案)

### 3.1 対象範囲
- txt2img のみ (img2img / inpaint / ControlNet / ADetailer は対象外)
- Hires fix など使用頻度の低い項目は折りたたむ

### 3.2 プロンプトエディタ
- シンタックスハイライト
  - 強調: `(tag:1.2)` `[tag]` (重みに応じて色の濃さを変える)
  - LoRA: `<lora:name:0.8>` (チップ表示、タップで重みを調整)
  - Dynamic Prompts: `{a|b|c}` `__wildcard__` (括弧の閉じ忘れを警告)
  - `BREAK` / コメント
- タグ補完 (a1111-sd-webui-tagcomplete のタグ CSV を流用)
- 簡易翻訳
  - タグ単位: 辞書による即時表示 (オフライン)
  - 文章単位: ローカル LLM (OmniRoute / Ollama 経由) をオンデマンドで呼ぶ

### 3.3 Checkpoint 選択
- プレビュー画像つきのカードグリッド
- アーキテクチャバッジ (SD / XL / Flux ...)、お気に入り、最近使ったもの
- モデルごとに前回のパラメータ (sampler / steps / CFG / サイズ / seed 等) を記憶し、切り替え時に復元する

### 3.4 LoRA
- カード一覧から、タップでプロンプトに挿入

### 3.5 生成
- 進捗とライブプレビューの表示、中断 / スキップ
- 生成完了を ntfy でプッシュ通知 (任意)
- 直近の生成結果の一覧
- 画像 (PNG info) から設定を読み込んで再生成

### 3.6 連携
- Dynamic Prompts: 展開は Forge 側で行われる想定 (API 経由で有効か要検証)
- Infinite Image Browser / IIB Manager: 当面は併用。再生成の連携口は今後検討

---

## 4. 未決事項
- フロントのフレームワーク / BFF の言語
- ポート番号
- デザインの方向性 (モックアップで確認する)
