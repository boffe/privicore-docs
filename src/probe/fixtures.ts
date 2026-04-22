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
import { probeGet, probePostForm, probePostJson, extractCommandId } from "./http.ts";
import { ProbeWS } from "./ws.ts";
import type { AuthenticatedSession } from "./auth.ts";
import { generateSignedKeyPair } from "./crypto.ts";

async function pollCommandStatus(apiUrl: string, cmdId: string, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${apiUrl.replace(/\/$/, "")}/request-status/${cmdId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const raw = await res.text();
    let data: unknown = raw;
    try { data = JSON.parse(raw); } catch { /* keep as string */ }
    const status = Array.isArray(data) ? data[0] : data;
    if (typeof status === "string" && status !== "started") return status;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`pollCommandStatus: timeout on ${cmdId}`);
}

/** Request a device id, await the ack, retrieve the assigned id,
 *  and approve it. Returns the approved deviceId. */
export async function createAndApproveDevice(session: AuthenticatedSession): Promise<string> {
  const requested = await probePostForm(
    "/device/request-unique-identifier",
    { deviceName: `probe-device-${Date.now()}` },
    session.token,
  );
  const requestCmdId = extractCommandId(requested.body);
  if (!requestCmdId) throw new Error(`fixture: request-unique-identifier returned no commandId (body: ${JSON.stringify(requested.body).slice(0, 200)})`);
  await session.ws.awaitCabAck(requestCmdId);

  const retrieved = await probePostForm(
    "/device/retrieve-unique-identifier",
    { id: requestCmdId },
    session.token,
  );
  const retrievedBody = retrieved.body as { deviceIdentifier?: string } | string;
  const deviceIdentifier = typeof retrievedBody === "string"
    ? retrievedBody
    : retrievedBody?.deviceIdentifier;
  if (!deviceIdentifier) throw new Error(`fixture: retrieve-unique-identifier returned no deviceIdentifier`);

  const approved = await probePostForm(
    "/device/approve-device",
    { deviceIdentifier },
    session.token,
  );
  const approveCmdId = extractCommandId(approved.body);
  if (!approveCmdId) throw new Error(`fixture: approve-device returned no commandId`);
  await session.ws.awaitCabAck(approveCmdId);

  return deviceIdentifier;
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
    { context: `probe/${Date.now()}`, ttl: "5" },
    session.token,
  );
  const commandId = extractCommandId(reserve.body);
  if (!commandId) throw new Error(`fixture: reserve-token-space returned no commandId (body: ${JSON.stringify(reserve.body).slice(0, 200)})`);
  await session.ws.awaitCabAck(commandId);

  const retrieve = await probeGet(`/data-token/retrieve-temporary-data-token/${commandId}`, session.token);
  const rawBody = retrieve.body as { token?: string; stream?: string } | string;
  const temporaryToken = typeof rawBody === "string" ? rawBody : rawBody?.token;
  const streamUrl = typeof rawBody === "object" && rawBody ? (rawBody.stream ?? "") : "";
  if (!temporaryToken) throw new Error(`fixture: retrieve-temporary-data-token returned no token`);
  return { commandId, temporaryToken, streamUrl };
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
  const exchangeCmdId = extractCommandId(exchange.body);
  if (!exchangeCmdId) throw new Error(`fixture: exchange-data-for-token returned no commandId (body: ${JSON.stringify(exchange.body).slice(0, 200)})`);
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
export async function createThrowawayProfile(apiUrl: string, wsUrl: string): Promise<ThrowawayProfile> {
  const username = `probe-user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@probe.local`;
  const password = `Probe-${Date.now()}-pwd`;

  // 1. Register profile. Async-command: body is a bare string/array
  //    containing the commandId; poll /request-status until settled.
  const reg = await probePostForm("/profile/register-profile", { username, password });
  if (reg.status !== 200 && reg.status !== 202) {
    throw new Error(`throwaway profile: register-profile ${reg.status}`);
  }
  const regCmd = extractCommandId(reg.body);
  if (regCmd) await pollCommandStatus(apiUrl, regCmd);

  // 2. Authenticate as the new profile.
  const auth = await probePostForm("/profile/authenticate", { username, password });
  if (auth.status !== 200) throw new Error(`throwaway profile: authenticate ${auth.status}`);
  const token = (auth.body as { authorizationToken?: string })?.authorizationToken;
  if (!token) throw new Error(`throwaway profile: no authorizationToken in authenticate response`);

  // 3. Register the profile's public key. Requires the auth token; the
  //    payload is {publicKey} only — username/password are not accepted
  //    on this endpoint.
  const keyPair = generateSignedKeyPair();
  const keyReg = await probePostForm(
    "/public-key/register-public-key",
    { publicKey: keyPair.signedPublicKeyHex },
    token,
  );
  if (keyReg.status !== 200 && keyReg.status !== 202) {
    throw new Error(`throwaway profile: register-public-key ${keyReg.status}`);
  }
  const keyCmd = extractCommandId(keyReg.body);
  if (keyCmd) await pollCommandStatus(apiUrl, keyCmd);

  const ws = new ProbeWS();
  await ws.connect(wsUrl, token);
  const session: AuthenticatedSession = { token, ws, close: () => ws.close() };

  return { username, password, session, signedPublicKeyHex: keyPair.signedPublicKeyHex };
}

/** Create a voting configuration and return its name. */
export async function createVotingConfiguration(session: AuthenticatedSession): Promise<string> {
  const name = `probe-voting-config-${Date.now()}`;
  const res = await probePostJson(
    "/verified-authenticator/voting-configuration/register",
    { name, strategy: "unanimous", timeLimit: 60, deviceIdentifiers: [] },
    session.token,
  );
  const commandId = extractCommandId(res.body);
  if (!commandId) throw new Error(`fixture: voting-configuration/register returned no commandId (body: ${JSON.stringify(res.body).slice(0, 200)})`);
  await session.ws.awaitCabAck(commandId);
  return name;
}
