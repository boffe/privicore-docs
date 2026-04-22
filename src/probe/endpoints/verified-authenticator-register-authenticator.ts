import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probePostForm } from "../http.ts";
import { recordExample } from "../recorder.ts";
import { createAndApproveDevice } from "../fixtures.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

export const probeVerifiedAuthenticatorRegisterAuthenticator: EndpointProbe = {
  id: "verified-authenticator.register-authenticator",
  summary: "Register authenticator",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      const deviceId = await createAndApproveDevice(session);
      const form = { deviceId };
      const response = await probePostForm("/verified-authenticator/register-authenticator", form, session.token);
      if (response.status !== 202) throw new Error(`register-authenticator expected 202, got ${response.status}`);
      const commandId = (response.body as { commandId?: string })?.commandId;
      if (!commandId) throw new Error(`register-authenticator: no commandId`);
      const ack = await session.ws.awaitCabAck(commandId);

      return {
        id: "verified-authenticator.register-authenticator",
        summary: "Register authenticator",
        method: "POST",
        path: "/verified-authenticator/register-authenticator",
        phase: "async-command",
        auth: "authorization-token",
        parameters: [{ in: "form", name: "deviceId", required: true, type: "string" }],
        responses: [{ status: 202, description: "Promotion accepted." }],
        examples: [{
          ...recordExample({ name: "Happy path", method: "POST", path: "/verified-authenticator/register-authenticator", bodyType: "form", body: form, response }),
          asyncAck: { type: ack.type, commandStatus: ack.commandStatus, body: ack.body },
        }],
        sourceRun: { tool: "probe", at: new Date().toISOString() },
      };
    } finally {
      session.close();
    }
  },
};
