import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probeGet, probePostForm } from "../http.ts";
import { recordExample } from "../recorder.ts";
import { createVotingConfiguration } from "../fixtures.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

/**
 * Self-cleaning: registers and activates a fresh policy, then
 * deactivates it. Existing activated policies on the profile are not
 * touched.
 */
export const probePolicyDeactivatePolicy: EndpointProbe = {
  id: "policy.deactivate-policy",
  summary: "Deactivate policy",
  destructive: true,
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      const votingConfigName = await createVotingConfiguration(session);
      const templates = await probeGet("/policy/list-policy-templates", session.token);
      const eventId = extractAnyEventId(templates.body);
      if (!eventId) throw new Error(`deactivate-policy setup: no event ids available`);

      const policyName = `probe-policy-${Date.now()}`;
      const registered = await probePostForm(
        "/policy/register-policy",
        {
          name: policyName,
          configuration: JSON.stringify({ scope: "profile" }),
          votingConfigurationId: votingConfigName,
          applyingEventIds: String(eventId),
        },
        session.token,
      );
      await session.ws.awaitCabAck((registered.body as { commandId?: string })?.commandId!);

      const activated = await probePostForm("/policy/activate-policy", { name: policyName }, session.token);
      await session.ws.awaitCabAck((activated.body as { commandId?: string })?.commandId!);

      const form = { name: policyName };
      const response = await probePostForm("/policy/deactivate-policy", form, session.token);
      if (response.status !== 202) throw new Error(`deactivate-policy expected 202, got ${response.status}`);
      const commandId = (response.body as { commandId?: string })?.commandId;
      if (!commandId) throw new Error(`deactivate-policy: no commandId`);
      const ack = await session.ws.awaitCabAck(commandId);

      return {
        id: "policy.deactivate-policy",
        summary: "Deactivate policy",
        method: "POST",
        path: "/policy/deactivate-policy",
        phase: "async-command",
        auth: "authorization-token",
        parameters: [{ in: "form", name: "name", required: true, type: "string" }],
        responses: [{ status: 202, description: "Policy deactivated." }],
        examples: [{
          ...recordExample({ name: "Happy path", method: "POST", path: "/policy/deactivate-policy", bodyType: "form", body: form, response }),
          asyncAck: { type: ack.type, commandStatus: ack.commandStatus, body: ack.body },
        }],
        sourceRun: { tool: "probe", at: new Date().toISOString() },
      };
    } finally {
      session.close();
    }
  },
};

function extractAnyEventId(body: unknown): number | string | undefined {
  const arr = Array.isArray(body) ? body : (body as { items?: unknown[] })?.items;
  if (!Array.isArray(arr)) return undefined;
  for (const t of arr) {
    const events = (t as { events?: Record<string, unknown> })?.events;
    if (events && typeof events === "object") {
      for (const v of Object.values(events)) if (typeof v === "number" || typeof v === "string") return v;
    }
  }
  return undefined;
}
