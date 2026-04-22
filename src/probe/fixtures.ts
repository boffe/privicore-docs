/**
 * Reusable probe fixtures. Anything that's "prerequisite state a
 * dependent probe needs" lives here rather than being duplicated
 * across modules.
 *
 * Every fixture runs end-to-end against the live server and returns
 * the handle(s) the caller needs. They don't record wire examples
 * themselves — only the dependent probe module records, and only for
 * the endpoint it's documenting.
 */

import crypto from "node:crypto";
import { probeGet, probePostForm } from "./http.ts";
import { ProbeWS } from "./ws.ts";
import type { AuthenticatedSession } from "./auth.ts";
import { generateSignedKeyPair } from "./crypto.ts";

/** Request a device id, await the ack, retrieve the assigned id,
 *  and approve it. Returns the approved deviceId. */
export async function createAndApproveDevice(session: AuthenticatedSession): Promise<string> {
  const requested = await probePostForm(
    "/device/request-device-id",
    { deviceName: `probe-device-${Date.now()}` },
    session.token,
  );
  const requestCmdId = (requested.body as { commandId?: string })?.commandId;
  if (!requestCmdId) throw new Error(`fixture: request-device-id returned no commandId`);
  await session.ws.awaitCabAck(requestCmdId);

  const retrieved = await probeGet(`/device/retrieve-device-id/${requestCmdId}`, session.token);
  const deviceId = (retrieved.body as { deviceId?: string })?.deviceId;
  if (!deviceId) throw new Error(`fixture: retrieve-device-id returned no deviceId`);

  const approved = await probePostForm(
    "/device/approve-device",
    { deviceId },
    session.token,
  );
  const approveCmdId = (approved.body as { commandId?: string })?.commandId;
  if (!approveCmdId) throw new Error(`fixture: approve-device returned no commandId`);
  await session.ws.awaitCabAck(approveCmdId);

  return deviceId;
}

export interface ReservedTokenSpace {
  commandId: string;
  temporaryToken: string;
  streamUrl: string;
}

/** Reserve a token slot, await the ack, retrieve the temporary token. */
export async function reserveTokenSpace(session: AuthenticatedSession): Promise<ReservedTokenSpace> {
  const reserve = await probePostForm(
    "/data-token/reserve-token-space",
    { context: `probe/${Date.now()}`, ttl: "300" },
    session.token,
  );
  const commandId = (reserve.body as { commandId?: string })?.commandId;
  if (!commandId) throw new Error(`fixture: reserve-token-space returned no commandId`);
  await session.ws.awaitCabAck(commandId);

  const retrieve = await probeGet(`/data-token/retrieve-temporary-data-token/${commandId}`, session.token);
  const body = retrieve.body as { token?: string; stream?: string };
  if (!body?.token) throw new Error(`fixture: retrieve-temporary-data-token returned no token`);
  return { commandId, temporaryToken: body.token, streamUrl: body.stream ?? "" };
}

export interface StoredDataToken {
  reservation: ReservedTokenSpace;
  permanentToken: string;
  /** AES-256 key used for the probe payload, hex-encoded. Kept so a
   *  retrieval probe can round-trip if it wants to. */
  aesKeyHex: string;
}

/** Full small-payload store flow: reserve → exchange → configure-file-meta.
 *  Returns the permanent data token and the AES key used. */
export async function storeSmallPayload(session: AuthenticatedSession, plaintext = "probe payload"): Promise<StoredDataToken> {
  const reservation = await reserveTokenSpace(session);

  // Encrypt plaintext with a fresh AES-256-GCM key.
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const wire = Buffer.concat([iv, ct, tag]);
  const dataB64 = wire.toString("base64");

  const exchange = await probePostForm(
    "/data-token/exchange-data-for-token",
    { temporaryTokenSpace: reservation.temporaryToken, data: dataB64 },
    session.token,
  );
  const exchangeCmdId = (exchange.body as { commandId?: string })?.commandId;
  if (!exchangeCmdId) throw new Error(`fixture: exchange-data-for-token returned no commandId`);
  await session.ws.awaitCabAck(exchangeCmdId);

  const configure = await probePostForm(
    "/data-token/configure-file-meta",
    {
      token: reservation.temporaryToken,
      fileName: "probe.txt",
      extension: "txt",
      context: `probe/${Date.now()}`,
      size: String(plaintext.length),
      path: "/",
    },
    session.token,
  );
  // Response shape is either {token: "dtk-..."} or a bare string. Handle both.
  const raw = configure.body;
  let permanentToken: string | undefined;
  if (typeof raw === "string") permanentToken = raw;
  else if (raw && typeof raw === "object" && "token" in raw) permanentToken = String((raw as { token: unknown }).token);
  if (!permanentToken) throw new Error(`fixture: configure-file-meta returned no token (body: ${JSON.stringify(raw).slice(0, 200)})`);

  return { reservation, permanentToken, aesKeyHex: aesKey.toString("hex") };
}

export interface ThrowawayProfile {
  username: string;
  password: string;
  session: AuthenticatedSession;
  signedPublicKeyHex: string;
}

/**
 * Create a fresh, fully-activated profile and return an authenticated
 * session for it. Used by probes that mutate profile-level state we
 * don't want applied to the real Baard fixture (change-password,
 * revoke-token, register-public-key). The throwaway profile is
 * abandoned when the probe finishes.
 */
export async function createThrowawayProfile(wsUrl: string): Promise<ThrowawayProfile> {
  const username = `probe-user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@probe.local`;
  const password = `Probe-${Date.now()}-pwd`;

  // 1. Register profile.
  const reg = await probePostForm("/profile/register-profile", { username, password });
  if (reg.status !== 202) throw new Error(`throwaway profile: register-profile ${reg.status}`);

  // 2. Register public key. register-public-key is itself async-command
  //    but we don't have a session for the new profile yet. Poll the
  //    returned commandId if present, or rely on the server having
  //    processed the registration by the time our own session picks it
  //    up.
  const keyPair = generateSignedKeyPair();
  const keyReg = await probePostForm("/public-key/register-public-key", {
    username,
    password,
    publicKey: keyPair.signedPublicKeyHex,
  });
  if (keyReg.status !== 202) throw new Error(`throwaway profile: register-public-key ${keyReg.status}`);

  // 3. Poll until authenticate succeeds — this is our proxy for "the
  //    async registration + pubkey-registration have both landed."
  let token: string | undefined;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const auth = await probePostForm("/profile/authenticate", { username, password });
    if (auth.status === 200) {
      token = (auth.body as { authorizationToken?: string })?.authorizationToken;
      if (token) break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!token) throw new Error(`throwaway profile: never became authenticatable`);

  const ws = new ProbeWS();
  await ws.connect(wsUrl, token);
  const session: AuthenticatedSession = { token, ws, close: () => ws.close() };

  return { username, password, session, signedPublicKeyHex: keyPair.signedPublicKeyHex };
}

/** Create a voting configuration and return its name. */
export async function createVotingConfiguration(session: AuthenticatedSession): Promise<string> {
  const name = `probe-voting-config-${Date.now()}`;
  const res = await probePostForm(
    "/verified-authenticator/voting-configuration/create",
    { name, strategy: "unanimous", timeLimit: "60" },
    session.token,
  );
  const commandId = (res.body as { commandId?: string })?.commandId;
  if (!commandId) throw new Error(`fixture: voting-configuration/create returned no commandId`);
  await session.ws.awaitCabAck(commandId);
  return name;
}
