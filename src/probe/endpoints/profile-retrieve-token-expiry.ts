import type { EndpointDoc } from "../../ir/types.ts";
import { authenticate } from "../auth.ts";
import { probePostForm } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

export const probeProfileRetrieveTokenExpiry: EndpointProbe = {
  id: "profile.retrieve-token-expiry",
  summary: "Retrieve token expiry",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const token = await authenticate(ctx);
    const response = await probePostForm("/profile/authorization-token/expiry", {}, token);
    if (response.status !== 200) throw new Error(`retrieve-token-expiry expected 200, got ${response.status}`);
    return {
      id: "profile.retrieve-token-expiry",
      summary: "Retrieve token expiry",
      method: "POST",
      path: "/profile/authorization-token/expiry",
      phase: "sync",
      auth: "authorization-token",
      responses: [
        { status: 200, description: "Expiry timestamp.", schema: { type: "object", properties: { expiresAt: { type: "string", format: "date-time" } } } },
      ],
      examples: [recordExample({ name: "Happy path", method: "POST", path: "/profile/authorization-token/expiry", bodyType: "form", body: {}, response })],
      sourceRun: { tool: "probe", at: new Date().toISOString() },
    };
  },
};
