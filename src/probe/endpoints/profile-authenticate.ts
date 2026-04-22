/**
 * Probe for POST /profile/authenticate.
 *
 * Sync endpoint — no WS ack involved. Exchanges username+password for
 * an authorization token and records the happy-path request/response.
 *
 * The recorded example redacts the `password` field in the request
 * body and the `authorizationToken` in the response body, so running
 * the probe with real credentials does not leak them into the IR.
 */

import type { EndpointDoc } from "../../ir/types.ts";
import { probePostForm } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

export const probeProfileAuthenticate: EndpointProbe = {
  id: "profile.authenticate",
  summary: "Authenticate",

  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    if (!ctx.username || !ctx.password) {
      throw new Error(
        "profile.authenticate probe needs PRIVICORE_USERNAME + PRIVICORE_PASSWORD in .env",
      );
    }

    const response = await probePostForm("/profile/authenticate", {
      username: ctx.username,
      password: ctx.password,
    });

    if (response.status !== 200) {
      throw new Error(
        `probe failed: expected 200 from /profile/authenticate, got ${response.status}. Body: ${response.rawBody.slice(0, 400)}`,
      );
    }

    const happy = recordExample({
      name: "Happy path",
      method: "POST",
      path: "/profile/authenticate",
      bodyType: "form",
      body: {
        // Placeholder, not the real probe username — the recorded
        // example is committed and we don't want the tester's
        // identity to leak into the public docset.
        username: "alice@example.com",
        password: "<redacted>",
      },
      response: redactTokenFromResponse(response),
      note: "Credentials redacted; username replaced with a placeholder.",
    });

    return {
      id: "profile.authenticate",
      summary: "Authenticate",
      method: "POST",
      path: "/profile/authenticate",
      phase: "sync",
      auth: "public",
      parameters: [
        {
          in: "form",
          name: "username",
          required: true,
          type: "string",
          description: "The username the profile was registered with.",
          example: "alice@example.com",
        },
        {
          in: "form",
          name: "password",
          required: true,
          type: "string",
          description: "The profile's password.",
          example: "<redacted>",
        },
      ],
      responses: [
        {
          status: 200,
          description: "Authentication succeeded; token returned.",
          schema: {
            type: "object",
            properties: {
              authorizationToken: { type: "string" },
              expiresAt: { type: "string", format: "date-time" },
            },
            required: ["authorizationToken", "expiresAt"],
          },
        },
        {
          status: 401,
          description:
            "Credentials rejected, or the profile's public key has not yet been registered.",
        },
      ],
      examples: [happy],
      sourceRun: {
        tool: "probe",
        at: new Date().toISOString(),
      },
    };
  },
};

function redactTokenFromResponse(response: Awaited<ReturnType<typeof probePostForm>>): Awaited<ReturnType<typeof probePostForm>> {
  const body = response.body;
  if (body && typeof body === "object" && !Array.isArray(body) && "authorizationToken" in body) {
    const copy = { ...(body as Record<string, unknown>) };
    const original = String(copy.authorizationToken ?? "");
    copy.authorizationToken = original.length > 10
      ? `${original.slice(0, 6)}…<redacted>`
      : "<redacted>";
    return { ...response, body: copy, rawBody: JSON.stringify(copy) };
  }
  return response;
}
