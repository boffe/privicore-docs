import type { EndpointDoc } from "../../ir/types.ts";
import { authenticate } from "../auth.ts";
import { probePostJson } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

/**
 * Probed against a synthetic commandId so the recording always shows
 * what a "no such command" response looks like. A 200/ok recording
 * requires a real cmdId currently in flight — that's better produced
 * by chaining off of another probe (e.g. during reserve-token-space).
 *
 * Wire: POST /request-status/{commandId} with an empty JSON body.
 * Response is a bare string / single-element array describing the
 * command state: "started", "succeeded", "rejected", etc.
 */
export const probeUtilityRequestCommandIdStatus: EndpointProbe = {
  id: "utility.request-command-id-status",
  summary: "Request command id status",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const token = await authenticate(ctx);
    const syntheticId = "00000000-0000-0000-0000-000000000000";
    const response = await probePostJson(`/request-status/${syntheticId}`, {}, token);
    return {
      id: "utility.request-command-id-status",
      summary: "Request command id status",
      method: "POST",
      path: "/request-status/{commandId}",
      phase: "sync",
      auth: "authorization-token",
      parameters: [
        { in: "path", name: "commandId", required: true, type: "string", description: "Command id from any async-command endpoint." },
      ],
      responses: [
        { status: 200, description: "Current command state as a bare string (e.g. `\"started\"`, `\"succeeded\"`, `\"rejected\"`) or a single-element array wrapping the same." },
        { status: 404, description: "No command with that id exists for this profile." },
      ],
      examples: [recordExample({
        name: response.status === 200 ? "Happy path" : "Unknown command id",
        method: "POST",
        path: `/request-status/${syntheticId}`,
        bodyType: "json",
        body: {},
        response,
        note: "Recorded against a synthetic uuid; replace with a real in-flight cmdId for a live-in-flight example.",
      })],
      sourceRun: { tool: "probe", at: new Date().toISOString() },
    };
  },
};
