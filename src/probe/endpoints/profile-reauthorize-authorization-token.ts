import type { EndpointDoc } from "../../ir/types.ts";
import { authenticate } from "../auth.ts";
import { probePostForm } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

export const probeProfileReauthorizeAuthorizationToken: EndpointProbe = {
  id: "profile.reauthorize-authorization-token",
  summary: "Reauthorize authorization token",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const token = await authenticate(ctx);
    const form = { ttl: "86400" };
    const response = await probePostForm("/profile/reauthorize-authorization-token", form, token);
    if (response.status !== 200) throw new Error(`reauthorize-authorization-token expected 200, got ${response.status}`);

    // Redact the refreshed token before recording.
    const body = response.body as { authorizationToken?: string } | null;
    let redactedBody = body;
    if (body && typeof body === "object" && body.authorizationToken) {
      redactedBody = { ...body, authorizationToken: `${body.authorizationToken.slice(0, 6)}…<redacted>` };
    }

    return {
      id: "profile.reauthorize-authorization-token",
      summary: "Reauthorize authorization token",
      method: "POST",
      path: "/profile/reauthorize-authorization-token",
      phase: "sync",
      auth: "authorization-token",
      parameters: [
        { in: "form", name: "ttl", required: true, type: "integer", description: "New lifetime in seconds.", example: 86400 },
      ],
      responses: [
        { status: 200, description: "Refreshed token issued.", schema: { type: "object", properties: { authorizationToken: { type: "string" }, expiresAt: { type: "string" } } } },
      ],
      examples: [recordExample({
        name: "Happy path",
        method: "POST",
        path: "/profile/reauthorize-authorization-token",
        bodyType: "form",
        body: form,
        response: { ...response, body: redactedBody, rawBody: JSON.stringify(redactedBody) },
        note: "Refreshed authorization token redacted.",
      })],
      sourceRun: { tool: "probe", at: new Date().toISOString() },
    };
  },
};
