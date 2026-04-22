/**
 * Signed-public-key generation for probes that need to register a
 * fresh profile key. Matches the canonical implementation documented
 * in `content/guides/keys-and-public-keys.md`.
 *
 * Wire format:
 *   [4 bytes: version tag][32 bytes: Curve25519 pubkey][64 bytes: integrity hash]
 *   Total: 100 bytes → 200 hex chars.
 */

import nacl from "tweetnacl";
import { blake2b } from "@noble/hashes/blake2.js";

const VERSION_TAG = new Uint8Array([0x31, 0x42, 0x05, 0x00]);

export interface SignedKeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  /** 200-hex-character signed public key ready for register-public-key. */
  signedPublicKeyHex: string;
}

export function generateSignedKeyPair(): SignedKeyPair {
  const { publicKey, secretKey } = nacl.box.keyPair();
  return {
    privateKey: secretKey,
    publicKey,
    signedPublicKeyHex: toSignedHex(publicKey),
  };
}

function toSignedHex(pubkey: Uint8Array): string {
  const versioned = new Uint8Array(VERSION_TAG.length + pubkey.length);
  versioned.set(VERSION_TAG);
  versioned.set(pubkey, VERSION_TAG.length);
  const hash = blake2b(versioned, { dkLen: 64 });
  const full = new Uint8Array(versioned.length + hash.length);
  full.set(versioned);
  full.set(hash, versioned.length);
  return Buffer.from(full).toString("hex");
}
