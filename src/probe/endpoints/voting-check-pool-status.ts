import type { EndpointDoc } from "../../ir/types.ts";
import { authenticate } from "../auth.ts";
import { probeGet } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

/**
 * Best-effort probe: uses a synthetic poolId to record what a
 * non-existent pool lookup returns. A 200-shape recording requires
 * an active voting pool, which in turn needs at least one registered
 * authenticator plus an active gated policy — chain that in a
 * future scenario probe rather than in this single-endpoint module.
 */
export const probeVotingCheckPoolStatus: EndpointProbe = {
  id: "voting.check-pool-status",
  summary: "Check pool status",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const token = await authenticate(ctx);
    const syntheticId = "00000000-0000-0000-0000-000000000000";
    const response = await probeGet(`/voting/check-pool-status/${syntheticId}`, token);

    return {
      id: "voting.check-pool-status",
      summary: "Check pool status",
      method: "GET",
      path: "/voting/check-pool-status/{poolId}",
      phase: "sync",
      auth: "authorization-token",
      parameters: [
        { in: "path", name: "poolId", required: true, type: "string", description: "Pool id from a live voting session." },
      ],
      responses: [
        { status: 200, description: "Pool status snapshot." },
        { status: 404, description: "No pool with that id." },
      ],
      examples: [recordExample({
        name: response.status === 200 ? "Happy path" : "Unknown pool id",
        method: "GET",
        path: `/voting/check-pool-status/${syntheticId}`,
        bodyType: "none",
        response,
        note: "Probed with a synthetic uuid; run against a live pool for a 200 example.",
      })],
      sourceRun: { tool: "probe", at: new Date().toISOString() },
    };
  },
};
