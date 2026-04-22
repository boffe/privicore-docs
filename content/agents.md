# Privicore integration — agent guide

> Save this file as `AGENTS.md` (or `CLAUDE.md`) at the root of your
> project. AI coding assistants read it automatically and will use it
> as an instruction set when helping you integrate Privicore.
>
> Canonical URL: {{docsSiteUrl}}/agents.md

## What Privicore is

Privicore is a client-side tokenization vault. You encrypt a payload
with your own AES-256-GCM key, hand the ciphertext to the Privicore
engine, receive an opaque data token (a `dtk-…` string), and store
that token in your application's database in place of the original
bytes. To retrieve, you present the token, get the ciphertext back,
and decrypt locally. The engine never sees your plaintext.

Every operation is done as a **profile** — a username + password +
signed Curve25519 public key. Your application may have one profile
(shared) or one-per-user, depending on your multi-tenancy model.

## Full documentation

- **Landing:** {{docsSiteUrl}}/
- **Guides (human-readable):** {{docsSiteUrl}}/guides/
- **OpenAPI spec (machine-readable):** {{docsSiteUrl}}/openapi.json

When the user asks about a specific endpoint you haven't memorised,
fetch the OpenAPI spec and introspect. Do not hallucinate endpoint
shapes — the spec is ground truth.

## Three things that will bite you

Commit these to memory. They're the subtle failure modes that
produce silent bugs rather than clean errors.

1. **`202 Accepted` does not mean done.** Most write endpoints
   respond with `202 { commandId }` and the real outcome arrives as
   an `X-DPT-CAB-ID` WebSocket message. You MUST subscribe to the
   WebSocket and await the ack (`command_status: 2`) before treating
   the operation as complete. Chaining calls on HTTP status alone
   produces ghosts: apparent successes that are actually rejections.

2. **A profile must have a registered public key before it can
   authenticate.** This applies when you're creating the profile
   yourself from code. The sequence is: register profile → generate
   keypair → register public key → await ack → authenticate. Skip
   the public-key step and `authenticate` returns `401 invalid
   credentials` with no hint about why.

   **If your profile was pre-provisioned for you** (e.g. handed to
   you as `PRIVICORE_USERNAME` + `PRIVICORE_PASSWORD` by the
   operator), skip the registration steps — the profile already
   has a public key on file. Go straight to `authenticate`.

3. **Encrypt client-side before uploading.** The encryption happens
   on your machine with a key you control — not on the server. Wire
   format is `[12-byte IV][ciphertext][16-byte GCM auth tag]`,
   base64-encoded. Skipping this breaks the threat model: plaintext
   lands at the engine.

## Environment

```
PRIVICORE_API_URL={{apiUrl}}
PRIVICORE_WS_URL={{wsUrl}}
PRIVICORE_USERNAME=...
PRIVICORE_PASSWORD=...
```

Treat all four as credentials. The AES key you use to encrypt payloads
is application-managed — store per-user keys in a secret manager, not
in source control.

## Canonical TypeScript client

Port the call signatures verbatim to your target language (Python,
Go, Rust, etc.). Only the WebSocket client and the AES-GCM API are
language-specific; the HTTP surface is identical.

### Authenticate + open WebSocket session

```ts
export interface Session {
  token: string;
  ws: WebSocket;
  close(): void;
}

export async function openSession(
  apiUrl: string,
  wsUrl: string,
  username: string,
  password: string,
): Promise<Session> {
  const res = await fetch(`${apiUrl}/profile/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password }).toString(),
  });
  if (!res.ok) throw new Error(`authenticate: ${res.status}`);
  const { authorizationToken } = await res.json();

  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("ws open failed")), { once: true });
  });
  ws.send(JSON.stringify({
    action: "joinChannel",
    data: { authorizationToken },
  }));
  return { token: authorizationToken, ws, close: () => ws.close() };
}
```

### Parse a commandId from any async response

The server returns async-command identifiers in one of three wire
shapes depending on the endpoint: a bare string, a single-element
array, or `{commandId: "..."}`. Normalize once and reuse.

```ts
export function extractCommandId(body: unknown): string | undefined {
  if (typeof body === "string") return body.replace(/^"|"$/g, "").trim() || undefined;
  if (Array.isArray(body)) return typeof body[0] === "string" ? body[0] : undefined;
  if (body && typeof body === "object" && typeof (body as { commandId?: unknown }).commandId === "string") {
    return (body as { commandId: string }).commandId;
  }
  return undefined;
}
```

### Await an async-command ack

```ts
export function awaitCommand(
  ws: WebSocket,
  commandId: string,
  timeoutMs = 30_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener("message", onMsg);
      reject(new Error(`timeout waiting for ${commandId}`));
    }, timeoutMs);
    function onMsg(ev: MessageEvent) {
      const m = JSON.parse(String(ev.data));
      if (m.data?.type !== "X-DPT-CAB-ID" || m.data.id !== commandId) return;
      ws.removeEventListener("message", onMsg);
      clearTimeout(timer);
      if (m.data.command_status === 2) resolve();
      else reject(new Error(`rejected: ${JSON.stringify(m.data.body)}`));
    }
    ws.addEventListener("message", onMsg);
  });
}
```

### Store a payload

```ts
import crypto from "node:crypto";

export async function storeData(
  session: Session,
  apiUrl: string,
  aesKey: Buffer,
  plaintext: Buffer,
  context = "my-app",
): Promise<string> {
  // 1. Reserve token space. ttl is in seconds and is bounded — small
  //    values (e.g. "5") are always accepted; very large values may be
  //    rejected with 422 depending on server policy.
  const reserve = await postForm(apiUrl, session.token, "/data-token/reserve-token-space", {
    context, ttl: "5",
  });
  const commandId = extractCommandId(await reserve.json());
  if (!commandId) throw new Error("reserve-token-space: no commandId in response");
  await awaitCommand(session.ws, commandId);

  // 2. Retrieve temporary token.
  const { token: tmpToken } = await getJson(
    apiUrl, session.token,
    `/data-token/retrieve-temporary-data-token/${commandId}`,
  );

  // 3. Encrypt client-side (AES-256-GCM). Wire: [IV | ciphertext | auth tag].
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const wire = Buffer.concat([iv, ct, tag]);

  // 4. Exchange encrypted bytes for a token.
  const exchange = await postForm(apiUrl, session.token, "/data-token/exchange-data-for-token", {
    temporaryTokenSpace: tmpToken,
    data: wire.toString("base64"),
  });
  const exchangeCmd = extractCommandId(await exchange.json());
  if (!exchangeCmd) throw new Error("exchange-data-for-token: no commandId");
  await awaitCommand(session.ws, exchangeCmd);

  // 5. Commit metadata → permanent data token. This step promotes the
  //    ephemeral `tmp-…` token to a durable `dtk-…` handle. Skip it and
  //    the row expires with the TTL you set in step 1.
  const meta = await postForm(apiUrl, session.token, "/data-token/configure-file-meta", {
    token: tmpToken,
    fileName: "payload.bin",
    extension: "bin",
    context,
    size: String(plaintext.length),
    path: "/",
  });
  const { token: permanentToken } = await meta.json();
  return permanentToken; // Persist this as the handle for this record.
}
```

### Retrieve a payload

```ts
export async function retrieveData(
  session: Session,
  apiUrl: string,
  aesKey: Buffer,
  permanentToken: string,
): Promise<Buffer> {
  const res = await postForm(apiUrl, session.token, "/data-token/request-data", {
    token: permanentToken,
  });
  const requestId = res.headers.get("x-dpt-cab-request-id");
  if (!requestId) throw new Error("no x-dpt-cab-request-id header");

  const ack = await new Promise<{ body: string; output_type: number }>((resolve, reject) => {
    const timer = setTimeout(() => {
      session.ws.removeEventListener("message", onMsg);
      reject(new Error(`timeout waiting for ${requestId}`));
    }, 30_000);
    function onMsg(ev: MessageEvent) {
      const m = JSON.parse(String(ev.data));
      if (m.data?.type !== "X-DPT-CAB-REQUEST-ID" || m.data.id !== requestId) return;
      session.ws.removeEventListener("message", onMsg);
      clearTimeout(timer);
      resolve({ body: m.data.body, output_type: m.data.output_type });
    }
    session.ws.addEventListener("message", onMsg);
  });

  let wire: Buffer;
  if (ack.output_type === 0) {
    // Inline: the body IS your base64-encoded ciphertext.
    wire = Buffer.from(ack.body, "base64");
  } else {
    // Streamed (large payloads) — see {{docsSiteUrl}}/guides/store-and-retrieve.html
    throw new Error("streamed retrieval path not shown here; see the store-and-retrieve guide");
  }

  // Decrypt. Wire format: [12-byte IV][ciphertext][16-byte GCM auth tag].
  const iv = wire.subarray(0, 12);
  const tag = wire.subarray(wire.length - 16);
  const ct = wire.subarray(12, wire.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}
```

### HTTP helpers used above

```ts
async function postForm(
  apiUrl: string, token: string, path: string, form: Record<string, string>,
): Promise<Response> {
  return fetch(`${apiUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-DPT-AUTHORIZATION": token,
    },
    body: new URLSearchParams(form).toString(),
  });
}

async function getJson(apiUrl: string, token: string, path: string): Promise<any> {
  const res = await fetch(`${apiUrl}${path}`, {
    headers: { "X-DPT-AUTHORIZATION": token },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}
```

## WebSocket messages

After `joinChannel` succeeds, the server sends exactly these message
types over the same socket. Your handler dispatches on
`message.data.type`:

| Type | When it arrives | Correlate by | Key fields |
| --- | --- | --- | --- |
| `X-DPT-CAB-ID` | After any async-command HTTP call (`202` response) | `message.data.id === commandId` | `command_status` (2 success / 3 rejected), `body` |
| `X-DPT-CAB-REQUEST-ID` | After `request-data` or other async-request HTTP calls. The correlation id comes back in the HTTP response's `x-dpt-cab-request-id` header, NOT the JSON body. | `message.data.id === requestId` | `body` (base64 for inline payloads), `output_type` (0 inline / 1 streamed) |
| `STREAM-READY` | During large-payload retrieval (`output_type === 1`). Tells you a streaming URL is ready. | `message.data.requestId` | `streamUrl` — open a second WebSocket there for the binary frames |

Messages you don't care about — join acks, keepalives, telemetry —
are safe to ignore. Always dispatch on `message.data.type` and
return early for anything unrecognised.

## Authorization token lifetime

- `authenticate` returns `authorizationToken` with an `expiresAt`
  timestamp. Treat the token as opaque — you must read `expiresAt`
  from the response, not parse the token.
- Tokens are typically valid for several hours. Re-authenticate
  (or call `/profile/reauthorize-authorization-token` to refresh)
  when you're within ~60 seconds of expiry.
- `/profile/authorization-token/expiry` (POST, empty body, auth'd)
  returns `{expiresAt}` for the current token if you need to check
  mid-session.
- A revoked or expired token shows up as `401 invalid token` on
  any authenticated endpoint. Recover by calling `authenticate`
  again and replaying the failed call; do not retry a bare HTTP
  failure.

## Error recovery

- **`command_status: 3` in a WebSocket ack.** The command was
  rejected. `message.data.body` is a short string explaining why
  (missing field, wrong owner, policy denied, etc.). Surface the
  string to logs, fail the calling operation, do NOT retry with
  the same inputs — retries will hit the same rejection. Fix the
  input or the prerequisite state (register missing device,
  satisfy a policy, etc.) before trying again.
- **No ack arrives within your timeout.** The most common cause
  is ordering: the WebSocket `joinChannel` must complete before
  the HTTP call that produces the ack. Second most common:
  multiple WebSocket connections and the ack landed on a
  different one. Re-run with a single shared socket and check
  timings.
- **`401 invalid token` mid-session.** Treat as expected — tokens
  rotate. Re-authenticate once, replay the call. If it fails a
  second time, the credentials or profile state are wrong.
- **`422` on a reserve-token-space, exchange-data-for-token, or
  any write endpoint.** The body will usually contain a field
  name or machine-readable reason. Validate inputs against the
  OpenAPI spec at `{{docsSiteUrl}}/openapi.json` — don't guess.

## Always

- **Subscribe to the WebSocket BEFORE** issuing the HTTP command whose
  ack you want to read. Acks arrive immediately.
- Check `command_status` on every ack: `2` = success, `3` = rejected
  (body carries the reason).
- Pass the token only via `X-DPT-AUTHORIZATION` header.
- Persist the permanent `dtk-…` token in your application database as
  the handle for each stored record.
- Generate a fresh 12-byte IV for every payload — never reuse.
- If you're provisioning a profile yourself, register its public key
  before calling `authenticate`. If the profile was handed to you
  ready-to-use, skip provisioning and go straight to `authenticate`.

## Never

- Don't parse the `T-…` authorization token; treat it as opaque.
- Don't skip the public-key registration step when provisioning a
  brand-new profile — the profile is inert until its public key
  lands. (When the profile was pre-provisioned by someone else,
  this step was already done.)
- Don't upload plaintext. The threat model requires client-side
  encryption.
- Don't poll when you could subscribe. Polling is for one-shot
  scripts only; real clients use the WebSocket.
- Don't hardcode the Privicore engine's public key. Fetch it on
  startup and cache briefly.
- Don't log tokens, passwords, or AES keys.
- Don't reuse a single AES key across users. One key per
  data-owning entity.

## When things go wrong

| Symptom | Likely cause |
| --- | --- |
| `authenticate` returns 401 "invalid credentials" with known-good creds | Public key not yet registered for this profile |
| Call returns 202 but no ack ever arrives | WebSocket not joined, or joined after the HTTP call fired |
| Ack arrives with `command_status: 3` | Operation rejected — body has the reason (missing field, wrong owner, policy denied, etc.) |
| Retrieved ciphertext fails to decrypt | AES key mismatch, or wire format mis-parsed (IV is first 12 bytes, tag is last 16) |
| `retrieve-temporary-data-token` returns 404 | The reservation `commandId` hasn't settled — await `X-DPT-CAB-ID` first |
| `request-data` ack has `output_type: 1` | Large-payload streaming path — see the [Store and retrieve guide]({{docsSiteUrl}}/guides/store-and-retrieve.html) |

## Where to go for depth

- **[Getting started]({{docsSiteUrl}}/guides/getting-started.html)** — authenticate end-to-end.
- **[Protocol overview]({{docsSiteUrl}}/guides/protocol-overview.html)** — async model, WebSocket, encryption layers.
- **[Store and retrieve]({{docsSiteUrl}}/guides/store-and-retrieve.html)** — the canonical happy-path flow.
- **[Keys and public keys]({{docsSiteUrl}}/guides/keys-and-public-keys.html)** — how to generate a signed public key.
- **[API reference]({{docsSiteUrl}}/reference/)** — every endpoint, every parameter, every response shape.
- **[OpenAPI spec (JSON)]({{docsSiteUrl}}/openapi.json)** — machine-readable ground truth.
