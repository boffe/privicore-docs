import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probeGet, probePostForm, probePostJson, extractCommandId } from "../http.ts";
import { recordExample } from "../recorder.ts";
import { createVotingConfiguration } from "../fixtures.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

/**
 * Self-cleaning: registers + activates a fresh policy, then deactivates
 * it. Existing activated policies on the profile are not touched.
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
      const picked = pickTemplateAndEvent(templates.body);
      if (!picked) throw new Error(`deactivate-policy setup: no template/event pair available`);

      const policyName = `probe-policy-${Date.now()}`;
      const registered = await probePostJson(
        "/policy/register",
        {
          name: policyName,
          policyTemplateId: picked.templateId,
          applyingEventIds: [picked.eventId],
          votingConfigurationId: votingConfigName,
          configuration: { classification: "internal", label: "probe", handling: "none" },
        },
        session.token,
      );
      await session.ws.awaitCabAck(extractCommandId(registered.body)!);

      let policyId: string | undefined;
      for (let attempt = 0; attempt < 5 && !policyId; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1000));
        const r = await probeGet(`/policy/retrieve-policy/${encodeURIComponent(policyName)}`, session.token);
        if (r.status === 200 && (r.body as { id?: string })?.id) {
          policyId = (r.body as { id: string }).id;
        }
      }
      if (!policyId) throw new Error(`deactivate-policy: could not retrieve ${policyName} after register`);

      const activated = await probePostForm("/policy/activate", { policyId }, session.token);
      await session.ws.awaitCabAck(extractCommandId(activated.body)!);

      const form = { policyId };
      const response = await probePostForm("/policy/deactivate", form, session.token);
      if (response.status !== 200 && response.status !== 202) {
        throw new Error(`deactivate-policy expected 200 or 202, got ${response.status}`);
      }
      const commandId = extractCommandId(response.body);
      if (!commandId) throw new Error(`deactivate-policy: no commandId`);
      const ack = await session.ws.awaitCabAck(commandId);

      return {
        id: "policy.deactivate-policy",
        summary: "Deactivate policy",
        method: "POST",
        path: "/policy/deactivate",
        phase: "async-command",
        auth: "authorization-token",
        parameters: [{ in: "form", name: "policyId", required: true, type: "string" }],
        responses: [{ status: 202, description: "Policy deactivated." }],
        examples: [{
          ...recordExample({ name: "Happy path", method: "POST", path: "/policy/deactivate", bodyType: "form", body: form, response }),
          asyncAck: { type: ack.type, commandStatus: ack.commandStatus, body: ack.body },
        }],
        sourceRun: { tool: "probe", at: new Date().toISOString() },
      };
    } finally {
      session.close();
    }
  },
};

function pickTemplateAndEvent(templatesBody: unknown): { templateId: string; eventId: string } | undefined {
  if (!templatesBody || typeof templatesBody !== "object") return undefined;
  for (const [templateId, t] of Object.entries(templatesBody as Record<string, unknown>)) {
    const events = (t as { events?: Record<string, unknown> })?.events;
    if (events && typeof events === "object") {
      const firstEventId = Object.keys(events)[0];
      if (firstEventId) return { templateId, eventId: firstEventId };
    }
  }
  return undefined;
}
