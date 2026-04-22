import type { EndpointDoc } from "../../ir/types.ts";
import { authenticate } from "../auth.ts";
import { probePostForm } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

/**
 * Authenticates, then revokes THAT token. Only the freshly-issued
 * probe token is killed; other sessions using Baard's credentials keep
 * working.
 */
export const probeProfileRevokeAuthorizationToken: EndpointProbe = {
  id: "profile.revoke-authorization-token",
  summary: "Revoke authorization token",
  destructive: true,
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const token = await authenticate(ctx);
    const response = await probePostForm("/profile/revoke-authorization-token", {}, token);
    if (response.status !== 200) throw new Error(`revoke-authorization-token expected 200, got ${response.status}`);

    return {
      id: "profile.revoke-authorization-token",
      summary: "Revoke authorization token",
      method: "POST",
      path: "/profile/revoke-authorization-token",
      phase: "sync",
      auth: "authorization-token",
      responses: [{ status: 200, description: "Token revoked." }],
      examples: [recordExample({
        name: "Happy path",
        method: "POST",
        path: "/profile/revoke-authorization-token",
        bodyType: "none",
        response,
        note: "Recorded against a throwaway token — the Baard session token used by other probes is not touched.",
      })],
      sourceRun: { tool: "probe", at: new Date().toISOString() },
    };
  },
};
