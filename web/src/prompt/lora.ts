// プロンプト中の <lora:name:weight> を読み書きする

export interface LoraUse {
  name: string;
  weight: number;
  from: number;
  to: number;
}

export function findLoras(prompt: string): LoraUse[] {
  const out: LoraUse[] = [];
  for (const m of prompt.matchAll(/<lora:([^:>]+)(?::([^:>]*))?(?::[^>]*)?>/g)) {
    const w = Number(m[2] ?? 1);
    out.push({ name: m[1], weight: Number.isFinite(w) ? w : 1, from: m.index, to: m.index + m[0].length });
  }
  return out;
}

export function setLoraWeight(prompt: string, use: LoraUse, weight: number) {
  return prompt.slice(0, use.from) + `<lora:${use.name}:${weight}>` + prompt.slice(use.to);
}

/** 前後の区切り (", ") ごと取り除く */
export function removeLora(prompt: string, use: LoraUse) {
  let from = use.from;
  let to = use.to;
  const after = /^\s*,\s*/.exec(prompt.slice(to));
  if (after) to += after[0].length;
  else {
    const before = /\s*,\s*$/.exec(prompt.slice(0, from));
    if (before) from -= before[0].length;
  }
  return prompt.slice(0, from) + prompt.slice(to);
}

/** 末尾に足す */
export function addLora(prompt: string, name: string, weight = 1) {
  const body = prompt.replace(/\s+$/, "");
  const sep = body === "" ? "" : body.endsWith(",") ? " " : ", ";
  return `${body}${sep}<lora:${name}:${weight}>`;
}
