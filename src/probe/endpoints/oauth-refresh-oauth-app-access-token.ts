import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probeGet, probePostForm, probePostFormBasic, probePostFormRawBasic, extractCommandId } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

/** Full chain: register app → retrieve config → request code → retrieve code → obtain tokens → refresh. */
export const probeOauthRefreshOauthAppAccessToken: EndpointProbe = {
  id: "oauth.refresh-oauth-app-access-token",
  summary: "Refresh OAuth app access token",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      const register = await probePostForm(
        "/profile/oauth-application-register",
        {
          name: `probe-refresh-${Date.now()}`,
          redirectUri: "https://probe.example.com/oauth/callback",
          scopes: "data-token:read",
        },
        session.token,
      );
      const applicationId = extractCommandId(register.body);
      if (!applicationId) throw new Error(`refresh setup: register returned no commandId`);
      await session.ws.awaitCabAck(applicationId);

      const cfg = await probePostForm(
        "/profile/retrieve-oauth-application-configuration",
        { applicationId },
        session.token,
      );
      const clientId = (cfg.body as { clientId?: string })?.clientId;
      const clientSecret = (cfg.body as { clientSecret?: string })?.clientSecret;
      if (!clientId || !clientSecret) throw new Error(`refresh setup: config missing clientId/clientSecret`);

      const nonce = `probe-${Date.now()}`;
      const consent = await probeGet(
        "/profile/oauth-application-request-authorization-code",
        session.token,
        { client_id: clientId, nonce, "scope[]": "all" },
      );
      const reqCmdId = extractCommandId(consent.body);
      if (!reqCmdId) throw new Error(`refresh setup: authorization-code request returned no commandId`);
      await session.ws.awaitCabAck(reqCmdId);

      const retrieve = await probePostFormBasic(
        "/oauth-application/retrieve-authorization-code",
        { id: reqCmdId, nonce },
        clientId,
        clientSecret,
      );
      const authorizationCode = (retrieve.body as { authorizationCode?: string })?.authorizationCode;
      if (!authorizationCode) throw new Error(`refresh setup: retrieve-authorization-code returned no authorizationCode`);

      const obtained = await probePostFormBasic(
        "/oauth-application/obtain-access-token",
        { authorization_code: authorizationCode },
        clientId,
        clientSecret,
      );
      const accessToken = (obtained.body as { token?: string })?.token;
      const refreshToken = (obtained.body as { refreshToken?: string })?.refreshToken;
      if (!accessToken || !refreshToken) throw new Error(`refresh setup: obtain did not return token + refreshToken`);

      const form = { refresh_token: refreshToken };
      const response = await probePostFormRawBasic("/oauth-application/refresh-access-token", form, accessToken);
      if (response.status !== 200) throw new Error(`refresh-access-token expected 200, got ${response.status}: ${response.rawBody.slice(0, 200)}`);

      const redacted = redactTokens(response);

      return {
        id: "oauth.refresh-oauth-app-access-token",
        summary: "Refresh OAuth app access token",
        method: "POST",
        path: "/oauth-application/refresh-access-token",
        phase: "sync",
        auth: "oauth",
        parameters: [
          { in: "header", name: "Authorization", required: true, type: "string", description: "`Basic <current-access-token>` — the raw access token, not base64(clientId:clientSecret)." },
          { in: "form", name: "refresh_token", required: true, type: "string" },
        ],
        responses: [
          { status: 200, description: "Fresh access + refresh token pair issued.", schema: { type: "object", properties: { token: { type: "string" }, refreshToken: { type: "string" }, expiresAt: { type: "string" } } } },
          { status: 401, description: "Bad Basic-auth header, or refresh token already used / revoked." },
        ],
        examples: [recordExample({
          name: "Happy path",
          method: "POST",
          path: "/oauth-application/refresh-access-token",
          bodyType: "form",
          body: { refresh_token: `${refreshToken.slice(0, 6)}…<redacted>` },
          response: redacted,
          note: "Authenticated with `Basic <access-token>`. Tokens redacted in recording.",
        })],
        sourceRun: { tool: "probe", at: new Date().toISOString() },
      };
    } finally {
      session.close();
    }
  },
};

function redactTokens(response: { status: number; headers: Record<string, string>; body: unknown; rawBody: string }): typeof response {
  const body = response.body;
  if (body && typeof body === "object") {
    const copy = { ...(body as Record<string, unknown>) };
    for (const key of ["token", "accessToken", "refreshToken"]) {
      if (typeof copy[key] === "string") {
        const s = copy[key] as string;
        copy[key] = s.length > 10 ? `${s.slice(0, 6)}…<redacted>` : "<redacted>";
      }
    }
    return { ...response, body: copy, rawBody: JSON.stringify(copy) };
  }
  return response;
}
