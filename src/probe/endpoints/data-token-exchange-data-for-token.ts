import crypto from "node:crypto";
import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probePostForm, extractCommandId } from "../http.ts";
import { recordExample } from "../recorder.ts";
import { reserveTokenSpace } from "../fixtures.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

export const probeDataTokenExchangeDataForToken: EndpointProbe = {
  id: "data-token.exchange-data-for-token",
  summary: "Exchange data for token",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      const reservation = await reserveTokenSpace(session);

      const aesKey = crypto.randomBytes(32);
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
      const ct = Buffer.concat([cipher.update("probe payload", "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      const dataB64 = Buffer.concat([iv, ct, tag]).toString("base64");

      const form = { temporaryTokenSpace: reservation.temporaryToken, data: dataB64 };
      const response = await probePostForm("/data-token/exchange-data-for-token", form, session.token);
      if (response.status !== 202) throw new Error(`exchange-data-for-token expected 202, got ${response.status}`);
      const commandId = extractCommandId(response.body);
      if (!commandId) throw new Error(`exchange-data-for-token: no commandId`);
      const ack = await session.ws.awaitCabAck(commandId);

      return {
        id: "data-token.exchange-data-for-token",
        summary: "Exchange data for token",
        method: "POST",
        path: "/data-token/exchange-data-for-token",
        phase: "async-command",
        auth: "authorization-token",
        parameters: [
          { in: "form", name: "temporaryTokenSpace", required: true, type: "string", description: "Temporary token from `retrieve-temporary-data-token`." },
          { in: "form", name: "data", required: true, type: "string", description: "Base64 of the AES-256-GCM wire format: `[12-byte IV][ciphertext][16-byte auth tag]`." },
        ],
        responses: [{ status: 202, description: "Payload accepted; await the `X-DPT-CAB-ID` ack.", schema: { type: "object", properties: { commandId: { type: "string" } } } }],
        examples: [{
          ...recordExample({
            name: "Happy path",
            method: "POST",
            path: "/data-token/exchange-data-for-token",
            bodyType: "form",
            body: { ...form, data: `${dataB64.slice(0, 12)}…<truncated>` },
            response,
            note: "Data payload truncated for display.",
          }),
          asyncAck: { type: ack.type, commandStatus: ack.commandStatus, body: ack.body },
        }],
        sourceRun: { tool: "probe", at: new Date().toISOString() },
      };
    } finally {
      session.close();
    }
  },
};
