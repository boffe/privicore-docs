import type { EndpointDoc } from "../../ir/types.ts";
import { authenticate } from "../auth.ts";
import { probeGet } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

export const probeDeviceRetrieveProfileDevices: EndpointProbe = {
  id: "device.retrieve-profile-devices",
  summary: "Retrieve profile devices",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const token = await authenticate(ctx);
    const response = await probeGet("/device/retrieve-profile-devices", token);
    if (response.status !== 200) throw new Error(`retrieve-profile-devices expected 200, got ${response.status}`);
    return {
      id: "device.retrieve-profile-devices",
      summary: "Retrieve profile devices",
      method: "GET",
      path: "/device/retrieve-profile-devices",
      phase: "sync",
      auth: "authorization-token",
      responses: [
        { status: 200, description: "Array of device records." },
      ],
      examples: [recordExample({ name: "Happy path", method: "GET", path: "/device/retrieve-profile-devices", bodyType: "none", response })],
      sourceRun: { tool: "probe", at: new Date().toISOString() },
    };
  },
};
