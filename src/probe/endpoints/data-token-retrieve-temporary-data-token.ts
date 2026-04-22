import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probeGet } from "../http.ts";
import { recordExample } from "../recorder.ts";
import { reserveTokenSpace } from "../fixtures.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

export const probeDataTokenRetrieveTemporaryDataToken: EndpointProbe = {
  id: "data-token.retrieve-temporary-data-token",
  summary: "Retrieve temporary data token",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      // Fresh reservation so we have a known-valid commandId.
      const res = await probeGet(`/data-token/retrieve-temporary-data-token/${(await reserveTokenSpace(session)).commandId}`, session.token);
      if (res.status !== 200) throw new Error(`retrieve-temporary-data-token expected 200, got ${res.status}`);

      return {
        id: "data-token.retrieve-temporary-data-token",
        summary: "Retrieve temporary data token",
        method: "GET",
        path: "/data-token/retrieve-temporary-data-token/{commandId}",
        phase: "sync",
        auth: "authorization-token",
        parameters: [
          { in: "path", name: "commandId", required: true, type: "string", description: "Command id from `reserve-token-space`." },
        ],
        responses: [
          { status: 200, description: "Temporary token and upstream stream URL.", schema: { type: "object", properties: { token: { type: "string" }, stream: { type: "string", format: "uri" } } } },
          { status: 404, description: "Reservation not found or not yet settled." },
        ],
        examples: [recordExample({
          name: "Happy path",
          method: "GET",
          path: "/data-token/retrieve-temporary-data-token/{commandId}",
          bodyType: "none",
          response: res,
          note: "Stream URL contains a short-lived auth token; treat as sensitive.",
        })],
        sourceRun: { tool: "probe", at: new Date().toISOString() },
      };
    } finally {
      session.close();
    }
  },
};
