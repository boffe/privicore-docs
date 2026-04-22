# Getting Started

This guide walks you from a freshly-provisioned Privicore Engine to your
first authenticated API call. At the end you will have a registered
profile, a registered public key, a valid authorization token, and a
confirmed round-trip against the server.

If you already know the protocol and just want the endpoint reference,
skip to the [API reference](/reference/).

## What you need

- A reachable Privicore Engine. This guide assumes `{{apiUrl}}`
  for the CAB API and `{{wsUrl}}` for the WebSocket
  proxy. Substitute your own sandbox URLs.
- An HTTPS client that can send `application/x-www-form-urlencoded`
  bodies and open WebSocket connections. Any modern language stdlib
  will do; the curl examples below assume shell.
- An understanding that **most write operations are asynchronous**. You
  get a `commandId` back immediately, then await the real outcome on a
  WebSocket message. This is covered in detail in the
  [Protocol overview](/guides/protocol-overview.html); for now, trust
  that a `202` does not mean "done".

## Step 1. Register a profile

A profile is the account identity you authenticate as. Register it with
your chosen username and password:

```bash
curl -X POST {{apiUrl}}/profile/register-profile \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'username=alice@example.com' \
  --data-urlencode 'password=correct-horse-battery-staple'
```

The server returns a `202 Accepted` with a command id:

```json
{ "commandId": "7c0f…" }
```

Registration is itself asynchronous. You can either poll
`GET /utility/request-command-id-status/{commandId}` until it returns
`command_status: 2` (accepted), or subscribe to the WebSocket proxy and
wait for an `X-DPT-CAB-ID` message for this id. Either is fine at this
stage.

:::note[]
The profile is not yet usable. It has no public key, and Privicore will
not let it authenticate until that changes.
:::

## Step 2. Register a public key

Every active profile registers a signed Curve25519 public key. Generate
a keypair locally, then register the public key against your new
profile:

```bash
curl -X POST {{apiUrl}}/public-key/register-public-key \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'username=alice@example.com' \
  --data-urlencode 'password=correct-horse-battery-staple' \
  --data-urlencode 'publicKey=<200-hex-char signed pubkey>'
```

The `publicKey` field is a 200-hex-character signed blob. See
[Keys and public keys](/guides/keys-and-public-keys.html) for the
format and a reference generator.

This call also returns a `commandId`; await it the same way.

:::note[]
Public key registration is a mandatory step in profile provisioning.
Until it completes successfully, the profile cannot participate in any
authenticated workflow.
:::

## Step 3. Authenticate

Now you can exchange credentials for an authorization token:

```bash
curl -X POST {{apiUrl}}/profile/authenticate \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'username=alice@example.com' \
  --data-urlencode 'password=correct-horse-battery-staple'
```

Response:

```json
{
  "authorizationToken": "T-MUIFA…",
  "expiresAt": "2027-04-21T12:00:00Z"
}
```

The token is an opaque string. Treat it as a bearer secret; do not
parse it. Include it on every subsequent call as:

```
X-DPT-AUTHORIZATION: T-MUIFA…
```

Tokens have a configurable TTL; query the expiry with
`GET /profile/retrieve-token-expiry` or refresh with
`POST /profile/reauthorize-authorization-token` before they lapse.

## Step 4. Hello world

Confirm the token works with a read-only health check:

```bash
curl {{apiUrl}}/utility/check-server-health \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…'
```

```json
{ "status": "ok" }
```

If you see that, your profile is live. Anything you can do with
Privicore you can now do.

## Next steps

- Read the [Protocol overview](/guides/protocol-overview.html) to
  understand the async command model and the WebSocket ack protocol.
  Every subsequent endpoint assumes you know these.
- Follow [Store and retrieve](/guides/store-and-retrieve.html) for an
  end-to-end walkthrough that puts a real blob through the full
  tokenisation pipeline and gets it back out.
- Browse the [API reference](/reference/) when you need the exact
  parameters for an endpoint.
