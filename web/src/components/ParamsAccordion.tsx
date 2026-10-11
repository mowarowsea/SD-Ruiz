import { faBolt, faDice, faLock } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { type ReactNode, useState } from "react";
import { type Dmd2Mode, formatRange, type GenerateParams, type Meta, type Recommendation } from "../api";
import { schedulerLabel as labelOf } from "../recommend";
import { NumberField } from "./NumberField";
import { RecommendTip, TipValue } from "./RecommendTip";

type Params = Pick<GenerateParams, "width" | "height" | "steps" | "cfg" | "sampler" | "scheduler" | "seed" | "batch" | "fast" | "dmd2">;

/** DMD2 モードの選択肢と、いつ使うか */
const dmd2Modes: { mode: Dmd2Mode; label: string; note: string }[] = [
  { mode: "off", label: "オフ", note: "少ないステップで描けるようにする LoRA (DMD2)。SDXL向け" },
  { mode: "fast", label: "最速", note: "数を回して当たりを探す用。約 3 倍速。Negative は効かない" },
  { mode: "balanced", label: "Negative あり", note: "約 2 倍速。Negative も効く" },
];

/** ほとんど触らないパラメータ。畳んだ状態では 1 行の要約だけ見せる */
export function ParamsAccordion({
  value,
  onChange,
  meta,
  lastSeed,
  rec,
  arch,
}: {
  value: Params;
  onChange: (patch: Partial<Params>) => void;
  meta: Meta | null;
  lastSeed: number | null;
  /** いまのモデルの推奨 (ラベルの (i) で出す。値は勝手に変えない) */
  rec: Recommendation | null;
  /** いまのモデルの構造 (高速化は sdxl だけ) */
  arch: string | null;
}) {
  // 高速化と DMD2 は SDXL 系でしか確かめていない。オンのまま別のモデルにしたときは、効かないことが分かるよう薄くする
  const sdxl = arch === "sdxl";
  // DMD2 中は Steps / CFG / Sampler / Scheduler をこちらの値で生成する
  const dmd2 = sdxl && value.dmd2 !== "off" ? (meta?.dmd2.presets[value.dmd2] ?? null) : null;
  // DMD2 はステップが少なく高速化の省ける余地が無いので、重ねない
  const fastUsable = sdxl && !dmd2;
  const fastOn = value.fast && fastUsable;
  const shown = dmd2 ?? value;
  const [open, setOpen] = useState(false);
  // 推奨の値。Forge にある名前ならタップでその値にできる
  const sizeTip = rec?.sizes.length ? (
    <RecommendTip>
      {rec.sizes.map((s) => {
        const [width, height] = s.split("x").map(Number);
        return (
          <TipValue key={s} current={value.width === width && value.height === height} onPick={() => onChange({ width, height })}>
            {width}×{height}
          </TipValue>
        );
      })}
    </RecommendTip>
  ) : null;
  const rangeTip = (key: "steps" | "cfg") => {
    const r = rec?.[key];
    if (!r) return null;
    const best = r.best;
    return (
      <RecommendTip>
        <div className="font-mono">{formatRange(r)}</div>
        {best !== null && (
          <div className="mt-2">
            <TipValue current={value[key] === best} onPick={() => onChange({ [key]: best })}>
              {best} にする
            </TipValue>
          </div>
        )}
      </RecommendTip>
    );
  };
  const samplerTip = rec?.samplers.length ? (
    <RecommendTip>
      {rec.samplers.map((s) => (
        <TipValue key={s} current={value.sampler === s} onPick={meta?.samplers.includes(s) ? () => onChange({ sampler: s }) : undefined}>
          {s}
        </TipValue>
      ))}
    </RecommendTip>
  ) : null;
  const schedulerTip = rec?.schedulers.length ? (
    <RecommendTip>
      {rec.schedulers.map((s) => (
        <TipValue key={s} current={value.scheduler === s} onPick={meta?.schedulers.some((x) => x.name === s) ? () => onChange({ scheduler: s }) : undefined}>
          {labelOf(meta, s)}
        </TipValue>
      ))}
    </RecommendTip>
  ) : null;
  const schedulerLabel = meta?.schedulers.find((s) => s.name === value.scheduler)?.label ?? value.scheduler;

  return (
    <div className="rounded-2xl border border-line bg-surface">
      <button className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="text-xs tracking-wider text-muted uppercase">Params</span>
        <span className="min-w-0 flex-1 truncate text-right font-mono text-xs text-muted">
          {value.width}×{value.height} · {shown.steps}st · CFG {shown.cfg} · {shown.sampler} · ×{value.batch}
        </span>
        {dmd2 && <span className="flex-none rounded-full bg-accent/15 px-2 py-0.5 text-[11px] text-accent">DMD2</span>}
        {fastOn && (
          <span className="flex flex-none items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] text-accent" title="高速化オン">
            <FontAwesomeIcon icon={faBolt} className="text-[10px]" />
            高速
          </span>
        )}
        <SeedMark seed={value.seed} />
        <span className={`text-muted transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>

      {open && (
        <div className="grid grid-cols-2 gap-3 border-t border-line p-3">
          <Field label="幅" tip={sizeTip}>
            <NumberField value={value.width} onChange={(width) => onChange({ width })} min={64} max={4096} step={8} ariaLabel="幅" />
          </Field>
          <Field
            label="高さ"
            action={
              <button className="text-accent" onClick={() => onChange({ width: value.height, height: value.width })}>
                ⇄ 入替
              </button>
            }
          >
            <NumberField value={value.height} onChange={(height) => onChange({ height })} min={64} max={4096} step={8} ariaLabel="高さ" />
          </Field>
          {dmd2 && (
            <div className="col-span-2 rounded-lg bg-accent/10 px-3 py-2 text-[11px] text-accent">
              DMD2 中は {dmd2.steps}st · CFG {dmd2.cfg} · {dmd2.sampler} · {labelOf(meta, dmd2.scheduler)} で生成します (下の値はオフにしたとき用)
            </div>
          )}
          <Field label="Steps" tip={rangeTip("steps")} dim={!!dmd2}>
            <NumberField value={value.steps} onChange={(steps) => onChange({ steps })} min={1} max={150} ariaLabel="Steps" />
          </Field>
          <Field label="CFG" tip={rangeTip("cfg")} dim={!!dmd2}>
            <NumberField value={value.cfg} onChange={(cfg) => onChange({ cfg })} min={0} max={30} integer={false} ariaLabel="CFG" />
          </Field>
          <Field label="Sampler" tip={samplerTip} dim={!!dmd2}>
            <select className="field w-full text-sm" aria-label="Sampler" value={value.sampler} onChange={(e) => onChange({ sampler: e.target.value })}>
              {(meta?.samplers ?? [value.sampler]).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Scheduler" tip={schedulerTip} dim={!!dmd2}>
            <select className="field w-full text-sm" aria-label="Scheduler" value={value.scheduler} onChange={(e) => onChange({ scheduler: e.target.value })}>
              {(meta?.schedulers ?? [{ name: value.scheduler, label: schedulerLabel }]).map((s) => (
                <option key={s.name} value={s.name}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Seed"
            action={
              <span className="flex gap-3">
                <button className="text-accent" onClick={() => onChange({ seed: -1 })} aria-label="ランダムにする">
                  <FontAwesomeIcon icon={faDice} /> ランダム
                </button>
                <button className="text-accent disabled:opacity-40" disabled={lastSeed === null} onClick={() => lastSeed !== null && onChange({ seed: lastSeed })}>
                  ♻ 前回
                </button>
              </span>
            }
          >
            <NumberField value={value.seed} onChange={(seed) => onChange({ seed })} min={-1} ariaLabel="Seed" />
          </Field>
          <Field label="Batch">
            <NumberField value={value.batch} onChange={(batch) => onChange({ batch })} min={1} max={8} ariaLabel="Batch" />
          </Field>
          <div className={`col-span-2 border-t border-line pt-3 ${sdxl ? "" : "opacity-50"}`}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-sm">DMD2</span>
              <div className="flex rounded-full border border-line p-0.5 text-xs" role="radiogroup" aria-label="DMD2">
                {dmd2Modes.map((m) => (
                  <button
                    key={m.mode}
                    role="radio"
                    aria-checked={value.dmd2 === m.mode}
                    disabled={!sdxl}
                    onClick={() => onChange({ dmd2: m.mode })}
                    className={`rounded-full px-3 py-1 ${value.dmd2 === m.mode ? "bg-accent/20 text-accent" : "text-muted"}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="text-[11px] text-muted">{sdxl ? dmd2Modes.find((m) => m.mode === value.dmd2)?.note : "SDXL 系のモデル (Illustrious / NoobAI / Pony / SDXL) でだけ使えます"}</div>
          </div>
          <label className={`col-span-2 flex items-start gap-2 ${fastUsable ? "" : "opacity-50"}`}>
            <input type="checkbox" checked={fastOn} disabled={!fastUsable} onChange={(e) => onChange({ fast: e.target.checked })} className="mt-0.5 size-4 accent-accent" />
            <span className="min-w-0">
              <span className="text-sm">
                <FontAwesomeIcon icon={faBolt} className="mr-1 text-xs text-accent" />
                高速化
              </span>
              <span className="block text-[11px] text-muted">
                {sdxl && value.dmd2 !== "off" ? "DMD2 と一緒には使えません" : "SDXL向け。ステップ数が多いほど大きくなります。(sd_forge_spectrum(改))"}
              </span>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}

/** 畳んだ状態でも Seed が固定かどうか分かるように。固定は忘れがちなので色を付けて目立たせる */
function SeedMark({ seed }: { seed: number }) {
  const fixed = seed !== -1;
  return (
    <span
      className={`flex flex-none items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${fixed ? "bg-accent/15 text-accent" : "bg-surface2 text-muted"}`}
      title={fixed ? `Seed 固定: ${seed}` : "Seed ランダム"}
    >
      <FontAwesomeIcon icon={fixed ? faLock : faDice} className="text-[10px]" />
      {fixed ? "固定" : "ランダム"}
    </span>
  );
}

/**
 * 見出しの行 (推奨の (i) と ⇄ などのボタン) は label で包まない。
 * label の中にボタンがあると、そのボタンが label の対象になり、見出しの文字や (i) の吹き出しの文字を押しただけでボタンが押されてしまうため
 */
function Field({ label, action, tip, dim, children }: { label: string; action?: ReactNode; tip?: ReactNode; dim?: boolean; children: ReactNode }) {
  return (
    <div className={`min-w-0 ${dim ? "opacity-40" : ""}`}>
      <div className="mb-1 flex justify-between text-[11px] text-muted">
        <span>
          {label}
          {tip}
        </span>
        {action}
      </div>
      {children}
    </div>
  );
}
