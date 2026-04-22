# Protocol Overview

Before chaining Privicore API calls together, internalise these three
concepts. Every endpoint page assumes you know them, and reverse-engineering
them from error responses is unpleasant.

1. The async command model — most writes return `202 + commandId`,
   not the final result.
2. The WebSocket ack protocol — that's how you learn the final result.
3. The encryption model — two layers, client-side and server-side,
   with different scopes.

## The async command model

![Register a profile, receive an identifier, poll or subscribe for the final command status.](/images/async-command-model.png)

Most mutating endpoints do not complete inline. They return a
`202 Accepted` with a command id, and the real outcome arrives on a
separate WebSocket message:

```json
// POST /data-token/reserve-token-space → 202
{ "commandId": "7c0f…" }
```

You have two ways to wait for the outcome:

- **Poll.** `GET /utility/request-command-id-status/{commandId}`
  returns the command's current state. Cheap for one-shot scripts;
  noisy for real clients.
- **Subscribe.** Open a WebSocket to the proxy (see below) and wait
  for a matching `X-DPT-CAB-ID` message. This is the recommended
  approach for any long-lived client.

The final state is encoded in `command_status`:

| `command_status` | Meaning |
| ---------------- | ------- |
| `1`              | In flight (seen mostly during polling) |
| `2`              | Accepted / succeeded |
| `3`              | Rejected — check the message body for the reason |

:::warning[]
A `202` on its own does not mean the operation succeeded. Treat a
request as complete only once you have seen `command_status: 2` for its
command id. Clients that skip the WebSocket wait and chain calls on
HTTP status alone will see apparent successes become hard-to-diagnose
failures later.
:::

## WebSocket acks

The WebSocket proxy at `{{wsUrl}}` is how clients
learn about command outcomes, data-download readiness, and streaming
events. Open a connection, join a channel bound to your token, and
read messages:

```js
const ws = new WebSocket('{{wsUrl}}');
ws.onopen = () => {
  ws.send(JSON.stringify({
    action: 'joinChannel',
    data: { authorizationToken: 'T-MUIFA…' },
  }));
};
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  // msg.data.id, msg.data.type, msg.data.command_status, …
};
```

The channel emits three message types you care about:

- **`X-DPT-CAB-ID`** — the ack for a command. `msg.data.id` matches
  the `commandId` you got from the HTTP response, and
  `msg.data.command_status` tells you whether it succeeded.
- **`X-DPT-CAB-REQUEST-ID`** — emitted by the retrieve flow. When you
  call `/data-token/request-data`, the server responds with a
  `requestId` in headers; the WebSocket message under that id carries
  the downstream auth token (or inline data, for small payloads).
- **`STREAM-READY`** — emitted when a streamed download is ready to
  pull from the downstream file-storage service.

:::note[]
Subscribe to the WebSocket **before** you issue the HTTP request whose
ack you want to read. Acks arrive immediately when the server has an
answer, and a race where the ack fires before you joined the channel
will look like a silent failure.
:::

## The encryption model

Privicore encrypts your data at **three layers**, each owned by a
different party and solving a different threat:

1. **Client-side, by you.** Before any bytes leave your machine, you
   encrypt the payload with AES-256-GCM using a key you generated and
   keep. The wire format is `[12-byte IV][ciphertext][16-byte auth tag]`.
   Only your application ever has this key.
2. **Transport / bus-layer, by the engine.** The engine wraps the
   already-encrypted payload in its own envelope for delivery to
   storage devices. Keys for this layer live inside the engine and you
   never handle them.
3. **At-rest, by each storage device.** Every registered storage
   device re-encrypts the chunks it receives under a key local to that
   device before writing them to disk. The engine does not hold these
   keys either — they live on the device.

What this means in practice:

- Lose your client-side AES key and the data is unrecoverable. Neither
  the engine nor the storage devices can help — they only ever saw
  ciphertext.
- Breaching only the storage layer yields chunks encrypted under
  three independent keys. All three have to fail for plaintext to
  leak.
- Storage device fan-out (below) distributes the server-wrapped
  ciphertext; each recipient device adds its own at-rest layer on top.

See [Store and retrieve](/guides/store-and-retrieve.html) for the
concrete encrypt / upload / download / decrypt flow that you as the
caller participate in. (You only handle layer 1; layers 2 and 3 are
applied by Privicore on your behalf.)

## Storage device fan-out

Every successful store is replicated to **every registered storage
device** on the profile. This is designed, not accidental: the
architecture assumes at least three storage devices per profile for
resilience against individual device loss.

Implications for integrators:

- Registered device count directly affects your storage costs and
  broker throughput. Plan accordingly.
- A stored blob is not "lost" when one device fails, but a profile
  with a single device has no resilience.

## Voting-gated operations

![A gated request: if a policy is active, a pool issues ballots, registered voter devices respond yes/no, and only a successful poll resolves the operation; otherwise the operation flows directly to storage.](/images/voting-gated-flow.png)

Some operations can be gated behind a **voting policy** — the
operation only completes if a quorum of registered authenticator
devices approves it. This is Privicore's differentiated feature for
high-assurance workflows, and the protocol on that path layers
authenticator registration, policy activation, and real-time vote
collection over the async command model above.

See [Voting-gated operations](/guides/voting-gated-operations.html) for
the end-to-end walkthrough — registering an authenticator device,
defining a voting configuration, attaching a policy, and triggering a
gated call.

