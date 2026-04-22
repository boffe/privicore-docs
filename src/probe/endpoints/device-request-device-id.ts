import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probePostForm } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

export const probeDeviceRequestDeviceId: EndpointProbe = {
  id: "device.request-device-id",
  summary: "Request device id",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      const form = { deviceName: `probe-device-${Date.now()}` };
      const response = await probePostForm("/device/request-device-id", form, session.token);
      if (response.status !== 202) throw new Error(`request-device-id expected 202, got ${response.status}`);
      const commandId = (response.body as { commandId?: string })?.commandId;
      if (!commandId) throw new Error(`request-device-id: no commandId in response body`);
      const ack = await session.ws.awaitCabAck(commandId);

      return {
        id: "device.request-device-id",
        summary: "Request device id",
        method: "POST",
        path: "/device/request-device-id",
        phase: "async-command",
        auth: "authorization-token",
        parameters: [
          { in: "form", name: "deviceName", required: true, type: "string", description: "Friendly display name for the device.", example: "phone-a" },
        ],
        responses: [
          { status: 202, description: "Accepted; await the `X-DPT-CAB-ID` ack to see the assigned id.", schema: { type: "object", properties: { commandId: { type: "string" } } } },
        ],
        examples: [{
          ...recordExample({ name: "Happy path", method: "POST", path: "/device/request-device-id", bodyType: "form", body: form, response }),
          asyncAck: { type: ack.type, commandStatus: ack.commandStatus, body: ack.body },
        }],
        sourceRun: { tool: "probe", at: new Date().toISOString() },
      };
    } finally {
      session.close();
    }
  },
};
