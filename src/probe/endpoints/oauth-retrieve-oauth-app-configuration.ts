import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probePostForm, extractCommandId } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

/**
 * Setup-chain: registers a throwaway OAuth application, awaits the
 * register ack, then fetches its configuration.
 *
 * The commandId returned by `/profile/oauth-application-register` is
 * the `applicationId` consumed here. The endpoint is single-use — a
 * second call with the same applicationId returns 422 with
 * `oauth.already_retrieved`.
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
        "/profile/oauth-application-register",
        {
          name: `probe-app-${Date.now()}`,
          redirectUri: "https://probe.example.com/oauth/callback",
          scopes: "data-token:read",
        },
        session.token,
      );
      const applicationId = extractCommandId(register.body);
      if (!applicationId) throw new Error(`retrieve-oauth-app-configuration setup: register returned no commandId`);
      await session.ws.awaitCabAck(applicationId);

      const form = { applicationId };
      const response = await probePostForm(
        "/profile/retrieve-oauth-application-configuration",
        form,
        session.token,
      );
      if (response.status !== 200) throw new Error(`retrieve-oauth-application-configuration expected 200, got ${response.status}`);

      const redactedResponse = redactSecret(response);

      return {
        id: "oauth.retrieve-oauth-app-configuration",
        summary: "Retrieve OAuth app configuration",
        method: "POST",
        path: "/profile/retrieve-oauth-application-configuration",
        phase: "sync",
        auth: "authorization-token",
        parameters: [
          { in: "form", name: "applicationId", required: true, type: "string", description: "The commandId returned by `/profile/oauth-application-register`." },
        ],
        responses: [
          { status: 200, description: "Application credentials. Single-use — a second call with the same applicationId returns 422.", schema: { type: "object", properties: { applicationId: { type: "string" }, clientId: { type: "string" }, clientSecret: { type: "string" }, redirectUri: { type: "string" }, scopes: { type: "array", items: { type: "string" } } } } },
          { status: 422, description: "Already retrieved (`oauth.already_retrieved`). Credentials cannot be recovered — re-register the application." },
        ],
        examples: [recordExample({
          name: "Happy path",
          method: "POST",
          path: "/profile/retrieve-oauth-application-configuration",
          bodyType: "form",
          body: form,
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
