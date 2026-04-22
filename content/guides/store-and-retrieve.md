# Store and Retrieve

This walkthrough takes a 1 KB blob end-to-end: client-side encryption,
token reservation, exchange, metadata, persistence, retrieval,
client-side decryption. It is the single most useful thing you can do
with Privicore, and touches every concept in the
[Protocol overview](/guides/protocol-overview.html).

Before you start, you should have:

- A valid authorization token. If not, do
  [Getting started](/guides/getting-started.html) first.
- A WebSocket connection to `{{wsUrl}}` already
  joined to your token's channel.
- A local AES-256-GCM key. This is your secret; the server never sees
  it. A 64-character hex string is fine.

Every HTTP call below includes:

```
X-DPT-AUTHORIZATION: T-MUIFA…
```

![The tokenisation flow: reserve token space, retrieve a temporary token, then exchange data either over the HTTP API (small payloads) or by streaming (larger payloads).](/images/data-token-exchange.png)

## Step 1. Reserve token space

Before you can exchange data for a token, you reserve a slot for the
token to land in. This is also where you attach operational
metadata — `context` (a free-form string, commonly used like a
directory name) and `ttl` (seconds).

```bash
curl -X POST {{apiUrl}}/data-token/reserve-token-space \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'context=invoices/2026-Q1' \
  --data-urlencode 'ttl=3600'
```

Response:

```json
{ "commandId": "7c0f…" }
```

Await `X-DPT-CAB-ID` for that id on your WebSocket. Once
`command_status: 2` arrives, proceed.

## Step 2. Retrieve the temporary token

The reservation produces a short-lived temporary token you exchange
your data against:

```bash
curl {{apiUrl}}/data-token/retrieve-temporary-data-token/7c0f… \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…'
```

```json
{
  "token": "tmp-3a71…",
  "stream": "{{upstreamUrl}}/?auth=…"
}
```

The `token` is what you send for small payloads. The `stream` URL is
the upstream file-storage endpoint for the streamed-upload path used
for larger payloads. This walkthrough uses the small-payload path;
see the note at the end of step 3 for when to switch.

## Step 3. Encrypt and exchange the data

Encrypt your payload locally with AES-256-GCM. Wire format is
`[12-byte IV][ciphertext][16-byte auth tag]`:

```js
import crypto from 'node:crypto';
const key = Buffer.from('…64 hex chars…', 'hex');
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const ct = Buffer.concat([cipher.update('hello world'), cipher.final()]);
const tag = cipher.getAuthTag();
const wire = Buffer.concat([iv, ct, tag]);
const base64 = wire.toString('base64');
```

Then exchange it:

```bash
curl -X POST {{apiUrl}}/data-token/exchange-data-for-token \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'temporaryTokenSpace=tmp-3a71…' \
  --data-urlencode 'data=<base64 from above>'
```

Response is another `202 + commandId`. Await the `X-DPT-CAB-ID` ack as
before.

:::info[]
The small-payload path is fine up to ~50 KB. For anything larger, POST
the binary ciphertext directly to the `stream` URL returned in step 2
(with `Content-Type: application/octet-stream`) instead of calling
`exchange-data-for-token`. The rest of the flow is the same.
:::

## Step 4. Configure file metadata

Exchange alone does not produce a permanent token. You also need to
commit file metadata, which is the moment the temporary token becomes
a permanent, addressable data token:

```bash
curl -X POST {{apiUrl}}/data-token/configure-file-meta \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'token=tmp-3a71…' \
  --data-urlencode 'fileName=hello.txt' \
  --data-urlencode 'extension=txt' \
  --data-urlencode 'context=invoices/2026-Q1' \
  --data-urlencode 'size=39' \
  --data-urlencode 'path=/'
```

The response carries the **permanent data token** — the string you
persist in your own system as the handle for this blob:

```json
{ "token": "dtk-9e22…" }
```

From here on, `dtk-9e22…` is how you refer to this payload.

## Step 5. Retrieve it back

![Retrieval: send the data token, receive an identifier, then either read the response inline, follow a response link, or pick up the data from the message queue.](/images/data-retrieve-flow.png)

Ask Privicore for the data:

```bash
curl -X POST {{apiUrl}}/data-token/request-data \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'token=dtk-9e22…' \
  -D -
```

The response headers include `x-dpt-cab-id` and `x-dpt-cab-request-id`.
Wait for the **`X-DPT-CAB-REQUEST-ID`** WebSocket message whose `id`
matches the request id. That message has the shape:

```json
{
  "data": {
    "id": "req-1234…",
    "type": "X-DPT-CAB-REQUEST-ID",
    "body": "…",
    "output_type": 0
  }
}
```

Branch on `output_type`:

- **`output_type: 0`** — the payload is small enough to be inlined.
  `body` contains your AES ciphertext, base64-encoded.
- **`output_type: 1`** — the payload is streamed. `body` contains a
  downstream auth token. Wait for a subsequent `STREAM-READY` message
  on the same id, then `GET {{downstreamUrl}}/?auth=<body>`
  to pull the binary ciphertext.

## Step 6. Decrypt

Whichever branch you took, you end up with the same AES ciphertext you
produced in step 3. Reverse the wire format, decrypt, and you have
your original bytes back:

```js
const wire = Buffer.from(base64, 'base64');
const iv = wire.subarray(0, 12);
const tag = wire.subarray(wire.length - 16);
const ct = wire.subarray(12, wire.length - 16);
const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
decipher.setAuthTag(tag);
const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
console.log(plain.toString()); // "hello world"
```

## What you just did

You reserved a token slot, encrypted a payload client-side, exchanged
it for a token, committed file metadata to promote the temporary token
to a permanent one, retrieved the ciphertext, and decrypted it
locally. Your plaintext never left the machine. What the engine held
was your AES ciphertext wrapped in a server-side envelope for bus
delivery, and what each storage device wrote was that wrapped
ciphertext re-encrypted again under a device-local at-rest key — three
independent layers, none of which the engine can peel back on its own.
See the [encryption model](/guides/protocol-overview.html#the-encryption-model)
for the full picture.

The endpoints used, for reference:

- [`POST /data-token/reserve-token-space`](/reference/#tag/data-token-management)
- [`GET /data-token/retrieve-temporary-data-token/{commandId}`](/reference/#tag/data-token-management)
- [`POST /data-token/exchange-data-for-token`](/reference/#tag/data-token-management)
- [`POST /data-token/configure-file-meta`](/reference/#tag/data-token-management)
- [`POST /data-token/request-data`](/reference/#tag/data-token-management)
