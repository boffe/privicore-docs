import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probePostForm } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

export const probeVerifiedAuthenticatorVotingConfigurationCreate: EndpointProbe = {
  id: "verified-authenticator.voting-configuration.create",
  summary: "Create voting configuration",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      const form = {
        name: `probe-voting-config-${Date.now()}`,
        strategy: "unanimous",
        timeLimit: "60",
      };
      const response = await probePostForm("/verified-authenticator/voting-configuration/create", form, session.token);
      if (response.status !== 202) throw new Error(`voting-configuration/create expected 202, got ${response.status}`);
      const commandId = (response.body as { commandId?: string })?.commandId;
      if (!commandId) throw new Error(`voting-configuration/create: no commandId in response body`);
      const ack = await session.ws.awaitCabAck(commandId);

      return {
        id: "verified-authenticator.voting-configuration.create",
        summary: "Create voting configuration",
        method: "POST",
        path: "/verified-authenticator/voting-configuration/create",
        phase: "async-command",
        auth: "authorization-token",
        parameters: [
          { in: "form", name: "name", required: true, type: "string", example: "high-assurance-exchange" },
          { in: "form", name: "strategy", required: true, type: "string", description: "Voting strategy — `unanimous` is canonical.", example: "unanimous" },
          { in: "form", name: "timeLimit", required: true, type: "integer", description: "Per-ballot deadline, in seconds.", example: 60 },
          { in: "form", name: "deviceIdentifiers", required: false, type: "string", description: "Comma-separated list of device ids to target. Omit to dispatch to all authenticators." },
        ],
        responses: [
          { status: 202, description: "Configuration create accepted; await the `X-DPT-CAB-ID` ack.", schema: { type: "object", properties: { commandId: { type: "string" } } } },
        ],
        examples: [{
          ...recordExample({ name: "Happy path", method: "POST", path: "/verified-authenticator/voting-configuration/create", bodyType: "form", body: form, response }),
          asyncAck: { type: ack.type, commandStatus: ack.commandStatus, body: ack.body },
        }],
        sourceRun: { tool: "probe", at: new Date().toISOString() },
      };
    } finally {
      session.close();
    }
  },
};
