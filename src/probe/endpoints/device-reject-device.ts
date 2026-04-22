import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probePostForm, extractCommandId } from "../http.ts";
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
      const requested = await probePostForm("/device/request-unique-identifier", { deviceName: `probe-reject-${Date.now()}` }, session.token);
      const requestCmdId = extractCommandId(requested.body)!;
      await session.ws.awaitCabAck(requestCmdId);
      const retrieved = await probePostForm("/device/retrieve-unique-identifier", { id: requestCmdId }, session.token);
      const retrievedBody = retrieved.body as { deviceIdentifier?: string } | string;
      const deviceIdentifier = typeof retrievedBody === "string" ? retrievedBody : retrievedBody?.deviceIdentifier!;

      const form = { deviceIdentifier };
      const response = await probePostForm("/device/reject-device", form, session.token);
      if (response.status !== 202) throw new Error(`reject-device expected 202, got ${response.status}`);
      const commandId = extractCommandId(response.body);
      if (!commandId) throw new Error(`reject-device: no commandId`);
      const ack = await session.ws.awaitCabAck(commandId);

      return {
        id: "device.reject-device",
        summary: "Reject device",
        method: "POST",
        path: "/device/reject-device",
        phase: "async-command",
        auth: "authorization-token",
        parameters: [{ in: "form", name: "deviceIdentifier", required: true, type: "string", description: "The device identifier to reject." }],
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
