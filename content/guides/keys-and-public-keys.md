# Keys and Public Keys

Every active profile has exactly one registered public key, and every
encrypted byte that passes through Privicore is protected by key
material you or the engine controls. This guide covers the key format,
how to generate valid keys, how to register and retrieve them, and how
to fetch the engine's own public key for messages you want to encrypt
*to* the server.

The bootstrap registration of your first public key is walked through
in [Getting started](/guides/getting-started.html). This page goes
deeper: the signed-key wire format, multi-device keys, and the engine
public key.

## The signed-key format

Privicore public keys on the wire are a **signed, versioned blob**, not
bare Curve25519 bytes. The structure is:

```
[4 bytes: Privicore version tag][32 bytes: Curve25519 public key][64 bytes: integrity hash]
Total: 100 bytes (200 hex characters)
```

The version tag is a fixed 4-byte constant; the integrity hash is
taken over `[version tag || public key]` and appended. The engine
refuses to register a key whose hash doesn't match.

## Generating a key pair

The canonical implementation uses `tweetnacl` for Curve25519 and
`@noble/hashes` for BLAKE2b:

```js
import nacl from "tweetnacl";
import { blake2b } from "@noble/hashes/blake2b";

function generateSignedKeyPair() {
  const keyPair = nacl.box.keyPair();
  const versionTag = new Uint8Array([0x31, 0x42, 0x05, 0x00]);

  // [version || public key]
  const versioned = new Uint8Array(versionTag.length + keyPair.publicKey.length);
  versioned.set(versionTag);
  versioned.set(keyPair.publicKey, versionTag.length);

  // BLAKE2b-64 over [version || public key]
  const hash = blake2b(versioned, { dkLen: 64 });

  // Final signed public key
  const signed = new Uint8Array(versioned.length + hash.length);
  signed.set(versioned);
  signed.set(hash, versioned.length);

  return {
    privateKey: keyPair.secretKey,                    // 32 bytes — keep secret
    publicKey: keyPair.publicKey,                     // 32 bytes — raw
    signedPublicKey: Buffer.from(signed).toString("hex"), // 200 hex chars — for registration
  };
}
```

Ports to Python (`PyNaCl`), Go (`golang.org/x/crypto/nacl/box`), Rust
(`sodiumoxide`), and PHP (`libsodium`) follow the same structure. The
only Privicore-specific wrinkle is the version-tag-and-hash wrapping;
the underlying keypair is plain Curve25519.

:::info[Deterministic keys]
For test harnesses or automated provisioning you can derive a
keypair from a seed instead of a random generator: hash the seed to
32 bytes with BLAKE2b, then pass it to
`nacl.box.keyPair.fromSecretKey(seed32)`. The rest of the signing
pipeline is identical.
:::

## Registering a key

See [Getting started → Register your public key](/guides/getting-started.html#step-2-register-your-public-key)
for the first-time registration of a profile's primary key. The wire
call is:

```bash
curl -X POST {{apiUrl}}/public-key/register-public-key \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'username=alice@example.com' \
  --data-urlencode 'password=correct-horse-battery-staple' \
  --data-urlencode 'publicKey=<200 hex chars>'
```

Registration is asynchronous; await the `X-DPT-CAB-ID` ack. A
successful registration activates the profile.

## Retrieving your public key

Fetch your own registered key for verification or re-distribution:

```bash
curl {{apiUrl}}/public-key/retrieve-public-key \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…'
```

Response:

```json
{ "publicKey": "31420500…" }
```

The return is the same 200-character signed hex format you registered.

## The engine's public key

When you need to verify server-signed responses, fetch the engine's
own public key:

```bash
curl {{apiUrl}}/public-key/retrieve-cab-public-key \
  -H 'X-DPT-AUTHORIZATION: T-MUIFA…'
```

Response is the same 200-character signed format. Verify the hash
before using it, and rotate your cached copy periodically.

:::warning[Do not hardcode the engine public key]
The engine public key can rotate. Hardcoding it will silently break
your client when it changes. Cache it with a short TTL and refetch on
verification failure.
:::

## Device keys

Registered devices (storage devices, authenticators) each have their
own keypair distinct from the owning profile's primary key. Device
keys are issued as part of the device configuration bundle returned by
`POST /device/download-device-configuration` — your device
implementation loads them at startup.

When a device encrypts or signs its own outbound messages, it uses
its device key; when the engine verifies those messages, it looks up
the registered device key, not the profile key. This lets you
revoke or rotate a single device's credentials without disturbing the
rest of the profile.

## Security hygiene

- **Private keys never leave the process that generated them.** Not
  in a backup, not in a log, not in an env var exposed to another
  service.
- **Keep the signed hex format opaque.** Don't try to split, slice,
  or rewrite it; round-trip through the generation pipeline only.
- **Treat device configuration bundles with the same care as private
  keys.** They contain the device's signing material.

Endpoints used in this guide, for reference:

- [`POST /public-key/register-public-key`](/reference/#tag/public-key/operation/public-key.register-public-key)
- [`GET /public-key/retrieve-public-key`](/reference/#tag/public-key/operation/public-key.retrieve-public-key)
- [`GET /public-key/retrieve-cab-public-key`](/reference/#tag/public-key/operation/public-key.retrieve-cab-public-key)
