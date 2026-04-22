import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probePostForm } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

export const probeDataTokenReserveTokenSpace: EndpointProbe = {
  id: "data-token.reserve-token-space",
  summary: "Reserve token space",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      const form = { context: "probe/reserve", ttl: "300" };
      const response = await probePostForm("/data-token/reserve-token-space", form, session.token);
      if (response.status !== 202) throw new Error(`reserve-token-space expected 202, got ${response.status}`);
      const commandId = (response.body as { commandId?: string })?.commandId;
      if (!commandId) throw new Error(`reserve-token-space: no commandId in response body`);
      const ack = await session.ws.awaitCabAck(commandId);

      return {
        id: "data-token.reserve-token-space",
        summary: "Reserve token space",
        method: "POST",
        path: "/data-token/reserve-token-space",
        phase: "async-command",
        auth: "authorization-token",
        parameters: [
          { in: "form", name: "context", required: true, type: "string", description: "Free-form label attached to the reservation.", example: "probe/reserve" },
          { in: "form", name: "ttl", required: true, type: "integer", description: "Time-to-live in seconds.", example: 300 },
        ],
        responses: [
          { status: 202, description: "Reservation accepted; await the `X-DPT-CAB-ID` WebSocket ack.", schema: { type: "object", properties: { commandId: { type: "string" } }, required: ["commandId"] } },
        ],
        examples: [recordExample({
          name: "Happy path",
          method: "POST",
          path: "/data-token/reserve-token-space",
          bodyType: "form",
          body: form,
          response,
          note: "Ack shown in asyncAck.",
        })].map((ex) => ({ ...ex, asyncAck: { type: ack.type, commandStatus: ack.commandStatus, body: ack.body } })),
        sourceRun: { tool: "probe", at: new Date().toISOString() },
      };
    } finally {
      session.close();
    }
  },
};
