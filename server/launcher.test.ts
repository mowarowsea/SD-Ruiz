import { afterEach, describe, expect, test, vi } from "vitest";
import { ForgeError } from "./forge.js";
import { Launcher } from "./launcher.js";

function stubFetch(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  });
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("Launcher", () => {
  test("サービス ID を URL に入れて LocalLauncher の API を叩く", async () => {
    const calls = stubFetch(200, { pid: 123 });
    const l = new Launcher("http://launcher:8765", "sd forge/neo");
    expect(await l.start()).toEqual({ pid: 123 });
    expect(calls[0]).toMatchObject({ url: "http://launcher:8765/api/services/sd%20forge%2Fneo/start", init: { method: "POST" } });
    await l.restart();
    expect(calls[1].url).toMatch(/\/restart$/);
  });

  test("LocalLauncher は失敗も 200 + {error} で返すので、それもエラーにする", async () => {
    stubFetch(200, { error: "already running" });
    await expect(new Launcher("http://launcher", "x").start()).rejects.toThrow(/LocalLauncher: already running/);
    stubFetch(500, {});
    await expect(new Launcher("http://launcher", "x").start()).rejects.toThrow(/HTTP 500/);
  });

  test("URL が設定されていなければ ForgeError", async () => {
    await expect(new Launcher(null, "x").start()).rejects.toBeInstanceOf(ForgeError);
  });

  test("log はログが無ければ空文字", async () => {
    const calls = stubFetch(200, { log: "abc", exists: true });
    expect(await new Launcher("http://launcher", "x").log(100)).toBe("abc");
    expect(calls[0].url).toMatch(/\/logs\?tail=100$/);
    stubFetch(200, { log: "", exists: false });
    expect(await new Launcher("http://launcher", "x").log()).toBe("");
  });
});
