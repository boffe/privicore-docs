import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probePostForm } from "../http.ts";
import { recordExample } from "../recorder.ts";
import { createAndApproveDevice } from "../fixtures.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

export const probeDeviceConfigureDeviceMeta: EndpointProbe = {
  id: "device.configure-device-meta",
  summary: "Configure device meta",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      const deviceId = await createAndApproveDevice(session);
      const form = { deviceId, displayName: "Probe recording", tags: "probe,test" };
      const response = await probePostForm("/device/configure-device-meta", form, session.token);
      if (response.status !== 202) throw new Error(`configure-device-meta expected 202, got ${response.status}`);
      const commandId = (response.body as { commandId?: string })?.commandId;
      if (!commandId) throw new Error(`configure-device-meta: no commandId`);
      const ack = await session.ws.awaitCabAck(commandId);

      return {
        id: "device.configure-device-meta",
        summary: "Configure device meta",
        method: "POST",
        path: "/device/configure-device-meta",
        phase: "async-command",
        auth: "authorization-token",
        parameters: [
          { in: "form", name: "deviceId", required: true, type: "string" },
          { in: "form", name: "displayName", required: false, type: "string" },
          { in: "form", name: "tags", required: false, type: "string", description: "Comma-separated list." },
        ],
        responses: [{ status: 202, description: "Update accepted." }],
        examples: [{
          ...recordExample({ name: "Happy path", method: "POST", path: "/device/configure-device-meta", bodyType: "form", body: form, response }),
          asyncAck: { type: ack.type, commandStatus: ack.commandStatus, body: ack.body },
        }],
        sourceRun: { tool: "probe", at: new Date().toISOString() },
      };
    } finally {
      session.close();
    }
  },
};
