import { afterEach, describe, expect, it } from "vitest";
import { ForgeClient, ForgeError } from "./forge.js";
import { fakeForge, idleProgress } from "./testing/forge.js";

let forge: ReturnType<typeof fakeForge> | null = null;
afterEach(() => forge?.restore());

const client = () => new ForgeClient("http://forge.test:7862");

describe("ForgeClient", () => {
  it("GET は baseUrl + パスを叩いて JSON を返す", async () => {
    forge = fakeForge({ models: [{ title: "a.safetensors [123]", model_name: "a", filename: "C:/m/a.safetensors" }] });
    const models = await client().models();
    expect(models).toHaveLength(1);
    expect(forge.calls[0]).toMatchObject({ method: "GET", url: "http://forge.test:7862/sdapi/v1/sd-models" });
  });

  it("POST は JSON の body と content-type を付ける", async () => {
    forge = fakeForge();
    await client().refreshLoras();
    const [call] = forge.callsTo("/sdapi/v1/refresh-loras");
    expect(call.method).toBe("POST");
    expect(call.body).toEqual({});
    const init = forge.fetch.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("txt2img は長い生成を待てるよう、タイムアウトの代わりに専用の dispatcher で送る", async () => {
    forge = fakeForge();
    const res = await client().txt2img({ prompt: "x" } as never);
    expect(res.images).toHaveLength(1);
    const init = forge.fetch.mock.calls[0][1] as RequestInit & { dispatcher?: unknown };
    expect(init.dispatcher).toBeDefined();
    expect(init.signal).toBeUndefined();
  });

  it("2xx 以外は ForgeError (status とパスと本文の先頭を含む)", async () => {
    forge = fakeForge({ extra: { "/sdapi/v1/sd-models": () => new Response("boom ".repeat(100), { status: 500 }) } });
    const err = await client()
      .models()
      .catch((e) => e);
    expect(err).toBeInstanceOf(ForgeError);
    expect(err.status).toBe(500);
    expect(err.message).toContain("Forge が 500 を返しました: /sdapi/v1/sd-models");
    expect(err.message.length).toBeLessThan(400);
  });

  it("接続できなければ status の無い ForgeError", async () => {
    forge = fakeForge({ down: true });
    const err = await client()
      .models()
      .catch((e) => e);
    expect(err).toBeInstanceOf(ForgeError);
    expect(err.status).toBeUndefined();
    expect(err.message).toContain("Forge に接続できません");
  });

  it("progress は withImage でプレビューを飛ばすかを切り替える", async () => {
    forge = fakeForge();
    await client().progress(true);
    await client().progress(false);
    expect(forge.calls.map((c) => c.path)).toEqual(["/sdapi/v1/progress?skip_current_image=false", "/sdapi/v1/progress?skip_current_image=true"]);
  });

  it("currentCheckpoint は options の sd_model_checkpoint (無ければ null)", async () => {
    forge = fakeForge({ options: { sd_model_checkpoint: "a.safetensors" } });
    expect(await client().currentCheckpoint()).toBe("a.safetensors");
    forge.state.options = {};
    expect(await client().currentCheckpoint()).toBeNull();
  });

  describe("status", () => {
    it("動いていて生成中でなければ online / busy false", async () => {
      forge = fakeForge();
      expect(await client().status()).toEqual({ online: true, busy: false });
    });

    it("job_count が 1 以上なら busy", async () => {
      forge = fakeForge({ progress: { ...idleProgress, state: { ...idleProgress.state, job_count: 1 } } });
      expect(await client().status()).toEqual({ online: true, busy: true });
    });

    it("--api 無し (404) は api-disabled、接続できなければ unreachable、それ以外は error", async () => {
      forge = fakeForge({ apiDisabled: true });
      expect(await client().status()).toEqual({ online: false, reason: "api-disabled" });
      forge.state.apiDisabled = false;
      forge.state.down = true;
      expect(await client().status()).toEqual({ online: false, reason: "unreachable" });
      forge.state.down = false;
      forge.state.extra["/sdapi/v1/progress"] = () => new Response("x", { status: 503 });
      expect(await client().status()).toMatchObject({ online: false, reason: "error", detail: expect.stringContaining("503") });
    });
  });
});
