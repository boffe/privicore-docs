import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probeGet, probePostForm } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

/**
 * Chain: request-device-id → retrieve-device-id → approve-device.
 * Records only the approve-device exchange; setup is silent.
 */
export const probeDeviceApproveDevice: EndpointProbe = {
  id: "device.approve-device",
  summary: "Approve device",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      const requested = await probePostForm("/device/request-device-id", { deviceName: `probe-device-${Date.now()}` }, session.token);
      const requestCmdId = (requested.body as { commandId?: string })?.commandId!;
      await session.ws.awaitCabAck(requestCmdId);
      const retrieved = await probeGet(`/device/retrieve-device-id/${requestCmdId}`, session.token);
      const deviceId = (retrieved.body as { deviceId?: string })?.deviceId!;

      const form = { deviceId };
      const response = await probePostForm("/device/approve-device", form, session.token);
      if (response.status !== 202) throw new Error(`approve-device expected 202, got ${response.status}`);
      const commandId = (response.body as { commandId?: string })?.commandId;
      if (!commandId) throw new Error(`approve-device: no commandId in response body`);
      const ack = await session.ws.awaitCabAck(commandId);

      return {
        id: "device.approve-device",
        summary: "Approve device",
        method: "POST",
        path: "/device/approve-device",
        phase: "async-command",
        auth: "authorization-token",
        parameters: [
          { in: "form", name: "deviceId", required: true, type: "string", description: "The device id to approve." },
        ],
        responses: [
          { status: 202, description: "Approval accepted; await the `X-DPT-CAB-ID` ack." },
        ],
        examples: [{
          ...recordExample({ name: "Happy path", method: "POST", path: "/device/approve-device", bodyType: "form", body: form, response }),
          asyncAck: { type: ack.type, commandStatus: ack.commandStatus, body: ack.body },
        }],
        sourceRun: { tool: "probe", at: new Date().toISOString() },
      };
    } finally {
      session.close();
    }
  },
};
