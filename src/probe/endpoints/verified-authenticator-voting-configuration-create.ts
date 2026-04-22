import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probePostJson, extractCommandId } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

export const probeVerifiedAuthenticatorVotingConfigurationCreate: EndpointProbe = {
  id: "verified-authenticator.voting-configuration.create",
  summary: "Create voting configuration",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      const body = {
        name: `probe-voting-config-${Date.now()}`,
        strategy: "unanimous",
        timeLimit: 60,
        deviceIdentifiers: [],
      };
      const response = await probePostJson("/verified-authenticator/voting-configuration/register", body, session.token);
      if (response.status !== 200 && response.status !== 202) {
        throw new Error(`voting-configuration/register expected 200 or 202, got ${response.status}`);
      }
      const commandId = extractCommandId(response.body);
      if (!commandId) throw new Error(`voting-configuration/register: no commandId in response body`);
      const ack = await session.ws.awaitCabAck(commandId);

      return {
        id: "verified-authenticator.voting-configuration.create",
        summary: "Create voting configuration",
        method: "POST",
        path: "/verified-authenticator/voting-configuration/register",
        phase: "async-command",
        auth: "authorization-token",
        parameters: [
          { in: "json", name: "name", required: true, type: "string", example: "high-assurance-exchange" },
          { in: "json", name: "strategy", required: true, type: "string", description: "Voting strategy — `unanimous` is canonical.", example: "unanimous" },
          { in: "json", name: "timeLimit", required: true, type: "integer", description: "Per-ballot deadline, in seconds.", example: 60 },
          { in: "json", name: "deviceIdentifiers", required: false, type: "array", description: "Device identifiers to target. Empty array dispatches to all authenticators." },
        ],
        responses: [
          { status: 202, description: "Configuration registration accepted; await the `X-DPT-CAB-ID` ack.", schema: { type: "object", properties: { commandId: { type: "string" } } } },
        ],
        examples: [{
          ...recordExample({ name: "Happy path", method: "POST", path: "/verified-authenticator/voting-configuration/register", bodyType: "json", body, response }),
          asyncAck: { type: ack.type, commandStatus: ack.commandStatus, body: ack.body },
        }],
        sourceRun: { tool: "probe", at: new Date().toISOString() },
      };
    } finally {
      session.close();
    }
  },
};
