import type { EndpointDoc } from "../../ir/types.ts";
import { authenticate } from "../auth.ts";
import { probePostForm } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

export const probeProfileGenerateQrToken: EndpointProbe = {
  id: "profile.generate-qr-token-for-authorization",
  summary: "Generate QR token for authorization",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const token = await authenticate(ctx);
    const response = await probePostForm("/profile/generate-token-qr", {}, token);
    if (response.status !== 200) throw new Error(`generate-qr-token expected 200, got ${response.status}`);
    return {
      id: "profile.generate-qr-token-for-authorization",
      summary: "Generate QR token for authorization",
      method: "POST",
      path: "/profile/generate-token-qr",
      phase: "sync",
      auth: "authorization-token",
      responses: [
        { status: 200, description: "QR token + TTL.", schema: { type: "object", properties: { qrToken: { type: "string" }, expiresAt: { type: "string" } } } },
      ],
      examples: [recordExample({ name: "Happy path", method: "POST", path: "/profile/generate-token-qr", bodyType: "none", response, note: "QR token is single-use and time-limited." })],
      sourceRun: { tool: "probe", at: new Date().toISOString() },
    };
  },
};
