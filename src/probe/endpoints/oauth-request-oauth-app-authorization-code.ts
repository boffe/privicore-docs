import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probeGet, probePostForm, extractCommandId } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

/**
 * Step 3 of the OAuth code-grant flow. Registers a throwaway app,
 * retrieves its clientId via the single-use config endpoint, then
 * issues the authorization-code request.
 *
 * Wire: GET `/profile/oauth-application-request-authorization-code`
 * with `client_id`, `nonce`, and `scope[]` as query parameters. The
 * response body is the commandId (bare string or single-element
 * array) whose WS ack carries the pending authorization.
 */
export const probeOauthRequestOauthAppAuthorizationCode: EndpointProbe = {
  id: "oauth.request-oauth-app-authorization-code",
  summary: "Request OAuth app authorization code",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      const register = await probePostForm(
        "/profile/oauth-application-register",
        {
          name: `probe-consent-${Date.now()}`,
          redirectUri: "https://probe.example.com/oauth/callback",
          scopes: "data-token:read",
        },
        session.token,
      );
      const applicationId = extractCommandId(register.body);
      if (!applicationId) throw new Error(`consent setup: register returned no commandId`);
      await session.ws.awaitCabAck(applicationId);

      const cfg = await probePostForm(
        "/profile/retrieve-oauth-application-configuration",
        { applicationId },
        session.token,
      );
      const clientId = (cfg.body as { clientId?: string })?.clientId ?? "<unknown>";

      const nonce = `probe-${Date.now()}`;
      const query = { client_id: clientId, nonce, "scope[]": "all" };
      const response = await probeGet(
        "/profile/oauth-application-request-authorization-code",
        session.token,
        query,
      );
      if (response.status !== 200 && response.status !== 202) {
        throw new Error(`request-authorization-code expected 200 or 202, got ${response.status}`);
      }

      return {
        id: "oauth.request-oauth-app-authorization-code",
        summary: "Request OAuth app authorization code",
        method: "GET",
        path: "/profile/oauth-application-request-authorization-code",
        phase: "async-command",
        auth: "authorization-token",
        parameters: [
          { in: "query", name: "client_id", required: true, type: "string" },
          { in: "query", name: "nonce", required: true, type: "string", description: "Per-request opaque value, replayed back to `/oauth-application/retrieve-authorization-code`." },
          { in: "query", name: "scope[]", required: true, type: "string", description: "Scope value, repeated for multiple scopes (PHP-style array syntax)." },
        ],
        responses: [
          { status: 202, description: "Authorization-code request accepted; await the `X-DPT-CAB-ID` ack, then exchange the commandId for the real authorization code via `/oauth-application/retrieve-authorization-code`." },
        ],
        examples: [recordExample({
          name: "Happy path",
          method: "GET",
          path: "/profile/oauth-application-request-authorization-code",
          bodyType: "none",
          body: query,
          response,
          note: "Registered a throwaway app as setup.",
        })],
        sourceRun: { tool: "probe", at: new Date().toISOString() },
      };
    } finally {
      session.close();
    }
  },
};
