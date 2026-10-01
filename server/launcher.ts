// LocalLauncher (Forge Neo を起動・監視している常駐ランチャー) の API クライアント
// Forge の起動は LocalLauncher に任せる。PID の管理とログ (service_logs/<id>.log) を一か所にまとめるため

import { ForgeError } from "./forge.js";

export class Launcher {
  constructor(
    readonly baseUrl: string | null,
    readonly serviceId: string,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    if (!this.baseUrl) throw new ForgeError("LocalLauncher が設定されていません (config.json の launcherUrl)");
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/services/${encodeURIComponent(this.serviceId)}${path}`, { signal: AbortSignal.timeout(15_000), ...init });
    } catch (e) {
      throw new ForgeError(`LocalLauncher に接続できません: ${(e as Error).message}`);
    }
    // LocalLauncher は失敗も 200 + {"error": ...} で返す
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok || body.error) throw new ForgeError(`LocalLauncher: ${body.error ?? `HTTP ${res.status}`}`);
    return body;
  }

  start() {
    return this.request<{ pid: number }>("/start", { method: "POST" });
  }

  /** 止めてから起動し直す (止まらないプロセスはプロセスツリーごと終了させる) */
  restart() {
    return this.request<{ pid: number }>("/restart", { method: "POST" });
  }

  /** ログの末尾 (LocalLauncher 側で 512KB / 5000 行まで) */
  async log(tail = 5000) {
    const r = await this.request<{ log: string; exists: boolean }>(`/logs?tail=${tail}`);
    return r.exists ? r.log : "";
  }
}
