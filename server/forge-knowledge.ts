// Forge Neo が落ちた・おかしくなったときの原因のナレッジ。
// 落ちるたびに原因を調べて、ここに足していく (seen に日付と状況を残す)。
// 診断 (forge-doctor.ts) は、セッションのログと同じ時間帯の Windows のイベントをこれに照らし合わせる

export interface WinEvent {
  /** ISO 8601 */
  time: string;
  /** app-crash: python.exe のアプリケーションエラー (Application / 1000)。commit-exhausted: 仮想メモリ不足の検出 (System / 2004) */
  kind: "app-crash" | "commit-exhausted";
  module?: string;
  code?: string;
  pid?: string;
  message?: string;
}

export interface Knowledge {
  id: string;
  title: string;
  /** crash: 落ちた原因 / warn: 落ちてはいないが問題 / info: 気にしなくてよいもの */
  level: "crash" | "warn" | "info";
  /** セッションのログのどこかに出ていれば該当 */
  log?: RegExp;
  /** 終了したセッションで、終わる直前の数行に出ていれば該当 */
  last?: RegExp;
  /** セッションの間に起きた Windows のイベントで該当 */
  event?: (e: WinEvent) => boolean;
  cause: string;
  remedy: string;
  /** これまでに見た例 */
  seen: string[];
}

export const knowledge: Knowledge[] = [
  {
    id: "commit-exhausted",
    title: "メモリ不足 (Windows の仮想メモリの上限)",
    level: "crash",
    log: /DefaultCPUAllocator: not enough memory/,
    event: (e) => e.kind === "commit-exhausted",
    cause:
      "RAM とページファイルを合わせた上限 (コミット上限) を使い切った。Forge (python) はモデルを切り替えるたびに使用量が増えていき、20GB を超えることがある。WSL (vmmemWSL) も 8GB ほど使っている。上限に近づくと Forge は torch_cpu.dll の中でアクセス違反 (0xC0000005) を起こして、エラーを出さずに落ちる",
    remedy:
      "Forge を起動し直せば戻る。続くようなら: ページファイルを大きくする (いまは 20GB 固定) / .wslconfig で WSL のメモリを絞る / 使わないときは WSL のサービス (Ollama など) を止める / モデルの切り替えを控える",
    seen: ["2026-10-01: 1 日で 5 回。python.exe が 23.7GB、vmmemWSL が 8.3GB で上限 (RAM 32GB + ページファイル 20GB) に達した"],
  },
  {
    id: "native-crash",
    title: "Forge のプロセスがクラッシュ (アクセス違反)",
    level: "crash",
    log: /Exception Code: 0xC0000005/i,
    event: (e) => e.kind === "app-crash",
    cause: "torch / Python の DLL の中で落ちたので、Python のエラー (Traceback) は出ない。これまではどれもメモリ不足と同じタイミングで起きている",
    remedy: "メモリ不足も出ていればそちらが原因。メモリに余裕があるのに続くなら、torch や GPU ドライバの更新を疑う",
    seen: ["2026-10-01: torch_cpu.dll / VCRUNTIME140.dll で 0xc0000005。どれもメモリ不足と同時"],
  },
  {
    id: "died-loading-model",
    title: "モデルの読み込み中に終了",
    level: "crash",
    last: /^Loading Model:/,
    cause: "Checkpoint を切り替えるときは、一時的に新しいモデルの分だけ余計にメモリを使う。メモリが足りないとここで落ちやすい",
    remedy: "メモリ不足と同じ。切り替える前に Forge を起動し直しておくと安全",
    seen: ["2026-10-01: novaMoeXL / semiRealIllustrious への切り替えで 4 回"],
  },
  {
    id: "cuda-oom",
    title: "VRAM 不足",
    level: "warn",
    log: /CUDA out of memory|OutOfMemoryError/,
    cause: "生成に GPU のメモリが足りなかった。Forge は動き続けるが、その生成は失敗する",
    remedy: "解像度やバッチ数を下げる",
    seen: [],
  },
  {
    id: "port-in-use",
    title: "ポートが使用中 (二重起動)",
    level: "crash",
    log: /error while attempting to bind on address|Cannot find empty port/,
    cause: "前の Forge が残ったまま、もう 1 つ起動しようとした",
    remedy: "動いている方をそのまま使う。応答が無いなら「再起動」で前のプロセスごと止めてから起動する",
    seen: ["2026-10-01: 再起動の直後に起動を重ねて 7862 が使用中になった"],
  },
  {
    id: "low-vram-warning",
    title: "VRAM の空きが少ないという警告",
    level: "info",
    log: /The current free memory for GPU is/,
    cause: "生成中の VRAM の空きが少ないという警告。遅くなることがあるだけで、落ちる原因ではない",
    remedy: "気にしなくてよい",
    seen: ["2026-10-01: 生成のたびに出ている"],
  },
  {
    id: "stale-gradio-tab",
    title: "古い Forge のタブからのエラー",
    level: "info",
    log: /blocks_config\.blocks\[key\]/,
    cause: "Forge を起動し直す前から開いていたブラウザのタブが、古い画面のまま通信している (KeyError: 850 など)。落ちる原因ではない",
    remedy: "Forge の画面を開いているタブを再読み込みする",
    seen: ["2026-10-01: 起動のたびに KeyError: 818 / 848 / 850"],
  },
];
