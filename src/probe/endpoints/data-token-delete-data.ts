import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probePostForm } from "../http.ts";
import { recordExample } from "../recorder.ts";
import { storeSmallPayload } from "../fixtures.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

/**
 * Self-cleaning: stores a fresh permanent token, then deletes it. The
 * token did not exist before the probe and doesn't exist after.
 */
export const probeDataTokenDeleteData: EndpointProbe = {
  id: "data-token.delete-data",
  summary: "Delete data",
  destructive: true,
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      const stored = await storeSmallPayload(session, "probe for delete");
      const form = { token: stored.permanentToken };
      const response = await probePostForm("/data-token/delete-data", form, session.token);
      if (response.status !== 202) throw new Error(`delete-data expected 202, got ${response.status}`);
      const commandId = (response.body as { commandId?: string })?.commandId;
      if (!commandId) throw new Error(`delete-data: no commandId`);
      const ack = await session.ws.awaitCabAck(commandId);

      return {
        id: "data-token.delete-data",
        summary: "Delete data",
        method: "POST",
        path: "/data-token/delete-data",
        phase: "async-command",
        auth: "authorization-token",
        parameters: [
          { in: "form", name: "token", required: true, type: "string" },
        ],
        responses: [{ status: 202, description: "Delete accepted; dispatched to storage devices." }],
        examples: [{
          ...recordExample({ name: "Happy path", method: "POST", path: "/data-token/delete-data", bodyType: "form", body: form, response, note: "Recorded on a probe-created token. The token is created and deleted in the same run." }),
          asyncAck: { type: ack.type, commandStatus: ack.commandStatus, body: ack.body },
        }],
        sourceRun: { tool: "probe", at: new Date().toISOString() },
      };
    } finally {
      session.close();
    }
  },
};
