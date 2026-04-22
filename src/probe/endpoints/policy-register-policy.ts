import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probeGet, probePostForm } from "../http.ts";
import { recordExample } from "../recorder.ts";
import { createVotingConfiguration } from "../fixtures.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

/**
 * Setup: creates a voting configuration, looks up a real event id from
 * `list-policy-templates`, then registers a policy linking the two.
 */
export const probePolicyRegisterPolicy: EndpointProbe = {
  id: "policy.register-policy",
  summary: "Register policy",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      const votingConfigName = await createVotingConfiguration(session);

      // Find an event id to gate. Templates are an array of objects with
      // `events` dicts mapping event name → numeric id. We pick the first
      // event we see; the exact one doesn't matter for the probe.
      const templates = await probeGet("/policy/list-policy-templates", session.token);
      const eventId = extractAnyEventId(templates.body);
      if (!eventId) throw new Error(`register-policy setup: list-policy-templates returned no events`);

      const form = {
        name: `probe-policy-${Date.now()}`,
        configuration: JSON.stringify({ scope: "profile" }),
        votingConfigurationId: votingConfigName,
        applyingEventIds: String(eventId),
      };
      const response = await probePostForm("/policy/register-policy", form, session.token);
      if (response.status !== 202) throw new Error(`register-policy expected 202, got ${response.status}`);
      const commandId = (response.body as { commandId?: string })?.commandId;
      if (!commandId) throw new Error(`register-policy: no commandId`);
      const ack = await session.ws.awaitCabAck(commandId);

      return {
        id: "policy.register-policy",
        summary: "Register policy",
        method: "POST",
        path: "/policy/register-policy",
        phase: "async-command",
        auth: "authorization-token",
        parameters: [
          { in: "form", name: "name", required: true, type: "string" },
          { in: "form", name: "configuration", required: true, type: "string", description: "JSON-serialised object of policy parameters. Cannot be empty." },
          { in: "form", name: "votingConfigurationId", required: true, type: "string" },
          { in: "form", name: "applyingEventIds", required: true, type: "string", description: "Comma-separated event ids from `list-policy-templates`." },
        ],
        responses: [{ status: 202, description: "Policy registered." }],
        examples: [{
          ...recordExample({ name: "Happy path", method: "POST", path: "/policy/register-policy", bodyType: "form", body: form, response }),
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
