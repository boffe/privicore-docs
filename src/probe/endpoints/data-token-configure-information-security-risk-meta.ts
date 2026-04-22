import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probePostForm } from "../http.ts";
import { recordExample } from "../recorder.ts";
import { storeSmallPayload } from "../fixtures.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

export const probeDataTokenConfigureInformationSecurityRiskMeta: EndpointProbe = {
  id: "data-token.configure-information-security-risk-meta",
  summary: "Configure information security risk meta",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      const stored = await storeSmallPayload(session, "probe for classification");
      const form = { token: stored.permanentToken, classification: "confidential", retentionDays: "365" };
      const response = await probePostForm("/data-token/configure-information-security-risk-meta", form, session.token);
      if (response.status !== 202) throw new Error(`configure-information-security-risk-meta expected 202, got ${response.status}`);
      const commandId = (response.body as { commandId?: string })?.commandId;
      if (!commandId) throw new Error(`configure-information-security-risk-meta: no commandId`);
      const ack = await session.ws.awaitCabAck(commandId);

      return {
        id: "data-token.configure-information-security-risk-meta",
        summary: "Configure information security risk meta",
        method: "POST",
        path: "/data-token/configure-information-security-risk-meta",
        phase: "async-command",
        auth: "authorization-token",
        parameters: [
          { in: "form", name: "token", required: true, type: "string" },
        ],
        responses: [{ status: 202, description: "Metadata accepted." }],
        examples: [{
          ...recordExample({ name: "Happy path", method: "POST", path: "/data-token/configure-information-security-risk-meta", bodyType: "form", body: form, response, note: "Schema is soft — arbitrary additional fields accepted. Pick an organisation-wide convention." }),
          asyncAck: { type: ack.type, commandStatus: ack.commandStatus, body: ack.body },
        }],
        sourceRun: { tool: "probe", at: new Date().toISOString() },
      };
    } finally {
      session.close();
    }
  },
};
