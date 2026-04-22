# Data Token Lifecycle

[Store and retrieve](/guides/store-and-retrieve.html) walks you through
creating a permanent data token. This guide covers what you can do with
tokens after that: listing them, updating their metadata, attaching a
risk classification, and deleting them when they're no longer needed.

All of these calls take the permanent data token (the `dtk-…` string
returned by [`configure-file-meta`](/reference/#tag/data-token/operation/data-token.configure-file-meta))
as their primary handle. Keep your own mapping from application-level
objects to permanent tokens — Privicore will not give you back the
original filename or context from a bare token.

## List tokens

Enumerate the tokens that exist under your profile:

```bash
curl {{apiUrl}}/data-token/list-data-tokens \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…'
```

Response is a paged list of token records, each including the
permanent token, its `context`, `fileName`, `extension`, `size`,
`createdAt`, and any metadata attached via the calls below.

```json
{
  "items": [
    {
      "token": "dtk-9e22aabb-ccdd-eeff-0011-223344556677",
      "context": "invoices/2026-Q1",
      "fileName": "hello.txt",
      "extension": "txt",
      "size": 39,
      "createdAt": "2026-04-21T12:00:00Z"
    }
  ],
  "meta": { "count": 1, "page": 1, "perPage": 25 }
}
```

Listing is meant for operator tooling and management consoles, not hot
paths — paginate with `page` / `perPage` query parameters and cache
results on your side when possible.

## Update token metadata

Change a token's mutable fields — typically the display filename, the
extension, or the context grouping — without re-uploading the payload:

```bash
curl -X POST {{apiUrl}}/data-token/update-data-token \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'token=dtk-9e22…' \
  --data-urlencode 'fileName=hello-renamed.txt' \
  --data-urlencode 'context=invoices/2026-Q2'
```

The call is asynchronous — await the `X-DPT-CAB-ID` ack the same way
you would for any other write.

The underlying ciphertext is untouched; this call only rewrites the
metadata the engine holds alongside the token. The payload's
cryptographic state — your client-side AES key, the engine's
server-side envelope, the device-local at-rest key — is unchanged.

## Attach a risk / info-security classification

Information-security metadata is a separate field bag intended for
classification, compliance, and governance tooling. Set it with:

```bash
curl -X POST {{apiUrl}}/data-token/configure-information-security-risk-meta \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'token=dtk-9e22…' \
  --data-urlencode 'classification=confidential' \
  --data-urlencode 'retentionDays=365'
```

:::info[Schema is soft]
The engine accepts arbitrary field names under this call; nothing is
enforced server-side. Pick a schema your organisation can defend and
stick to it across all tokens — downstream systems that read this
metadata assume consistency.
:::

## Delete a token

When a token is no longer needed, deleting it removes the engine-side
record and fans removal out to every registered storage device:

```bash
curl -X POST {{apiUrl}}/data-token/delete-data \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…' \
  --data-urlencode 'token=dtk-9e22…'
```

The call is asynchronous. When `command_status: 2` arrives on the
WebSocket, the engine has committed the delete and dispatched the
storage-device removals.

:::warning[Deletes propagate, but observability is limited]
There is no single "all devices have acknowledged the removal" signal.
The engine confirms the dispatch, not each device's local delete. If
auditable deletion is a requirement — e.g. GDPR right-to-erasure —
record the post-delete state of each storage device independently.
:::

## Putting it together

A typical lifecycle for a single token, from store to retire:

1. Reserve, exchange, configure-file-meta — see
   [Store and retrieve](/guides/store-and-retrieve.html).
2. Persist the permanent token in your application database against
   whatever business object it represents.
3. Attach classification metadata with `configure-information-security-risk-meta`
   to feed your governance / retention tooling.
4. Retrieve on demand via `request-data` (happy path) or list and
   filter via `list-data-tokens` when reconciling.
5. Rename or re-group via `update-data-token` if the organisational
   layer changes.
6. When retention expires or the business object is deleted, call
   `delete-data` and mark the record retired on your side.

Endpoints used in this guide, for reference:

- [`GET /data-token/list-data-tokens`](/reference/#tag/data-token/operation/data-token.list-data-tokens)
- [`POST /data-token/update-data-token`](/reference/#tag/data-token/operation/data-token.update-data-token)
- [`POST /data-token/configure-information-security-risk-meta`](/reference/#tag/data-token/operation/data-token.configure-information-security-risk-meta)
- [`POST /data-token/delete-data`](/reference/#tag/data-token/operation/data-token.delete-data)
