import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { moveModelToTrash, readSidecar, SidecarCache } from "./library.js";
import { tempDir } from "./testing/tmp.js";

let tmp: ReturnType<typeof tempDir>;
beforeEach(() => (tmp = tempDir()));
afterEach(() => tmp.remove());

/** ヘッダ (JSON) だけの safetensors もどき */
function writeSafetensors(path: string, header: Record<string, unknown>) {
  const json = Buffer.from(JSON.stringify(header));
  const len = Buffer.alloc(8);
  len.writeBigUInt64LE(BigInt(json.length));
  writeFileSync(path, Buffer.concat([len, json]));
}

describe("readSidecar", () => {
  it("StabilityMatrix の cm-info.json とプレビュー画像を読む", () => {
    const model = join(tmp.dir, "foo.safetensors");
    writeFileSync(model, "");
    writeFileSync(join(tmp.dir, "foo.cm-info.json"), JSON.stringify({ BaseModel: "Illustrious", TrainedWords: ["miku", " ", 3, "hair"], ModelId: 10, VersionId: 20 }));
    writeFileSync(join(tmp.dir, "foo.preview.png"), "");
    const s = readSidecar(model);
    expect(s).toMatchObject({ base: "Illustrious", trainedWords: ["miku", "hair"], preview: join(tmp.dir, "foo.preview.png"), civitai: { modelId: 10, versionId: 20 } });
    expect(s.mtime).toBeGreaterThan(0);
  });

  it("cm-info.json が無ければ Civitai Helper の civitai.info (id が versionId)", () => {
    const model = join(tmp.dir, "foo.safetensors");
    writeFileSync(model, "");
    writeFileSync(join(tmp.dir, "foo.civitai.info"), JSON.stringify({ baseModel: "Pony", trainedWords: ["x"], modelId: "5", id: 7 }));
    writeFileSync(join(tmp.dir, "foo.png"), "");
    expect(readSidecar(model)).toMatchObject({ base: "Pony", trainedWords: ["x"], preview: join(tmp.dir, "foo.png"), civitai: { modelId: 5, versionId: 7 } });
  });

  it("プレビューは .preview.* を優先する。ID が揃わなければ civitai は null", () => {
    const model = join(tmp.dir, "foo.safetensors");
    writeFileSync(model, "");
    writeFileSync(join(tmp.dir, "foo.png"), "");
    writeFileSync(join(tmp.dir, "foo.preview.jpg"), "");
    writeFileSync(join(tmp.dir, "foo.civitai.info"), JSON.stringify({ modelId: 5 }));
    expect(readSidecar(model)).toMatchObject({ preview: join(tmp.dir, "foo.preview.jpg"), civitai: null, base: null });
  });

  it.each([
    [{ __metadata__: { ss_base_model_version: "sdxl_base_v1-0" } }, "SDXL"],
    [{ __metadata__: { ss_base_model_version: "sd_v1" } }, "SD 1.5"],
    [{ "lora_te2_text_model.weight": {} }, "SDXL"],
    [{ "conditioner.embedders.1.model.weight": {} }, "SDXL"],
    [{ "cond_stage_model.transformer.weight": {} }, "SD 1.5"],
    [{ "lora_te_text_model.weight": {} }, "SD 1.5"],
    [{ "double_blocks.0.img_attn.qkv.weight": {} }, "Flux"],
    [{ "net.llm_adapter.weight": {} }, "Anima"],
    [{ "lora_unet_blocks_3_self_attn_q_proj.lora_down.weight": {} }, "Anima"],
    [{ "joint_blocks.0.weight": {} }, "SD 3"],
    [{ "something.else": {} }, null],
  ])("メタデータが無ければ safetensors のヘッダから推定する: %j → %s", (header, base) => {
    const model = join(tmp.dir, "foo.safetensors");
    writeSafetensors(model, header);
    expect(readSidecar(model).base).toBe(base);
  });

  it("BaseModel が Other / Unknown ならヘッダからの推定を優先し、推定できなければ書いてあるものを使う", () => {
    const model = join(tmp.dir, "foo.safetensors");
    writeSafetensors(model, { "lora_te2_x": {} });
    writeFileSync(join(tmp.dir, "foo.cm-info.json"), JSON.stringify({ BaseModel: "Other" }));
    expect(readSidecar(model).base).toBe("SDXL");
    writeSafetensors(model, { "x": {} });
    expect(readSidecar(model).base).toBe("Other");
  });

  it("消えたファイルは mtime 0 で落ちない", () => {
    expect(readSidecar(join(tmp.dir, "gone.safetensors"))).toMatchObject({ base: null, mtime: 0, preview: null, civitai: null });
  });
});

describe("SidecarCache", () => {
  it("同じパスは読み直さず、clear で読み直す", () => {
    const model = join(tmp.dir, "foo.safetensors");
    writeFileSync(model, "");
    const cache = new SidecarCache();
    expect(cache.get(model).preview).toBeNull();
    writeFileSync(join(tmp.dir, "foo.png"), "");
    expect(cache.get(model).preview).toBeNull();
    cache.clear();
    expect(cache.get(model).preview).toBe(join(tmp.dir, "foo.png"));
  });
});

describe("moveModelToTrash", () => {
  it("本体と名前の決まった付随ファイルだけを移す (foo.v2.safetensors は巻き込まない)", async () => {
    const dir = join(tmp.dir, "Lora");
    mkdirSync(dir);
    for (const f of ["foo.safetensors", "foo.preview.png", "foo.cm-info.json", "foo.json", "foo.v2.safetensors", "foo.v2.png", "bar.safetensors"]) writeFileSync(join(dir, f), "");
    const dest = join(tmp.dir, "Trash", "models", "Lora");
    expect(await moveModelToTrash(join(dir, "foo.safetensors"), dest)).toEqual({ files: 4 });
    expect(readdirSync(dir).sort()).toEqual(["bar.safetensors", "foo.v2.png", "foo.v2.safetensors"]);
    expect(readdirSync(dest).sort()).toEqual(["foo.cm-info.json", "foo.json", "foo.preview.png", "foo.safetensors"]);
  });

  it("同じ名前を前にも捨てていたら日時のフォルダに分ける", async () => {
    const dir = join(tmp.dir, "Lora");
    mkdirSync(dir);
    const dest = join(tmp.dir, "Trash");
    writeFileSync(join(dir, "foo.safetensors"), "1");
    await moveModelToTrash(join(dir, "foo.safetensors"), dest);
    writeFileSync(join(dir, "foo.safetensors"), "2");
    await moveModelToTrash(join(dir, "foo.safetensors"), dest);
    const entries = readdirSync(dest);
    expect(entries).toHaveLength(2);
    const sub = entries.find((e) => e !== "foo.safetensors")!;
    expect(sub).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(existsSync(join(dest, sub, "foo.safetensors"))).toBe(true);
  });
});
