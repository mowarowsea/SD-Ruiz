import { useEffect, useState } from "react";

/**
 * 手打ち向けの数値入力。入力中は文字列のまま持ち、確定 (blur / Enter) 時に数値化して範囲に収める。
 * 不正な値なら元の値に戻す。
 */
export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  integer = true,
  className = "",
  ariaLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const commit = () => {
    let n = Number(text);
    if (text.trim() === "" || !Number.isFinite(n)) return setText(String(value));
    if (integer) n = Math.round(n / step) * step;
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    setText(String(n));
    if (n !== value) onChange(n);
  };

  return (
    <input
      type="text"
      inputMode={integer && (min ?? 0) >= 0 ? "numeric" : "decimal"}
      aria-label={ariaLabel}
      className={`field w-full font-mono text-sm ${className}`}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      onFocus={(e) => e.target.select()}
    />
  );
}
