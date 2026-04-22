import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probePostForm, extractCommandId } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

/**
 * Setup-chain probe: runs /device/request-unique-identifier internally to
 * get a live commandId, awaits its ack, then records the happy-path
 * retrieval via /device/retrieve-unique-identifier.
 */
export const probeDeviceRetrieveDeviceId: EndpointProbe = {
  id: "device.retrieve-device-id",
  summary: "Retrieve device identifier",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      const requested = await probePostForm(
        "/device/request-unique-identifier",
        { deviceName: `probe-device-${Date.now()}` },
        session.token,
      );
      const commandId = extractCommandId(requested.body);
      if (!commandId) throw new Error(`retrieve-unique-identifier setup: request-unique-identifier returned no commandId`);
      await session.ws.awaitCabAck(commandId);

      const form = { id: commandId };
      const response = await probePostForm("/device/retrieve-unique-identifier", form, session.token);
      if (response.status !== 200) throw new Error(`retrieve-unique-identifier expected 200, got ${response.status}`);

      return {
        id: "device.retrieve-device-id",
        summary: "Retrieve device identifier",
        method: "POST",
        path: "/device/retrieve-unique-identifier",
        phase: "sync",
        auth: "authorization-token",
        parameters: [
          { in: "form", name: "id", required: true, type: "string", description: "Command id from `request-unique-identifier`." },
        ],
        responses: [
          { status: 200, description: "Device identifier assigned.", schema: { type: "object", properties: { deviceIdentifier: { type: "string" } } } },
        ],
        examples: [recordExample({
          name: "Happy path",
          method: "POST",
          path: "/device/retrieve-unique-identifier",
          bodyType: "form",
          body: form,
          response,
          note: "Recorded after running request-unique-identifier as setup.",
        })],
        sourceRun: { tool: "probe", at: new Date().toISOString() },
      };
    } finally {
      session.close();
    }
  },
};
