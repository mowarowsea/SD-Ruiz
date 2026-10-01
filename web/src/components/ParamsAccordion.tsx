import { type ReactNode, useState } from "react";
import type { GenerateParams, Meta } from "../api";
import { NumberField } from "./NumberField";

type Params = Pick<GenerateParams, "width" | "height" | "steps" | "cfg" | "sampler" | "scheduler" | "seed" | "batch">;

/** ほとんど触らないパラメータ。畳んだ状態では 1 行の要約だけ見せる */
export function ParamsAccordion({ value, onChange, meta, lastSeed }: { value: Params; onChange: (patch: Partial<Params>) => void; meta: Meta | null; lastSeed: number | null }) {
  const [open, setOpen] = useState(false);
  const schedulerLabel = meta?.schedulers.find((s) => s.name === value.scheduler)?.label ?? value.scheduler;

  return (
    <div className="rounded-2xl border border-line bg-surface">
      <button className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="text-xs tracking-wider text-muted uppercase">Params</span>
        <span className="min-w-0 flex-1 truncate text-right font-mono text-xs text-muted">
          {value.width}×{value.height} · {value.steps}st · CFG {value.cfg} · {value.sampler} · ×{value.batch}
        </span>
        <span className={`text-muted transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>

      {open && (
        <div className="grid grid-cols-2 gap-3 border-t border-line p-3">
          <Field label="幅">
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
          <Field label="Steps">
            <NumberField value={value.steps} onChange={(steps) => onChange({ steps })} min={1} max={150} ariaLabel="Steps" />
          </Field>
          <Field label="CFG">
            <NumberField value={value.cfg} onChange={(cfg) => onChange({ cfg })} min={0} max={30} integer={false} ariaLabel="CFG" />
          </Field>
          <Field label="Sampler">
            <select className="field w-full text-sm" value={value.sampler} onChange={(e) => onChange({ sampler: e.target.value })}>
              {(meta?.samplers ?? [value.sampler]).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Scheduler">
            <select className="field w-full text-sm" value={value.scheduler} onChange={(e) => onChange({ scheduler: e.target.value })}>
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
                <button className="text-accent" onClick={() => onChange({ seed: -1 })}>
                  🎲
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
        </div>
      )}
    </div>
  );
}

function Field({ label, action, children }: { label: string; action?: ReactNode; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 flex justify-between text-[11px] text-muted">
        {label}
        {action && <span onClick={(e) => e.preventDefault()}>{action}</span>}
      </span>
      {children}
    </label>
  );
}
