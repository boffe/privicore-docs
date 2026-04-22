# Device Management

In Privicore, a **device** is a second-class profile identity —
something owned by a user profile that can receive encrypted messages,
sign its own outbound traffic, and be trusted to perform a specific
role. Storage devices hold encrypted blobs; authenticator devices
vote on gated operations; mobile devices act as trusted signers. All
of them share the same lifecycle: request, approve, specialise.

This guide covers the generic device lifecycle — the three-step
onboarding chain, the per-device configuration bundle, managing the
device list, and retirement. Specialised device roles have their own
guides:

- [Storage device management](/guides/storage-device-management.html)
  — registering devices that hold encrypted blobs.
- [Voting-gated operations](/guides/voting-gated-operations.html) —
  promoting a device to an authenticator for real-time voting.

## Device types

- **Storage device.** Persists encrypted chunks on the engine's behalf
  and serves retrievals.
- **Authenticator device.** Receives ballots and replies yes/no for
  voting-gated operations.
- **Generic signer.** A device registered without a specialised role,
  used for multi-device authentication workflows (e.g. an owner's
  second phone).

Every device has its own Curve25519 keypair — distinct from the
owning profile's primary key — so revoking or rotating one device's
credentials doesn't disturb the rest of the profile's keys.

## The three-step onboarding chain

Every device, regardless of specialisation, goes through the same
first three steps under the owning profile's authorization token:

### 1. Request a device id

```bash
curl -X POST {{apiUrl}}/device/request-device-id \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'deviceName=phone-a'
# → 202 { commandId }
```

Asynchronous — await the `X-DPT-CAB-ID` ack.

### 2. Retrieve the id once the ack lands

```bash
curl {{apiUrl}}/device/retrieve-device-id/{commandId} \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…'
# → { deviceId: "dev-…" }
```

The `deviceId` is the handle used for everything else.

### 3. Approve the device

```bash
curl -X POST {{apiUrl}}/device/approve-device \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…' \
  --data-urlencode 'deviceId=dev-…'
```

Approval is the owner's explicit consent: the device is now active
under the profile. Until this call lands, the device can't do
anything useful.

:::info[Rejecting instead of approving]
If you decide mid-flow not to trust a device (e.g. you see a request
for a device you don't recognise on an account-management UI), reject
it with `POST /device/reject-device` — the record is deleted and the
pending credentials are discarded.
:::

## Specialise the device

After approval, you can promote the device to a specialised role.
See the linked guides for the specifics:

- [Register as a storage device](/guides/storage-device-management.html#step-2-promote-to-storage)
- [Register as an authenticator](/guides/voting-gated-operations.html#step-1-register-an-authenticator-device)

A single device can hold at most one role at a time.

## Download the device configuration

Any device that needs to subscribe to RabbitMQ (storage, authenticator)
needs its configuration bundle — AMQP host, vhost, per-device
credentials, routing key. Fetch it with:

```bash
curl -X POST {{apiUrl}}/device/download-device-configuration \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…' \
  --data-urlencode 'deviceId=dev-…'
```

The response is the file the reference device implementations expect
on startup. Ship it alongside the device binary and restart.

:::warning[Treat configurations like credentials]
The bundle contains AMQP credentials that grant the holder read/write
access to a slice of your profile's internal traffic. Store it with
the same care as API keys — never commit it, never log it, and
rotate it if it leaks.
:::

## Listing and managing devices

See the devices currently registered under your profile:

```bash
curl {{apiUrl}}/device/retrieve-profile-devices \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…'
```

Each record includes the device id, friendly name, type, approval
state, and creation time.

Attach or update device-level metadata (display name, tags,
operator-level notes — anything your ops tooling needs) with:

```bash
curl -X POST {{apiUrl}}/device/configure-device-meta \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'deviceId=dev-…' \
  --data-urlencode 'displayName=Phone — Alice' \
  --data-urlencode 'tags=production,primary'
```

## Removing a device

When a device is retired or compromised:

```bash
curl -X POST {{apiUrl}}/device/remove-device \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…' \
  --data-urlencode 'deviceId=dev-…'
```

The engine:

- Invalidates the device's credentials immediately.
- Stops routing traffic to it.
- Deregisters any specialised role (storage, authenticator) the
  device held.

Existing chunks on a removed storage device's disk are **not**
reclaimed by the engine — handle physical decommissioning separately.

## Mobile pairing via QR

For consumer-facing flows, pairing a mobile device over QR skips the
three-step chain entirely: the profile owner generates a QR token on
an already-signed-in session, and the mobile app scans it to
auto-register. Generate the token with:

```bash
curl -X POST {{apiUrl}}/profile/generate-qr-token-for-authorization \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…'
```

The app runs request-device-id / approve-device / role-specialise in
the background. This is what the Privicore mobile authenticator apps
use.

Endpoints used in this guide, for reference:

- [`POST /device/request-device-id`](/reference/#tag/device/operation/device.request-device-id)
- [`GET /device/retrieve-device-id/{commandId}`](/reference/#tag/device/operation/device.retrieve-device-id)
- [`POST /device/approve-device`](/reference/#tag/device/operation/device.approve-device)
- [`POST /device/reject-device`](/reference/#tag/device/operation/device.reject-device)
- [`POST /device/download-device-configuration`](/reference/#tag/device/operation/device.download-device-configuration)
- [`GET /device/retrieve-profile-devices`](/reference/#tag/device/operation/device.retrieve-profile-devices)
- [`POST /device/configure-device-meta`](/reference/#tag/device/operation/device.configure-device-meta)
- [`POST /device/remove-device`](/reference/#tag/device/operation/device.remove-device)
- [`POST /profile/generate-qr-token-for-authorization`](/reference/#tag/profile/operation/profile.generate-qr-token-for-authorization)
