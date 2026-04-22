import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probePostForm, extractCommandId } from "../http.ts";
import { recordExample } from "../recorder.ts";
import { storeSmallPayload } from "../fixtures.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

export const probeDataTokenUpdateDataToken: EndpointProbe = {
  id: "data-token.update-data-token",
  summary: "Update data token",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      const stored = await storeSmallPayload(session, "probe for update");
      const form = { token: stored.permanentToken, fileName: "probe-renamed.txt", context: `probe-renamed/${Date.now()}` };
      const response = await probePostForm("/data-token/update-data-token", form, session.token);
      if (response.status !== 202) throw new Error(`update-data-token expected 202, got ${response.status}`);
      const commandId = extractCommandId(response.body);
      if (!commandId) throw new Error(`update-data-token: no commandId`);
      const ack = await session.ws.awaitCabAck(commandId);

      return {
        id: "data-token.update-data-token",
        summary: "Update data token",
        method: "POST",
        path: "/data-token/update-data-token",
        phase: "async-command",
        auth: "authorization-token",
        parameters: [
          { in: "form", name: "token", required: true, type: "string" },
          { in: "form", name: "fileName", required: false, type: "string" },
          { in: "form", name: "extension", required: false, type: "string" },
          { in: "form", name: "context", required: false, type: "string" },
        ],
        responses: [{ status: 202, description: "Update accepted." }],
        examples: [{
          ...recordExample({ name: "Happy path", method: "POST", path: "/data-token/update-data-token", bodyType: "form", body: form, response }),
          asyncAck: { type: ack.type, commandStatus: ack.commandStatus, body: ack.body },
        }],
        sourceRun: { tool: "probe", at: new Date().toISOString() },
      };
    } finally {
      session.close();
    }
  },
};
