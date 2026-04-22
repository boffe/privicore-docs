import type { EndpointDoc } from "../../ir/types.ts";
import { probePostForm } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

/**
 * register-profile is async-command but public — no caller token, no
 * WebSocket channel the new profile could bind to yet. We record the
 * HTTP half of the exchange and leave asyncAck unset; the schema +
 * guide description explain the WS-ack semantics readers still need.
 *
 * Creates a throwaway profile with a timestamped username to avoid
 * collisions with the real "Baard" fixture. The test profile is
 * inert (no public key registered) — it exists only for the wire
 * recording.
 */
export const probeProfileRegisterProfile: EndpointProbe = {
  id: "profile.register-profile",
  summary: "Register new profile",
  async run(_ctx: ProbeContext): Promise<EndpointDoc> {
    const username = `probe-user-${Date.now()}@probe.local`;
    const form = { username, password: "Probe-" + Date.now() + "-pwd" };
    const response = await probePostForm("/profile/register-profile", form);
    if (response.status !== 202) throw new Error(`register-profile expected 202, got ${response.status}`);

    return {
      id: "profile.register-profile",
      summary: "Register new profile",
      method: "POST",
      path: "/profile/register-profile",
      phase: "async-command",
      auth: "public",
      parameters: [
        { in: "form", name: "username", required: true, type: "string", description: "Desired username. Must be unique." },
        { in: "form", name: "password", required: true, type: "string", description: "Password for the new profile." },
      ],
      responses: [
        { status: 202, description: "Registration accepted; the final outcome lands on the WebSocket as an `X-DPT-CAB-ID` message once the new profile can authenticate and join its channel.", schema: { type: "object", properties: { commandId: { type: "string" } } } },
        { status: 409, description: "Username already taken." },
      ],
      examples: [recordExample({
        name: "Happy path",
        method: "POST",
        path: "/profile/register-profile",
        bodyType: "form",
        body: { ...form, password: "<redacted>" },
        response,
        note: "Password redacted. asyncAck not recorded — the new profile has no WebSocket channel yet.",
      })],
      sourceRun: { tool: "probe", at: new Date().toISOString() },
    };
  },
};
