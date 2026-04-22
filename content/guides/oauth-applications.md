# OAuth Applications

OAuth applications let you delegate access to your Privicore profile
without handing over credentials or your primary authorization token.
Each application gets its own identity, its own scoped access tokens,
and its own lifecycle — so you can revoke one integration without
touching any of the others.

This guide covers the full flow: registering an application,
retrieving its configuration, running the authorization-code leg,
exchanging the code for an access token, refreshing tokens, and
revoking access. The vocabulary matches standard OAuth 2.0
authorization-code flow; the only Privicore-specific twists are noted
as they come up.

## When to use OAuth applications

- You're building a **third-party integration** that acts on behalf of
  Privicore users, and you want an audit trail that distinguishes
  your application's actions from the user's own.
- You want to **scope** what an integration can do (read-only,
  storage-only, metadata-only) rather than granting full profile
  access.
- You need to **revoke** individual integrations without disturbing
  the user's primary session or other integrations.

If you're building a first-party client that users sign into with
their own credentials, you don't need an OAuth application — use the
regular `POST /profile/authenticate` flow.

## Step 1. Register the application

The profile owner registers the application, choosing a display name
and the scopes it may request:

```bash
curl -X POST {{apiUrl}}/oauth/register-oauth-application \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'name=my-integration' \
  --data-urlencode 'redirectUri=https://my-integration.example.com/oauth/callback' \
  --data-urlencode 'scopes=data-token:read,data-token:write'
```

Registration returns an `applicationId` once the async ack lands.

## Step 2. Retrieve the application's configuration

Fetch the credentials your integration will use to drive the OAuth
flow:

```bash
curl {{apiUrl}}/oauth/retrieve-oauth-app-configuration/{applicationId} \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…'
```

Response:

```json
{
  "applicationId": "app-…",
  "clientId": "cli-…",
  "clientSecret": "shh-…",
  "redirectUri": "https://my-integration.example.com/oauth/callback",
  "scopes": ["data-token:read", "data-token:write"]
}
```

:::warning[Treat the client secret as sensitive]
`clientSecret` is your application's password. Keep it server-side,
never ship it to browser or mobile bundles, and rotate it if it
leaks by re-registering the application.
:::

## Step 3. Request an authorization code

Redirect the user to Privicore's authorization endpoint. Users sign
in and consent to the scopes the application requests; on success the
engine redirects back to your `redirectUri` with an authorization
code.

```
POST /oauth/request-oauth-app-authorization-code
  clientId=cli-…
  scopes=data-token:read,data-token:write
  state=<opaque csrf token>
```

The engine issues a one-shot authorization code tied to the user's
profile. Your callback endpoint receives the code (and the `state`
value you passed, which you should verify matches what you issued).

## Step 4. Exchange the code for an access token

With the code in hand, your **server-side** code exchanges it for an
access token. Authenticate the exchange with HTTP Basic
authentication — base64 of `clientId:clientSecret`:

```bash
curl -X POST {{apiUrl}}/oauth/obtain-oauth-app-access-token \
  -H "Authorization: Basic $(echo -n 'cli-…:shh-…' | base64)" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'grantType=authorization_code' \
  --data-urlencode 'code=<auth code from step 3>'
```

Response:

```json
{
  "accessToken": "T-oauth-…",
  "tokenType": "Bearer",
  "expiresIn": 3600,
  "refreshToken": "T-oauth-refresh-…",
  "scope": "data-token:read data-token:write"
}
```

The `accessToken` is the token your application uses for subsequent
API calls. Pass it the same way you would any other Privicore token,
via the `X-DPT-AUTHORIZATION` header.

:::info[Basic-auth format]
The `Authorization` header is `Basic base64(clientId:clientSecret)` —
not the authorization code. The code goes in the request body. This
trips up people who assume the code is part of the Basic-auth string.
:::

## Step 5. Use the access token

Once issued, the OAuth access token is a first-class Privicore
authorization token, restricted to the scopes granted at consent.
All data-plane API calls work the same way:

```bash
curl -X POST {{apiUrl}}/data-token/request-data \
  -H 'X-DPT-AUTHORIZATION: T-oauth-…' \
  --data-urlencode 'token=dtk-…'
```

The engine attributes every action taken with this token to your
registered application, not to the underlying user profile. That
attribution shows up in audit logs and observability dashboards.

## Step 6. Refresh an expired token

Access tokens are short-lived (the `expiresIn` value in seconds).
Before expiry, trade your refresh token for a new access token:

```bash
curl -X POST {{apiUrl}}/oauth/refresh-oauth-app-access-token \
  -H "Authorization: Basic $(echo -n 'cli-…:shh-…' | base64)" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'grantType=refresh_token' \
  --data-urlencode 'refreshToken=T-oauth-refresh-…'
```

The response has the same shape as the initial token exchange. The
old access token stops working immediately; the old refresh token is
rotated and replaced by the new one in the response.

## Managing and revoking applications

- **List all applications** owned by the profile:
  `GET /oauth/oauth-application-list`.
- **Inspect an application's scope** (useful for consent UIs):
  `GET /oauth/retrieve-oauth-application-scope/{applicationId}`.
- **Revoke** an application by deleting its registration — all
  outstanding access and refresh tokens are invalidated immediately.
  Re-registering with the same name issues fresh credentials; old
  tokens stay dead.

## Putting it together

A full integration run, start to steady state:

1. Profile owner registers the application and copies `clientId` /
   `clientSecret` to the integration's server-side config.
2. User visits the integration, which redirects them to Privicore for
   consent.
3. Privicore redirects back with an authorization code; integration's
   server exchanges it for an access + refresh token.
4. Integration calls Privicore APIs with the access token.
5. Before expiry, integration refreshes silently.
6. If anything goes wrong, profile owner revokes the application and
   all tokens stop working instantly.

Endpoints used in this guide, for reference:

- [`POST /oauth/register-oauth-application`](/reference/#tag/oauth/operation/oauth.register-oauth-application)
- [`GET /oauth/retrieve-oauth-app-configuration/{applicationId}`](/reference/#tag/oauth/operation/oauth.retrieve-oauth-app-configuration)
- [`POST /oauth/request-oauth-app-authorization-code`](/reference/#tag/oauth/operation/oauth.request-oauth-app-authorization-code)
- [`POST /oauth/obtain-oauth-app-access-token`](/reference/#tag/oauth/operation/oauth.obtain-oauth-app-access-token)
- [`POST /oauth/refresh-oauth-app-access-token`](/reference/#tag/oauth/operation/oauth.refresh-oauth-app-access-token)
- [`GET /oauth/oauth-application-list`](/reference/#tag/oauth/operation/oauth.oauth-application-list)
