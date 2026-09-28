"use strict";

/**
 * Pure JavaScript Base64 and Base64URL encoder/decoder.
 * Compatible with UXP, browsers, and Node.js without Buffer dependency.
 */

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_LOOKUP = new Uint8Array(256);
for (let i = 0; i < B64_CHARS.length; i++) {
  B64_LOOKUP[B64_CHARS.charCodeAt(i)] = i;
}

/**
 * Decodes standard Base64 string to Uint8Array.
 * Strictly validates padding and characters.
 * @param {string} b64Str
 * @returns {Uint8Array}
 */
function base64ToBytes(b64Str) {
  if (typeof b64Str !== "string") {
    throw new Error("Invalid base64 input: must be a string");
  }

  // Remove whitespace
  const clean = b64Str.replace(/\s+/g, "");
  if (clean.length % 4 !== 0) {
    throw new Error("Invalid base64 length");
  }

  // Validate characters
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) {
    throw new Error("Invalid base64 characters");
  }

  let pad = 0;
  if (clean.endsWith("==")) {
    pad = 2;
  } else if (clean.endsWith("=")) {
    pad = 1;
  }

  const byteLength = (clean.length * 3) / 4 - pad;
  const bytes = new Uint8Array(byteLength);

  let byteIdx = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64_LOOKUP[clean.charCodeAt(i)];
    const c1 = B64_LOOKUP[clean.charCodeAt(i + 1)];
    const c2 = clean[i + 2] === "=" ? 0 : B64_LOOKUP[clean.charCodeAt(i + 2)];
    const c3 = clean[i + 3] === "=" ? 0 : B64_LOOKUP[clean.charCodeAt(i + 3)];

    const chunk = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;

    if (byteIdx < byteLength) bytes[byteIdx++] = (chunk >> 16) & 0xff;
    if (byteIdx < byteLength) bytes[byteIdx++] = (chunk >> 8) & 0xff;
    if (byteIdx < byteLength) bytes[byteIdx++] = chunk & 0xff;
  }

  return bytes;
}

/**
 * Encodes Uint8Array or Array of bytes to standard Base64 string.
 * @param {Uint8Array|Array<number>} bytes
 * @returns {string}
 */
function bytesToBase64(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    bytes = new Uint8Array(bytes);
  }

  let out = "";
  const len = bytes.length;
  let i = 0;

  for (; i + 2 < len; i += 3) {
    const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64_CHARS[(chunk >> 18) & 0x3f];
    out += B64_CHARS[(chunk >> 12) & 0x3f];
    out += B64_CHARS[(chunk >> 6) & 0x3f];
    out += B64_CHARS[chunk & 0x3f];
  }

  if (i < len) {
    const rem = len - i;
    if (rem === 1) {
      const chunk = bytes[i] << 16;
      out += B64_CHARS[(chunk >> 18) & 0x3f];
      out += B64_CHARS[(chunk >> 12) & 0x3f];
      out += "==";
    } else if (rem === 2) {
      const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out += B64_CHARS[(chunk >> 18) & 0x3f];
      out += B64_CHARS[(chunk >> 12) & 0x3f];
      out += B64_CHARS[(chunk >> 6) & 0x3f];
      out += "=";
    }
  }

  return out;
}

/**
 * Decodes base64url string to Uint8Array.
 * @param {string} b64UrlStr
 * @returns {Uint8Array}
 */
function base64UrlToBytes(b64UrlStr) {
  if (typeof b64UrlStr !== "string") {
    throw new Error("Invalid base64url input: must be a string");
  }

  let base64 = b64UrlStr.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  if (pad === 2) {
    base64 += "==";
  } else if (pad === 3) {
    base64 += "=";
  } else if (pad === 1) {
    throw new Error("Illegal base64url length");
  }

  return base64ToBytes(base64);
}

/**
 * Encodes bytes to unpadded base64url string.
 * @param {Uint8Array|Array<number>} bytes
 * @returns {string}
 */
function bytesToBase64Url(bytes) {
  const b64 = bytesToBase64(bytes);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Converts UTF-8 string to Uint8Array.
 * @param {string} str
 * @returns {Uint8Array}
 */
function utf8ToBytes(str) {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(str);
  }
  // Fallback if TextEncoder is unavailable in older hosts
  const utf8 = [];
  for (let i = 0; i < str.length; i++) {
    let charcode = str.charCodeAt(i);
    if (charcode < 0x80) utf8.push(charcode);
    else if (charcode < 0x800) {
      utf8.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f));
    } else if (charcode < 0xd800 || charcode >= 0xe000) {
      utf8.push(
        0xe0 | (charcode >> 12),
        0x80 | ((charcode >> 6) & 0x3f),
        0x80 | (charcode & 0x3f)
      );
    } else {
      // surrogate pair
      i++;
      charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
      utf8.push(
        0xf0 | (charcode >> 18),
        0x80 | ((charcode >> 12) & 0x3f),
        0x80 | ((charcode >> 6) & 0x3f),
        0x80 | (charcode & 0x3f)
      );
    }
  }
  return new Uint8Array(utf8);
}

/**
 * Converts Uint8Array to UTF-8 string.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToUtf8(bytes) {
  if (!bytes) return "";
  if (typeof TextDecoder !== "undefined") {
    try {
      return new TextDecoder("utf-8").decode(bytes);
    } catch {
      // Fallback if TextDecoder fails on specific byte sequences
    }
  }
  // Fallback if TextDecoder is unavailable
  let out = "";
  let i = 0;
  const len = bytes.length;
  while (i < len) {
    const c = bytes[i++];
    if (c < 0x80) {
      out += String.fromCharCode(c);
    } else if (c >= 0xc0 && c < 0xe0) {
      if (i < len) {
        const c2 = bytes[i++];
        out += String.fromCharCode(((c & 0x1f) << 6) | (c2 & 0x3f));
      }
    } else if (c >= 0xe0 && c < 0xf0) {
      if (i + 1 < len) {
        const c2 = bytes[i++];
        const c3 = bytes[i++];
        out += String.fromCharCode(((c & 0x0f) << 12) | ((c2 & 0x3f) << 6) | (c3 & 0x3f));
      } else {
        break;
      }
    } else if (c >= 0xf0 && c < 0xf8) {
      if (i + 2 < len) {
        const c2 = bytes[i++];
        const c3 = bytes[i++];
        const c4 = bytes[i++];
        let u = (((c & 0x07) << 18) | ((c2 & 0x3f) << 12) | ((c3 & 0x3f) << 6) | (c4 & 0x3f)) - 0x10000;
        out += String.fromCharCode(0xd800 + (u >> 10), 0xdc00 + (u & 0x3ff));
      } else {
        break;
      }
    }
    // Any unexpected or trailing byte is skipped safely
  }
  return out;
}

module.exports = {
  base64ToBytes,
  bytesToBase64,
  base64UrlToBytes,
  bytesToBase64Url,
  utf8ToBytes,
  bytesToUtf8
};
