"use strict";

const { base64UrlToBytes, utf8ToBytes, bytesToUtf8 } = require("./base64");
const { verifyEd25519 } = require("./ed25519Verifier");
const config = require("../productionConfig");

const TOKEN_PREFIX = "MM1";
const EXPECTED_ISSUER = "mm-license-server";
const EXPECTED_PLUGIN_ID = "in.memorymaker.albumplacer";
const ENTITLEMENT_SLUG_REGEX = /^[a-z0-9_-]{1,64}$/;
const MAX_ENTITLEMENTS = 32;

/**
 * Validates and normalizes token entitlements array.
 * @param {*} rawEntitlements
 * @returns {string[]} sorted, validated array of unique slugs
 * @throws {Error} if invalid
 */
function validateEntitlements(rawEntitlements) {
  if (rawEntitlements === undefined || rawEntitlements === null) {
    return [];
  }
  if (!Array.isArray(rawEntitlements)) {
    throw new Error("Invalid entitlements: expected array");
  }
  if (rawEntitlements.length > MAX_ENTITLEMENTS) {
    throw new Error(`Too many entitlements: max ${MAX_ENTITLEMENTS}`);
  }

  const seen = new Set();
  for (let i = 0; i < rawEntitlements.length; i++) {
    const slug = rawEntitlements[i];
    if (typeof slug !== "string" || !ENTITLEMENT_SLUG_REGEX.test(slug)) {
      throw new Error(`Invalid entitlement slug at index ${i}`);
    }
    if (seen.has(slug)) {
      throw new Error(`Duplicate entitlement slug: ${slug}`);
    }
    seen.add(slug);
  }

  // Verify canonical deterministic sort order
  const sorted = [...rawEntitlements].sort();
  for (let i = 0; i < rawEntitlements.length; i++) {
    if (rawEntitlements[i] !== sorted[i]) {
      throw new Error("Entitlements array is not canonically sorted");
    }
  }

  return rawEntitlements;
}

/**
 * Verifies an MM1 token against the configured public key.
 *
 * @param {string} tokenString
 * @param {object} [options]
 * @param {string} [options.expectedDeviceHash] If provided, enforces device binding
 * @param {string} [options.expectedKid] Defaults to config.SIGNING_KEY_ID
 * @param {string} [options.publicKeySpki] Defaults to config.SIGNING_PUBLIC_KEY_SPKI_B64
 * @returns {{ ok: boolean, payload?: object, error?: string }}
 */
function verifyToken(tokenString, options = {}) {
  if (typeof tokenString !== "string" || !tokenString.trim()) {
    return { ok: false, error: "EMPTY_TOKEN" };
  }

  const parts = tokenString.trim().split(".");
  if (parts.length !== 4) {
    return { ok: false, error: "MALFORMED_TOKEN_STRUCTURE" };
  }

  const [prefix, kid, payloadB64Url, sigB64Url] = parts;

  if (prefix !== TOKEN_PREFIX) {
    return { ok: false, error: "INVALID_TOKEN_PREFIX" };
  }

  const expectedKid = options.expectedKid || config.SIGNING_KEY_ID;
  if (!kid || kid !== expectedKid) {
    return { ok: false, error: "UNEXPECTED_KEY_ID" };
  }

  let sigBytes;
  try {
    sigBytes = base64UrlToBytes(sigB64Url);
  } catch {
    return { ok: false, error: "MALFORMED_SIGNATURE_ENCODING" };
  }

  if (sigBytes.length !== 64) {
    return { ok: false, error: "INVALID_SIGNATURE_LENGTH" };
  }

  const signedContentString = `${prefix}.${kid}.${payloadB64Url}`;
  const signedContentBytes = utf8ToBytes(signedContentString);

  const publicKey = options.publicKeySpki || config.SIGNING_PUBLIC_KEY_SPKI_B64;
  const signatureValid = verifyEd25519(signedContentBytes, sigBytes, publicKey);
  if (!signatureValid) {
    return { ok: false, error: "SIGNATURE_VERIFICATION_FAILED" };
  }

  // Signature is verified; now decode and validate untrusted JSON payload
  let payloadJson;
  try {
    const payloadBytes = base64UrlToBytes(payloadB64Url);
    const jsonStr = bytesToUtf8(payloadBytes);
    payloadJson = JSON.parse(jsonStr);
  } catch {
    return { ok: false, error: "MALFORMED_PAYLOAD_JSON" };
  }

  if (!payloadJson || typeof payloadJson !== "object" || Array.isArray(payloadJson)) {
    return { ok: false, error: "INVALID_PAYLOAD_SCHEMA" };
  }

  if (payloadJson.v !== 1) {
    return { ok: false, error: "UNSUPPORTED_TOKEN_VERSION" };
  }

  if (payloadJson.iss !== EXPECTED_ISSUER) {
    return { ok: false, error: "INVALID_TOKEN_ISSUER" };
  }

  if (payloadJson.pluginId !== EXPECTED_PLUGIN_ID) {
    return { ok: false, error: "INVALID_TOKEN_PLUGIN_ID" };
  }

  if (typeof payloadJson.licenseId !== "string" || !payloadJson.licenseId) {
    return { ok: false, error: "INVALID_LICENSE_ID" };
  }

  if (typeof payloadJson.activationId !== "string" || !payloadJson.activationId) {
    return { ok: false, error: "INVALID_ACTIVATION_ID" };
  }

  if (typeof payloadJson.deviceHash !== "string" || !payloadJson.deviceHash) {
    return { ok: false, error: "INVALID_DEVICE_HASH" };
  }

  if (options.expectedDeviceHash && payloadJson.deviceHash !== options.expectedDeviceHash) {
    return { ok: false, error: "DEVICE_MISMATCH" };
  }

  if (typeof payloadJson.plan !== "string" || !payloadJson.plan) {
    return { ok: false, error: "INVALID_PLAN" };
  }

  // Validate timestamps (all must be positive integers / Unix seconds)
  const tsFields = ["issuedAt", "refreshAfter", "graceUntil", "expiresAt"];
  for (const field of tsFields) {
    const val = payloadJson[field];
    if (typeof val !== "number" || !Number.isFinite(val) || val <= 0) {
      return { ok: false, error: `INVALID_TIMESTAMP_${field.toUpperCase()}` };
    }
  }

  // Validate entitlements
  let validatedEntitlements;
  try {
    validatedEntitlements = validateEntitlements(payloadJson.entitlements);
  } catch (err) {
    return { ok: false, error: `INVALID_ENTITLEMENTS: ${err?.message || err}` };
  }

  const trustedPayload = Object.freeze({
    v: payloadJson.v,
    iss: payloadJson.iss,
    pluginId: payloadJson.pluginId,
    licenseId: payloadJson.licenseId,
    activationId: payloadJson.activationId,
    deviceHash: payloadJson.deviceHash,
    plan: payloadJson.plan,
    entitlements: validatedEntitlements,
    issuedAt: payloadJson.issuedAt,
    refreshAfter: payloadJson.refreshAfter,
    graceUntil: payloadJson.graceUntil,
    expiresAt: payloadJson.expiresAt
  });

  return { ok: true, payload: trustedPayload };
}

module.exports = {
  verifyToken,
  validateEntitlements,
  TOKEN_PREFIX,
  EXPECTED_ISSUER,
  EXPECTED_PLUGIN_ID
};
