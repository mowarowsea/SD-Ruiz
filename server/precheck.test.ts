import { describe, expect, test, vi } from "vitest";
import type { GenerateParams } from "./jobs.js";
import { checkSpeed, precheck, type PrecheckDeps, resolveModules, SetupError } from "./precheck.js";

const params: GenerateParams = { checkpoint: "illu.safetensors", prompt: "", negative: "", width: 832, height: 1216, steps: 28, cfg: 5, sampler: "Euler a", scheduler: "automatic", seed: -1, batch: 1, save: true, fast: false, dmd2: "off", pag: false, apg: false };

/** Forge にあるモデル: title → ベースモデル名。TE / VAE・LoRA・スクリプトは Forge にあるものを並べる */
function deps(over: Partial<PrecheckDeps> & { bases?: Record<string, string | null>; modules?: string[]; loras?: string[]; scripts?: string[]; prefs?: Record<string, string[]> } = {}): PrecheckDeps & { fetched: number } {
  const bases = over.bases ?? { "illu.safetensors": "Illustrious", "anima.safetensors": "Anima", "sd15.safetensors": "SD 1.5", "unknown.safetensors": null };
  const d = {
    fetched: 0,
    checkpointFile: vi.fn(async (title: string) => {
      if (!(title in bases)) d.fetched++;
      return title in bases ? `C:/models/${title}` : null;
    }),
    baseOf: (file: string) => bases[file.replace("C:/models/", "")] ?? null,
    modulesFor: (checkpoint: string, family: string | null) => over.prefs?.[checkpoint] ?? (family === "Anima" ? ["qwen_te.safetensors", "qwen_vae.safetensors"] : []),
    forge: {
      modules: vi.fn(async () => (over.modules ?? ["qwen_te.safetensors", "qwen_vae.safetensors"]).map((m) => ({ model_name: m, filename: `C:/models/VAE/${m}` }))),
      loras: vi.fn(async () => (over.loras ?? ["dmd2_lora"]).map((n) => ({ name: n, alias: n, path: `C:/models/Lora/${n}.safetensors` }))),
      scripts: vi.fn(async () => ({ txt2img: over.scripts ?? ["spectrum (ruiz)", "guidance (ruiz)"] })),
    },
    dmd2Lora: "dmd2_lora",
    ...over,
  };
  return d;
}

const fails = async (p: Promise<unknown>, message: RegExp) => {
  const e = (await p.catch((e: unknown) => e)) as SetupError;
  expect(e).toBeInstanceOf(SetupError);
  expect(e.statusCode).toBe(400);
  expect(e.message).toMatch(message);
};

describe("resolveModules", () => {
  test("TE / VAE の要らないモデルは [] を返す (Forge には聞かない)", async () => {
    const d = deps();
    expect(await resolveModules("illu.safetensors", d)).toEqual({ family: "Illustrious", modules: [] });
    expect(await resolveModules("unknown.safetensors", d)).toEqual({ family: null, modules: [] });
    expect(d.forge.modules).not.toHaveBeenCalled();
  });

  test("Forge に無い Checkpoint は止める (黙っていま読み込んでいるモデルで生成されるため)", async () => {
    await fails(resolveModules("nope.safetensors", deps()), /Checkpoint が見つかりません: nope\.safetensors/);
  });

  test("Anima はベースモデルの既定の TE / VAE を使い、Forge にあることを確かめる", async () => {
    const d = deps();
    expect(await resolveModules("anima.safetensors", d)).toEqual({ family: "Anima", modules: ["qwen_te.safetensors", "qwen_vae.safetensors"] });
    expect(d.forge.modules).toHaveBeenCalledOnce();
  });

  test("Anima なのに TE / VAE が指定されていなければ止める", async () => {
    await fails(resolveModules("anima.safetensors", deps({ prefs: { "anima.safetensors": [] } })), /Anima は Text Encoder と VAE を別に指定しないと使えません/);
  });

  test("指定した TE / VAE が Forge に無ければ、無いものの名前を出して止める", async () => {
    await fails(resolveModules("anima.safetensors", deps({ modules: ["qwen_te.safetensors"] })), /Anima に使う Text Encoder \/ VAE が Forge にありません: qwen_vae\.safetensors。/);
    // ベースモデルが分からないモデルに個別指定したときは「このモデル」
    await fails(resolveModules("unknown.safetensors", deps({ modules: [], prefs: { "unknown.safetensors": ["my_vae"] } })), /このモデル に使う Text Encoder \/ VAE が Forge にありません: my_vae/);
  });

  test("モデルごとの指定があれば、ベースモデルの既定より優先する", async () => {
    const d = deps({ modules: ["other_vae"], prefs: { "illu.safetensors": ["other_vae"] } });
    expect(await resolveModules("illu.safetensors", d)).toEqual({ family: "Illustrious", modules: ["other_vae"] });
  });
});

describe("checkSpeed", () => {
  test("何も使わなければ Forge に聞かずに通る", async () => {
    const d = deps();
    await checkSpeed(params, "SD 1.5", d);
    await checkSpeed(params, null, d);
    expect(d.forge.loras).not.toHaveBeenCalled();
    expect(d.forge.scripts).not.toHaveBeenCalled();
  });

  test("高速化 / DMD2 / PAG / APG は SDXL 系 (Illustrious / NoobAI / Pony / SDXL) だけ。使うものの名前を並べて止める", async () => {
    await fails(checkSpeed({ ...params, fast: true }, "SD 1.5", deps()), /^高速化 は SDXL 系のモデル/);
    await fails(checkSpeed({ ...params, dmd2: "fast", fast: true, pag: true, apg: true }, "Anima", deps()), /^DMD2 \/ 高速化 \/ PAG \/ APG は SDXL 系/);
    await fails(checkSpeed({ ...params, pag: true }, null, deps()), /^PAG は SDXL 系/);
    for (const family of ["Illustrious", "NoobAI", "Pony", "SDXL"]) await checkSpeed({ ...params, fast: true, pag: true, apg: true }, family, deps());
  });

  test("DMD2 は LoRA が Forge にあるかだけ見る (拡張は重ねないので見ない)", async () => {
    const d = deps();
    await checkSpeed({ ...params, dmd2: "balanced", fast: true, pag: true }, "Illustrious", d);
    expect(d.forge.loras).toHaveBeenCalledOnce();
    expect(d.forge.scripts).not.toHaveBeenCalled();
    await fails(checkSpeed({ ...params, dmd2: "fast" }, "Illustrious", deps({ loras: ["something_else"] })), /DMD2 の LoRA \(dmd2_lora\) が Forge にありません/);
  });

  test("高速化と PAG / APG は Forge の拡張 (スクリプト名、小文字で比べる) があるか見る", async () => {
    await fails(checkSpeed({ ...params, fast: true }, "Pony", deps({ scripts: ["guidance (ruiz)"] })), /高速化に使う Forge の拡張 \(Spectrum \(Ruiz\)\) がありません。forge-extensions\/ruiz-spectrum/);
    await fails(checkSpeed({ ...params, apg: true }, "Pony", deps({ scripts: ["spectrum (ruiz)"] })), /PAG \/ APGに使う Forge の拡張 \(Guidance \(Ruiz\)\) がありません。forge-extensions\/ruiz-guidance/);
    await checkSpeed({ ...params, fast: true }, "Pony", deps({ scripts: ["Spectrum (Ruiz)".toLowerCase()] }));
  });
});

describe("precheck", () => {
  test("通れば Forge に渡す TE / VAE を返す", async () => {
    expect(await precheck({ ...params, checkpoint: "anima.safetensors" }, deps())).toEqual(["qwen_te.safetensors", "qwen_vae.safetensors"]);
    expect(await precheck({ ...params, fast: true }, deps())).toEqual([]);
  });

  test("Checkpoint → TE / VAE → 高速化 の順に確かめる", async () => {
    await fails(precheck({ ...params, checkpoint: "nope", fast: true }, deps()), /Checkpoint が見つかりません/);
    await fails(precheck({ ...params, checkpoint: "anima.safetensors", fast: true }, deps({ modules: [] })), /Text Encoder \/ VAE が Forge にありません/);
    await fails(precheck({ ...params, checkpoint: "anima.safetensors", fast: true }, deps()), /SDXL 系のモデル/);
  });
});
