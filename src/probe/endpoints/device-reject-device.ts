import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probeGet, probePostForm } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

/**
 * Self-cleaning: requests a fresh device id, retrieves it, then
 * rejects (instead of approving) it. Nothing existed before; nothing
 * remains after.
 */
export const probeDeviceRejectDevice: EndpointProbe = {
  id: "device.reject-device",
  summary: "Reject device",
  destructive: true,
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      const requested = await probePostForm("/device/request-device-id", { deviceName: `probe-reject-${Date.now()}` }, session.token);
      const requestCmdId = (requested.body as { commandId?: string })?.commandId!;
      await session.ws.awaitCabAck(requestCmdId);
      const retrieved = await probeGet(`/device/retrieve-device-id/${requestCmdId}`, session.token);
      const deviceId = (retrieved.body as { deviceId?: string })?.deviceId!;

      const form = { deviceId };
      const response = await probePostForm("/device/reject-device", form, session.token);
      if (response.status !== 202) throw new Error(`reject-device expected 202, got ${response.status}`);
      const commandId = (response.body as { commandId?: string })?.commandId;
      if (!commandId) throw new Error(`reject-device: no commandId`);
      const ack = await session.ws.awaitCabAck(commandId);

      return {
        id: "device.reject-device",
        summary: "Reject device",
        method: "POST",
        path: "/device/reject-device",
        phase: "async-command",
        auth: "authorization-token",
        parameters: [{ in: "form", name: "deviceId", required: true, type: "string", description: "The device id to reject." }],
        responses: [{ status: 202, description: "Rejection accepted." }],
        examples: [{
          ...recordExample({ name: "Happy path", method: "POST", path: "/device/reject-device", bodyType: "form", body: form, response }),
          asyncAck: { type: ack.type, commandStatus: ack.commandStatus, body: ack.body },
        }],
        sourceRun: { tool: "probe", at: new Date().toISOString() },
      };
    } finally {
      session.close();
    }
  },
};
