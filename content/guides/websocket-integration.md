# WebSocket Integration

The WebSocket proxy is how your client learns about the outcome of
asynchronous commands, the readiness of streamed downloads, and any
other real-time signal the engine emits. This guide covers the
concrete wire protocol — connection, channel join, message shapes,
teardown, and a minimal awaiter pattern you can build against.

If you haven't read it already, the
[async command model](/guides/protocol-overview.html#the-async-command-model)
is required background.

## Connecting

Open a standard WebSocket connection to the proxy:

```
{{wsUrl}}
```

No subprotocol, no special headers, no auth at connect time — the
proxy will accept the connection and wait for you to identify
yourself with a channel-join message.

:::warning[Connect before issuing commands]
Acks arrive the moment the engine has an answer. If you fire an HTTP
command before the WebSocket is connected and joined, you will miss
the ack and your client will appear to hang. Always establish and
join the channel first.
:::

## Joining a channel

A channel is bound to your authorization token. Once joined, the
proxy emits every event the engine produces for your profile on this
socket.

```js
ws.send(JSON.stringify({
  action: "joinChannel",
  data: { authorizationToken: "T-MUIFA…" },
}));
```

Expect a confirmation:

```json
{
  "status": 200,
  "data": { "channelId": "chn-…" }
}
```

Any messages that would have been routed to you before the join
arrived are buffered briefly server-side and delivered on successful
join — but do not rely on that buffer for anything you can't tolerate
losing. Join before issuing commands.

## Message types

After joining, every message has the shape:

```json
{
  "data": {
    "id": "…",
    "type": "…",
    "command_status": 0,
    "output_type": 0,
    "body": "…"
  }
}
```

The three types you care about:

### `X-DPT-CAB-ID`

The ack for any async *command* (writes: register-profile,
reserve-token-space, exchange-data-for-token, policy activation, etc.).
`data.id` matches the `commandId` the HTTP endpoint returned in its
`202` body. Branch on `data.command_status`:

| value | meaning |
| ----- | ------- |
| `1`   | Still in flight. Mostly seen when polling, not on the socket. |
| `2`   | Accepted / succeeded. |
| `3`   | Rejected. `data.body` carries the reason (machine-readable key, e.g. `profile.not_an_owner`). |

### `X-DPT-CAB-REQUEST-ID`

The ack for async *reads* that return data asynchronously —
[`request-data`](/reference/#tag/data-token/operation/data-token.request-data)
is the canonical example. `data.id` matches the `x-dpt-cab-request-id`
header from the HTTP response.

The payload depends on `data.output_type`:

- `output_type: 0` — the response fits inline. `data.body` is your
  AES ciphertext, base64-encoded.
- `output_type: 1` — the response is streamed. `data.body` is a
  downstream auth token; watch for a subsequent `STREAM-READY` message
  on the same `id`, then pull the payload via HTTP GET against the
  downstream file-storage service.

### `STREAM-READY`

Emitted only for the streamed variant of `request-data`. Signals that
the downstream service has the payload ready for a GET using the auth
token you received on the prior `X-DPT-CAB-REQUEST-ID` message.

## Leaving a channel

If your client is shutting down cleanly, release the channel
before closing the socket:

```js
ws.send(JSON.stringify({
  action: "leaveChannel",
  data: { channelId: "chn-…" },
}));
```

The proxy also cleans up on socket close, so this is an optimisation,
not a requirement.

## A minimal awaiter

A common pattern is to wrap the proxy in a promise-returning helper
that resolves on the matching ack:

```js
function awaitCommand(ws, commandId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const handler = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.data?.type !== "X-DPT-CAB-ID") return;
      if (msg.data.id !== commandId) return;
      ws.removeEventListener("message", handler);
      clearTimeout(timer);
      if (msg.data.command_status === 2) resolve(msg.data);
      else reject(new Error(`command ${commandId} rejected: ${JSON.stringify(msg.data.body)}`));
    };
    const timer = setTimeout(() => {
      ws.removeEventListener("message", handler);
      reject(new Error(`command ${commandId} timed out`));
    }, timeoutMs);
    ws.addEventListener("message", handler);
  });
}
```

Issue the HTTP command, then `await awaitCommand(ws, commandId)` to
block until the real outcome is known. The same pattern (filtering on
a different `type` + `id` field) works for the request-id and
stream-ready flows.

## Reconnection

The proxy will drop idle connections eventually; your client should
reconnect on close and re-join the channel. If you were waiting on a
specific command id when the socket dropped, a safe recovery is:

1. Reconnect, re-join with the same authorization token.
2. Poll the command id via
   [`GET /utility/request-command-id-status/{id}`](/reference/#tag/utility/operation/utility.request-command-id-status)
   once to reconcile state.
3. Resume waiting for any commands that are still in flight.

Do not rely on the proxy re-emitting acks for commands that completed
while you were disconnected — once an ack has been delivered to a
channel, it's gone.
