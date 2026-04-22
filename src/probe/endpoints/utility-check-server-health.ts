import type { EndpointDoc } from "../../ir/types.ts";
import { authenticate } from "../auth.ts";
import { probeGet } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

export const probeUtilityCheckServerHealth: EndpointProbe = {
  id: "utility.check-server-health",
  summary: "Check server health",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const token = await authenticate(ctx);
    const response = await probeGet("/utility/check-server-health", token);
    if (response.status !== 200) {
      throw new Error(`check-server-health expected 200, got ${response.status}`);
    }
    return {
      id: "utility.check-server-health",
      summary: "Check server health",
      method: "GET",
      path: "/utility/check-server-health",
      phase: "sync",
      auth: "authorization-token",
      responses: [
        { status: 200, description: "Engine is healthy.", schema: { type: "object", properties: { status: { type: "string" } } } },
      ],
      examples: [recordExample({ name: "Happy path", method: "GET", path: "/utility/check-server-health", bodyType: "none", response })],
      sourceRun: { tool: "probe", at: new Date().toISOString() },
    };
  },
};
