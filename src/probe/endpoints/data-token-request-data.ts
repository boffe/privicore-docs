import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probePostForm } from "../http.ts";
import { recordExample } from "../recorder.ts";
import { storeSmallPayload } from "../fixtures.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

/**
 * Async-request endpoint: the ack type is X-DPT-CAB-REQUEST-ID and the
 * correlator comes from `x-dpt-cab-request-id` in the HTTP response
 * headers, not the body.
 */
export const probeDataTokenRequestData: EndpointProbe = {
  id: "data-token.request-data",
  summary: "Request data",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      // Set up a real permanent token to retrieve.
      const stored = await storeSmallPayload(session, "probe payload for retrieval");

      const form = { token: stored.permanentToken };
      const response = await probePostForm("/data-token/request-data", form, session.token);
      if (response.status !== 202) throw new Error(`request-data expected 202, got ${response.status}`);

      const requestId = response.headers["x-dpt-cab-request-id"];
      if (!requestId) throw new Error(`request-data: no x-dpt-cab-request-id header`);
      const ack = await session.ws.awaitRequestAck(requestId);

      return {
        id: "data-token.request-data",
        summary: "Request data",
        method: "POST",
        path: "/data-token/request-data",
        phase: "async-request",
        auth: "authorization-token",
        parameters: [
          { in: "form", name: "token", required: true, type: "string", description: "The permanent data token from `configure-file-meta`." },
        ],
        responses: [
          { status: 202, description: "Request accepted. Read `x-dpt-cab-request-id` from response headers and await the matching `X-DPT-CAB-REQUEST-ID` message." },
          { status: 404, description: "Token does not exist or has been deleted." },
        ],
        examples: [{
          ...recordExample({ name: "Happy path", method: "POST", path: "/data-token/request-data", bodyType: "form", body: form, response }),
          asyncAck: { type: ack.type, commandStatus: ack.commandStatus, body: ack.body },
        }],
        sourceRun: { tool: "probe", at: new Date().toISOString() },
      };
    } finally {
      session.close();
    }
  },
};
