import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probePostForm } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

/**
 * Registers a throwaway app, then invokes the consent leg with our
 * authenticated session. The response is typically a 302 redirect
 * carrying the authorization code, or a 2xx with the code in the
 * body. Recording captures whichever shape the server returns so the
 * reference is honest about the live behaviour.
 */
export const probeOauthRequestOauthAppAuthorizationCode: EndpointProbe = {
  id: "oauth.request-oauth-app-authorization-code",
  summary: "Request OAuth app authorization code",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      // Register a throwaway app to get a clientId.
      const register = await probePostForm(
        "/oauth/register-oauth-application",
        {
          name: `probe-consent-${Date.now()}`,
          redirectUri: "https://probe.example.com/oauth/callback",
          scopes: "data-token:read",
        },
        session.token,
      );
      const registerCmdId = (register.body as { commandId?: string })?.commandId;
      if (!registerCmdId) throw new Error(`consent setup: register-oauth-application returned no commandId`);
      const ack = await session.ws.awaitCabAck(registerCmdId);
      const applicationId = (ack.body as { applicationId?: string } | null)?.applicationId
        ?? (ack.body as { id?: string } | null)?.id;
      if (!applicationId) throw new Error(`consent setup: ack body had no applicationId`);

      // Pull config for the clientId.
      const cfg = await probePostForm(`/oauth/retrieve-oauth-app-configuration/${applicationId}`, {}, session.token);
      const clientId = (cfg.body as { clientId?: string })?.clientId ?? "<unknown>";

      const form = { clientId, scopes: "data-token:read", state: "probe-state" };
      const response = await probePostForm("/oauth/request-oauth-app-authorization-code", form, session.token);

      return {
        id: "oauth.request-oauth-app-authorization-code",
        summary: "Request OAuth app authorization code",
        method: "POST",
        path: "/oauth/request-oauth-app-authorization-code",
        phase: "sync",
        auth: "authorization-token",
        parameters: [
          { in: "form", name: "clientId", required: true, type: "string" },
          { in: "form", name: "scopes", required: true, type: "string" },
          { in: "form", name: "state", required: false, type: "string", description: "Opaque CSRF token echoed on redirect." },
        ],
        responses: [
          { status: 302, description: "Redirect to `redirectUri` with `?code=…&state=…` appended." },
          { status: 200, description: "Code returned inline (some flows)." },
        ],
        examples: [recordExample({ name: response.status === 302 ? "Consent redirect" : "Inline response", method: "POST", path: "/oauth/request-oauth-app-authorization-code", bodyType: "form", body: form, response, note: "Probe captures whatever the server returns; browser-based consent UIs may differ." })],
        sourceRun: { tool: "probe", at: new Date().toISOString() },
      };
    } finally {
      session.close();
    }
  },
};
