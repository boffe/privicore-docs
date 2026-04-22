import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probePostForm } from "../http.ts";
import { recordExample } from "../recorder.ts";
import { createAndApproveDevice } from "../fixtures.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

/**
 * Self-cleaning: creates a fresh device, promotes it to storage, then
 * deregisters. Existing storage devices on the profile are not
 * touched.
 */
export const probeStorageRemoveStorage: EndpointProbe = {
  id: "storage.remove-storage",
  summary: "Remove storage",
  destructive: true,
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      const deviceId = await createAndApproveDevice(session);
      const register = await probePostForm("/storage/register-storage-device", { deviceId }, session.token);
      const registerCmdId = (register.body as { commandId?: string })?.commandId!;
      await session.ws.awaitCabAck(registerCmdId);

      const form = { deviceId };
      const response = await probePostForm("/storage/remove-storage", form, session.token);
      if (response.status !== 202) throw new Error(`remove-storage expected 202, got ${response.status}`);
      const commandId = (response.body as { commandId?: string })?.commandId;
      if (!commandId) throw new Error(`remove-storage: no commandId`);
      const ack = await session.ws.awaitCabAck(commandId);

      return {
        id: "storage.remove-storage",
        summary: "Remove storage",
        method: "POST",
        path: "/storage/remove-storage",
        phase: "async-command",
        auth: "authorization-token",
        parameters: [{ in: "form", name: "deviceId", required: true, type: "string" }],
        responses: [{ status: 202, description: "Deregistration accepted." }],
        examples: [{
          ...recordExample({ name: "Happy path", method: "POST", path: "/storage/remove-storage", bodyType: "form", body: form, response }),
          asyncAck: { type: ack.type, commandStatus: ack.commandStatus, body: ack.body },
        }],
        sourceRun: { tool: "probe", at: new Date().toISOString() },
      };
    } finally {
      session.close();
    }
  },
};
