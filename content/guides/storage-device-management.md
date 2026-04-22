# Storage Device Management

A **storage device** is a process that holds your encrypted blobs on
behalf of a Privicore profile. The engine itself never stores payloads;
every store, retrieve, and delete is forwarded to every storage device
registered under the profile. Until you register at least one device,
calls to [`exchange-data-for-token`](/reference/#tag/data-token/operation/data-token.exchange-data-for-token)
have nowhere to land and will not complete.

This guide walks through registering a device as a storage device,
fetching the credentials it needs to connect, and understanding the
traffic it will see at runtime.

## What a storage device is

A storage device is a small service that persists the encrypted blobs
the engine hands it. Privicore ships reference storage devices; you
register one (or more) under your profile and the engine takes care
of the rest — routing stores to them, serving retrievals, propagating
deletes. Each device re-encrypts the chunks it receives under a
device-local at-rest key, giving you the third layer described in the
[encryption model](/guides/protocol-overview.html#the-encryption-model).

:::info[Recommended device count]
Privicore's architecture assumes you register **at least three** storage
devices per profile. Every store fans out to every device, so three
gives you redundancy against single-device loss without amplifying
costs too far. A profile with a single device has no resilience.
:::

## Step 1. Register the device

A storage device begins as any other device. Request an id, approve it,
and then promote it to a storage role:

```bash
# 1. Request a new device id under your profile.
curl -X POST {{apiUrl}}/device/request-device-id \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'deviceName=storage-a'
# → 202 { commandId }

# 2. Retrieve the id once the async ack has arrived.
curl {{apiUrl}}/device/retrieve-device-id/{commandId} \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…'
# → { deviceId: "dev-…" }

# 3. Approve the device (owner consent).
curl -X POST {{apiUrl}}/device/approve-device \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…' \
  --data-urlencode 'deviceId=dev-…'
```

## Step 2. Promote to storage

With the device approved, register it as a storage device. This tells
the engine that future stores should fan out to it:

```bash
curl -X POST {{apiUrl}}/storage/register-storage-device \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'deviceId=dev-…'
```

The device is now live in the fan-out — but it still has nothing to
connect to the broker with.

## Step 3. Download the device configuration

The device's RabbitMQ credentials live inside a Privicore-signed
configuration bundle. Fetch it with:

```bash
curl -X POST {{apiUrl}}/device/download-device-configuration \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…' \
  --data-urlencode 'deviceId=dev-…'
```

The response is the configuration bundle the reference device
implementations expect — the credentials and connection details the
device needs to receive traffic from the engine. Provision this file
alongside the device binary and start the service.

:::warning[Treat the configuration as a secret]
The device configuration contains credentials that let a process read
and write your profile's storage traffic. Store it with the same care
as an API key, rotate it if it leaks, and never commit it to a
repository.
:::

## Step 4. Verify the device is live

Once the device is running and subscribed to its queue, confirm the
engine sees it:

```bash
curl {{apiUrl}}/storage/list-storage-devices \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…'
```

Expect your device to appear. Now issue a normal
[store-and-retrieve](/guides/store-and-retrieve.html) round-trip — the
engine fans the store out to every registered device, including this
one.

## What happens at runtime

Every successful exchange publishes to all registered devices in
parallel; each writes the chunk to its local storage under a
device-local at-rest key. Retrievals are served by whichever device
responds first. Deletes propagate to every device, so removing a token
from the engine reliably removes it from storage.

## Removing a device

When a device is retired or replaced, deregister it so new stores stop
fanning out to a dead endpoint:

```bash
curl -X POST {{apiUrl}}/storage/remove-storage \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…' \
  --data-urlencode 'deviceId=dev-…'
```

The engine stops publishing to the device's queue immediately. Existing
chunks remain on the device's disk until you reclaim it by other means.

Endpoints used in this guide, for reference:

- [`POST /device/request-device-id`](/reference/#tag/device/operation/device.request-device-id)
- [`GET /device/retrieve-device-id/{commandId}`](/reference/#tag/device/operation/device.retrieve-device-id)
- [`POST /device/approve-device`](/reference/#tag/device/operation/device.approve-device)
- [`POST /storage/register-storage-device`](/reference/#tag/storage/operation/storage.register-storage-device)
- [`POST /device/download-device-configuration`](/reference/#tag/device/operation/device.download-device-configuration)
- [`GET /storage/list-storage-devices`](/reference/#tag/storage/operation/storage.list-storage-devices)
- [`POST /storage/remove-storage`](/reference/#tag/storage/operation/storage.remove-storage)
