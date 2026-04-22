/**
 * Minimal WebSocket client for probe modules. Connects to the CAB
 * WebSocket proxy, joins a channel bound to an authorization token,
 * and exposes promise-returning awaiters for the two correlation
 * shapes used by Privicore's async command model:
 *
 *   - `X-DPT-CAB-ID` for async-command acks (keyed by `commandId`).
 *   - `X-DPT-CAB-REQUEST-ID` for async-request acks (keyed by
 *     `requestId`).
 *
 * Deliberately small. Probe modules get their inputs (commandId,
 * requestId) synchronously from the HTTP response, then await the
 * matching WS message.
 */

// `WebSocket` is available as a global from Node 22. No import needed.

export interface ProbeWsAck {
  type: string;
  commandStatus: number;
  body: unknown;
  raw: unknown;
}

export class ProbeWS {
  private ws: WebSocket | null = null;
  private listeners: Array<(msg: unknown) => void> = [];

  async connect(wsUrl: string, authorizationToken: string): Promise<void> {
    this.ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      this.ws!.addEventListener("open", () => resolve());
      this.ws!.addEventListener("error", () => reject(new Error(`WebSocket open failed for ${wsUrl}`)));
    });
    this.ws.addEventListener("message", (ev) => {
      let msg: unknown;
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      for (const l of this.listeners) l(msg);
    });
    await this.joinChannel(authorizationToken);
  }

  private joinChannel(token: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("joinChannel timed out")), 10_000);
      const listener = (msg: unknown) => {
        const m = msg as { status?: number; data?: { channelId?: string } };
        if (m.status === 200 && m.data?.channelId) {
          this.listeners = this.listeners.filter((l) => l !== listener);
          clearTimeout(timer);
          resolve(m.data.channelId);
        }
      };
      this.listeners.push(listener);
      this.ws!.send(JSON.stringify({ action: "joinChannel", data: { authorizationToken: token } }));
    });
  }

  awaitCabAck(commandId: string, timeoutMs = 30_000): Promise<ProbeWsAck> {
    return this.awaitMatching("X-DPT-CAB-ID", commandId, timeoutMs);
  }

  awaitRequestAck(requestId: string, timeoutMs = 30_000): Promise<ProbeWsAck> {
    return this.awaitMatching("X-DPT-CAB-REQUEST-ID", requestId, timeoutMs);
  }

  private awaitMatching(type: string, id: string, timeoutMs: number): Promise<ProbeWsAck> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners = this.listeners.filter((l) => l !== listener);
        reject(new Error(`timed out waiting for ${type} matching ${id}`));
      }, timeoutMs);
      const listener = (msg: unknown) => {
        const m = msg as { data?: { id?: string; type?: string; command_status?: number; body?: unknown } };
        if (m.data?.type !== type || m.data?.id !== id) return;
        this.listeners = this.listeners.filter((l) => l !== listener);
        clearTimeout(timer);
        resolve({
          type: m.data.type!,
          commandStatus: m.data.command_status ?? 0,
          body: m.data.body,
          raw: msg,
        });
      };
      this.listeners.push(listener);
    });
  }

  close(): void {
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    this.listeners = [];
  }
}
