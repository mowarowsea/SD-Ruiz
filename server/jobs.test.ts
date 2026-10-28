import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ForgeClient, Txt2ImgRequest, Txt2ImgResponse } from "./forge.js";

// data/last/ は本物に触らず、メモリ上に持つ
const mem = await vi.hoisted(async () => (await import("./test-fs.js")).memoryFs((p) => /[\\/]data[\\/]last([\\/]|$)/.test(p)));
vi.mock("node:fs", async (orig) => mem.fake(await orig()));

import { type GenerateParams, JobBusyError, JobManager } from "./jobs.js";

const png = Buffer.from("fake png");
const params: GenerateParams = { checkpoint: "foo.safetensors", prompt: "1girl", negative: "bad", width: 832, height: 1216, steps: 28, cfg: 5, sampler: "Euler a", scheduler: "automatic", seed: -1, batch: 2, save: true, fast: false, dmd2: "off", pag: false, apg: false };

/** Forge の代わり。txt2img は呼ばれたリクエストを覚え、resolve を呼ぶまで返さない */
function fakeForge() {
  const calls: Txt2ImgRequest[] = [];
  let resolve!: (r: Txt2ImgResponse) => void;
  let reject!: (e: Error) => void;
  const forge = {
    txt2img: vi.fn((req: Txt2ImgRequest) => {
      calls.push(req);
      return new Promise<Txt2ImgResponse>((res, rej) => {
        resolve = res;
        reject = rej;
      });
    }),
    interrupt: vi.fn(async () => {}),
  };
  return { forge: forge as unknown as ForgeClient, calls, done: (r: Txt2ImgResponse) => resolve(r), fail: (e: Error) => reject(e) };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => mem.reset());

describe("JobManager", () => {
  test("Forge へのリクエスト: 1 枚ずつ n_iter で作り、Checkpoint と TE / VAE と名前の書式を override_settings で送る", () => {
    const f = fakeForge();
    new JobManager(f.forge, "dmd2").start(params, ["te.safetensors", "vae.safetensors"]);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toMatchObject({
      prompt: "1girl",
      negative_prompt: "bad",
      batch_size: 1,
      n_iter: 2,
      save_images: true,
      override_settings: {
        sd_model_checkpoint: "foo.safetensors",
        forge_additional_modules: ["te.safetensors", "vae.safetensors"],
        dp_write_raw_template: true,
        samples_filename_pattern: "[seed]-[job_timestamp]",
        grid_extended_filename: true,
      },
      override_settings_restore_afterwards: false,
    });
  });

  test("DMD2 などの高速化は Forge に送る直前に当てる (フォームの値は変えない)", () => {
    const f = fakeForge();
    const job = new JobManager(f.forge, "dmd2").start({ ...params, dmd2: "fast" }, []);
    expect(f.calls[0]).toMatchObject({ prompt: "1girl\n<lora:dmd2:1>", steps: 8, cfg_scale: 1, sampler_name: "LCM" });
    expect(job.params).toMatchObject({ prompt: "1girl", steps: 28 });
  });

  test("生成中はもう 1 件始められない。終わったら画像・Seed・展開後のプロンプトが入り、最後の成功として保存される", async () => {
    const f = fakeForge();
    const jobs = new JobManager(f.forge, "dmd2");
    const job = jobs.start(params, []);
    expect(job.status).toBe("running");
    expect(jobs.current).toBe(job);
    expect(() => jobs.start(params, [])).toThrow(JobBusyError);
    expect(jobs.last).toBeNull();

    f.done({ images: [png.toString("base64"), png.toString("base64")], info: JSON.stringify({ all_seeds: [1, 2], all_prompts: ["1girl a", "1girl b"] }) });
    await settle();
    expect(job).toMatchObject({ status: "done", seeds: [1, 2], prompts: ["1girl a", "1girl b"], interrupted: false });
    expect(job.images.map((b) => b.toString())).toEqual(["fake png", "fake png"]);
    expect(job.finishedAt).toBeGreaterThanOrEqual(job.startedAt);
    expect(jobs.last).toBe(job);
    expect(jobs.find(job.id)).toBe(job);
    expect(jobs.find("nope")).toBeNull();

    const saved = [...mem.files.keys()].map((k) => k.split(/[\\/]/).slice(-2).join("/")).sort();
    expect(saved).toEqual(["last/0.png", "last/1.png", "last/job.json"]);
    const meta = mem.json<{ id: string; images?: unknown }>([...mem.files.keys()].find((k) => k.endsWith("job.json"))!);
    expect(meta.id).toBe(job.id);
    expect(meta.images).toBeUndefined();
  });

  test("次に作ったときは最後の成功を data/last/ から復元する", async () => {
    const f = fakeForge();
    const job = new JobManager(f.forge, "dmd2").start(params, ["te"]);
    f.done({ images: [png.toString("base64")], info: "{}" });
    await settle();
    const restored = new JobManager(f.forge, "dmd2").last!;
    expect(restored).toMatchObject({ id: job.id, status: "done", modules: ["te"], seeds: [], prompts: [] });
    expect(restored.images.map((b) => b.toString())).toEqual(["fake png"]);
  });

  test("失敗したら error になり、最後の成功は前のまま。画像なしの完了も最後の成功にはしない", async () => {
    const f = fakeForge();
    const jobs = new JobManager(f.forge, "dmd2");
    const ok = jobs.start(params, []);
    f.done({ images: [png.toString("base64")], info: "{}" });
    await settle();

    const bad = jobs.start(params, []);
    f.fail(new Error("Forge が 500 を返しました"));
    await settle();
    expect(bad).toMatchObject({ status: "error", error: "Forge が 500 を返しました" });
    expect(bad.finishedAt).toBeDefined();
    expect(jobs.last).toBe(ok);

    const empty = jobs.start(params, []);
    f.done({ images: [], info: "{}" });
    await settle();
    expect(empty.status).toBe("done");
    expect(jobs.last).toBe(ok);
    // 画像を引くときは直近のジョブと最後の成功の両方から探せる
    expect(jobs.find(empty.id)).toBe(empty);
    expect(jobs.find(ok.id)).toBe(ok);
  });

  test("中断は生成中だけ Forge に頼み、ジョブに印を付ける", async () => {
    const f = fakeForge();
    const jobs = new JobManager(f.forge, "dmd2");
    await jobs.interrupt();
    expect(f.forge.interrupt).not.toHaveBeenCalled();
    const job = jobs.start(params, []);
    await jobs.interrupt();
    expect(f.forge.interrupt).toHaveBeenCalledOnce();
    expect(job.interrupted).toBe(true);
    // 中断でも 1 枚できていれば成功扱い
    f.done({ images: [png.toString("base64")], info: "{}" });
    await settle();
    expect(jobs.last).toBe(job);
  });
});
