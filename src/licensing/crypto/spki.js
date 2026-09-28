"use strict";

const { base64ToBytes } = require("./base64");

/**
 * Strict Ed25519 SPKI DER Parser.
 *
 * An Ed25519 SubjectPublicKeyInfo (SPKI) in DER representation is exactly 44 bytes:
 *
 * Sequence (0x30, length 0x2a = 42 bytes):
 *   Sequence (0x30, length 0x05):
 *     OID 1.3.101.112 (id-Ed25519) -> 0x06, 0x03, 0x2b, 0x65, 0x70
 *   Bit String (0x03, length 0x21 = 33 bytes):
 *     0x00 (0 unused bits)
 *     32 bytes of raw Ed25519 public key
 *
 * Header prefix hex: 302a300506032b6570032100 (12 bytes)
 */
const EXPECTED_ED25519_SPKI_HEADER = new Uint8Array([
  0x30, 0x2a, // SEQUENCE, len 42
  0x30, 0x05, // SEQUENCE, len 5
  0x06, 0x03, 0x2b, 0x65, 0x70, // OID 1.3.101.112 (id-Ed25519)
  0x03, 0x21, 0x00 // BIT STRING, len 33, 0 unused bits
]);

const SPKI_DER_TOTAL_LENGTH = 44;
const RAW_KEY_LENGTH = 32;

/**
 * Parses an Ed25519 public key in Base64 SPKI format and returns the 32-byte raw public key.
 * Strictly validates the DER structure, algorithm OID, and length.
 *
 * @param {string} spkiBase64
 * @returns {Uint8Array} 32-byte raw Ed25519 public key
 * @throws {Error} If base64 is malformed, SPKI header is invalid, or key length is wrong.
 */
function parseEd25519Spki(spkiBase64) {
  if (typeof spkiBase64 !== "string" || !spkiBase64.trim()) {
    throw new Error("Invalid SPKI public key: must be a non-empty string");
  }

  const derBytes = base64ToBytes(spkiBase64.trim());

  if (derBytes.length !== SPKI_DER_TOTAL_LENGTH) {
    throw new Error(
      `Invalid SPKI DER length: expected ${SPKI_DER_TOTAL_LENGTH} bytes, got ${derBytes.length}`
    );
  }

  for (let i = 0; i < EXPECTED_ED25519_SPKI_HEADER.length; i++) {
    if (derBytes[i] !== EXPECTED_ED25519_SPKI_HEADER[i]) {
      throw new Error("Invalid SPKI header: not an Ed25519 SubjectPublicKeyInfo");
    }
  }

  const rawKey = derBytes.subarray(EXPECTED_ED25519_SPKI_HEADER.length);
  if (rawKey.length !== RAW_KEY_LENGTH) {
    throw new Error(
      `Invalid raw Ed25519 key length: expected ${RAW_KEY_LENGTH} bytes, got ${rawKey.length}`
    );
  }

  return rawKey;
}

module.exports = {
  parseEd25519Spki,
  parseSpkiEd25519PublicKey: parseEd25519Spki,
  EXPECTED_ED25519_SPKI_HEADER,
  SPKI_DER_TOTAL_LENGTH,
  RAW_KEY_LENGTH
};
