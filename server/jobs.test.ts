import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForgeClient, type Txt2ImgRequest } from "./forge.js";
import { type GenerateParams, JobBusyError, JobManager } from "./jobs.js";
import { fakeForge, tinyPngBase64 } from "./testing/forge.js";
import { tempDir } from "./testing/tmp.js";

let tmp: ReturnType<typeof tempDir>;
let forge: ReturnType<typeof fakeForge>;
let lastDir: string;
beforeEach(() => {
  tmp = tempDir();
  lastDir = join(tmp.dir, "last");
  forge = fakeForge();
});
afterEach(() => {
  forge.restore();
  tmp.remove();
});

const params: GenerateParams = {
  checkpoint: "a.safetensors [123]",
  prompt: "1girl",
  negative: "lowres",
  width: 832,
  height: 1216,
  steps: 28,
  cfg: 5,
  sampler: "Euler a",
  scheduler: "automatic",
  seed: 42,
  batch: 2,
  save: true,
  fast: false,
  dmd2: "off",
  pag: false,
  apg: false,
};

const manager = () => new JobManager(new ForgeClient("http://forge.test"), "dmd2_lora", lastDir);
const settle = (jobs: JobManager) => vi.waitFor(() => expect(jobs.current?.status).not.toBe("running"));

describe("JobManager", () => {
  it("Forge への要求を組み立てる: 1 枚ずつ n_iter で、Checkpoint と TE / VAE は override_settings で切り替える", async () => {
    const jobs = manager();
    const job = jobs.start(params, ["te.safetensors", "vae.safetensors"]);
    expect(job.status).toBe("running");
    expect(jobs.current).toBe(job);
    await settle(jobs);
    const [call] = forge.callsTo("/sdapi/v1/txt2img");
    const req = call.body as Txt2ImgRequest;
    expect(req).toMatchObject({
      prompt: "1girl",
      negative_prompt: "lowres",
      width: 832,
      height: 1216,
      steps: 28,
      cfg_scale: 5,
      sampler_name: "Euler a",
      scheduler: "automatic",
      seed: 42,
      batch_size: 1,
      n_iter: 2,
      save_images: true,
      override_settings_restore_afterwards: false,
      alwayson_scripts: {},
    });
    expect(req.override_settings).toMatchObject({
      sd_model_checkpoint: "a.safetensors [123]",
      forge_additional_modules: ["te.safetensors", "vae.safetensors"],
      dp_write_raw_template: true,
      samples_filename_pattern: "[seed]-[job_timestamp]",
      grid_extended_filename: true,
    });
  });

  it("高速化の設定は Forge に送る直前に当てる (フォームの params は変えない)", async () => {
    const jobs = manager();
    jobs.start({ ...params, dmd2: "fast" }, []);
    await settle(jobs);
    const req = forge.callsTo("/sdapi/v1/txt2img")[0].body as Txt2ImgRequest;
    expect(req.prompt).toBe("1girl\n<lora:dmd2_lora:1>");
    expect(req.steps).toBe(8);
    expect(jobs.current?.params.steps).toBe(28);
  });

  it("成功したら画像・Seed・展開後のプロンプトを持ち、最後に成功したジョブとして保存して、次に起動したとき復元する", async () => {
    forge.state.txt2img = { images: [tinyPngBase64, tinyPngBase64], info: JSON.stringify({ all_seeds: [42, 43], all_prompts: ["1girl, red", "1girl, blue"] }) };
    const jobs = manager();
    const job = jobs.start(params, []);
    await settle(jobs);
    expect(job).toMatchObject({ status: "done", seeds: [42, 43], prompts: ["1girl, red", "1girl, blue"], interrupted: false });
    expect(job.images).toHaveLength(2);
    expect(job.images[0].subarray(1, 4).toString()).toBe("PNG");
    expect(job.finishedAt).toBeGreaterThanOrEqual(job.startedAt);
    expect(jobs.last).toBe(job);
    expect(jobs.find(job.id)).toBe(job);
    expect(jobs.find("nope")).toBeNull();
    expect(readdirSync(lastDir).sort()).toEqual(["0.png", "1.png", "job.json"]);
    expect(JSON.parse(readFileSync(join(lastDir, "job.json"), "utf8"))).not.toHaveProperty("images");

    const again = manager();
    expect(again.current).toBeNull();
    expect(again.last).toMatchObject({ id: job.id, status: "done", seeds: [42, 43] });
    expect(again.last?.images).toHaveLength(2);
    expect(again.find(job.id)?.id).toBe(job.id);
  });

  it("生成中にもう 1 件始めようとすると JobBusyError", async () => {
    let release!: () => void;
    forge.state.txt2img = () => new Promise((r) => (release = () => r({ images: [], info: "{}" })));
    const jobs = manager();
    jobs.start(params, []);
    await vi.waitFor(() => expect(release).toBeDefined());
    expect(() => jobs.start(params, [])).toThrow(JobBusyError);
    release();
    await settle(jobs);
    expect(() => jobs.start(params, [])).not.toThrow();
  });

  it("画像が 1 枚もできなければ done でも最後に成功したジョブにはしない", async () => {
    forge.state.txt2img = { images: [], info: "{}" };
    const jobs = manager();
    const job = jobs.start(params, []);
    await settle(jobs);
    expect(job.status).toBe("done");
    expect(jobs.last).toBeNull();
    expect(existsSync(lastDir)).toBe(false);
  });

  it("Forge のエラーはジョブの error に入れ、前に成功したジョブは残す", async () => {
    const jobs = manager();
    const ok = jobs.start(params, []);
    await settle(jobs);
    forge.state.txt2img = () => {
      throw new Error("CUDA out of memory");
    };
    const bad = jobs.start(params, []);
    await settle(jobs);
    expect(bad.status).toBe("error");
    expect(bad.error).toContain("Forge が 500 を返しました");
    expect(bad.error).toContain("CUDA out of memory");
    expect(jobs.last).toBe(ok);
    expect(jobs.find(ok.id)).toBe(ok);
  });

  it("中断は Forge に interrupt を送り、ジョブに印を付ける。生成中でなければ何もしない", async () => {
    let release!: () => void;
    forge.state.txt2img = () => new Promise((r) => (release = () => r({ images: [tinyPngBase64], info: "{}" })));
    const jobs = manager();
    await jobs.interrupt();
    expect(forge.callsTo("/sdapi/v1/interrupt")).toHaveLength(0);
    const job = jobs.start(params, []);
    await vi.waitFor(() => expect(release).toBeDefined());
    await jobs.interrupt();
    expect(forge.callsTo("/sdapi/v1/interrupt")).toHaveLength(1);
    expect(job.interrupted).toBe(true);
    release();
    await settle(jobs);
    // 中断でも 1 枚できていれば成功扱い
    expect(jobs.last).toBe(job);
  });
});
