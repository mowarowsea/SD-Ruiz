import { afterEach, describe, expect, it } from "vitest";
import { ForgeError } from "./forge.js";
import { Launcher } from "./launcher.js";
import { fakeForge } from "./testing/forge.js";

let forge: ReturnType<typeof fakeForge> | null = null;
afterEach(() => forge?.restore());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("Launcher", () => {
  it("URL が未設定なら ForgeError", async () => {
    forge = fakeForge();
    await expect(new Launcher(null, "sd-forge-neo").start()).rejects.toThrow(/LocalLauncher が設定されていません/);
    expect(forge.calls).toHaveLength(0);
  });

  it("start / restart はサービス ID を URL に入れて POST する", async () => {
    forge = fakeForge({ extra: { "/api/services/sd%20forge/start": () => json({ pid: 42 }), "/api/services/sd%20forge/restart": () => json({ pid: 43 }) } });
    const l = new Launcher("http://launcher.test:8765", "sd forge");
    expect(await l.start()).toEqual({ pid: 42 });
    expect(await l.restart()).toEqual({ pid: 43 });
    expect(forge.calls.map((c) => c.method)).toEqual(["POST", "POST"]);
  });

  it("200 でも error が入っていれば ForgeError", async () => {
    forge = fakeForge({ extra: { "/api/services/x/start": () => json({ error: "already running" }) } });
    const err = await new Launcher("http://launcher.test", "x")
      .start()
      .catch((e) => e);
    expect(err).toBeInstanceOf(ForgeError);
    expect(err.message).toBe("LocalLauncher: already running");
  });

  it("JSON でない失敗は HTTP の status を出す", async () => {
    forge = fakeForge({ extra: { "/api/services/x/start": () => new Response("nope", { status: 500 }) } });
    await expect(new Launcher("http://launcher.test", "x").start()).rejects.toThrow("LocalLauncher: HTTP 500");
  });

  it("接続できなければ ForgeError", async () => {
    forge = fakeForge({ down: true });
    await expect(new Launcher("http://launcher.test", "x").start()).rejects.toThrow(/LocalLauncher に接続できません/);
  });

  it("log は tail を付けて取り、ログが無ければ空文字", async () => {
    forge = fakeForge({ extra: { "/api/services/x/logs": (c) => json(c.path.endsWith("tail=200") ? { log: "hello", exists: true } : { log: "", exists: false }) } });
    const l = new Launcher("http://launcher.test", "x");
    expect(await l.log(200)).toBe("hello");
    expect(await l.log()).toBe("");
    expect(forge.calls.map((c) => c.path)).toEqual(["/api/services/x/logs?tail=200", "/api/services/x/logs?tail=5000"]);
  });
});
