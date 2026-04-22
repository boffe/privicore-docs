import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probeGet, probePostForm } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

/**
 * Setup-chain: registers a throwaway OAuth application, then fetches
 * its configuration to record the sync endpoint's shape.
 *
 * The clientSecret in the recorded example is redacted so committing
 * the docset doesn't leak an active credential.
 */
export const probeOauthRetrieveOauthAppConfiguration: EndpointProbe = {
  id: "oauth.retrieve-oauth-app-configuration",
  summary: "Retrieve OAuth app configuration",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      const register = await probePostForm(
        "/oauth/register-oauth-application",
        {
          name: `probe-app-${Date.now()}`,
          redirectUri: "https://probe.example.com/oauth/callback",
          scopes: "data-token:read",
        },
        session.token,
      );
      const commandId = (register.body as { commandId?: string })?.commandId;
      if (!commandId) throw new Error(`retrieve-oauth-app-configuration setup: register returned no commandId`);
      const ack = await session.ws.awaitCabAck(commandId);
      const applicationId = (ack.body as { applicationId?: string } | null)?.applicationId
        ?? (ack.body as { id?: string } | null)?.id;
      if (!applicationId) throw new Error(`retrieve-oauth-app-configuration setup: ack body had no applicationId`);

      const response = await probeGet(
        `/oauth/retrieve-oauth-app-configuration/${applicationId}`,
        session.token,
      );
      if (response.status !== 200) throw new Error(`retrieve-oauth-app-configuration expected 200, got ${response.status}`);

      const redactedResponse = redactSecret(response);

      return {
        id: "oauth.retrieve-oauth-app-configuration",
        summary: "Retrieve OAuth app configuration",
        method: "GET",
        path: "/oauth/retrieve-oauth-app-configuration/{applicationId}",
        phase: "sync",
        auth: "authorization-token",
        parameters: [
          { in: "path", name: "applicationId", required: true, type: "string", description: "Id from `register-oauth-application`." },
        ],
        responses: [
          { status: 200, description: "Application configuration.", schema: { type: "object", properties: { applicationId: { type: "string" }, clientId: { type: "string" }, clientSecret: { type: "string" }, redirectUri: { type: "string" }, scopes: { type: "array", items: { type: "string" } } } } },
        ],
        examples: [recordExample({
          name: "Happy path",
          method: "GET",
          path: `/oauth/retrieve-oauth-app-configuration/${applicationId}`,
          bodyType: "none",
          response: redactedResponse,
          note: "clientSecret redacted. Registered a throwaway app as setup.",
        })],
        sourceRun: { tool: "probe", at: new Date().toISOString() },
      };
    } finally {
      session.close();
    }
  },
};

function redactSecret(response: { status: number; headers: Record<string, string>; body: unknown; rawBody: string }): { status: number; headers: Record<string, string>; body: unknown; rawBody: string } {
  const body = response.body;
  if (body && typeof body === "object" && !Array.isArray(body) && "clientSecret" in body) {
    const copy = { ...(body as Record<string, unknown>) };
    copy.clientSecret = "<redacted>";
    return { ...response, body: copy, rawBody: JSON.stringify(copy) };
  }
  return response;
}
