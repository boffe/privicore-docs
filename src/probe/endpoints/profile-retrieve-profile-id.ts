import type { EndpointDoc } from "../../ir/types.ts";
import { authenticate } from "../auth.ts";
import { probeGet } from "../http.ts";
import { recordExample } from "../recorder.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

export const probeProfileRetrieveProfileId: EndpointProbe = {
  id: "profile.retrieve-profile-id",
  summary: "Retrieve profile id",
  async run(ctx: ProbeContext): Promise<EndpointDoc> {
    const token = await authenticate(ctx);
    const response = await probeGet("/profile/retrieve-profile-id", token);
    if (response.status !== 200) throw new Error(`retrieve-profile-id expected 200, got ${response.status}`);
    return {
      id: "profile.retrieve-profile-id",
      summary: "Retrieve profile id",
      method: "GET",
      path: "/profile/retrieve-profile-id",
      phase: "sync",
      auth: "authorization-token",
      responses: [
        { status: 200, description: "Profile uuid.", schema: { type: "object", properties: { profileId: { type: "string" } } } },
      ],
      examples: [recordExample({ name: "Happy path", method: "GET", path: "/profile/retrieve-profile-id", bodyType: "none", response })],
      sourceRun: { tool: "probe", at: new Date().toISOString() },
    };
  },
};
