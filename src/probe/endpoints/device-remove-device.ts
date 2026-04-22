import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probePostForm } from "../http.ts";
import { recordExample } from "../recorder.ts";
import { createAndApproveDevice } from "../fixtures.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

/** Self-cleaning: creates and approves a fresh device, then removes it. */
export const probeDeviceRemoveDevice: EndpointProbe = {
  id: "device.remove-device",
  summary: "Remove device",
  destructive: true,
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      const deviceId = await createAndApproveDevice(session);
      const form = { deviceId };
      const response = await probePostForm("/device/remove-device", form, session.token);
      if (response.status !== 202) throw new Error(`remove-device expected 202, got ${response.status}`);
      const commandId = (response.body as { commandId?: string })?.commandId;
      if (!commandId) throw new Error(`remove-device: no commandId`);
      const ack = await session.ws.awaitCabAck(commandId);

      return {
        id: "device.remove-device",
        summary: "Remove device",
        method: "POST",
        path: "/device/remove-device",
        phase: "async-command",
        auth: "authorization-token",
        parameters: [{ in: "form", name: "deviceId", required: true, type: "string" }],
        responses: [{ status: 202, description: "Removal accepted." }],
        examples: [{
          ...recordExample({ name: "Happy path", method: "POST", path: "/device/remove-device", bodyType: "form", body: form, response }),
          asyncAck: { type: ack.type, commandStatus: ack.commandStatus, body: ack.body },
        }],
        sourceRun: { tool: "probe", at: new Date().toISOString() },
      };
    } finally {
      session.close();
    }
  },
};
