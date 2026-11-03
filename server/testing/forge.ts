// テスト用の Forge Neo (と LocalLauncher) の偽物。fetch を差し替え、/sdapi/v1/* への呼び出しに決めた答えを返す

import { vi } from "vitest";
import type { ForgeLora, ForgeModel, ForgeProgress, Txt2ImgRequest, Txt2ImgResponse } from "../forge.js";

export interface Call {
  method: string;
  url: string;
  path: string;
  body: unknown;
}

export interface FakeForgeState {
  models: ForgeModel[];
  loras: ForgeLora[];
  samplers: string[];
  schedulers: { name: string; label: string }[];
  modules: { model_name: string; filename: string }[];
  scripts: string[];
  options: Record<string, unknown>;
  progress: ForgeProgress;
  /** txt2img の答え (関数なら要求を見て決める)。Error を投げると 500 */
  txt2img: Txt2ImgResponse | ((req: Txt2ImgRequest) => Txt2ImgResponse | Promise<Txt2ImgResponse>);
  /** 丸ごと落ちている (接続できない) */
  down: boolean;
  /** --api 無しで起動している (/sdapi/* が 404) */
  apiDisabled: boolean;
  /** 上記以外のパスの答え (IIB や LocalLauncher など)。path は URL のパス + クエリ */
  extra: Record<string, (call: Call) => Response | Promise<Response>>;
}

export const idleProgress: ForgeProgress = { progress: 0, eta_relative: 0, state: { job_count: 0, sampling_step: 0, sampling_steps: 0, interrupted: false }, current_image: null };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** 1x1 の PNG (base64)。txt2img の答えに使う */
export const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export function fakeForge(partial: Partial<FakeForgeState> = {}) {
  const state: FakeForgeState = {
    models: [],
    loras: [],
    samplers: ["Euler a", "DPM++ 2M", "LCM"],
    schedulers: [
      { name: "automatic", label: "Automatic" },
      { name: "karras", label: "Karras" },
      { name: "sgm_uniform", label: "SGM Uniform" },
    ],
    modules: [],
    scripts: [],
    options: { sd_model_checkpoint: null },
    progress: idleProgress,
    txt2img: { images: [tinyPngBase64], info: JSON.stringify({ all_seeds: [1], all_prompts: ["x"] }) },
    down: false,
    apiDisabled: false,
    extra: {},
    ...partial,
  };
  const calls: Call[] = [];

  const handle = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(url);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    const call: Call = { method, url, path: u.pathname + u.search, body };
    calls.push(call);
    if (state.down) throw new TypeError("fetch failed");
    const extra = state.extra[u.pathname] ?? state.extra[call.path];
    if (extra) return extra(call);
    if (!u.pathname.startsWith("/sdapi/v1/")) return json({ error: "not found" }, 404);
    if (state.apiDisabled) return new Response("Not Found", { status: 404 });
    switch (u.pathname) {
      case "/sdapi/v1/progress":
        return json(state.progress);
      case "/sdapi/v1/sd-models":
        return json(state.models);
      case "/sdapi/v1/loras":
        return json(state.loras);
      case "/sdapi/v1/samplers":
        return json(state.samplers.map((name) => ({ name })));
      case "/sdapi/v1/schedulers":
        return json(state.schedulers);
      case "/sdapi/v1/sd-modules":
        return json(state.modules);
      case "/sdapi/v1/scripts":
        return json({ txt2img: state.scripts.map((s) => s.toLowerCase()), img2img: [] });
      case "/sdapi/v1/options":
        return json(state.options);
      case "/sdapi/v1/refresh-checkpoints":
      case "/sdapi/v1/refresh-loras":
      case "/sdapi/v1/interrupt":
        return json(null);
      case "/sdapi/v1/txt2img":
        try {
          return json(typeof state.txt2img === "function" ? await state.txt2img(body as Txt2ImgRequest) : state.txt2img);
        } catch (e) {
          return new Response(`Internal Server Error: ${(e as Error).message}`, { status: 500 });
        }
      default:
        return new Response("Not Found", { status: 404 });
    }
  };

  const fetchMock = vi.fn(handle);
  vi.stubGlobal("fetch", fetchMock);

  return {
    state,
    calls,
    fetch: fetchMock,
    /** そのパスへの呼び出し (新しい順ではなく呼んだ順) */
    callsTo: (path: string) => calls.filter((c) => c.path === path || c.path.startsWith(`${path}?`)),
    restore: () => vi.unstubAllGlobals(),
  };
}
