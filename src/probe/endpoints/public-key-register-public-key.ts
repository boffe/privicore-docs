import type { EndpointDoc } from "../../ir/types.ts";
import { probePostForm, extractCommandId } from "../http.ts";
import { recordExample } from "../recorder.ts";
import { generateSignedKeyPair } from "../crypto.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

/**
 * register-public-key requires a valid authorization token — it is not
 * a public endpoint. Recording runs against a freshly-registered
 * throwaway profile: register-profile, authenticate, *then* register the
 * public key with the resulting auth token.
 *
 * Doesn't await the WS ack here — the throwaway profile doesn't yet
 * have a WS session joined — so the recording covers the HTTP half only.
 */
export const probePublicKeyRegisterPublicKey: EndpointProbe = {
  id: "public-key.register-public-key",
  summary: "Register public key",
  async run(_ctx: ProbeContext): Promise<EndpointDoc> {
    const username = `probe-pkreg-${Date.now()}@probe.local`;
    const password = `Probe-${Date.now()}-pwd`;

    const reg = await probePostForm("/profile/register-profile", { username, password });
    if (reg.status !== 200 && reg.status !== 202) {
      throw new Error(`register-public-key setup: register-profile ${reg.status}`);
    }

    // Authenticate as the freshly-registered profile. The register-public-key
    // endpoint below requires this token in the X-DPT-AUTHORIZATION header.
    const auth = await probePostForm("/profile/authenticate", { username, password });
    if (auth.status !== 200) throw new Error(`register-public-key setup: authenticate ${auth.status}`);
    const token = (auth.body as { authorizationToken?: string })?.authorizationToken;
    if (!token) throw new Error(`register-public-key setup: no authorizationToken`);

    const keyPair = generateSignedKeyPair();
    const form = { publicKey: keyPair.signedPublicKeyHex };
    const response = await probePostForm("/public-key/register-public-key", form, token);
    if (response.status !== 200 && response.status !== 202) {
      throw new Error(`register-public-key expected 200 or 202, got ${response.status}`);
    }
    // Extract for cross-check; not awaited on WS since we have no session.
    void extractCommandId(response.body);

    return {
      id: "public-key.register-public-key",
      summary: "Register public key",
      method: "POST",
      path: "/public-key/register-public-key",
      phase: "async-command",
      auth: "authorization-token",
      parameters: [
        { in: "header", name: "X-DPT-AUTHORIZATION", required: true, type: "string", description: "Authorization token from `/profile/authenticate`." },
        { in: "form", name: "publicKey", required: true, type: "string", description: "Signed Curve25519 public key — 200 hex characters: `[4-byte version][32-byte pubkey][64-byte BLAKE2b hash]`." },
      ],
      responses: [
        { status: 202, description: "Key accepted; await the `X-DPT-CAB-ID` ack. On success the profile becomes fully active.", schema: { type: "object", properties: { commandId: { type: "string" } } } },
      ],
      examples: [recordExample({
        name: "Happy path",
        method: "POST",
        path: "/public-key/register-public-key",
        bodyType: "form",
        body: {
          publicKey: `${keyPair.signedPublicKeyHex.slice(0, 20)}…<truncated>`,
        },
        response,
        note: "Public key truncated. asyncAck not recorded — the new profile has no WebSocket session yet.",
      })],
      sourceRun: { tool: "probe", at: new Date().toISOString() },
    };
  },
};
