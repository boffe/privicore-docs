import type { EndpointDoc } from "../../ir/types.ts";
import { authenticate } from "../auth.ts";
import { probeGet } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

export const probePolicyListPolicyTemplates: EndpointProbe = {
  id: "policy.list-policy-templates",
  summary: "List policy templates",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const token = await authenticate(ctx);
    const response = await probeGet("/policy/list-policy-templates", token);
    if (response.status !== 200) throw new Error(`list-policy-templates expected 200, got ${response.status}`);
    return {
      id: "policy.list-policy-templates",
      summary: "List policy templates",
      method: "GET",
      path: "/policy/list-policy-templates",
      phase: "sync",
      auth: "authorization-token",
      responses: [
        { status: 200, description: "Array of templates.", schema: { type: "array" } },
      ],
      examples: [recordExample({ name: "Happy path", method: "GET", path: "/policy/list-policy-templates", bodyType: "none", response, note: "Each template's `events` dict maps event names to numeric ids for applyingEventIds." })],
      sourceRun: { tool: "probe", at: new Date().toISOString() },
    };
  },
};
