import type { EndpointDoc } from "../../ir/types.ts";
import { probePostForm } from "../http.ts";
import { recordExample } from "../recorder.ts";
import { generateSignedKeyPair } from "../crypto.ts";
import type { EndpointProbe, ProbeContext } from "./index.ts";

/**
 * register-public-key is public (no prior token). Recording runs
 * against a freshly-registered throwaway profile so we don't
 * re-register a key for Baard. Does not await the WS ack — the new
 * profile has no session yet — so the recording covers the HTTP half
 * only.
 */
export const probePublicKeyRegisterPublicKey: EndpointProbe = {
  id: "public-key.register-public-key",
  summary: "Register public key",
  async run(_ctx: ProbeContext): Promise<EndpointDoc> {
    const username = `probe-pkreg-${Date.now()}@probe.local`;
    const password = `Probe-${Date.now()}-pwd`;
    const reg = await probePostForm("/profile/register-profile", { username, password });
    if (reg.status !== 202) throw new Error(`register-public-key setup: register-profile ${reg.status}`);

    const keyPair = generateSignedKeyPair();
    const form = { username, password, publicKey: keyPair.signedPublicKeyHex };
    const response = await probePostForm("/public-key/register-public-key", form);
    if (response.status !== 202) throw new Error(`register-public-key expected 202, got ${response.status}`);

    return {
      id: "public-key.register-public-key",
      summary: "Register public key",
      method: "POST",
      path: "/public-key/register-public-key",
      phase: "async-command",
      auth: "public",
      parameters: [
        { in: "form", name: "username", required: true, type: "string" },
        { in: "form", name: "password", required: true, type: "string" },
        { in: "form", name: "publicKey", required: true, type: "string", description: "Signed Curve25519 public key — 200 hex characters: `[4-byte version][32-byte pubkey][64-byte BLAKE2b hash]`." },
      ],
      responses: [
        { status: 202, description: "Key accepted; await the `X-DPT-CAB-ID` ack. On success the profile becomes active and can authenticate.", schema: { type: "object", properties: { commandId: { type: "string" } } } },
      ],
      examples: [recordExample({
        name: "Happy path",
        method: "POST",
        path: "/public-key/register-public-key",
        bodyType: "form",
        body: {
          username,
          password: "<redacted>",
          publicKey: `${keyPair.signedPublicKeyHex.slice(0, 20)}…<truncated>`,
        },
        response,
        note: "Password redacted; public key truncated. asyncAck not recorded — the new profile has no WebSocket session yet.",
      })],
      sourceRun: { tool: "probe", at: new Date().toISOString() },
    };
  },
};
