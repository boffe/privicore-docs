/**
 * Bootstrap helper for probe modules that need an authenticated
 * session. Authenticates with the configured PRIVICORE_USERNAME /
 * PRIVICORE_PASSWORD and returns the token along with a connected
 * WebSocket ready to await acks.
 *
 * Kept separate from the individual probe modules so every async
 * probe doesn't re-implement the handshake. Authentication itself is
 * probed by `endpoints/profile-authenticate.ts`.
 */

import { probePostForm } from "./http.ts";
import { ProbeWS } from "./ws.ts";
import type { ProbeContext } from "./endpoints/index.ts";

export interface AuthenticatedSession {
  token: string;
  ws: ProbeWS;
  /** Close the WebSocket and release resources. Always call in a finally. */
  close(): void;
}

/** Authenticate with the configured credentials and return just the
 *  token. Cheap — no WebSocket. Use for sync-only probes. */
export async function authenticate(ctx: ProbeContext): Promise<string> {
  if (!ctx.username || !ctx.password) {
    throw new Error(
      "authenticated probes require PRIVICORE_USERNAME + PRIVICORE_PASSWORD in .env",
    );
  }
  const res = await probePostForm("/profile/authenticate", {
    username: ctx.username,
    password: ctx.password,
  });
  if (res.status !== 200) {
    throw new Error(
      `probe setup: authenticate failed (${res.status}): ${res.rawBody.slice(0, 200)}`,
    );
  }
  const body = res.body as { authorizationToken?: string };
  const token = body?.authorizationToken;
  if (!token) throw new Error(`probe setup: authenticate returned no authorizationToken`);
  return token;
}

/** Authenticate and also open a WebSocket ready to await async-command
 *  acks. For async probes. */
export async function openAuthenticatedSession(ctx: ProbeContext): Promise<AuthenticatedSession> {
  const token = await authenticate(ctx);
  const ws = new ProbeWS();
  await ws.connect(ctx.wsUrl, token);
  return { token, ws, close: () => ws.close() };
}
