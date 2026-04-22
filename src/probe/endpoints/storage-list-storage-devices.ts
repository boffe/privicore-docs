import type { EndpointDoc } from "../../ir/types.ts";
import { authenticate } from "../auth.ts";
import { probeGet } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

export const probeStorageListStorageDevices: EndpointProbe = {
  id: "storage.list-storage-devices",
  summary: "List storage devices",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const token = await authenticate(ctx);
    const response = await probeGet("/storage/list-storage-devices", token);
    if (response.status !== 200) throw new Error(`list-storage-devices expected 200, got ${response.status}`);
    return {
      id: "storage.list-storage-devices",
      summary: "List storage devices",
      method: "GET",
      path: "/storage/list-storage-devices",
      phase: "sync",
      auth: "authorization-token",
      responses: [
        { status: 200, description: "Array of storage device records." },
      ],
      examples: [recordExample({ name: "Happy path", method: "GET", path: "/storage/list-storage-devices", bodyType: "none", response })],
      sourceRun: { tool: "probe", at: new Date().toISOString() },
    };
  },
};
