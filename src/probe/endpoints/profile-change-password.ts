import type { EndpointDoc } from "../../ir/types.ts";
import { probePostForm } from "../http.ts";
import { recordExample } from "../recorder.ts";
import { createThrowawayProfile } from "../fixtures.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

/**
 * Password rotation against the real Baard profile would break future
 * probe runs (the .env password would no longer work). So this probe
 * stands up a fresh throwaway profile, rotates *its* password, and
 * abandons it. The Baard fixture is untouched.
 */
export const probeProfileChangePassword: EndpointProbe = {
  id: "profile.change-password",
  summary: "Change password",
  destructive: true,
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const throwaway = await createThrowawayProfile(ctx.wsUrl);
    try {
      const form = { currentPassword: throwaway.password, newPassword: `${throwaway.password}-rotated` };
      const response = await probePostForm("/profile/change-password", form, throwaway.session.token);
      if (response.status !== 202) throw new Error(`change-password expected 202, got ${response.status}`);
      const commandId = (response.body as { commandId?: string })?.commandId;
      if (!commandId) throw new Error(`change-password: no commandId`);
      const ack = await throwaway.session.ws.awaitCabAck(commandId);

      return {
        id: "profile.change-password",
        summary: "Change password",
        method: "POST",
        path: "/profile/change-password",
        phase: "async-command",
        auth: "authorization-token",
        parameters: [
          { in: "form", name: "currentPassword", required: true, type: "string" },
          { in: "form", name: "newPassword", required: true, type: "string", description: "Entropy requirements apply." },
        ],
        responses: [{ status: 202, description: "Change accepted." }],
        examples: [{
          ...recordExample({
            name: "Happy path",
            method: "POST",
            path: "/profile/change-password",
            bodyType: "form",
            body: { currentPassword: "<redacted>", newPassword: "<redacted>" },
            response,
            note: "Recorded on a throwaway profile; both password fields redacted.",
          }),
          asyncAck: { type: ack.type, commandStatus: ack.commandStatus, body: ack.body },
        }],
        sourceRun: { tool: "probe", at: new Date().toISOString() },
      };
    } finally {
      throwaway.session.close();
    }
  },
};
