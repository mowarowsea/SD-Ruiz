import { afterEach, describe, expect, test, vi } from "vitest";
import { ForgeClient, ForgeError } from "./forge.js";

type Reply = { status: number; body?: unknown } | Error;
/** fetch を差し替えて、URL ごとの応答を決める。呼ばれた URL と init を記録する */
function stubFetch(reply: (url: string) => Reply) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = reply(url);
    if (r instanceof Error) throw r;
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  });
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const progress = { progress: 0, eta_relative: 0, state: { job_count: 0, sampling_step: 0, sampling_steps: 0, interrupted: false }, current_image: null };

describe("ForgeClient.status", () => {
  test("progress が取れれば online。job_count で生成中か分かる", async () => {
    stubFetch(() => ({ status: 200, body: { ...progress, state: { ...progress.state, job_count: 1 } } }));
    expect(await new ForgeClient("http://forge").status()).toEqual({ online: true, busy: true });
  });

  test("404 なら --api 無しで起動している、つながらなければ unreachable、それ以外はエラー", async () => {
    stubFetch(() => ({ status: 404 }));
    expect(await new ForgeClient("http://forge").status()).toEqual({ online: false, reason: "api-disabled" });
    stubFetch(() => new TypeError("fetch failed"));
    expect(await new ForgeClient("http://forge").status()).toEqual({ online: false, reason: "unreachable" });
    stubFetch(() => ({ status: 500, body: { detail: "boom" } }));
    expect(await new ForgeClient("http://forge").status()).toMatchObject({ online: false, reason: "error", detail: expect.stringContaining("500") });
  });
});

describe("ForgeClient の呼び出し", () => {
  test("エラーは ForgeError にし、本文の先頭を添える", async () => {
    stubFetch(() => ({ status: 422, body: { detail: "bad request" } }));
    const e = await new ForgeClient("http://forge").models().catch((e) => e);
    expect(e).toBeInstanceOf(ForgeError);
    expect(e.status).toBe(422);
    expect(e.message).toContain("422");
    expect(e.message).toContain("bad request");
  });

  test("txt2img は POST で JSON を送る (長い生成なので AbortSignal は付けない)。currentCheckpoint は無ければ null", async () => {
    const calls = stubFetch((url) => (url.endsWith("/txt2img") ? { status: 200, body: { images: [], info: "{}" } } : { status: 200, body: {} }));
    const forge = new ForgeClient("http://forge");
    await forge.txt2img({ prompt: "a" } as never);
    expect(calls[0].url).toBe("http://forge/sdapi/v1/txt2img");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ prompt: "a" });
    expect(calls[0].init.signal).toBeUndefined();
    expect(await forge.currentCheckpoint()).toBeNull();
    expect(calls[1].init.signal).toBeInstanceOf(AbortSignal);
  });
});
