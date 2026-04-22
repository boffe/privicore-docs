import type { EndpointDoc } from "../../ir/types.ts";
import { authenticate } from "../auth.ts";
import { probeGet } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

export const probeProfileRetrieveTokenExpiry: EndpointProbe = {
  id: "profile.retrieve-token-expiry",
  summary: "Retrieve token expiry",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const token = await authenticate(ctx);
    const response = await probeGet("/profile/retrieve-token-expiry", token);
    if (response.status !== 200) throw new Error(`retrieve-token-expiry expected 200, got ${response.status}`);
    return {
      id: "profile.retrieve-token-expiry",
      summary: "Retrieve token expiry",
      method: "GET",
      path: "/profile/retrieve-token-expiry",
      phase: "sync",
      auth: "authorization-token",
      responses: [
        { status: 200, description: "Expiry timestamp.", schema: { type: "object", properties: { expiresAt: { type: "string", format: "date-time" } } } },
      ],
      examples: [recordExample({ name: "Happy path", method: "GET", path: "/profile/retrieve-token-expiry", bodyType: "none", response })],
      sourceRun: { tool: "probe", at: new Date().toISOString() },
    };
  },
};
