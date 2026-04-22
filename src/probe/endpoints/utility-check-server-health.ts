import type { EndpointDoc } from "../../ir/types.ts";
import { probeGet } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

/**
 * Liveness probe. Served unauthenticated — does not require a prior
 * authenticate call.
 */
export const probeUtilityCheckServerHealth: EndpointProbe = {
  id: "utility.check-server-health",
  summary: "Check server health",
  async run(_ctx: ProbeContext): Promise<EndpointDoc> {
    const response = await probeGet("/health");
    if (response.status !== 200) {
      throw new Error(`check-server-health expected 200, got ${response.status}`);
    }
    return {
      id: "utility.check-server-health",
      summary: "Check server health",
      method: "GET",
      path: "/health",
      phase: "sync",
      auth: "public",
      responses: [
        { status: 200, description: "Engine is healthy.", schema: { type: "object", properties: { status: { type: "string" } } } },
      ],
      examples: [recordExample({ name: "Happy path", method: "GET", path: "/health", bodyType: "none", response })],
      sourceRun: { tool: "probe", at: new Date().toISOString() },
    };
  },
};
