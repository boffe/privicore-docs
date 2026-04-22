import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probeGet, probePostForm, probePostFormBasic } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

/** Full chain: register app → consent → obtain → refresh. */
export const probeOauthRefreshOauthAppAccessToken: EndpointProbe = {
  id: "oauth.refresh-oauth-app-access-token",
  summary: "Refresh OAuth app access token",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      const register = await probePostForm(
        "/oauth/register-oauth-application",
        {
          name: `probe-refresh-${Date.now()}`,
          redirectUri: "https://probe.example.com/oauth/callback",
          scopes: "data-token:read",
        },
        session.token,
      );
      const regAck = await session.ws.awaitCabAck((register.body as { commandId?: string })?.commandId!);
      const applicationId = (regAck.body as { applicationId?: string } | null)?.applicationId
        ?? (regAck.body as { id?: string } | null)?.id;
      if (!applicationId) throw new Error(`refresh setup: ack had no applicationId`);

      const cfg = await probeGet(`/oauth/retrieve-oauth-app-configuration/${applicationId}`, session.token);
      const clientId = (cfg.body as { clientId?: string })?.clientId;
      const clientSecret = (cfg.body as { clientSecret?: string })?.clientSecret;
      if (!clientId || !clientSecret) throw new Error(`refresh setup: configuration had no clientId/clientSecret`);

      const consent = await probePostForm("/oauth/request-oauth-app-authorization-code", { clientId, scopes: "data-token:read", state: "probe" }, session.token);
      const code = extractCode(consent);
      if (!code) throw new Error(`refresh setup: consent leg did not return a code`);

      const obtained = await probePostFormBasic("/oauth/obtain-oauth-app-access-token", { grantType: "authorization_code", code }, clientId, clientSecret);
      const refreshToken = (obtained.body as { refreshToken?: string })?.refreshToken;
      if (!refreshToken) throw new Error(`refresh setup: obtain did not return a refreshToken`);

      const form = { grantType: "refresh_token", refreshToken };
      const response = await probePostFormBasic("/oauth/refresh-oauth-app-access-token", form, clientId, clientSecret);
      if (response.status !== 200) throw new Error(`refresh-oauth-app-access-token expected 200, got ${response.status}`);

      const redacted = redactTokens(response);

      return {
        id: "oauth.refresh-oauth-app-access-token",
        summary: "Refresh OAuth app access token",
        method: "POST",
        path: "/oauth/refresh-oauth-app-access-token",
        phase: "sync",
        auth: "oauth",
        parameters: [
          { in: "form", name: "grantType", required: true, type: "string", example: "refresh_token" },
          { in: "form", name: "refreshToken", required: true, type: "string" },
        ],
        responses: [
          { status: 200, description: "Fresh access + refresh token pair issued.", schema: { type: "object", properties: { accessToken: { type: "string" }, tokenType: { type: "string" }, expiresIn: { type: "integer" }, refreshToken: { type: "string" }, scope: { type: "string" } } } },
          { status: 401, description: "Bad Basic-auth, or refresh token already used / revoked." },
        ],
        examples: [recordExample({
          name: "Happy path",
          method: "POST",
          path: "/oauth/refresh-oauth-app-access-token",
          bodyType: "form",
          body: { grantType: "refresh_token", refreshToken: `${refreshToken.slice(0, 6)}…<redacted>` },
          response: redacted,
          note: "Authenticated with Basic base64(clientId:clientSecret). Tokens redacted.",
        })],
        sourceRun: { tool: "probe", at: new Date().toISOString() },
      };
    } finally {
      session.close();
    }
  },
};

function extractCode(consent: { status: number; headers: Record<string, string>; body: unknown }): string | undefined {
  const loc = consent.headers["location"] ?? consent.headers["Location"];
  if (loc) {
    const m = loc.match(/[?&]code=([^&]+)/);
    if (m) return decodeURIComponent(m[1]!);
  }
  const body = consent.body;
  if (body && typeof body === "object" && "code" in body) {
    const code = (body as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

function redactTokens(response: { status: number; headers: Record<string, string>; body: unknown; rawBody: string }): typeof response {
  const body = response.body;
  if (body && typeof body === "object") {
    const copy = { ...(body as Record<string, unknown>) };
    for (const key of ["accessToken", "refreshToken"]) {
      if (typeof copy[key] === "string") {
        const s = copy[key] as string;
        copy[key] = s.length > 10 ? `${s.slice(0, 6)}…<redacted>` : "<redacted>";
      }
    }
    return { ...response, body: copy, rawBody: JSON.stringify(copy) };
  }
  return response;
}
