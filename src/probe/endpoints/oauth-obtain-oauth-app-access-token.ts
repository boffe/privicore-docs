import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probeGet, probePostForm, probePostFormBasic } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

/**
 * Full-chain probe: register app → retrieve its client credentials →
 * request a consent code → exchange code + Basic-auth-ed credentials
 * for an access token.
 *
 * The recorded example redacts `accessToken`, `refreshToken`, and
 * `clientSecret` so committing docset.json doesn't ship an active
 * token.
 */
export const probeOauthObtainOauthAppAccessToken: EndpointProbe = {
  id: "oauth.obtain-oauth-app-access-token",
  summary: "Obtain OAuth app access token",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      const register = await probePostForm(
        "/oauth/register-oauth-application",
        {
          name: `probe-obtain-${Date.now()}`,
          redirectUri: "https://probe.example.com/oauth/callback",
          scopes: "data-token:read",
        },
        session.token,
      );
      const registerCmdId = (register.body as { commandId?: string })?.commandId;
      if (!registerCmdId) throw new Error(`obtain-access-token setup: register returned no commandId`);
      const regAck = await session.ws.awaitCabAck(registerCmdId);
      const applicationId = (regAck.body as { applicationId?: string } | null)?.applicationId
        ?? (regAck.body as { id?: string } | null)?.id;
      if (!applicationId) throw new Error(`obtain-access-token setup: ack had no applicationId`);

      const cfg = await probeGet(`/oauth/retrieve-oauth-app-configuration/${applicationId}`, session.token);
      const clientId = (cfg.body as { clientId?: string })?.clientId;
      const clientSecret = (cfg.body as { clientSecret?: string })?.clientSecret;
      if (!clientId || !clientSecret) throw new Error(`obtain-access-token setup: configuration had no clientId/clientSecret`);

      const consent = await probePostForm(
        "/oauth/request-oauth-app-authorization-code",
        { clientId, scopes: "data-token:read", state: "probe-state" },
        session.token,
      );
      const code = extractCode(consent);
      if (!code) throw new Error(`obtain-access-token setup: consent leg did not return a code (status ${consent.status}). The server may require a browser-based consent flow that this probe cannot drive.`);

      const form = { grantType: "authorization_code", code };
      const response = await probePostFormBasic("/oauth/obtain-oauth-app-access-token", form, clientId, clientSecret);
      if (response.status !== 200) throw new Error(`obtain-oauth-app-access-token expected 200, got ${response.status}: ${response.rawBody.slice(0, 200)}`);

      const redacted = redactTokens(response);

      return {
        id: "oauth.obtain-oauth-app-access-token",
        summary: "Obtain OAuth app access token",
        method: "POST",
        path: "/oauth/obtain-oauth-app-access-token",
        phase: "sync",
        auth: "oauth",
        parameters: [
          { in: "form", name: "grantType", required: true, type: "string", example: "authorization_code" },
          { in: "form", name: "code", required: true, type: "string", description: "One-shot code from the consent leg." },
        ],
        responses: [
          { status: 200, description: "Access token issued.", schema: { type: "object", properties: { accessToken: { type: "string" }, tokenType: { type: "string" }, expiresIn: { type: "integer" }, refreshToken: { type: "string" }, scope: { type: "string" } } } },
          { status: 401, description: "Bad Basic-auth credentials, or code expired / already used." },
        ],
        examples: [recordExample({
          name: "Happy path",
          method: "POST",
          path: "/oauth/obtain-oauth-app-access-token",
          bodyType: "form",
          body: { grantType: "authorization_code", code: `${code.slice(0, 6)}…<redacted>` },
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
