import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probeGet, probePostForm } from "../http.ts";
import { recordExample } from "../recorder.ts";
import { createVotingConfiguration } from "../fixtures.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

export const probePolicyActivatePolicy: EndpointProbe = {
  id: "policy.activate-policy",
  summary: "Activate policy",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      const votingConfigName = await createVotingConfiguration(session);
      const templates = await probeGet("/policy/list-policy-templates", session.token);
      const eventId = extractAnyEventId(templates.body);
      if (!eventId) throw new Error(`activate-policy setup: no event ids available`);

      const policyName = `probe-policy-${Date.now()}`;
      const register = await probePostForm(
        "/policy/register-policy",
        {
          name: policyName,
          configuration: JSON.stringify({ scope: "profile" }),
          votingConfigurationId: votingConfigName,
          applyingEventIds: String(eventId),
        },
        session.token,
      );
      const registerCmdId = (register.body as { commandId?: string })?.commandId!;
      await session.ws.awaitCabAck(registerCmdId);

      const form = { name: policyName };
      const response = await probePostForm("/policy/activate-policy", form, session.token);
      if (response.status !== 202) throw new Error(`activate-policy expected 202, got ${response.status}`);
      const commandId = (response.body as { commandId?: string })?.commandId;
      if (!commandId) throw new Error(`activate-policy: no commandId`);
      const ack = await session.ws.awaitCabAck(commandId);

      return {
        id: "policy.activate-policy",
        summary: "Activate policy",
        method: "POST",
        path: "/policy/activate-policy",
        phase: "async-command",
        auth: "authorization-token",
        parameters: [{ in: "form", name: "name", required: true, type: "string" }],
        responses: [{ status: 202, description: "Policy activated." }],
        examples: [{
          ...recordExample({ name: "Happy path", method: "POST", path: "/policy/activate-policy", bodyType: "form", body: form, response }),
          asyncAck: { type: ack.type, commandStatus: ack.commandStatus, body: ack.body },
        }],
        sourceRun: { tool: "probe", at: new Date().toISOString() },
      };
    } finally {
      session.close();
    }
  },
};

function extractAnyEventId(templatesBody: unknown): number | string | undefined {
  const templates = Array.isArray(templatesBody) ? templatesBody : (templatesBody as { items?: unknown[] })?.items;
  if (!Array.isArray(templates)) return undefined;
  for (const t of templates) {
    const events = (t as { events?: Record<string, unknown> })?.events;
    if (events && typeof events === "object") {
      for (const v of Object.values(events)) {
        if (typeof v === "number" || typeof v === "string") return v;
      }
    }
  }
  return undefined;
}
