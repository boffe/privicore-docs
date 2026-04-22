import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probeGet, probePostForm } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

/**
 * Setup-chain probe: runs request-device-id internally to get a live
 * commandId, awaits its ack, then records the happy-path retrieval.
 */
export const probeDeviceRetrieveDeviceId: EndpointProbe = {
  id: "device.retrieve-device-id",
  summary: "Retrieve device id",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      const requested = await probePostForm(
        "/device/request-device-id",
        { deviceName: `probe-device-${Date.now()}` },
        session.token,
      );
      const commandId = (requested.body as { commandId?: string })?.commandId;
      if (!commandId) throw new Error(`retrieve-device-id setup: request-device-id returned no commandId`);
      await session.ws.awaitCabAck(commandId);

      const response = await probeGet(`/device/retrieve-device-id/${commandId}`, session.token);
      if (response.status !== 200) throw new Error(`retrieve-device-id expected 200, got ${response.status}`);

      return {
        id: "device.retrieve-device-id",
        summary: "Retrieve device id",
        method: "GET",
        path: "/device/retrieve-device-id/{commandId}",
        phase: "sync",
        auth: "authorization-token",
        parameters: [
          { in: "path", name: "commandId", required: true, type: "string", description: "Command id from `request-device-id`." },
        ],
        responses: [
          { status: 200, description: "Device id assigned.", schema: { type: "object", properties: { deviceId: { type: "string" } } } },
        ],
        examples: [recordExample({
          name: "Happy path",
          method: "GET",
          path: `/device/retrieve-device-id/${commandId}`,
          bodyType: "none",
          response,
          note: "Recorded after running request-device-id as setup.",
        })],
        sourceRun: { tool: "probe", at: new Date().toISOString() },
      };
    } finally {
      session.close();
    }
  },
};
