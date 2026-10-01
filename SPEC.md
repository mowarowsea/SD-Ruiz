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
- txt2img のみ (img2img / inpaint / ControlNet / ADetailer / Hires fix は対象外)
- 画面: 生成 / ギャラリー / メニュー の 3 タブ (下部ナビ)。メニューはたまに使う機能のサブメニューで、機能はここに増やしていく
- デザイン: Atelier (暖色寄りのダーク + セリフ体の見出し)、アクセントは彩度を落としたローズ `#c99bab` (`mockups/index.html`)
- 生成画面: Prompt と Negative は常に表示 (Negative もよく使う)。Params (サイズ / Steps / CFG / Sampler / Scheduler / Seed / Batch) はほとんど変えないのでアコーディオンで畳む
- 数値は基本的に手打ちで入力する (スライダーは使わない)

### 3.2 プロンプトエディタ
- CodeMirror 6 (`web/src/prompt/`)。Prompt / Negative の両方で使う
- シンタックスハイライト
  - 強調: `(tag)` `(tag:1.2)` `[tag]`。入れ子の倍率を掛け合わせ、強いほどローズ、弱いほど青の背景を濃くする
  - 括弧は入れ子の深さで色分けし、閉じ忘れ・対応しない括弧は波線で警告
  - LoRA: `<lora:name:0.8>` (チップ風の表示。タップで重みを調整するのはステップ 5)
  - Dynamic Prompts: `{a|b|c}` `{2$$a|b}` `__wildcard__`
  - `BREAK` / `AND`、`\(` などのエスケープ
  - コメント: Forge の "Remove Comments from Prompts" と同じ `#` `//` `/* */`
- 入力補完 (tagcomplete の設定に合わせた挙動)
  - タグ: `tags/danbooru.csv` を BFF がメモリに読み、前方一致 → 別名 → 部分一致を件数順に返す。カテゴリで色分け
  - 確定時はアンダースコアを空白に、括弧をエスケープし、後ろに `, ` を付ける
  - `__` でワイルドカード、`<` でLoRA を補完 (`<lora:name:1>` を挿入)
- 簡易翻訳
  - タグ単位: 辞書による即時表示 (オフライン)。`config.json` の `translationFile` に `tag,訳` 形式の CSV を置くと補完候補に訳が出る (エディタ内の表示はステップ 6)
  - 文章単位: ローカル LLM (OmniRoute / Ollama 経由) をオンデマンドで呼ぶ

### 3.3 Checkpoint 選択
- プレビュー画像つきのカードグリッド
- アーキテクチャバッジ (SD / XL / Flux ...)、お気に入り、最近使ったもの
- モデルごとに前回のパラメータ (sampler / steps / CFG / サイズ / seed 等) を記憶し、切り替え時に復元する

### 3.4 LoRA
- ボトムシートで検索・選択し、重みは数値を手打ちで調整
- 使用中の LoRA は生成画面にチップで表示

### 3.4.1 ワイルドカード編集 (メニュー内)
- Dynamic Prompts の wildcards ディレクトリ (フォルダ階層あり) を一覧・編集・新規作成
- 行単位で編集 (行の中もシンタックスハイライト)
- 展開プレビュー (ランダムに数件引いて表示)

### 3.4.2 ギャラリー
- 日付ごとのグリッド、Like / 今日 / モデル / タグで絞り込み、プロンプト検索
- 画像詳細: Like・タグ・共有・削除、「この設定で生成画面へ」
- バックエンドは Forge 内で動いている IIB の API (`/infinite_image_browsing/*`) に任せる
  (サムネイル・生成情報・検索・カスタムタグ)。タグは IIB の DB に書くので IIB / IIB Manager と共有される

### 3.5 生成
- 進捗とライブプレビューの表示、中断
- 生成ジョブは BFF が持つ。生成中にスマホを閉じても生成は続き、開き直すと結果を受け取れる
- 入力内容は端末 (localStorage) に保存し、リロードしても残す
- 生成完了を ntfy でプッシュ通知 (任意)
- 直近の生成結果の一覧
- 画像ビューア (Forge に入れていた改造と同じ操作): 全画面表示で、左右 25% のタップで前後送り (端で反対側へ戻る)、真ん中のタップで閉じる。スマホの「戻る」でも閉じる
- 画像 (PNG info) から設定を読み込んで再生成

### 3.6 連携
- Dynamic Prompts: 展開は Forge 側で行われる想定 (API 経由で有効か要検証)
- Infinite Image Browser: ギャラリーのバックエンドとして API を利用 (3.4.2)。IIB Manager の整理フローはそのまま使える

---

## 4. 技術構成
- BFF: Fastify + TypeScript (`server/`、tsx で直接実行)
- フロント: React + Vite + TypeScript + Tailwind CSS v4 (`web/`)
- プロンプトエディタ: CodeMirror 6
- ポート: 3940 (BFF。本番はビルド済みフロントも配信) / 5940 (開発時の Vite dev server)
- 設定: `config.json` (git 管理外。`config.example.json` を参照)
  - `forgeDir`: Forge Neo のインストール先。タグ CSV とワイルドカードをここから読む
  - 環境変数 `SD_RUIZ_PORT` でポートだけ差し替えられる (本番を動かしたまま別ポートで試すとき用)
- 配信は `@fastify/compress` で圧縮する (Tailscale 越しのスマホ向け)

## 5. 未決事項
- デザインの方向性 (モックアップで確認する)
