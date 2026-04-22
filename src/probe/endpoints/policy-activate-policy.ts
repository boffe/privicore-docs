import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probeGet, probePostForm, probePostJson, extractCommandId } from "../http.ts";
import { recordExample } from "../recorder.ts";
import { createVotingConfiguration } from "../fixtures.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

/**
 * Full activate-policy flow: register (JSON), await ack, look up policy id by
 * name via /policy/retrieve-policy/{name} (eventual-consistency: retry),
 * then call /policy/activate with {policyId}.
 */
export const probePolicyActivatePolicy: EndpointProbe = {
  id: "policy.activate-policy",
  summary: "Activate policy",
  destructive: true,
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      const votingConfigName = await createVotingConfiguration(session);
      const templates = await probeGet("/policy/list-policy-templates", session.token);
      const picked = pickTemplateAndEvent(templates.body);
      if (!picked) throw new Error(`activate-policy setup: no template/event pair available`);

      const policyName = `probe-policy-${Date.now()}`;
      const register = await probePostJson(
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
      const registerCmdId = extractCommandId(register.body);
      if (!registerCmdId) throw new Error(`activate-policy setup: register returned no commandId`);
      await session.ws.awaitCabAck(registerCmdId);

      // Look up the policy id by name (eventual consistency — retry briefly).
      let policyId: string | undefined;
      for (let attempt = 0; attempt < 5 && !policyId; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1000));
        const r = await probeGet(`/policy/retrieve-policy/${encodeURIComponent(policyName)}`, session.token);
        if (r.status === 200 && (r.body as { id?: string })?.id) {
          policyId = (r.body as { id: string }).id;
        }
      }
      if (!policyId) throw new Error(`activate-policy: could not retrieve ${policyName} after register`);

      const form = { policyId };
      const response = await probePostForm("/policy/activate", form, session.token);
      if (response.status !== 200 && response.status !== 202) {
        throw new Error(`activate-policy expected 200 or 202, got ${response.status}`);
      }
      const commandId = extractCommandId(response.body);
      if (!commandId) throw new Error(`activate-policy: no commandId`);
      const ack = await session.ws.awaitCabAck(commandId);

      return {
        id: "policy.activate-policy",
        summary: "Activate policy",
        method: "POST",
        path: "/policy/activate",
        phase: "async-command",
        auth: "authorization-token",
        parameters: [{ in: "form", name: "policyId", required: true, type: "string", description: "Policy id from `/policy/retrieve-policy/{name}`." }],
        responses: [{ status: 202, description: "Policy activated." }],
        examples: [{
          ...recordExample({ name: "Happy path", method: "POST", path: "/policy/activate", bodyType: "form", body: form, response }),
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
