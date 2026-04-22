# Profile Management

[Getting started](/guides/getting-started.html) walks through the one
thing every profile needs at birth: registration, key registration,
authentication. This guide covers everything else you do with a
profile after that — change the password, rotate the authorization
token, look up the profile id, and generate a QR token for mobile
device pairing.

All calls require a valid authorization token unless otherwise noted.

## Change the password

Rotate the profile's password. This is asynchronous; await the
`X-DPT-CAB-ID` ack:

```bash
curl -X POST {{apiUrl}}/profile/change-password \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'currentPassword=correct-horse-battery-staple' \
  --data-urlencode 'newPassword=Tr0ub4dor&3-2026'
```

The engine enforces entropy on the new password. Re-authenticate
afterwards — the old password no longer works, but previously-issued
authorization tokens remain valid until they expire or are revoked.

:::info[Rotate the token too]
A password rotation doesn't automatically invalidate existing tokens.
If the rotation is driven by a suspected credential leak, follow up
with [`revoke-authorization-token`](#revoke-an-authorization-token)
to force all sessions to re-authenticate.
:::

## Retrieve your profile id

The profile id is a stable uuid, distinct from the username, used
when third-party systems need to refer to a profile without exposing
credentials:

```bash
curl {{apiUrl}}/profile/retrieve-profile-id \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…'
```

```json
{ "profileId": "prf-abc123…" }
```

Profile ids are ULIDs — sortable by creation time, globally unique.
Persist them in your own systems; they don't change when the username
or password does.

## Generate a QR token for pairing

Mobile authenticator apps use QR codes to pair a device without the
three-step onboarding chain described in
[Device management](/guides/device-management.html). Generate the QR
payload on an already-signed-in session:

```bash
curl -X POST {{apiUrl}}/profile/generate-qr-token-for-authorization \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…'
```

Response carries a one-shot token and a TTL. Render it as a QR code
in your UI; the mobile app scans, exchanges the token for a device
id, and runs the approval + role-specialisation steps under the hood.

## Token lifecycle

Authorization tokens are time-limited and can be rotated or revoked
explicitly.

### Check token expiry

```bash
curl {{apiUrl}}/profile/retrieve-token-expiry \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…'
```

```json
{ "expiresAt": "2027-04-21T12:00:00Z" }
```

Use this to schedule re-authorisation in long-running clients before
their tokens lapse.

### Reauthorize a token

Extend a valid token's lifetime without re-authenticating with a
password:

```bash
curl -X POST {{apiUrl}}/profile/reauthorize-authorization-token \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'ttl=2592000'
```

`ttl` is the new lifetime in seconds (here, 30 days). The engine
returns a refreshed token; use it and discard the old one.

### Revoke an authorization token

Invalidate a token immediately — the right call for logout, and the
right first response to a suspected token leak:

```bash
curl -X POST {{apiUrl}}/profile/revoke-authorization-token \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…'
```

The token is dead immediately. Any in-flight request using it returns
401 from that point on. OAuth-derived access tokens have their own
revocation path — see [OAuth applications](/guides/oauth-applications.html).

## A typical lifecycle

For a production client:

1. Authenticate once at startup with password + username.
2. Cache the token and its `expiresAt`.
3. Before the token lapses, call `reauthorize-authorization-token`
   with a fresh ttl; replace the cached token.
4. On graceful shutdown (or user-initiated logout), call
   `revoke-authorization-token` so the token can't be replayed.
5. On suspected credential leak, revoke, change the password, and
   re-authenticate.

Endpoints used in this guide, for reference:

- [`POST /profile/change-password`](/reference/#tag/profile/operation/profile.change-password)
- [`GET /profile/retrieve-profile-id`](/reference/#tag/profile/operation/profile.retrieve-profile-id)
- [`POST /profile/generate-qr-token-for-authorization`](/reference/#tag/profile/operation/profile.generate-qr-token-for-authorization)
- [`GET /profile/retrieve-token-expiry`](/reference/#tag/profile/operation/profile.retrieve-token-expiry)
- [`POST /profile/reauthorize-authorization-token`](/reference/#tag/profile/operation/profile.reauthorize-authorization-token)
- [`POST /profile/revoke-authorization-token`](/reference/#tag/profile/operation/profile.revoke-authorization-token)
