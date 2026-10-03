import { findLoras, removeLora, setLoraWeight } from "../prompt/lora";
import { NumberField } from "./NumberField";

/** プロンプト中の LoRA をチップで並べ、重みを手打ちで変えられるようにする。今のモデルに合わない LoRA は赤くして理由を下に出す */
export function LoraChips({
  prompt,
  onChange,
  onAdd,
  problem,
}: {
  prompt: string;
  onChange: (p: string) => void;
  onAdd: () => void;
  /** 合わない理由。合うなら null */
  problem: (name: string) => string | null;
}) {
  const uses = findLoras(prompt);
  const problems = [...new Set(uses.map((u) => problem(u.name) && `${u.name}: ${problem(u.name)}`).filter((x): x is string => !!x))];
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {uses.map((u, i) => (
        <div
          key={`${u.name}-${i}`}
          className={`flex max-w-full items-center gap-1 rounded-full border py-0.5 pr-1 pl-3 ${problem(u.name) ? "border-danger bg-danger/10" : "border-line bg-surface"}`}
        >
          <span className={`truncate text-xs ${problem(u.name) ? "text-danger" : "text-[#b9c9e6]"}`}>{u.name}</span>
          <NumberField
            value={u.weight}
            integer={false}
            min={-5}
            max={5}
            ariaLabel={`${u.name} の重み`}
            className="w-14! rounded-full! px-2! py-0.5! text-center text-xs! text-[#e8c27a]!"
            onChange={(w) => onChange(setLoraWeight(prompt, u, w))}
          />
          <button className="grid size-6 place-items-center text-muted" aria-label={`${u.name} を外す`} onClick={() => onChange(removeLora(prompt, u))}>
            ×
          </button>
        </div>
      ))}
      <button onClick={onAdd} className="rounded-full border border-dashed border-accent/60 px-3 py-1 text-xs text-accent">
        ＋ LoRA
      </button>
      {problems.map((p) => (
        <p key={p} className="w-full px-1 text-[11px] break-words text-danger">
          {p}
        </p>
      ))}
    </div>
  );
}
