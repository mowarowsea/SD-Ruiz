// PNG に埋め込まれた生成情報 (A1111 形式の infotext) を読む
//
//   prompt (複数行)
//   Negative prompt: negative (複数行)
//   Steps: 28, Sampler: Euler a, Schedule type: Automatic, CFG scale: 5, Seed: 123, Size: 832x1216, Model: foo, ...

import { type GenerateParams, type Meta, modelLabel } from "./api";

export interface Infotext {
  prompt: string;
  negative: string;
  params: Record<string, string>;
}

const paramRe = /\s*([\w][\w \-/]*):\s*("(?:\\.|[^\\"])*"|[^,]*)(?:,|$)/g;

export function parseInfotext(text: string): Infotext {
  const lines = text.trim().split("\n");
  let paramsLine = "";
  // 最後の行が "Steps: ..." のようなキー: 値の並びなら、それがパラメータ
  if (lines.length && /^\s*Steps:/.test(lines[lines.length - 1])) paramsLine = lines.pop()!;
  const body = lines.join("\n");
  const negAt = body.search(/^Negative prompt:/m);
  const prompt = (negAt === -1 ? body : body.slice(0, negAt)).trim();
  const negative = negAt === -1 ? "" : body.slice(negAt).replace(/^Negative prompt:\s*/, "").trim();

  const params: Record<string, string> = {};
  for (const m of paramsLine.matchAll(paramRe)) {
    let v = m[2].trim();
    if (v.startsWith('"')) {
      try {
        v = JSON.parse(v);
      } catch {
        /* そのまま */
      }
    }
    params[m[1].trim()] = v;
  }
  return { prompt, negative, params };
}

/**
 * infotext を生成画面の設定にする。Dynamic Prompts のテンプレート (展開前のプロンプト) が残っていればそちらを使う。
 * Seed は「同じ絵をもう一度」用に持ってくる。
 */
export function infotextToParams(info: Infotext, meta: Meta | null): Partial<GenerateParams> {
  const p = info.params;
  const out: Partial<GenerateParams> = {
    prompt: p["Template"] ?? info.prompt,
    negative: p["Negative Template"] ?? info.negative,
  };
  const num = (k: string) => (p[k] !== undefined && Number.isFinite(Number(p[k])) ? Number(p[k]) : undefined);
  if (num("Steps") !== undefined) out.steps = num("Steps");
  if (num("CFG scale") !== undefined) out.cfg = num("CFG scale");
  if (num("Seed") !== undefined) out.seed = num("Seed");
  const size = /^(\d+)x(\d+)$/.exec(p["Size"] ?? "");
  if (size) {
    out.width = Number(size[1]);
    out.height = Number(size[2]);
  }
  if (p["Sampler"] && (!meta || meta.samplers.includes(p["Sampler"]))) out.sampler = p["Sampler"];
  if (p["Schedule type"]) {
    const s = meta?.schedulers.find((x) => x.label === p["Schedule type"] || x.name === p["Schedule type"]);
    if (s) out.scheduler = s.name;
  }
  if (p["Model"] && meta) {
    const m = meta.models.find((x) => modelLabel(x.title) === p["Model"]) ?? meta.models.find((x) => x.title.includes(p["Model"]));
    if (m) out.checkpoint = m.title;
  }
  return out;
}
