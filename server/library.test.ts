import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { moveModelToTrash, readSidecar, SidecarCache } from "./library.js";

/** safetensors の先頭 (ヘッダ長 + JSON のヘッダ) だけを持つ偽のモデルファイル */
const safetensors = (header: Record<string, unknown>) => {
  const json = Buffer.from(JSON.stringify(header));
  const len = Buffer.alloc(8);
  len.writeBigUInt64LE(BigInt(json.length));
  return Buffer.concat([len, json]);
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ruiz-library-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("readSidecar", () => {
  test("StabilityMatrix の cm-info.json を優先して読む。プレビューは .preview.png などから探す", () => {
    const model = join(dir, "foo.safetensors");
    writeFileSync(model, safetensors({ "lora_te_x": {} }));
    writeFileSync(join(dir, "foo.cm-info.json"), JSON.stringify({ BaseModel: "Illustrious", TrainedWords: ["foo", " ", "bar"], ModelId: 1, VersionId: 2 }));
    writeFileSync(join(dir, "foo.civitai.info"), JSON.stringify({ baseModel: "Pony", id: 9, modelId: 8 }));
    writeFileSync(join(dir, "foo.preview.png"), "x");
    expect(readSidecar(model)).toMatchObject({ base: "Illustrious", trainedWords: ["foo", "bar"], preview: join(dir, "foo.preview.png"), civitai: { modelId: 1, versionId: 2 } });
    expect(readSidecar(model).mtime).toBeGreaterThan(0);
  });

  test("Civitai Helper の civitai.info も読む。ID が無ければ civitai は null", () => {
    const model = join(dir, "bar.safetensors");
    writeFileSync(model, safetensors({}));
    writeFileSync(join(dir, "bar.civitai.info"), JSON.stringify({ baseModel: "Pony", trainedWords: ["x"] }));
    writeFileSync(join(dir, "bar.png"), "x");
    expect(readSidecar(model)).toMatchObject({ base: "Pony", trainedWords: ["x"], preview: join(dir, "bar.png"), civitai: null });
  });

  test("メタデータが無い・Other のときは safetensors のヘッダから推定する", () => {
    const cases: [Record<string, unknown>, string | null][] = [
      [{ __metadata__: { ss_base_model_version: "sdxl_base_v1-0" } }, "SDXL"],
      [{ __metadata__: { ss_base_model_version: "sd_v1" } }, "SD 1.5"],
      [{ "conditioner.embedders.1.model.x": {} }, "SDXL"],
      [{ "lora_te2_text_model": {} }, "SDXL"],
      [{ "cond_stage_model.transformer": {} }, "SD 1.5"],
      [{ "lora_te_text_model": {} }, "SD 1.5"],
      [{ "double_blocks.0.img_attn": {} }, "Flux"],
      [{ "joint_blocks.0.x": {} }, "SD 3"],
      [{ "net.llm_adapter.x": {} }, "Anima"],
      [{ "net.blocks.3.self_attn.q_proj.weight": {} }, "Anima"],
      [{ "lora_unet_blocks_3_cross_attn_k_proj": {} }, "Anima"],
      [{ "something_else": {} }, null],
    ];
    cases.forEach(([header, base], i) => {
      const model = join(dir, `m${i}.safetensors`);
      writeFileSync(model, safetensors(header));
      expect(readSidecar(model).base, JSON.stringify(header)).toBe(base);
    });
    const other = join(dir, "other.safetensors");
    writeFileSync(other, safetensors({ "double_blocks.0": {} }));
    writeFileSync(join(dir, "other.civitai.info"), JSON.stringify({ baseModel: "Other" }));
    expect(readSidecar(other).base).toBe("Flux");
  });

  test("壊れたヘッダ・無いファイル・safetensors 以外でも落ちない", () => {
    const broken = join(dir, "broken.safetensors");
    writeFileSync(broken, Buffer.from("not a safetensors file at all"));
    expect(readSidecar(broken).base).toBeNull();
    expect(readSidecar(join(dir, "nope.safetensors"))).toEqual({ base: null, trainedWords: [], preview: null, mtime: 0, civitai: null });
    writeFileSync(join(dir, "old.ckpt"), "x");
    expect(readSidecar(join(dir, "old.ckpt")).base).toBeNull();
  });

  test("SidecarCache はパスごとに 1 回だけ読む", () => {
    const model = join(dir, "c.safetensors");
    writeFileSync(model, safetensors({}));
    const cache = new SidecarCache();
    const first = cache.get(model);
    writeFileSync(join(dir, "c.png"), "x");
    expect(cache.get(model)).toBe(first);
    cache.clear();
    expect(cache.get(model).preview).toBe(join(dir, "c.png"));
  });
});

describe("moveModelToTrash", () => {
  test("本体と決まった名前の付随ファイルだけを移す (foo.v2.safetensors は巻き込まない)", async () => {
    for (const f of ["foo.safetensors", "foo.preview.png", "foo.cm-info.json", "foo.json", "foo.v2.safetensors", "foo.v2.png"]) writeFileSync(join(dir, f), "x");
    const dest = join(dir, "trash");
    expect(await moveModelToTrash(join(dir, "foo.safetensors"), dest)).toEqual({ files: 4 });
    for (const f of ["foo.safetensors", "foo.preview.png", "foo.cm-info.json", "foo.json"]) {
      expect(existsSync(join(dir, f)), f).toBe(false);
      expect(existsSync(join(dest, f)), f).toBe(true);
    }
    expect(existsSync(join(dir, "foo.v2.safetensors"))).toBe(true);
    expect(existsSync(join(dir, "foo.v2.png"))).toBe(true);
  });

  test("同じ名前を前にも捨てていたら、日時を付けたフォルダに分ける", async () => {
    const dest = join(dir, "trash");
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "foo.safetensors"), "old");
    writeFileSync(join(dir, "foo.safetensors"), "new");
    await moveModelToTrash(join(dir, "foo.safetensors"), dest);
    const { readdirSync, readFileSync } = await import("node:fs");
    const sub = readdirSync(dest).filter((n) => n !== "foo.safetensors");
    expect(sub).toEqual([expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d$/)]);
    expect(readFileSync(join(dest, sub[0], "foo.safetensors"), "utf8")).toBe("new");
    expect(readFileSync(join(dest, "foo.safetensors"), "utf8")).toBe("old");
  });
});
