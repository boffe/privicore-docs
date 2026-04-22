import type { EndpointDoc } from "../../ir/types.ts";
import { authenticate } from "../auth.ts";
import { probeGet } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

export const probePublicKeyRetrieveCabPublicKey: EndpointProbe = {
  id: "public-key.retrieve-cab-public-key",
  summary: "Retrieve CAB public key",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const token = await authenticate(ctx);
    const response = await probeGet("/public-key/retrieve-cab-public-key", token);
    if (response.status !== 200) throw new Error(`retrieve-cab-public-key expected 200, got ${response.status}`);
    return {
      id: "public-key.retrieve-cab-public-key",
      summary: "Retrieve CAB public key",
      method: "GET",
      path: "/public-key/retrieve-cab-public-key",
      phase: "sync",
      auth: "authorization-token",
      responses: [
        { status: 200, description: "The engine's registered public key.", schema: { type: "object", properties: { publicKey: { type: "string" } } } },
      ],
      examples: [recordExample({ name: "Happy path", method: "GET", path: "/public-key/retrieve-cab-public-key", bodyType: "none", response })],
      sourceRun: { tool: "probe", at: new Date().toISOString() },
    };
  },
};
