import type { EndpointDoc } from "../../ir/types.ts";
import { authenticate } from "../auth.ts";
import { probeGet } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

export const probeOauthOauthApplicationList: EndpointProbe = {
  id: "oauth.oauth-application-list",
  summary: "OAuth application list",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const token = await authenticate(ctx);
    const response = await probeGet("/profile/retrieve-oauth-application-list", token);
    if (response.status !== 200) throw new Error(`oauth-application-list expected 200, got ${response.status}`);
    return {
      id: "oauth.oauth-application-list",
      summary: "OAuth application list",
      method: "GET",
      path: "/profile/retrieve-oauth-application-list",
      phase: "sync",
      auth: "authorization-token",
      responses: [
        { status: 200, description: "List of applications.", schema: { type: "object", properties: { items: { type: "array" }, meta: { type: "object" } } } },
      ],
      examples: [recordExample({ name: "Happy path", method: "GET", path: "/profile/retrieve-oauth-application-list", bodyType: "none", response })],
      sourceRun: { tool: "probe", at: new Date().toISOString() },
    };
  },
};
