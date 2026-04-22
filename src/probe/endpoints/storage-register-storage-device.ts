import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probePostForm, extractCommandId } from "../http.ts";
import { recordExample } from "../recorder.ts";
import { createAndApproveDevice } from "../fixtures.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

export const probeStorageRegisterStorageDevice: EndpointProbe = {
  id: "storage.register-storage-device",
  summary: "Register storage device",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      const deviceIdentifier = await createAndApproveDevice(session);
      const form = { deviceIdentifier };
      const response = await probePostForm("/storage/register", form, session.token);
      if (response.status !== 202) throw new Error(`register-storage-device expected 202, got ${response.status}`);
      const commandId = extractCommandId(response.body);
      if (!commandId) throw new Error(`register-storage-device: no commandId`);
      const ack = await session.ws.awaitCabAck(commandId);

      return {
        id: "storage.register-storage-device",
        summary: "Register storage device",
        method: "POST",
        path: "/storage/register",
        phase: "async-command",
        auth: "authorization-token",
        parameters: [{ in: "form", name: "deviceIdentifier", required: true, type: "string" }],
        responses: [{ status: 202, description: "Promotion accepted." }],
        examples: [{
          ...recordExample({ name: "Happy path", method: "POST", path: "/storage/register", bodyType: "form", body: form, response }),
          asyncAck: { type: ack.type, commandStatus: ack.commandStatus, body: ack.body },
        }],
        sourceRun: { tool: "probe", at: new Date().toISOString() },
      };
    } finally {
      session.close();
    }
  },
};
