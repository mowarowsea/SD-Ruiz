# SD-Ruiz

Forge Neo を生成エンジンとして使う、スマホファーストの txt2img 専用フロントエンド + BFF。仕様は SPEC.md (決まったことは全部ここ。設計相談で決まったら更新する)。

## 使い方 (機能の判断の前提)

- **ガチャ**: Batch 2 で、Dynamic Prompts (`{a|b}` / `__wildcard__`) である程度ランダム化して回しまくる。1 回の生成の設定を作り込むより、数を回して当たりを拾う。だから grid 中心、プロンプトは書いたまま (Template) で残す、生成 ID で grid と元画像を紐付ける
- **txt2img 一発出しの品質**は上げたい (推奨設定、PAG / APG、高速化、モデルごとの設定)。でも i2i / Hires fix / ADetailer / inpaint で時間をかけて仕上げるほどのこだわりは無い。対象外 (SPEC 3.1) のまま
- **ギャラリーのタグ**は「気に入ったプロンプトを残す」のが主目的。画像のコレクションではない。タグを付けたら保管庫 (Saved) に移り、整理 (タグなしの一括片付け) の対象から外れる。プロンプトへ戻せること (to t2i、Template) が大事
- **主にスマホ** (Tailscale 越し)。片手・縦画面・ソフトキーボード前提。PC は補助。だから数値は手打ち、シートとボトムナビ、キーボードが出ている間の挙動に気を使う、画像は WebP で軽く

迷ったら「ガチャを回す手が止まらないか」「スマホで片手で済むか」で決める。

## 守ること

- Forge Neo 本体のコードは変更しない。連携は REST API (`/sdapi/v1/*`) 経由のみ。生成処理に手を入れるなら拡張として `forge-extensions/<名前>/` に置き、Forge の `extensions/` からジャンクションでつなぐ (読み込みには Forge の再起動が要る)
- 会話・ドキュメント・コミットメッセージ・コードのコメントは日本語
- 仕様が決まったら SPEC.md を更新する。ロジックを直したら同じ名前の `.test.ts` も直す
- Forge が落ちた原因を調べたら `server/forge-knowledge.ts` に足す (見分け方・原因・対処と、`seen` に日付と状況)。`server/forge-knowledge.test.ts` の「実際のログの行」にも足す
- Forge に新しく何かを渡す機能を足すときは、`server/precheck.ts` に事前の確認も足す (下の「Forge は黙って捨てる」)

## 構成の地図

```
スマホ ─(Tailscale)→ web/ (React + Vite + Tailwind v4 + CodeMirror 6) ─/api/*→ server/ (Fastify, tsx で直接実行) ─→ Forge Neo --api (7862)
                                                                                                                ├→ IIB (Forge の拡張の API)
                                                                                                                ├→ LocalLauncher (8765)
                                                                                                                ├→ Civitai API / Groq API
                                                                                                                └→ Windows (PowerShell)
```

### server/ — 何が外に触るか

| モジュール | 役目 | 触る先 |
|---|---|---|
| `index.ts` | ルーティングと配線だけ。ロジックは持たない | 全部 |
| `forge.ts` | `/sdapi/v1/*` の薄いクライアント | Forge |
| `jobs.ts` | 生成ジョブ (同時 1 件)。リクエストの組み立て、`data/last/` の保存と復元 | Forge (txt2img) |
| `speed.ts` | 高速化 / DMD2 / PAG / APG。フォームの値は変えず、Forge に送る直前に差し替える | なし |
| `precheck.ts` | 生成前の確認 (Checkpoint / TE・VAE / LoRA / 拡張が Forge にあるか) | Forge (一覧) |
| `gallery.ts` | 出力フォルダの走査、grid↔元画像の対応、保管庫 (Saved) への出し入れ、整理、ゴミ箱 | ファイル、IIB の API と `iib.db` (読み取り専用) |
| `library.ts` | モデルの付随ファイル (プレビュー・`cm-info.json`・`civitai.info`)、safetensors のヘッダからのベースモデル推定、モデルの削除 | ファイル、sharp |
| `base.ts` | ベースモデル名の正規化 (`familyOf`) と中身の構造 (`archOf`)、組み込みの既定 | なし |
| `prefs.ts` | お気に入り・最近・モデルごと / ベースモデルごとの設定 (`data/prefs.json`) | ファイル |
| `recommend.ts` | Civitai の説明文と作例 → Groq で推奨設定の JSON に。`data/recommended.json` と作例画像 | Civitai、Groq、ファイル (SHA256 で数 GB 読むことがある) |
| `dictionary.ts` | タグ補完・和訳・逆引き (tagcomplete の CSV)。直した訳は `data/translations.csv` | ファイル |
| `wildcards.ts` | Dynamic Prompts の wildcards/ の編集 | ファイル |
| `launcher.ts` | LocalLauncher に Forge の起動 / 再起動 / ログを頼む | LocalLauncher |
| `forge-doctor.ts` | LocalLauncher のログを起動ごとに分けて診断。Windows のイベントとメモリ | PowerShell (win32 以外では空) |
| `forge-knowledge.ts` | 落ちた原因のナレッジ (正規表現とイベントの照合) | なし |
| `config.ts` | `config.json` (git 管理外) と既定。環境変数 `SD_RUIZ_PORT` / `GROQ_API_KEY` | ファイル |

### web/src/ — 純粋なロジックは `prompt/` と直下の `.ts`

- `prompt/parse.ts` が構文の唯一の解析器 (強調・括弧・LoRA・Dynamic Prompts・コメント)。ハイライト (`highlight.ts`)・折りたたみ (`structure.ts`)・トークン数 (`tokens.ts`)・差分 (`../infodiff.ts`) は全部これの結果を使う。構文を足すならまずここ
- `prompt/find.ts` 検索置換 (タグ単位)、`prompt/lora.ts` `<lora:>` の読み書き、`prompt/complete.ts` 補完
- `infotext.ts` PNG の生成情報の読み取りと生成画面への反映、`infodiff.ts` 前の生成との違い、`recommend.ts` 作例の設定の変換、`api.ts` BFF の型と呼び出し
- `pages/` `components/` は React。`hooks.ts` にスマホのキーボード判定など

## Forge は黙って捨てる (事前確認が要る理由)

Forge は渡したものが無くても教えてくれない。知らない Checkpoint → いま読み込んでいるモデルで生成。知らない TE / VAE のファイル名 → 無視して分かりにくい落ち方。知らない LoRA → 無視 (DMD2 が効かないまま 8 ステップ)。知らないスクリプト名 → 英語の 500。
だから `server/precheck.ts` で先に確かめて日本語で止める。Forge の TE / VAE・拡張の一覧は Forge の起動時にしか更新されない (Checkpoint / LoRA は `refresh-*` で読み直せる)。

## ファイルの名前の決まりごと (ギャラリー)

- 生成のたびに `override_settings` で `samples_filename_pattern: "[seed]-[job_timestamp]"` と `grid_extended_filename: true` を送る。元画像 `00123-<seed>-<生成ID 14桁>.png`、grid `grid-0020-<seed>-<生成ID>.jpg`。同じ生成 ID が対応
- 生成 ID の無い古いもの (2026-10-04 より前) は時間 (2 分以内) と Seed の連番で推定する (`gallery.ts` の `outputMap`)
- 保管庫 (Saved) の名前は Forge の Save に合わせる: grid `<日付>_grid-0020.jpg`、元画像 `<grid の名前>_<元の名前>`。古い Save には `images_` 接頭辞付きもある。保管庫のタグは `Saved/.sd-ruiz-tags.json`、記録が無ければ Like
- 枚数は `batch_size: 1, n_iter: N` で送る (Anima の LLM 系 TE はバッチ内でプロンプト長が違うと落ちる)
- `dp_write_raw_template: true` で書いたままのプロンプトを `Template` として PNG に残す (コメントは Dynamic Prompts / Forge が消すため)

## data/ と cache/ (git 管理外)

| 場所 | 誰が書く | 消すと |
|---|---|---|
| `data/prefs.json` | prefs.ts | お気に入り・最近・モデルごとの設定が消える |
| `data/last/` (`job.json` + `N.png`) | jobs.ts | 「最後に成功した状態」への復帰ができなくなるだけ |
| `data/translations.csv` | dictionary.ts | 自分で直した訳が消える |
| `data/recommended.json` / `data/model-hashes.json` / `data/recommend-images/` | recommend.ts | 推奨と作例を取り直す (Groq を呼び直す。ハッシュは数 GB 読み直す) |
| `data/bench/` | tools/bench.ts | ベンチの結果 |
| `cache/thumbs/` | library.ts | 作り直すだけ |

`data/` の JSON は一時ファイルに書いてから入れ替え、壊れていれば `.broken` に退けて空から始める。テストはどれにも触らない。

## 開発

- `npm run dev` (BFF 3940 + Vite 5940)、本番は `start.bat` (ビルドして BFF が配信)。LocalLauncher に 1 サービスとして登録し `/api/health` で見る
- `npm test` (vitest。`server/*.test.ts` と `web/src/**/*.test.ts`)。ファイルを触るテストは一時フォルダに作り、`data/` と `config.json` は `server/test-fs.ts` で node:fs をメモリ上に差し替える。ギャラリーは `node:sqlite` で小さな `iib.db` を作る。CodeMirror と React の描画は対象外
- `npm run typecheck` (server と web の両方)
- 生成の速さ・画質の比較は `npx tsx tools/bench.ts <spec.json>` (seed 固定で設定違いを生成し、時間・PSNR・WD14 tagger でのプロンプト追従の採点・比較グリッドを `data/bench/` に出す。使い方はファイル先頭、採点の準備は `tools/score/score.py` の先頭)。数字を SPEC に書くときは日付も
