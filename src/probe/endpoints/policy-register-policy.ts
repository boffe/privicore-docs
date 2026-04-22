import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probeGet, probePostJson, extractCommandId } from "../http.ts";
import { recordExample } from "../recorder.ts";
import { createVotingConfiguration } from "../fixtures.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

/**
 * Setup: creates a voting configuration, looks up a real template id +
 * event id from `list-policy-templates`, then registers a policy
 * linking them together.
 *
 * Request body is JSON (not form-encoded). Events are an array, not a
 * comma-separated string.
 */
export const probePolicyRegisterPolicy: EndpointProbe = {
  id: "policy.register-policy",
  summary: "Register policy",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      const votingConfigName = await createVotingConfiguration(session);

      // Templates come back as a Record keyed by templateId. Each template has an
      // `events` Record keyed by eventId. Pick the first pair we find.
      const templates = await probeGet("/policy/list-policy-templates", session.token);
      const picked = pickTemplateAndEvent(templates.body);
      if (!picked) throw new Error(`register-policy setup: list-policy-templates returned no usable template/event pair`);
      const { templateId, eventId } = picked;

      const body = {
        name: `probe-policy-${Date.now()}`,
        policyTemplateId: templateId,
        applyingEventIds: [eventId],
        votingConfigurationId: votingConfigName,
        configuration: { classification: "internal", label: "probe", handling: "none" },
      };
      const response = await probePostJson("/policy/register", body, session.token);
      if (response.status !== 200 && response.status !== 202) {
        throw new Error(`register-policy expected 200 or 202, got ${response.status}`);
      }
      const commandId = extractCommandId(response.body);
      if (!commandId) throw new Error(`register-policy: no commandId`);
      const ack = await session.ws.awaitCabAck(commandId);

      return {
        id: "policy.register-policy",
        summary: "Register policy",
        method: "POST",
        path: "/policy/register",
        phase: "async-command",
        auth: "authorization-token",
        parameters: [
          { in: "json", name: "name", required: true, type: "string" },
          { in: "json", name: "policyTemplateId", required: true, type: "string", description: "Template id from `list-policy-templates`." },
          { in: "json", name: "applyingEventIds", required: true, type: "array", description: "Array of event ids the policy applies to. Each id comes from the selected template's `events` dict." },
          { in: "json", name: "votingConfigurationId", required: true, type: "string" },
          { in: "json", name: "configuration", required: true, type: "object", description: "Policy-specific parameters. Cannot be empty." },
        ],
        responses: [{ status: 202, description: "Policy registration accepted; await the `X-DPT-CAB-ID` ack." }],
        examples: [{
          ...recordExample({ name: "Happy path", method: "POST", path: "/policy/register", bodyType: "json", body, response }),
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
