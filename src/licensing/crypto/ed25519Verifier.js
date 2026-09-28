"use strict";

const nacl = require("./tweetnacl");
const { parseEd25519Spki } = require("./spki");

/**
 * Verifies an Ed25519 signature over a message using a raw 32-byte public key
 * or a Base64-encoded SPKI string.
 *
 * @param {Uint8Array} messageBytes
 * @param {Uint8Array} signatureBytes (must be 64 bytes)
 * @param {Uint8Array|string} publicKey (32 raw bytes or Base64 SPKI string)
 * @returns {boolean} true if valid, false otherwise
 */
function verifyEd25519(messageBytes, signatureBytes, publicKey) {
  try {
    if (!(messageBytes instanceof Uint8Array)) {
      return false;
    }
    if (!(signatureBytes instanceof Uint8Array) || signatureBytes.length !== 64) {
      return false;
    }

    let rawPublicKeyBytes;
    if (typeof publicKey === "string") {
      rawPublicKeyBytes = parseEd25519Spki(publicKey);
    } else if (publicKey instanceof Uint8Array && publicKey.length === 32) {
      rawPublicKeyBytes = publicKey;
    } else {
      return false;
    }

    return nacl.sign.detached.verify(messageBytes, signatureBytes, rawPublicKeyBytes);
  } catch {
    return false;
  }
}

module.exports = {
  verifyEd25519
};
