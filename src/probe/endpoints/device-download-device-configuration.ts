import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probePostForm } from "../http.ts";
import { recordExample } from "../recorder.ts";
import { createAndApproveDevice } from "../fixtures.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

/**
 * The recorded example has the RabbitMQ credentials stripped — they
 * are equivalent to an API key and should never land in a committed
 * docset.
 */
export const probeDeviceDownloadDeviceConfiguration: EndpointProbe = {
  id: "device.download-device-configuration",
  summary: "Download device configuration",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      const deviceIdentifier = await createAndApproveDevice(session);
      const form = { deviceIdentifier };
      const response = await probePostForm("/device/download-device-configuration", form, session.token);
      if (response.status !== 200) throw new Error(`download-device-configuration expected 200, got ${response.status}`);

      const redacted = redactCredentials(response);

      return {
        id: "device.download-device-configuration",
        summary: "Download device configuration",
        method: "POST",
        path: "/device/download-device-configuration",
        phase: "sync",
        auth: "authorization-token",
        parameters: [{ in: "form", name: "deviceIdentifier", required: true, type: "string", description: "The device to issue configuration for." }],
        responses: [{ status: 200, description: "Configuration bundle.", schema: { type: "object" } }],
        examples: [recordExample({
          name: "Happy path",
          method: "POST",
          path: "/device/download-device-configuration",
          bodyType: "form",
          body: form,
          response: redacted,
          note: "AMQP credentials and any signing material redacted.",
        })],
        sourceRun: { tool: "probe", at: new Date().toISOString() },
      };
    } finally {
      session.close();
    }
  },
};

const SENSITIVE_KEYS = ["password", "secret", "key", "privateKey", "signingKey", "credential"];
function redactCredentials(response: { status: number; headers: Record<string, string>; body: unknown; rawBody: string }): typeof response {
  const body = deepRedact(response.body);
  return { ...response, body, rawBody: JSON.stringify(body) };
}
function deepRedact(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(deepRedact);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.some((s) => k.toLowerCase().includes(s.toLowerCase()))
        ? "<redacted>"
        : deepRedact(val);
    }
    return out;
  }
  return v;
}
