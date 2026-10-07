import { faArrowRotateRight, faArrowUpRightFromSquare, faChevronLeft } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { type ReactNode, useState } from "react";
import { formatRange, sampleImage, type GenerateParams, type Meta, type RecommendView, type Sample } from "../api";
import { usePersistentState } from "../hooks";
import { sampleParams, schedulerLabel } from "../recommend";
import { PromptEditor } from "./PromptEditor";
import { Sheet } from "./Sheet";

/** R18 (nsfwLevel: 4 R / 8 X / 16 XXX) */
const isR18 = (s: Sample) => s.nsfwLevel >= 4;

/** モデル (Checkpoint / LoRA) の推奨設定と作例。作例のプロンプト・設定を生成画面に入れられる */
export function RecommendSheet({
  open,
  onClose,
  view,
  meta,
  onRefresh,
  onUse,
  name,
  useNote,
}: {
  open: boolean;
  onClose: () => void;
  view: RecommendView | null;
  meta: Meta | null;
  onRefresh: () => Promise<void>;
  /** 作例を使う。skipped は Forge に合わずに入れなかった項目。入れたら true (上書きの確認でやめたら false で、シートは閉じない) */
  onUse: (patch: Partial<GenerateParams>, skipped: string[]) => boolean;
  /** Civitai の名前が分かるまで出すモデルの名前 (一覧から開いたとき) */
  name?: string;
  /** 作例を使うときに、上書きのほかにすること (「Checkpoint もこのモデルに切り替えます」など) */
  useNote?: string;
}) {
  const [selected, setSelected] = useState<Sample | null>(null);
  const [opts, setOpts] = usePersistentState("ruiz.samples", { r18: false });
  const [refreshing, setRefreshing] = useState(false);
  const close = () => {
    setSelected(null);
    onClose();
  };
  const entry = view?.entry;
  const rec = entry?.rec;
  const samples = entry?.samples ?? [];
  // 取得待ちのあいだと、Civitai に無いモデルは出さない
  const canRefresh = !!view && view.status !== "pending" && view.status !== "none";

  const refresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const link = view?.url && (
    <a href={view.url} target="_blank" rel="noreferrer" className="text-accent">
      Civitai <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="text-[10px]" />
    </a>
  );

  if (selected)
    return (
      <Sheet open={open} onClose={close} title="作例" aside={link}>
        <SampleDetail sample={selected} v={entry?.imagesTriedAt ?? 0} useNote={useNote} meta={meta} onBack={() => setSelected(null)} onUse={(patch, skipped) => onUse(patch, skipped) && close()} />
      </Sheet>
    );

  return (
    <Sheet open={open} onClose={close} title="推奨と作例" aside={link}>
      {(entry?.name || name || canRefresh) && (
        <div className="mb-3 flex items-center gap-3">
          <p className="min-w-0 flex-1 truncate text-xs text-muted">
            {entry?.name ?? name}
            {entry && <span className="ml-1.5">· {new Date(entry.fetchedAt).toLocaleDateString()} 取得</span>}
          </p>
          {canRefresh && (
            <button onClick={refresh} disabled={refreshing} className="flex-none rounded-full border border-line px-2.5 py-1 text-[11px] text-accent disabled:opacity-40">
              <FontAwesomeIcon icon={faArrowRotateRight} className={refreshing ? "animate-spin" : ""} /> 再取得
            </button>
          )}
        </div>
      )}
      <StatusNote view={view} />

      {rec && (
        <dl className="divide-y divide-line rounded-2xl border border-line bg-surface text-sm">
          <Row label="重み">{rec.weight ? formatRange(rec.weight) : null}</Row>
          <Row label="トリガー" mono>
            {rec.triggers?.length ? rec.triggers.join(", ") : null}
          </Row>
          <Row label="Steps">{formatRange(rec.steps)}</Row>
          <Row label="CFG">{formatRange(rec.cfg)}</Row>
          <Row label="Sampler">{rec.samplers.join(" / ") || null}</Row>
          <Row label="Scheduler">{rec.schedulers.map((s) => schedulerLabel(meta, s)).join(" / ") || null}</Row>
          <Row label="サイズ">{rec.sizes.map((s) => s.replace("x", "×")).join(" / ") || null}</Row>
          <Row label="Clip skip">{rec.clipSkip}</Row>
          <Row label="Hires fix">{rec.hires}</Row>
          <Row label="クオリティ" mono>
            {rec.quality}
          </Row>
          <Row label="ネガティブ" mono>
            {rec.negative}
          </Row>
          {rec.notes.length > 0 && (
            <Row label="注意">
              <ul className="list-disc space-y-0.5 pl-4">
                {rec.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </Row>
          )}
        </dl>
      )}
      {rec && (rec.quality || rec.negative) && <p className="mt-2 px-1 text-[11px] text-muted">プロンプト欄で /quality・/negative と打つと補完に出ます</p>}

      {samples.length > 0 && (
        <>
          <div className="mt-5 mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              作例 ({samples.length})
              {samples.some((s) => s.by) && <span className="ml-1.5 text-[11px] font-normal text-muted">@ はほかの人の投稿</span>}
            </h3>
            {samples.some(isR18) && (
              <button onClick={() => setOpts({ r18: !opts.r18 })} className={`rounded-full border px-2.5 py-1 text-[11px] ${opts.r18 ? "border-accent text-accent" : "border-line text-muted"}`}>
                R18 を表示
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {samples.map((s) => (
              <button key={s.url} onClick={() => setSelected(s)} className="relative overflow-hidden rounded-xl bg-surface2" style={{ aspectRatio: s.width && s.height ? `${s.width} / ${s.height}` : "2 / 3" }}>
                <img src={sampleImage(s, "thumb", entry?.imagesTriedAt)} alt="" loading="lazy" className={`size-full object-cover ${isR18(s) && !opts.r18 ? "scale-110 blur-xl" : ""}`} />
                {isR18(s) && !opts.r18 && <span className="absolute inset-0 grid place-items-center text-xs text-white/80">R18</span>}
                {(s.noInfo || s.by) && (
                  <span className={`absolute bottom-1.5 left-1.5 max-w-[calc(100%-12px)] truncate rounded-md px-1.5 py-0.5 text-[10px] ${s.pinned ? "bg-accent text-accent-ink" : "bg-black/60 text-white/90"}`}>
                    {[s.by && `@${s.by}`, s.noInfo && "生成情報なし"].filter(Boolean).join(" · ")}
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}

function StatusNote({ view }: { view: RecommendView | null }) {
  const note = (text: string, danger = false) => <p className={`mb-3 rounded-lg bg-surface2 px-3 py-2 text-xs leading-relaxed ${danger ? "text-danger" : ""}`}>{text}</p>;
  if (!view) return note("読み込み中…");
  switch (view.status) {
    case "pending":
      if (view.entry) return note("Civitai から取り直しています (作例の画像の保存も)。ほかのモデルの順番待ちで少しかかることがあります。いまは前に取ったものを出しています");
      return note("Civitai から取得中です。ほかのモデルの順番待ちや、ファイルのハッシュの計算 (付随ファイルの無いモデル) で少しかかります");
    case "none":
      return note("Civitai にこのモデルが見つかりませんでした (ファイルのハッシュで探しています)");
    case "gone":
      return note(view.entry?.samples.length || view.entry?.rec ? "Civitai からこのモデルが消えています (前に取った推奨と作例を出しています)" : "Civitai からこのモデルが消えています");
    case "no-llm":
      return note("Groq の API キーが無いので、推奨設定は読み取っていません (作例だけ)。環境変数 GROQ_API_KEY か config.json の groqApiKey に入れてください");
    case "error":
      return note(`取得できませんでした: ${view.entry?.error ?? view.error ?? ""} (1 時間後に自動で取り直します。前に取ったものがあればそれを出しています)`, true);
    default:
      return view.entry?.rec && Object.values(view.entry.rec).every((v) => v === null || (Array.isArray(v) && !v.length)) ? note("説明文と作例に推奨設定が見つかりませんでした") : null;
  }
}

function Row({ label, mono = false, children }: { label: string; mono?: boolean; children: ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="flex gap-3 px-3 py-2.5">
      <dt className="w-20 flex-none text-xs text-muted">{label}</dt>
      <dd className={`min-w-0 flex-1 break-words ${mono ? "font-mono text-xs" : "text-[13px]"}`}>{children}</dd>
    </div>
  );
}

function SampleDetail({ sample, v, useNote, meta, onBack, onUse }: { sample: Sample; v: number; useNote?: string; meta: Meta | null; onBack: () => void; onUse: (patch: Partial<GenerateParams>, skipped: string[]) => void }) {
  return (
    <div>
      <button onClick={onBack} className="mb-3 text-xs text-accent">
        <FontAwesomeIcon icon={faChevronLeft} /> 一覧へ
      </button>
      <img src={sampleImage(sample, "full", v)} alt="" className="mx-auto max-h-[50vh] rounded-xl object-contain" />
      {sample.by && <p className="mt-3 text-[11px] text-muted">@{sample.by} さんの投稿 (作者の作例ではありません)</p>}
      {sample.noInfo ? (
        <p className="mt-3 rounded-lg bg-surface2 px-3 py-2 text-xs leading-relaxed">この作例には生成情報 (プロンプトや設定) が付いていないので、見るだけです</p>
      ) : (
        <SampleInfo sample={sample} useNote={useNote} meta={meta} onUse={onUse} />
      )}
    </div>
  );
}

/** 作例の生成情報と、生成画面に入れるボタン */
function SampleInfo({ sample, useNote, meta, onUse }: { sample: Sample; useNote?: string; meta: Meta | null; onUse: (patch: Partial<GenerateParams>, skipped: string[]) => void }) {
  const params = [
    sample.width && `${sample.width}×${sample.height}`,
    sample.steps !== null && `${sample.steps}st`,
    sample.cfg !== null && `CFG ${sample.cfg}`,
    sample.sampler,
    sample.scheduler,
    sample.clipSkip !== null && `Clip skip ${sample.clipSkip}`,
    sample.seed !== null && `Seed ${sample.seed}`,
  ].filter(Boolean);
  const prompts = { prompt: sample.prompt, negative: sample.negative };
  return (
    <>
      <p className="mt-3 font-mono text-[11px] text-muted">{params.join(" · ")}</p>
      <div className="mt-3 mb-1.5 text-[11px] tracking-wider text-muted uppercase">Prompt</div>
      <PromptEditor value={sample.prompt} readOnly copyable />
      {sample.negative && (
        <>
          <div className="mt-3 mb-1.5 text-[11px] tracking-wider text-muted uppercase">Negative</div>
          <PromptEditor value={sample.negative} readOnly copyable />
        </>
      )}
      <div className="mt-4 flex gap-2">
        <button onClick={() => onUse(prompts, [])} className="flex-1 rounded-2xl border border-accent py-3 text-sm font-semibold text-accent">
          プロンプトを使う
        </button>
        <button
          onClick={() => {
            const { patch, skipped } = sampleParams(meta, sample);
            onUse({ ...prompts, ...patch }, skipped);
          }}
          className="flex-1 rounded-2xl bg-accent py-3 text-sm font-semibold text-accent-ink"
        >
          設定も使う
        </button>
      </div>
      <p className="mt-2 text-[11px] text-muted">
        いまの Prompt / Negative を上書きします (Seed は変えません)
        {useNote && `。${useNote}`}
      </p>
    </>
  );
}
