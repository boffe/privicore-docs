import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probeGet, probePostForm, probePostFormBasic, extractCommandId } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

/**
 * Full-chain probe for the token-exchange leg of OAuth code grant:
 *
 *   1. Register a throwaway app (commandId = applicationId).
 *   2. Retrieve its client credentials (single-use).
 *   3. Request an authorization code (GET, async).
 *   4. Retrieve the authorization code (POST + Basic client:secret).
 *   5. Exchange the authorization code for an access token (POST + Basic).
 *
 * The recorded example redacts access token, refresh token, and client
 * secret so committing docset.json doesn't ship active credentials.
 */
export const probeOauthObtainOauthAppAccessToken: EndpointProbe = {
  id: "oauth.obtain-oauth-app-access-token",
  summary: "Obtain OAuth app access token",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      // 1. Register throwaway app.
      const register = await probePostForm(
        "/profile/oauth-application-register",
        {
          name: `probe-obtain-${Date.now()}`,
          redirectUri: "https://probe.example.com/oauth/callback",
          scopes: "data-token:read",
        },
        session.token,
      );
      const applicationId = extractCommandId(register.body);
      if (!applicationId) throw new Error(`obtain-access-token setup: register returned no commandId`);
      await session.ws.awaitCabAck(applicationId);

      // 2. Retrieve client credentials.
      const cfg = await probePostForm(
        "/profile/retrieve-oauth-application-configuration",
        { applicationId },
        session.token,
      );
      const clientId = (cfg.body as { clientId?: string })?.clientId;
      const clientSecret = (cfg.body as { clientSecret?: string })?.clientSecret;
      if (!clientId || !clientSecret) throw new Error(`obtain-access-token setup: configuration had no clientId/clientSecret`);

      // 3. Request authorization code (async — commandId comes back).
      const nonce = `probe-${Date.now()}`;
      const consent = await probeGet(
        "/profile/oauth-application-request-authorization-code",
        session.token,
        { client_id: clientId, nonce, "scope[]": "all" },
      );
      const reqCmdId = extractCommandId(consent.body);
      if (!reqCmdId) throw new Error(`obtain-access-token setup: authorization-code request returned no commandId`);
      await session.ws.awaitCabAck(reqCmdId);

      // 4. Retrieve the authorization code using Basic client:secret.
      const retrieve = await probePostFormBasic(
        "/oauth-application/retrieve-authorization-code",
        { id: reqCmdId, nonce },
        clientId,
        clientSecret,
      );
      const authorizationCode = (retrieve.body as { authorizationCode?: string })?.authorizationCode;
      if (!authorizationCode) throw new Error(`obtain-access-token setup: retrieve-authorization-code returned no authorizationCode (status ${retrieve.status})`);

      // 5. Exchange the code for an access token.
      const form = { authorization_code: authorizationCode };
      const response = await probePostFormBasic("/oauth-application/obtain-access-token", form, clientId, clientSecret);
      if (response.status !== 200) {
        throw new Error(`obtain-access-token expected 200, got ${response.status}: ${response.rawBody.slice(0, 200)}`);
      }

      const redacted = redactTokens(response);

      return {
        id: "oauth.obtain-oauth-app-access-token",
        summary: "Obtain OAuth app access token",
        method: "POST",
        path: "/oauth-application/obtain-access-token",
        phase: "sync",
        auth: "oauth",
        parameters: [
          { in: "header", name: "Authorization", required: true, type: "string", description: "`Basic base64(clientId:clientSecret)`." },
          { in: "form", name: "authorization_code", required: true, type: "string", description: "One-shot code from `/oauth-application/retrieve-authorization-code`." },
        ],
        responses: [
          { status: 200, description: "Access token issued.", schema: { type: "object", properties: { token: { type: "string" }, refreshToken: { type: "string" }, expiresAt: { type: "string" } } } },
          { status: 401, description: "Bad Basic-auth credentials, or code expired / already used." },
        ],
        examples: [recordExample({
          name: "Happy path",
          method: "POST",
          path: "/oauth-application/obtain-access-token",
          bodyType: "form",
          body: { authorization_code: `${authorizationCode.slice(0, 6)}…<redacted>` },
          response: redacted,
          note: "Authenticated with Basic base64(clientId:clientSecret). Tokens redacted in recording.",
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
