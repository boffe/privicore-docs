import crypto from "node:crypto";
import type { EndpointDoc } from "../../ir/types.ts";
import { openAuthenticatedSession } from "../auth.ts";
import { probePostForm, extractCommandId } from "../http.ts";
import { recordExample } from "../recorder.ts";
import { reserveTokenSpace } from "../fixtures.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

export const probeDataTokenConfigureFileMeta: EndpointProbe = {
  id: "data-token.configure-file-meta",
  summary: "Configure file meta",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const session = await openAuthenticatedSession(ctx);
    try {
      const reservation = await reserveTokenSpace(session);

      // Minimal exchange so the temp token can be configured.
      const aesKey = crypto.randomBytes(32);
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
      const ct = Buffer.concat([cipher.update("probe payload", "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      const dataB64 = Buffer.concat([iv, ct, tag]).toString("base64");
      const exchange = await probePostForm("/data-token/exchange-data-for-token", { temporaryTokenSpace: reservation.temporaryToken, data: dataB64 }, session.token);
      const exchangeCmdId = extractCommandId(exchange.body)!;
      await session.ws.awaitCabAck(exchangeCmdId);

      const form = {
        token: reservation.temporaryToken,
        fileName: "probe.txt",
        extension: "txt",
        context: `probe/${Date.now()}`,
        size: "13",
        path: "/",
      };
      const response = await probePostForm("/data-token/configure-file-meta", form, session.token);
      if (response.status !== 200) throw new Error(`configure-file-meta expected 200, got ${response.status}`);

      return {
        id: "data-token.configure-file-meta",
        summary: "Configure file meta",
        method: "POST",
        path: "/data-token/configure-file-meta",
        phase: "sync",
        auth: "authorization-token",
        parameters: [
          { in: "form", name: "token", required: true, type: "string", description: "Temporary token from `retrieve-temporary-data-token`." },
          { in: "form", name: "fileName", required: true, type: "string" },
          { in: "form", name: "extension", required: true, type: "string" },
          { in: "form", name: "context", required: true, type: "string" },
          { in: "form", name: "size", required: true, type: "integer", description: "Plaintext payload size in bytes." },
          { in: "form", name: "path", required: true, type: "string" },
        ],
        responses: [{ status: 200, description: "Permanent data token issued." }],
        examples: [recordExample({ name: "Happy path", method: "POST", path: "/data-token/configure-file-meta", bodyType: "form", body: form, response })],
        sourceRun: { tool: "probe", at: new Date().toISOString() },
      };
    } finally {
      session.close();
    }
  },
};
