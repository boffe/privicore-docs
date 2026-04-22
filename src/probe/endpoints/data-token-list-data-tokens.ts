import type { EndpointDoc } from "../../ir/types.ts";
import { authenticate } from "../auth.ts";
import { probeGet } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

export const probeDataTokenListDataTokens: EndpointProbe = {
  id: "data-token.list-data-tokens",
  summary: "List data tokens",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const token = await authenticate(ctx);
    const response = await probeGet("/data-token/list-data-tokens", token);
    if (response.status !== 200) throw new Error(`list-data-tokens expected 200, got ${response.status}`);
    return {
      id: "data-token.list-data-tokens",
      summary: "List data tokens",
      method: "GET",
      path: "/data-token/list-data-tokens",
      phase: "sync",
      auth: "authorization-token",
      parameters: [
        { in: "query", name: "page", required: false, type: "integer" },
        { in: "query", name: "perPage", required: false, type: "integer" },
      ],
      responses: [
        { status: 200, description: "Paged list.", schema: { type: "object", properties: { items: { type: "array" }, meta: { type: "object" } } } },
      ],
      examples: [recordExample({ name: "Happy path", method: "GET", path: "/data-token/list-data-tokens", bodyType: "none", response })],
      sourceRun: { tool: "probe", at: new Date().toISOString() },
    };
  },
};
