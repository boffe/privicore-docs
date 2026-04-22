import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probePostForm } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

export const probeOauthRegisterOauthApplication: EndpointProbe = {
  id: "oauth.register-oauth-application",
  summary: "Register OAuth application",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      const form = {
        name: `probe-app-${Date.now()}`,
        redirectUri: "https://probe.example.com/oauth/callback",
        scopes: "data-token:read",
      };
      const response = await probePostForm("/oauth/register-oauth-application", form, session.token);
      if (response.status !== 202) throw new Error(`register-oauth-application expected 202, got ${response.status}`);
      const commandId = (response.body as { commandId?: string })?.commandId;
      if (!commandId) throw new Error(`register-oauth-application: no commandId in response body`);
      const ack = await session.ws.awaitCabAck(commandId);

      return {
        id: "oauth.register-oauth-application",
        summary: "Register OAuth application",
        method: "POST",
        path: "/oauth/register-oauth-application",
        phase: "async-command",
        auth: "authorization-token",
        parameters: [
          { in: "form", name: "name", required: true, type: "string", description: "Display name." },
          { in: "form", name: "redirectUri", required: true, type: "string", description: "OAuth redirect URI." },
          { in: "form", name: "scopes", required: true, type: "string", description: "Comma-separated list of scopes." },
        ],
        responses: [
          { status: 202, description: "Registration accepted; await the `X-DPT-CAB-ID` ack.", schema: { type: "object", properties: { commandId: { type: "string" } } } },
        ],
        examples: [{
          ...recordExample({ name: "Happy path", method: "POST", path: "/oauth/register-oauth-application", bodyType: "form", body: form, response }),
          asyncAck: { type: ack.type, commandStatus: ack.commandStatus, body: ack.body },
        }],
        sourceRun: { tool: "probe", at: new Date().toISOString() },
      };
    } finally {
      session.close();
    }
  },
};
