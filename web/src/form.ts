// 生成画面の入力内容
import type { GenerateParams } from "./api";

export const defaultForm: GenerateParams = {
  checkpoint: "",
  prompt: "",
  negative: "",
  width: 832,
  height: 1216,
  steps: 28,
  cfg: 5,
  sampler: "Euler a",
  scheduler: "automatic",
  seed: -1,
  batch: 1,
};

/** ジョブの params (サーバー側の余分な項目つき) からフォームの項目だけを取り出す */
export function toForm(p: Partial<GenerateParams>): GenerateParams {
  const out = { ...defaultForm };
  for (const k of Object.keys(defaultForm) as (keyof GenerateParams)[]) if (p[k] !== undefined) (out as Record<string, unknown>)[k] = p[k];
  return out;
}
