"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { verifyEd25519 } = require("../src/licensing/crypto/ed25519Verifier");
const { parseSpkiEd25519PublicKey, ED25519_SPKI_PREFIX_BYTES } = require("../src/licensing/crypto/spki");
const { base64UrlEncode, base64UrlDecode, utf8ToBytes, bytesToUtf8 } = require("../src/licensing/crypto/base64");
const {
  verifyToken,
  parseTokenStructure,
  validatePayloadSchema,
  validateEntitlements
} = require("../src/licensing/crypto/tokenVerifier");
const { createLicenseApiClient } = require("../src/licensing/licenseApi");
const { createLicenseStorage } = require("../src/licensing/licenseStorage");
const { STORAGE_KEYS, PLUGIN_VERSION } = require("../src/licensing/constants");
const {
  LicenseManager,
  createLicenseManager,
  getLicenseManager,
  resetLicenseManager,
  SAFE_USER_MESSAGES
} = require("../src/licensing/licenseManager");
const { LICENSE_STATES, isOperationalState } = require("../src/licensing/licenseState");
const { getInstallationDeviceId, generateFallbackRandomId } = require("../src/licensing/deviceId");
const PRODUCTION_CONFIG = require("../src/licensing/productionConfig");
const mainModule = require("../main");

function toMockBytes(v) {
  if (v == null) return null;
  if (v instanceof Uint8Array) return v;
  if (typeof v === "string") {
    return new TextEncoder().encode(v);
  }
  if (ArrayBuffer.isView(v)) {
    return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  }
  return v;
}

/**
 * Creates in-memory secure storage for testing.
 * Mimics real Adobe UXP secureStorage by storing and returning Uint8Array.
 */
function createMockStorage(initial = {}) {
  const store = new Map();
  for (const [k, v] of Object.entries(initial)) {
    if (v == null) continue;
    store.set(k, toMockBytes(v));
  }
  return {
    async getItem(k) {
      if (!store.has(k)) return null;
      const v = store.get(k);
      return v != null ? toMockBytes(v) : null;
    },
    async setItem(k, v) { store.set(k, toMockBytes(v)); },
    async removeItem(k) { store.delete(k); },
    _store: store
  };
}

/**
 * Helper to generate ephemeral Ed25519 keypair and create valid MM1 tokens in tests.
 */
function generateTestKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const spkiDer = publicKey.export({ type: "spki", format: "der" });
  const spkiB64 = spkiDer.toString("base64");
  return { publicKey, privateKey, spkiB64 };
}

function signTestToken(kid, payload, privateKey) {
  const payloadJson = JSON.stringify(payload);
  const payloadB64Url = Buffer.from(payloadJson, "utf8").toString("base64url");
  const msg = `MM1.${kid}.${payloadB64Url}`;
  const sigBytes = crypto.sign(null, Buffer.from(msg, "utf8"), privateKey);
  const sigB64Url = sigBytes.toString("base64url");
  return `${msg}.${sigB64Url}`;
}

// =============================================================================
// 1. MANIFEST & CONFIGURATION VALIDATION
// =============================================================================

test("V2-1. manifest network permissions are strictly limited to Worker domain and not 'all'", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../manifest.json"), "utf8")
  );
  assert.equal(manifest.id, "9beaddeb");
  assert.equal(manifest.version, "1.4.2");
  assert.equal(PLUGIN_VERSION, manifest.version, "runtime PLUGIN_VERSION must match manifest.version");

  const indexHtml = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.ok(
    indexHtml.includes(`<span class="version">v${manifest.version}</span>`) || indexHtml.includes(`<span class="version">v${manifest.version} DEV</span>`),
    "index.html must display visible version matching manifest"
  );

  assert.equal(manifest.requiredPermissions?.localFileSystem, "fullAccess");
  assert.ok(manifest.requiredPermissions?.network, "Manifest must include network permission");
  assert.notEqual(manifest.requiredPermissions.network.domains, "all", "network.domains must NOT be 'all'");
  assert.deepEqual(
    manifest.requiredPermissions.network.domains,
    ["https://mm-license-server.rammonihalder.workers.dev"]
  );
});

test("V2-2. production configuration strictly validates public key, key ID, and https base URL", () => {
  assert.ok(PRODUCTION_CONFIG.API_BASE_URL.startsWith("https://"));
  assert.ok(PRODUCTION_CONFIG.SIGNING_KEY_ID.length > 0);
  assert.ok(PRODUCTION_CONFIG.SIGNING_PUBLIC_KEY_SPKI_B64.length > 0);

  // Validate that the production public key correctly parses as 32-byte Ed25519 raw key
  const parsed = parseSpkiEd25519PublicKey(PRODUCTION_CONFIG.SIGNING_PUBLIC_KEY_SPKI_B64);
  assert.equal(parsed.length, 32);
});

test("V2-3. security check: no private keys, admin secrets, or owner bypasses in codebase", () => {
  const filesToScan = [
    "../manifest.json",
    "../main.js",
    "../src/licensing/productionConfig.js",
    "../src/licensing/constants.js",
    "../src/licensing/licenseState.js",
    "../src/licensing/licenseStorage.js",
    "../src/licensing/licenseManager.js",
    "../src/licensing/licenseApi.js",
    "../src/licensing/deviceId.js",
    "../src/licensing/crypto/spki.js",
    "../src/licensing/crypto/ed25519Verifier.js",
    "../src/licensing/crypto/tokenVerifier.js",
    "../src/licensing/crypto/base64.js",
    "../src/licensing/crypto/tweetnacl.js"
  ];

  const forbidden = [
    /ADMIN_API_KEY/i,
    /-----BEGIN (RSA|EC|PRIVATE) KEY-----/i,
    /PKCS8/i,
    /memory-maker-owner-license/i,
    /production\.env/i,
    /license-private/i,
    /admin-api-key/i
  ];

  for (const rel of filesToScan) {
    const content = fs.readFileSync(path.join(__dirname, rel), "utf8");
    for (const pattern of forbidden) {
      assert.equal(
        pattern.test(content),
        false,
        `File ${rel} must NOT contain forbidden secret pattern ${pattern}`
      );
    }
  }
});

// =============================================================================
// 2. CRYPTOGRAPHIC VERIFIER & SPKI PARSER TESTS
// =============================================================================

test("V2-4. RFC 8032 Ed25519 known verification vector 1", () => {
  const pub = Buffer.from("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "hex");
  const msg = Buffer.from("", "utf8");
  const sig = Buffer.from("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b", "hex");

  const valid = verifyEd25519(msg, sig, pub);
  assert.equal(valid, true, "RFC 8032 test vector 1 must verify");

  // Tampered message must fail
  const tamperedMsg = Buffer.from("a", "utf8");
  assert.equal(verifyEd25519(tamperedMsg, sig, pub), false);

  // Tampered signature must fail
  const tamperedSig = new Uint8Array(sig);
  tamperedSig[0] ^= 0x01;
  assert.equal(verifyEd25519(msg, tamperedSig, pub), false);
});

test("V2-5. Node-generated ephemeral Ed25519 keypair interoperability with plugin verifier", () => {
  const { publicKey, privateKey, spkiB64 } = generateTestKeypair();
  const testMessage = "Hello Memory Maker Album Placer";
  const msgBytes = Buffer.from(testMessage, "utf8");
  const sig = crypto.sign(null, msgBytes, privateKey);

  // Verify using SPKI string
  const validWithSpki = verifyEd25519(msgBytes, sig, spkiB64);
  assert.equal(validWithSpki, true, "Node-signed message must verify against SPKI string");

  // Tampered message fails
  assert.equal(verifyEd25519(Buffer.from("Hello Tampered"), sig, spkiB64), false);

  // Tampered signature fails
  const badSig = new Uint8Array(sig);
  badSig[10] ^= 0xff;
  assert.equal(verifyEd25519(msgBytes, badSig, spkiB64), false);

  // Wrong public key fails
  const otherKeypair = generateTestKeypair();
  assert.equal(verifyEd25519(msgBytes, sig, otherKeypair.spkiB64), false);
});

test("V2-6. strict SPKI parser accepts valid Ed25519 SPKI and rejects malformed DER", () => {
  const { spkiB64 } = generateTestKeypair();
  const rawKey = parseSpkiEd25519PublicKey(spkiB64);
  assert.equal(rawKey.length, 32);

  // Rejects invalid Base64
  assert.throws(() => parseSpkiEd25519PublicKey("!not@valid#base64$"), /Invalid base64/i);

  // Rejects invalid length (not 44 bytes DER)
  const shortDer = Buffer.alloc(30);
  assert.throws(() => parseSpkiEd25519PublicKey(shortDer.toString("base64")), /Invalid SPKI DER length/);

  // Rejects wrong algorithm header / prefix
  const wrongHeaderDer = Buffer.concat([Buffer.alloc(12, 0xaa), Buffer.alloc(32, 0xbb)]);
  assert.throws(() => parseSpkiEd25519PublicKey(wrongHeaderDer.toString("base64")), /Invalid SPKI header/);
});

// =============================================================================
// 3. MM1 TOKEN PARSING & VERIFICATION TESTS
// =============================================================================

test("V2-7. MM1 token verification rejects malformed tokens", () => {
  const res1 = verifyToken("not-a-token");
  assert.equal(res1.ok, false);
  assert.equal(res1.error, "MALFORMED_TOKEN_STRUCTURE");

  const res2 = verifyToken("MM2.k1.payload.sig");
  assert.equal(res2.ok, false);
  assert.equal(res2.error, "INVALID_TOKEN_PREFIX");

  const res3 = verifyToken("MM1.wrong_key_id.payload.sig");
  assert.equal(res3.ok, false);
  assert.equal(res3.error, "UNEXPECTED_KEY_ID");
});

test("V2-8. MM1 token verification validates payload schema, issuer, pluginId, and deviceHash", () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const now = Math.floor(Date.now() / 1000);
  const kid = "test_kid";
  const deviceHash = "dev_1234567890abcdef";

  const validPayload = {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    licenseId: "lic_test_123",
    activationId: "act_test_456",
    deviceHash,
    plan: "standard",
    entitlements: ["ai-clean", "smart-align"],
    issuedAt: now,
    refreshAfter: now + 7 * 86400,
    graceUntil: now + 21 * 86400,
    expiresAt: now + 365 * 86400
  };

  const token = signTestToken(kid, validPayload, privateKey);

  // Verification options
  const verifyOptions = {
    expectedKid: kid,
    publicKeySpki: spkiB64,
    expectedDeviceHash: deviceHash,
    nowSeconds: now
  };

  const resOk = verifyToken(token, verifyOptions);
  assert.equal(resOk.ok, true);
  assert.equal(resOk.payload.licenseId, "lic_test_123");
  assert.deepEqual(resOk.payload.entitlements, ["ai-clean", "smart-align"]);

  // Wrong issuer fails
  const wrongIssToken = signTestToken(kid, { ...validPayload, iss: "fake-server" }, privateKey);
  assert.equal(verifyToken(wrongIssToken, verifyOptions).error, "INVALID_TOKEN_ISSUER");

  // Wrong pluginId fails
  const wrongPluginToken = signTestToken(kid, { ...validPayload, pluginId: "com.other.plugin" }, privateKey);
  assert.equal(verifyToken(wrongPluginToken, verifyOptions).error, "INVALID_TOKEN_PLUGIN_ID");

  // Device mismatch fails
  const mismatchOptions = { ...verifyOptions, expectedDeviceHash: "dev_different_999" };
  assert.equal(verifyToken(token, mismatchOptions).error, "DEVICE_MISMATCH");

  // Missing legacy entitlements normalizes to []
  const legacyPayload = { ...validPayload };
  delete legacyPayload.entitlements;
  const legacyToken = signTestToken(kid, legacyPayload, privateKey);
  const legacyRes = verifyToken(legacyToken, verifyOptions);
  assert.equal(legacyRes.ok, true);
  assert.deepEqual(legacyRes.payload.entitlements, []);
});

test("V2-9. entitlement schema strictness: max 32, regex slugs, no duplicates, canonical sort", () => {
  // Valid canonically sorted list
  assert.deepEqual(validateEntitlements(["a", "b"]), ["a", "b"]);

  // Unsorted array rejected
  assert.throws(() => validateEntitlements(["b", "a"]), /canonically sorted/);

  // Duplicate rejected
  assert.throws(() => validateEntitlements(["a", "a"]), /Duplicate/);

  // Non-array rejected
  assert.throws(() => validateEntitlements("not-an-array"), /expected array/);

  // Invalid slug characters rejected
  assert.throws(() => validateEntitlements(["valid-slug", "INVALID SLUG!"]), /Invalid entitlement slug/);

  // More than 32 rejected
  const thirtyThree = Array.from({ length: 33 }, (_, i) => `slug-${i.toString().padStart(2, "0")}`).sort();
  assert.throws(() => validateEntitlements(thirtyThree), /Too many entitlements/);
});

// =============================================================================
// 4. DEVICE IDENTITY TESTS
// =============================================================================

test("V2-10. device identity is stable, stored in secureStorage, and reused across sessions", async () => {
  const mockStore = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStore });

  const devId1 = await getInstallationDeviceId(storage);
  assert.ok(typeof devId1 === "string" && devId1.length >= 16);

  const devId2 = await getInstallationDeviceId(storage);
  assert.equal(devId1, devId2, "Device ID must remain stable across calls");

  // Stored in secure storage
  const storedId = await storage.readDeviceId();
  assert.equal(storedId, devId1);
});

test("V2-11. fallback random ID generates high-entropy collision-resistant strings", () => {
  const id1 = generateFallbackRandomId();
  const id2 = generateFallbackRandomId();
  assert.ok(id1.length >= 16);
  assert.notEqual(id1, id2);
});

// =============================================================================
// 5. LICENSE MANAGER RUNTIME LIFECYCLE & STATE MACHINE
// =============================================================================

test("V2-12. fresh valid token initializes to ACTIVE with zero network requests", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const now = Math.floor(Date.now() / 1000);
  const kid = "k1";
  const deviceHash = "dev_test_device_hash_1";

  const payload = {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    licenseId: "lic_active_01",
    activationId: "act_active_01",
    deviceHash,
    plan: "standard",
    entitlements: ["bulk-export"],
    issuedAt: now,
    refreshAfter: now + 7 * 86400,
    graceUntil: now + 21 * 86400,
    expiresAt: now + 365 * 86400
  };

  const validToken = signTestToken(kid, payload, privateKey);

  const mockStore = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStore });
  await storage.writeDeviceId(deviceHash);
  await storage.writeToken({ token: validToken, savedAt: Date.now() });

  let fetchCalled = false;
  const mockApiClient = {
    async refresh() { fetchCalled = true; return { ok: false }; },
    async activate() { fetchCalled = true; return { ok: false }; },
    async deactivate() { fetchCalled = true; return { ok: false }; }
  };

  const manager = createLicenseManager({
    storage,
    apiClient: mockApiClient,
    verifier: t => verifyToken(t, { expectedKid: kid, publicKeySpki: spkiB64, expectedDeviceHash: deviceHash, nowSeconds: now }),
    clock: () => now * 1000
  });

  const snapshot = await manager.initialize();
  assert.equal(snapshot.state, LICENSE_STATES.ACTIVE);
  assert.equal(snapshot.licenseId, "lic_active_01");
  assert.equal(fetchCalled, false, "Fresh active token must NOT make network requests");
});

test("V2-13. token with refresh due triggers one online refresh and updates cached token", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const now = Math.floor(Date.now() / 1000);
  const kid = "k1";
  const deviceHash = "dev_refresh_due";

  // Token where refresh is due (issued 8 days ago, refresh was at 7 days)
  const oldPayload = {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    licenseId: "lic_refresh_01",
    activationId: "act_refresh_01",
    deviceHash,
    plan: "standard",
    entitlements: [],
    issuedAt: now - 8 * 86400,
    refreshAfter: now - 1 * 86400,
    graceUntil: now + 13 * 86400,
    expiresAt: now + 357 * 86400
  };

  const oldToken = signTestToken(kid, oldPayload, privateKey);

  // New refreshed token
  const newPayload = {
    ...oldPayload,
    issuedAt: now,
    refreshAfter: now + 7 * 86400,
    graceUntil: now + 21 * 86400
  };
  const refreshedToken = signTestToken(kid, newPayload, privateKey);

  const mockStore = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStore });
  await storage.writeDeviceId(deviceHash);
  await storage.writeToken({ token: oldToken, savedAt: Date.now() });

  let refreshCallCount = 0;
  const mockApiClient = {
    async refresh(args) {
      refreshCallCount++;
      assert.equal(args.token, oldToken);
      assert.equal(args.deviceHash, deviceHash);
      return { ok: true, data: { token: refreshedToken } };
    }
  };

  const manager = createLicenseManager({
    storage,
    apiClient: mockApiClient,
    verifier: t => verifyToken(t, { expectedKid: kid, publicKeySpki: spkiB64, expectedDeviceHash: deviceHash, nowSeconds: now }),
    clock: () => now * 1000
  });

  const snapshot = await manager.initialize();
  assert.equal(refreshCallCount, 1, "Refresh-due token must trigger exactly one refresh");
  assert.equal(snapshot.state, LICENSE_STATES.ACTIVE);

  // Storage must contain new token
  const stored = await storage.readToken();
  assert.equal(stored.token, refreshedToken);
});

test("V2-14. refresh network failure within grace period enters GRACE state and tools remain operational", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const now = Math.floor(Date.now() / 1000);
  const kid = "k1";
  const deviceHash = "dev_grace_test";

  const payload = {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    licenseId: "lic_grace_01",
    activationId: "act_grace_01",
    deviceHash,
    plan: "standard",
    entitlements: [],
    issuedAt: now - 8 * 86400,
    refreshAfter: now - 1 * 86400,
    graceUntil: now + 6 * 86400, // within grace!
    expiresAt: now + 300 * 86400
  };

  const token = signTestToken(kid, payload, privateKey);
  const mockStore = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStore });
  await storage.writeDeviceId(deviceHash);
  await storage.writeToken({ token, savedAt: Date.now() });

  const mockApiClient = {
    async refresh() {
      // Simulate network timeout or offline
      return { ok: false, error: "NETWORK_TIMEOUT" };
    }
  };

  const manager = createLicenseManager({
    storage,
    apiClient: mockApiClient,
    verifier: t => verifyToken(t, { expectedKid: kid, publicKeySpki: spkiB64, expectedDeviceHash: deviceHash, nowSeconds: now }),
    clock: () => now * 1000
  });

  const snapshot = await manager.initialize();
  assert.equal(snapshot.state, LICENSE_STATES.GRACE);
  assert.equal(isOperationalState(snapshot.state), true, "GRACE must be operational");
});

test("V2-15. refresh failure after grace period expires enters EXPIRED state", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const now = Math.floor(Date.now() / 1000);
  const kid = "k1";
  const deviceHash = "dev_expired_test";

  const payload = {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    licenseId: "lic_expired_01",
    activationId: "act_expired_01",
    deviceHash,
    plan: "standard",
    entitlements: [],
    issuedAt: now - 30 * 86400,
    refreshAfter: now - 23 * 86400,
    graceUntil: now - 2 * 86400, // Grace expired!
    expiresAt: now + 100 * 86400
  };

  const token = signTestToken(kid, payload, privateKey);
  const mockStore = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStore });
  await storage.writeDeviceId(deviceHash);
  await storage.writeToken({ token, savedAt: Date.now() });

  const mockApiClient = {
    async refresh() {
      return { ok: false, error: "NETWORK_ERROR" };
    }
  };

  const manager = createLicenseManager({
    storage,
    apiClient: mockApiClient,
    verifier: t => verifyToken(t, { expectedKid: kid, publicKeySpki: spkiB64, expectedDeviceHash: deviceHash, nowSeconds: now }),
    clock: () => now * 1000
  });

  const snapshot = await manager.initialize();
  assert.equal(snapshot.state, LICENSE_STATES.EXPIRED);
  assert.equal(isOperationalState(snapshot.state), false, "EXPIRED must not be operational");
});

test("V2-16. authoritative denial (LICENSE_REVOKED, LICENSE_SUSPENDED, DEVICE_REVOKED) beats grace and blocks immediately", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const now = Math.floor(Date.now() / 1000);
  const kid = "k1";
  const deviceHash = "dev_auth_denial";

  const payload = {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    licenseId: "lic_revoked_01",
    activationId: "act_revoked_01",
    deviceHash,
    plan: "standard",
    entitlements: [],
    issuedAt: now - 8 * 86400,
    refreshAfter: now - 1 * 86400,
    graceUntil: now + 6 * 86400, // Still within grace time window!
    expiresAt: now + 300 * 86400
  };

  const token = signTestToken(kid, payload, privateKey);

  // Test LICENSE_REVOKED
  {
    const mockStore = createMockStorage();
    const storage = createLicenseStorage({ secureStorage: mockStore });
    await storage.writeDeviceId(deviceHash);
    await storage.writeToken({ token, savedAt: Date.now() });

    const manager = createLicenseManager({
      storage,
      apiClient: { async refresh() { return { ok: false, error: "LICENSE_REVOKED" }; } },
      verifier: t => verifyToken(t, { expectedKid: kid, publicKeySpki: spkiB64, expectedDeviceHash: deviceHash, nowSeconds: now }),
      clock: () => now * 1000
    });
    const snapshot = await manager.initialize();
    assert.equal(snapshot.state, LICENSE_STATES.REVOKED);
    assert.equal(isOperationalState(snapshot.state), false);
  }

  // Test LICENSE_SUSPENDED
  {
    const mockStore = createMockStorage();
    const storage = createLicenseStorage({ secureStorage: mockStore });
    await storage.writeDeviceId(deviceHash);
    await storage.writeToken({ token, savedAt: Date.now() });

    const manager = createLicenseManager({
      storage,
      apiClient: { async refresh() { return { ok: false, error: "LICENSE_SUSPENDED" }; } },
      verifier: t => verifyToken(t, { expectedKid: kid, publicKeySpki: spkiB64, expectedDeviceHash: deviceHash, nowSeconds: now }),
      clock: () => now * 1000
    });
    const snapshot = await manager.initialize();
    assert.equal(snapshot.state, LICENSE_STATES.SUSPENDED);
    assert.equal(isOperationalState(snapshot.state), false);
  }

  // Test DEVICE_REVOKED
  {
    const mockStore = createMockStorage();
    const storage = createLicenseStorage({ secureStorage: mockStore });
    await storage.writeDeviceId(deviceHash);
    await storage.writeToken({ token, savedAt: Date.now() });

    const manager = createLicenseManager({
      storage,
      apiClient: { async refresh() { return { ok: false, error: "DEVICE_REVOKED" }; } },
      verifier: t => verifyToken(t, { expectedKid: kid, publicKeySpki: spkiB64, expectedDeviceHash: deviceHash, nowSeconds: now }),
      clock: () => now * 1000
    });
    const snapshot = await manager.initialize();
    assert.equal(snapshot.state, LICENSE_STATES.REVOKED);
    assert.equal(isOperationalState(snapshot.state), false);
  }
});

// =============================================================================
// 6. ACTIVATION, DEACTIVATION & PLAINTEXT SECURITY
// =============================================================================

test("V2-17. activation verifies token BEFORE storage write and never persists plaintext license key", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const now = Math.floor(Date.now() / 1000);
  const kid = "k1";
  const deviceHash = "dev_activation_test";

  const payload = {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    licenseId: "lic_activated_100",
    activationId: "act_activated_100",
    deviceHash,
    plan: "standard",
    entitlements: ["ai-clean"],
    issuedAt: now,
    refreshAfter: now + 7 * 86400,
    graceUntil: now + 21 * 86400,
    expiresAt: now + 365 * 86400
  };

  const validToken = signTestToken(kid, payload, privateKey);
  const plaintextKey = "MMAP-1234-5678-ABCD";

  const mockStore = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStore });
  await storage.writeDeviceId(deviceHash);

  const mockApiClient = {
    async activate(args) {
      assert.equal(args.licenseKey, plaintextKey);
      assert.equal(args.deviceHash, deviceHash);
      return { ok: true, data: { token: validToken } };
    }
  };

  const manager = createLicenseManager({
    storage,
    apiClient: mockApiClient,
    verifier: t => verifyToken(t, { expectedKid: kid, publicKeySpki: spkiB64, expectedDeviceHash: deviceHash, nowSeconds: now }),
    clock: () => now * 1000
  });

  await manager.initialize();
  const actRes = await manager.activate(plaintextKey);
  assert.equal(actRes.ok, true);
  assert.equal(manager.getState(), LICENSE_STATES.ACTIVE);

  // Check stored items: plaintext key MUST NOT be anywhere in storage
  for (const [key, val] of mockStore._store.entries()) {
    const valStr = typeof val === "string" ? val : JSON.stringify(val);
    assert.equal(valStr.includes(plaintextKey), false, `Storage key ${key} must not contain plaintext license key`);
  }

  // Token is verified before storing
  const stored = await storage.readToken();
  assert.equal(stored.token, validToken);

  // Case B: Server returns an invalid/forged token -> rejected BEFORE storage write
  const mockStoreForged = createMockStorage();
  const storageForged = createLicenseStorage({ secureStorage: mockStoreForged });
  await storageForged.writeDeviceId(deviceHash);

  const forgedToken = validToken + "_tampered";
  const managerForged = createLicenseManager({
    storage: storageForged,
    apiClient: {
      async activate() { return { ok: true, data: { token: forgedToken } }; }
    },
    verifier: t => verifyToken(t, { expectedKid: kid, publicKeySpki: spkiB64, expectedDeviceHash: deviceHash, nowSeconds: now }),
    clock: () => now * 1000
  });

  await managerForged.initialize();
  const forgedRes = await managerForged.activate(plaintextKey);
  assert.equal(forgedRes.ok, false);
  assert.equal(forgedRes.error, "TOKEN_VERIFICATION_FAILED");
  assert.equal(await storageForged.readToken(), null, "Forged token must NEVER be written to storage");
  assert.equal(managerForged.getState(), LICENSE_STATES.UNACTIVATED);
});

test("V2-18. deactivation requires online server success, clears token, and retains device ID", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const now = Math.floor(Date.now() / 1000);
  const kid = "k1";
  const deviceHash = "dev_deact_test";

  const payload = {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    licenseId: "lic_deact_01",
    activationId: "act_deact_01",
    deviceHash,
    plan: "standard",
    entitlements: [],
    issuedAt: now,
    refreshAfter: now + 7 * 86400,
    graceUntil: now + 21 * 86400,
    expiresAt: now + 365 * 86400
  };

  const validToken = signTestToken(kid, payload, privateKey);
  const mockStore = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStore });
  await storage.writeDeviceId(deviceHash);
  await storage.writeToken({ token: validToken, savedAt: Date.now() });

  let serverDeactivated = false;
  let networkFailMode = true;

  const mockApiClient = {
    async deactivate(args) {
      if (networkFailMode) {
        return { ok: false, error: "NETWORK_ERROR", message: "Failed to connect" };
      }
      serverDeactivated = true;
      assert.equal(args.token, validToken);
      assert.equal(args.deviceHash, deviceHash);
      return { ok: true, data: { deactivated: true } };
    }
  };

  const manager = createLicenseManager({
    storage,
    apiClient: mockApiClient,
    verifier: t => verifyToken(t, { expectedKid: kid, publicKeySpki: spkiB64, expectedDeviceHash: deviceHash, nowSeconds: now }),
    clock: () => now * 1000
  });

  await manager.initialize();
  assert.equal(manager.getState(), LICENSE_STATES.ACTIVE);

  // 1. Deactivation fails due to network -> must NOT falsely clear license
  const failRes = await manager.deactivate();
  assert.equal(failRes.ok, false);
  assert.equal(manager.getState(), LICENSE_STATES.ACTIVE, "Failed deactivation must not clear active status");
  assert.ok(await storage.readToken(), "Cached token must remain intact on network failure");

  // 2. Deactivation succeeds online -> clears token, keeps device ID, transitions to UNACTIVATED
  networkFailMode = false;
  const successRes = await manager.deactivate();
  assert.equal(successRes.ok, true);
  assert.equal(serverDeactivated, true);
  assert.equal(manager.getState(), LICENSE_STATES.UNACTIVATED);

  // Token is deleted
  assert.equal(await storage.readToken(), null);

  // Device ID is preserved!
  const preservedDevId = await storage.readDeviceId();
  assert.equal(preservedDevId, deviceHash);
});

// =============================================================================
// 7. CLOCK ROLLBACK DETECTION & RECOVERY
// =============================================================================

test("V2-19. clock rollback triggers online validation requirement; recovers if online", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const observedTime = 1750000000;
  const rolledBackTime = 1700000000; // 50,000,000 seconds earlier (~1.5 years back)
  const kid = "k1";
  const deviceHash = "dev_clock_test";

  const payload = {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    licenseId: "lic_clock_01",
    activationId: "act_clock_01",
    deviceHash,
    plan: "standard",
    entitlements: [],
    issuedAt: observedTime - 100000,
    refreshAfter: observedTime + 500000,
    graceUntil: observedTime + 1000000,
    expiresAt: observedTime + 5000000
  };

  const validToken = signTestToken(kid, payload, privateKey);

  // Offline case: clock rollback blocks with EXPIRED/validation required
  {
    const mockStore = createMockStorage();
    const storage = createLicenseStorage({ secureStorage: mockStore });
    await storage.writeDeviceId(deviceHash);
    await storage.writeToken({ token: validToken, savedAt: Date.now() });
    await storage.writeMetadata({ lastObservedTime: observedTime });

    const manager = createLicenseManager({
      storage,
      apiClient: { async refresh() { return { ok: false, error: "OFFLINE" }; } },
      verifier: t => verifyToken(t, { expectedKid: kid, publicKeySpki: spkiB64, expectedDeviceHash: deviceHash, nowSeconds: rolledBackTime }),
      clock: () => rolledBackTime * 1000
    });

    const snapshot = await manager.initialize();
    assert.equal(snapshot.state, LICENSE_STATES.EXPIRED);
    assert.equal(snapshot.reason, "clock-rollback");
    assert.equal(isOperationalState(snapshot.state), false);
  }

  // Online case: clock rollback successfully recovers with online refresh
  {
    const mockStore = createMockStorage();
    const storage = createLicenseStorage({ secureStorage: mockStore });
    await storage.writeDeviceId(deviceHash);
    await storage.writeToken({ token: validToken, savedAt: Date.now() });
    await storage.writeMetadata({ lastObservedTime: observedTime });

    const newPayload = {
      ...payload,
      issuedAt: rolledBackTime,
      refreshAfter: rolledBackTime + 7 * 86400,
      graceUntil: rolledBackTime + 21 * 86400
    };
    const refreshedToken = signTestToken(kid, newPayload, privateKey);

    const manager = createLicenseManager({
      storage,
      apiClient: { async refresh() { return { ok: true, data: { token: refreshedToken } }; } },
      verifier: t => verifyToken(t, { expectedKid: kid, publicKeySpki: spkiB64, expectedDeviceHash: deviceHash, nowSeconds: rolledBackTime }),
      clock: () => rolledBackTime * 1000
    });

    const snapshot = await manager.initialize();
    assert.equal(snapshot.state, LICENSE_STATES.ACTIVE);
  }
});

// =============================================================================
// 8. CENTRAL TOOL GATING IN MAIN.JS
// =============================================================================

test("V2-20. tool gate allows ACTIVE and GRACE, blocks UNACTIVATED and EXPIRED without modifying individual tool algorithms", async () => {
  const mainModule = require("../main");

  // Verify all 8 original handlers are exported and untouched
  const expectedHandlers = [
    "handleOpenPsd",
    "handleAutoPhotoFill",
    "handleSwapPhotos",
    "handleFlipPhoto",
    "handleSavePage",
    "handleSaveEditedPhotos",
    "handleSavePsdCategory",
    "handleRemovePhotos"
  ];

  for (const name of expectedHandlers) {
    assert.equal(typeof mainModule[name], "function", `${name} must remain an exported function`);
  }

  // Ensure helper functions exist
  assert.equal(typeof mainModule.ensureLicenseOperational, "function");
  assert.equal(typeof mainModule.wrapProtectedAction, "function");

  // Test wrapping logic with a test action
  let executedCount = 0;
  const mockAction = async () => { executedCount++; return "action-done"; };
  const protectedAction = mainModule.wrapProtectedAction(mockAction);

  // Case A: License manager is operational (ACTIVE) -> action executes
  const activeManager = createLicenseManager();
  activeManager._state = LICENSE_STATES.ACTIVE;
  activeManager._initialized = true;
  activeManager.getSnapshot = () => ({ state: LICENSE_STATES.ACTIVE });
  activeManager.isOperational = () => true;

  // Swap manager in main temporarily
  const origManager = mainModule.getLicenseManagerInstance ? mainModule.getLicenseManagerInstance() : mainModule.licenseManager;
  try {
    mainModule.setLicenseManager(activeManager);
    const resActive = await protectedAction();
    assert.equal(resActive, "action-done");
    assert.equal(executedCount, 1);

    // Case B: License manager is in GRACE -> action executes
    activeManager._state = LICENSE_STATES.GRACE;
    activeManager.getSnapshot = () => ({ state: LICENSE_STATES.GRACE });
    activeManager.isOperational = () => true;
    const resGrace = await protectedAction();
    assert.equal(resGrace, "action-done");
    assert.equal(executedCount, 2);

    // Case C: License manager is UNACTIVATED -> action blocked
    activeManager._state = LICENSE_STATES.UNACTIVATED;
    activeManager.getSnapshot = () => ({ state: LICENSE_STATES.UNACTIVATED });
    activeManager.isOperational = () => false;
    const resUnact = await protectedAction();
    assert.deepEqual(resUnact, { outcome: "license-required" });
    assert.equal(executedCount, 2, "Action must NOT execute when license is UNACTIVATED");

    // Case D: License manager is EXPIRED -> action blocked
    activeManager._state = LICENSE_STATES.EXPIRED;
    activeManager.getSnapshot = () => ({ state: LICENSE_STATES.EXPIRED });
    activeManager.isOperational = () => false;
    const resExp = await protectedAction();
    assert.deepEqual(resExp, { outcome: "license-required" });
    assert.equal(executedCount, 2, "Action must NOT execute when license is EXPIRED");
  } finally {
    mainModule.setLicenseManager(origManager);
  }
});

// =============================================================================
// 9. AUDIT SCENARIO COMPLETION TESTS (V2-21 to V2-31)
// =============================================================================

test("V2-21. malformed or invalid payload rejected (schema invariants)", () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const now = Math.floor(Date.now() / 1000);
  const kid = "k1";
  const deviceHash = "dev_schema_invariants";

  const verifyOpts = {
    expectedKid: kid,
    publicKeySpki: spkiB64,
    expectedDeviceHash: deviceHash,
    nowSeconds: now
  };

  // Case 1: Payload is not valid JSON
  const invalidJsonB64 = Buffer.from("this is not json", "utf8").toString("base64url");
  const badJsonMsg = `MM1.${kid}.${invalidJsonB64}`;
  const badJsonSig = crypto.sign(null, Buffer.from(badJsonMsg, "utf8"), privateKey).toString("base64url");
  const badJsonToken = `${badJsonMsg}.${badJsonSig}`;
  assert.equal(verifyToken(badJsonToken, verifyOpts).error, "MALFORMED_PAYLOAD_JSON");

  // Case 2: Missing licenseId
  const missingLicPayload = {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    activationId: "act_1",
    deviceHash,
    plan: "standard",
    issuedAt: now,
    expiresAt: now + 3600
  };
  const tokenMissingLic = signTestToken(kid, missingLicPayload, privateKey);
  assert.equal(verifyToken(tokenMissingLic, verifyOpts).error, "INVALID_LICENSE_ID");

  // Case 3: Unsupported version (v !== 1)
  const badVerPayload = { ...missingLicPayload, licenseId: "lic_1", v: 99 };
  const tokenBadVer = signTestToken(kid, badVerPayload, privateKey);
  assert.equal(verifyToken(tokenBadVer, verifyOpts).error, "UNSUPPORTED_TOKEN_VERSION");

  // Case 4: Missing timestamps (issuedAt)
  const missingTsPayload = { ...missingLicPayload, licenseId: "lic_1", issuedAt: null };
  const tokenMissingTs = signTestToken(kid, missingTsPayload, privateKey);
  assert.equal(verifyToken(tokenMissingTs, verifyOpts).error, "INVALID_TIMESTAMP_ISSUEDAT");
});

test("V2-22. device limit activation error handled with safe user message and no state change", async () => {
  const mockStore = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStore });

  const mockApiClient = {
    async activate() {
      return {
        ok: false,
        error: "DEVICE_LIMIT_REACHED",
        message: "Device limit reached"
      };
    }
  };

  const manager = createLicenseManager({
    storage,
    apiClient: mockApiClient,
    verifier: () => ({ ok: true })
  });

  await manager.initialize();
  assert.equal(manager.getState(), LICENSE_STATES.UNACTIVATED);

  const actResult = await manager.activate("MMAP-DEVICE-LIMIT-KEY");
  assert.equal(actResult.ok, false);
  assert.equal(actResult.error, "DEVICE_LIMIT_REACHED");
  assert.equal(actResult.message, SAFE_USER_MESSAGES.DEVICE_LIMIT_REACHED);
  assert.equal(manager.getState(), LICENSE_STATES.UNACTIVATED, "Device limit failure must leave state UNACTIVATED");

  // Storage must not have any token
  assert.equal(await storage.readToken(), null);
});

test("V2-23. individual eight tool implementations are not modified for licensing", () => {
  const toolFiles = [
    "openPsd.js",
    "autoPhotoFill.js",
    "swapPhotos.js",
    "flipPhoto.js",
    "savePage.js",
    "saveEditedPhotos.js",
    "savePsdCategory.js",
    "removePhotos.js"
  ];

  for (const filename of toolFiles) {
    const fullPath = path.join(__dirname, "../src/tools", filename);
    const code = fs.readFileSync(fullPath, "utf8");
    assert.equal(code.includes("licenseManager"), false, `${filename} must not reference licenseManager`);
    assert.equal(code.includes("isOperationalState"), false, `${filename} must not reference isOperationalState`);
    assert.equal(code.includes("verifyToken"), false, `${filename} must not reference verifyToken`);
    assert.equal(code.includes("productionConfig"), false, `${filename} must not reference productionConfig`);
  }
});

test("V2-24. tool execution performs zero network fetches on tool clicks", async () => {
  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCount++;
    throw new Error("Network fetch forbidden on tool clicks");
  };

  try {
    let actionRunCount = 0;
    const testAction = async () => { actionRunCount++; return "ok"; };
    const wrapped = mainModule.wrapProtectedAction(testAction);

    const activeManager = createLicenseManager();
    activeManager._state = LICENSE_STATES.ACTIVE;
    activeManager._initialized = true;
    activeManager.getSnapshot = () => ({ state: LICENSE_STATES.ACTIVE });
    activeManager.isOperational = () => true;

    const orig = mainModule.getLicenseManagerInstance ? mainModule.getLicenseManagerInstance() : mainModule.licenseManager;
    try {
      mainModule.setLicenseManager(activeManager);

      for (let i = 0; i < 5; i++) {
        const res = await wrapped();
        assert.equal(res, "ok");
      }

      assert.equal(actionRunCount, 5);
      assert.equal(fetchCount, 0, "Tool actions must execute completely locally without fetch calls");
    } finally {
      mainModule.setLicenseManager(orig);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("V2-25. license manager initialization is idempotent and handles concurrent calls safely", async () => {
  let storageReadCount = 0;
  const mockStorage = {
    async getItem() {
      storageReadCount++;
      return null;
    },
    async setItem() {},
    async removeItem() {}
  };

  const storage = createLicenseStorage({ secureStorage: mockStorage });
  const manager = createLicenseManager({ storage });

  // Call initialize concurrently 5 times
  const results = await Promise.all([
    manager.initialize(),
    manager.initialize(),
    manager.initialize(),
    manager.initialize(),
    manager.initialize()
  ]);

  // All results must be identical snapshots
  for (const res of results) {
    assert.equal(res.state, LICENSE_STATES.UNACTIVATED);
  }

  // Storage should only be read once
  assert.equal(storageReadCount, 1, "Storage should only be read once despite concurrent init calls");
});

test("V2-26. malformed or throwing secureStorage never crashes initialization", async () => {
  // Case A: Storage throws exception
  const throwingStorage = {
    async getItem() { throw new Error("Hardware I/O error"); },
    async setItem() {},
    async removeItem() {}
  };
  const storageA = createLicenseStorage({ secureStorage: throwingStorage });
  const managerA = createLicenseManager({ storage: storageA });
  const snapA = await managerA.initialize();
  assert.equal(snapA.state, LICENSE_STATES.ERROR);
  assert.equal(snapA.reason, "storage-error");

  // Case B: Corrupted token payload in storage
  const mockStore = createMockStorage({
    [STORAGE_KEYS.SIGNED_TOKEN]: "{ corrupted invalid json ... "
  });
  const storageB = createLicenseStorage({ secureStorage: mockStore });
  const managerB = createLicenseManager({ storage: storageB });
  const snapB = await managerB.initialize();
  assert.equal(snapB.state, LICENSE_STATES.UNACTIVATED);
});

test("V2-27. API client timeout, network error, and non-200 responses are sanitized without leaking secrets", async () => {
  const originalFetch = globalThis.fetch;

  try {
    // 1. Simulate network timeout (AbortError)
    globalThis.fetch = async () => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    };

    const client = createLicenseApiClient({ baseUrl: "https://mm-license-server.rammonihalder.workers.dev", timeoutMs: 100 });
    const resTimeout = await client.activate({
      licenseKey: "SECRET-KEY-1234",
      deviceHash: "SECRET-DEVICE-HASH",
      deviceName: "Photoshop Test",
      pluginVersion: PLUGIN_VERSION
    });

    assert.equal(resTimeout.ok, false);
    assert.equal(resTimeout.error, "TIMEOUT");
    assert.ok(resTimeout.message.includes("timed out"));
    assert.equal(JSON.stringify(resTimeout).includes("SECRET-KEY-1234"), false, "Error response must not leak license key");

    // 2. Simulate HTTP 500 error with JSON error body
    const fetch500 = async () => ({
      ok: false,
      status: 500,
      async json() { return { ok: false, error: "INTERNAL_CRASH", stack: "Secret stack trace" }; },
      async text() { return "Internal Server Error"; }
    });

    const client500 = createLicenseApiClient({
      baseUrl: "https://mm-license-server.rammonihalder.workers.dev",
      fetchFn: fetch500
    });

    const res500 = await client500.refresh({
      token: "MM1.k1.payload.sig",
      deviceHash: "SECRET-DEV-HASH"
    });
    assert.equal(res500.ok, false);
    assert.equal(res500.error, "INTERNAL_CRASH");
    assert.equal(JSON.stringify(res500).includes("Secret stack trace"), false, "Stack traces must not leak to client");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("V2-28. device ID regeneration occurs only when stored ID is missing or corrupt (< 16 chars)", async () => {
  const mockStore = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStore });

  // 1. Missing ID -> generated
  const id1 = await getInstallationDeviceId(storage);
  assert.ok(id1.length >= 16);

  // 2. Stored ID valid -> preserved
  const id2 = await getInstallationDeviceId(storage);
  assert.equal(id2, id1, "Valid device ID must be reused");

  // 3. Corrupt short ID (< 16 chars) -> regenerated
  await storage.writeDeviceId("short");
  const id3 = await getInstallationDeviceId(storage);
  assert.notEqual(id3, "short");
  assert.ok(id3.length >= 16);

  // 4. Non-string stored ID -> regenerated
  await storage.writeDeviceId(null);
  const id4 = await getInstallationDeviceId(storage);
  assert.ok(id4.length >= 16);
});

test("V2-29. uniqueness across generated device IDs", () => {
  const ids = new Set();
  for (let i = 0; i < 50; i++) {
    ids.add(generateFallbackRandomId());
  }
  assert.equal(ids.size, 50, "50 generated installation IDs must all be distinct");
});

test("V2-30. clean storage initialization yields UNACTIVATED without network fetch", async () => {
  let fetchAttempted = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchAttempted = true;
    throw new Error("Network call forbidden on clean startup");
  };

  try {
    const mockStore = createMockStorage();
    const storage = createLicenseStorage({ secureStorage: mockStore });
    const manager = createLicenseManager({ storage, useProductionDefaults: true });

    const snap = await manager.initialize();
    assert.equal(snap.state, LICENSE_STATES.UNACTIVATED);
    assert.equal(fetchAttempted, false, "Clean startup must NEVER call network");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("V2-31. deactivation retains device ID across multiple activation/deactivation cycles", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const now = Math.floor(Date.now() / 1000);
  const kid = "k1";

  const mockStore = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStore });
  const fixedDeviceId = await getInstallationDeviceId(storage);

  const payload = {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    licenseId: "lic_cycle_test",
    activationId: "act_cycle_test",
    deviceHash: fixedDeviceId,
    plan: "standard",
    entitlements: [],
    issuedAt: now,
    refreshAfter: now + 7 * 86400,
    graceUntil: now + 21 * 86400,
    expiresAt: now + 365 * 86400
  };

  const validToken = signTestToken(kid, payload, privateKey);

  const mockApiClient = {
    async activate() { return { ok: true, data: { token: validToken } }; },
    async deactivate() { return { ok: true, data: { deactivated: true } }; }
  };

  const manager = createLicenseManager({
    storage,
    apiClient: mockApiClient,
    verifier: t => verifyToken(t, { expectedKid: kid, publicKeySpki: spkiB64, expectedDeviceHash: fixedDeviceId, nowSeconds: now }),
    clock: () => now * 1000
  });

  await manager.initialize();

  // Cycle 1: Activate -> Deactivate
  const act1 = await manager.activate("KEY-1");
  assert.equal(act1.ok, true);
  assert.equal(manager.getState(), LICENSE_STATES.ACTIVE);
  assert.equal(await storage.readDeviceId(), fixedDeviceId);

  const deact1 = await manager.deactivate();
  assert.equal(deact1.ok, true);
  assert.equal(manager.getState(), LICENSE_STATES.UNACTIVATED);
  assert.equal(await storage.readDeviceId(), fixedDeviceId, "Device ID must survive first deactivation");

  // Cycle 2: Reactivate -> Deactivate
  const act2 = await manager.activate("KEY-1");
  assert.equal(act2.ok, true);
  assert.equal(manager.getState(), LICENSE_STATES.ACTIVE);
  assert.equal(await storage.readDeviceId(), fixedDeviceId);

  const deact2 = await manager.deactivate();
  assert.equal(deact2.ok, true);
  assert.equal(manager.getState(), LICENSE_STATES.UNACTIVATED);
  assert.equal(await storage.readDeviceId(), fixedDeviceId, "Device ID must survive second deactivation");
});

test("V2-32. license dialog CSS layout, sizing, and structural invariants", () => {
  const css = fs.readFileSync(path.join(__dirname, "../style.css"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const mainSrc = fs.readFileSync(path.join(__dirname, "../main.js"), "utf8");

  // 1. #licenseDialog does not have display:none in CSS
  const dialogCssMatches = css.match(/(?:dialog#licenseDialog|#licenseDialog)\s*\{([^}]+)\}/g) || [];
  assert.ok(dialogCssMatches.length > 0, "CSS must define rules for #licenseDialog");
  for (const block of dialogCssMatches) {
    assert.equal(/display\s*:\s*none/i.test(block), false, "#licenseDialog must NOT have display:none in CSS");
    // 2. #licenseDialog does not have visibility:hidden
    assert.equal(/visibility\s*:\s*hidden/i.test(block), false, "#licenseDialog must NOT have visibility:hidden in CSS");
    // 3. #licenseDialog does not have opacity:0
    assert.equal(/opacity\s*:\s*0/i.test(block), false, "#licenseDialog must NOT have opacity:0 in CSS");
  }

  // Also verify no dialog#licenseDialog[hidden] selector exists in CSS
  assert.equal(/dialog#licenseDialog\[hidden\]/i.test(css), false, "CSS must NOT contain dialog#licenseDialog[hidden]");

  // 4. #licenseDialog has nonzero intended width
  assert.match(css, /(?:dialog#licenseDialog|#licenseDialog)[^{]*\{[^}]*width\s*:\s*360px/i);
  assert.match(css, /(?:dialog#licenseDialog|#licenseDialog)[^{]*\{[^}]*min-width\s*:\s*340px/i);

  // 5. modal open call uses explicit size
  assert.match(mainSrc, /width\s*:\s*380/);
  assert.match(mainSrc, /height\s*:\s*520/);

  // 6. modal height is sufficient for license UI (>= 460)
  const heightMatch = mainSrc.match(/showLicenseDialog[\s\S]*?uxpShowModal[\s\S]*?height\s*:\s*(\d+)/);
  assert.ok(heightMatch && parseInt(heightMatch[1], 10) >= 460, "Modal height must be >= 460px to avoid clipping");

  // 7. ACTIVATE button remains inside dialog
  // 8. CLOSE button remains inside dialog
  const dialogMarkupMatch = html.match(/<dialog id="licenseDialog"[^>]*>([\s\S]*?)<\/dialog>/i);
  assert.ok(dialogMarkupMatch, "<dialog id='licenseDialog'> must exist in index.html");
  const dialogInnerHtml = dialogMarkupMatch[1];
  assert.ok(dialogInnerHtml.includes('id="licenseActivateBtn"'), "ACTIVATE button must be inside dialog");
  assert.ok(dialogInnerHtml.includes('id="licenseDialogCloseBtn"'), "CLOSE button must be inside dialog");

  // 9. duplicate "License Management" heading is avoided
  assert.equal(dialogInnerHtml.includes("<h2>License Management</h2>"), false, "Duplicate 'License Management' heading must be avoided");
  assert.ok(dialogInnerHtml.includes("<h2>FM Album Designing Tools</h2>"), "Internal heading must show product title");

  // 10. existing state-specific hidden controls remain functional
  assert.ok(dialogInnerHtml.includes('id="licenseDeactivateBtn" class="btn btn-destructive full" type="button" hidden'), "Deactivate button has initial hidden attribute");
  assert.ok(dialogInnerHtml.includes('id="licensePlanRow" hidden'), "Plan row has initial hidden attribute");
  assert.ok(dialogInnerHtml.includes('id="licenseNextRefreshRow" hidden'), "Next refresh row has initial hidden attribute");
});

// =============================================================================
// 9. CROSS-SESSION RESTORE & STORAGE CODEC ROUND-TRIP
// =============================================================================

test("V2-34. cross-session restart: Session A writes device ID/token/metadata, Session B restores ACTIVE with zero fetch and reuses device ID", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const fixedDeviceId = "device_test_session_abc123456789";
  const customVerifier = (t, opts) => verifyToken(t, {
    publicKeySpki: spkiB64,
    expectedKid: "restart-key",
    expectedDeviceHash: opts?.expectedDeviceHash || fixedDeviceId,
    nowSeconds
  });

  // Persistent simulated Adobe UXP secureStorage
  const uxpDiskStore = new Map();
  const persistentUxpSecureStorage = {
    async getItem(k) {
      if (!uxpDiskStore.has(k)) return null;
      const val = uxpDiskStore.get(k);
      // Real Adobe UXP strictly returns Uint8Array
      return val instanceof Uint8Array ? val : new TextEncoder().encode(String(val));
    },
    async setItem(k, v) {
      // Real UXP accepts string, encrypts and stores as bytes
      const bytes = typeof v === "string" ? new TextEncoder().encode(v) : v;
      uxpDiskStore.set(k, bytes);
    },
    async removeItem(k) {
      uxpDiskStore.delete(k);
    }
  };

  // --- SESSION A ---
  let storageA = createLicenseStorage({ secureStorage: persistentUxpSecureStorage });
  let managerA = createLicenseManager({
    storage: storageA,
    verifier: (t) => customVerifier(t, { expectedDeviceHash: fixedDeviceId }),
    clock: () => nowSeconds * 1000
  });

  // Session A establishes device ID
  await storageA.writeDeviceId(fixedDeviceId);

  // Generate valid MM1 token for this device
  const tokenPayload = {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    licenseId: "lic_restart_test_123",
    activationId: "act_restart_test_456",
    deviceHash: fixedDeviceId,
    plan: "studio",
    entitlements: ["batch-fill", "export-psd"],
    issuedAt: nowSeconds,
    refreshAfter: nowSeconds + 86400, // Fresh for 24h
    graceUntil: nowSeconds + 172800,
    expiresAt: nowSeconds + 2592000
  };
  const signedToken = signTestToken("restart-key", tokenPayload, privateKey);

  // Persist token & metadata in Session A
  await storageA.writeToken({ token: signedToken, savedAt: Date.now() });
  await storageA.writeMetadata({
    lastValidatedAt: nowSeconds,
    lastObservedTime: nowSeconds
  });

  // Verify uxpDiskStore now contains Uint8Array for all 3 keys (real Adobe UXP post-activation state)
  assert.ok(uxpDiskStore.get(STORAGE_KEYS.DEVICE_ID) instanceof Uint8Array);
  assert.ok(uxpDiskStore.get(STORAGE_KEYS.SIGNED_TOKEN) instanceof Uint8Array);
  assert.ok(uxpDiskStore.get(STORAGE_KEYS.LICENSE_METADATA) instanceof Uint8Array);

  // DESTROY ALL in-memory manager and storage objects (simulate Photoshop restart)
  storageA = null;
  managerA = null;

  // --- SESSION B (Photoshop has restarted) ---
  let fetchCallCount = 0;
  const mockApiClientB = {
    async refresh() {
      fetchCallCount++;
      return { ok: true };
    },
    async activate() {
      fetchCallCount++;
      return { ok: true };
    }
  };

  const storageB = createLicenseStorage({ secureStorage: persistentUxpSecureStorage });
  const managerB = createLicenseManager({
    storage: storageB,
    apiClient: mockApiClientB,
    verifier: (t) => customVerifier(t, { expectedDeviceHash: fixedDeviceId }),
    clock: () => nowSeconds * 1000
  });

  // Initialize Session B
  const snapB = await managerB.initialize();

  // Assertions:
  assert.equal(snapB.state, LICENSE_STATES.ACTIVE, "State must be ACTIVE after restart");
  assert.equal(managerB.isOperational(), true, "Manager must be operational");
  assert.equal(snapB.deviceId, fixedDeviceId, "Device ID must be identical to Session A (reused)");
  assert.equal(snapB.plan, "studio");
  assert.deepEqual(snapB.entitlements, ["batch-fill", "export-psd"]);
  assert.equal(fetchCallCount, 0, "Expected zero fetch calls when token is still fresh");
});

test("V2-35. device ID, metadata, and token round-trip through Uint8Array secureStorage", async () => {
  const mockStore = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStore });

  // 1. Device ID round-trip
  const testDeviceId = "device_opaque_identity_987654321";
  const okDevId = await storage.writeDeviceId(testDeviceId);
  assert.equal(okDevId, true);
  assert.ok(mockStore._store.get(STORAGE_KEYS.DEVICE_ID) instanceof Uint8Array, "Underlying store must hold Uint8Array");
  const readDevId = await storage.readDeviceId();
  assert.equal(readDevId, testDeviceId);

  // 2. Metadata round-trip
  const testMeta = {
    lastValidatedAt: 1727400000,
    lastObservedTime: 1727400100,
    customField: "photoshop-windows"
  };
  const okMeta = await storage.writeMetadata(testMeta);
  assert.equal(okMeta, true);
  assert.ok(mockStore._store.get(STORAGE_KEYS.LICENSE_METADATA) instanceof Uint8Array, "Underlying store must hold Uint8Array");
  const readMeta = await storage.readMetadata();
  assert.deepEqual(readMeta, testMeta);

  // 3. Token round-trip
  const testTokenObj = {
    token: "MM1.test_kid.eyJwbGFuIjoicHJvIn0.signaturesig",
    savedAt: 1727400000500
  };
  const okToken = await storage.writeToken(testTokenObj);
  assert.equal(okToken, true);
  assert.ok(mockStore._store.get(STORAGE_KEYS.SIGNED_TOKEN) instanceof Uint8Array, "Underlying store must hold Uint8Array");
  const readToken = await storage.readToken();
  assert.deepEqual(readToken, testTokenObj);
});

test("V2-36. corrupt Uint8Array safe handling: non-JSON or invalid UTF-8 bytes return null without crashing initialize()", async () => {
  // Case A: completely invalid binary garbage
  const mockStoreA = createMockStorage();
  mockStoreA._store.set(STORAGE_KEYS.SIGNED_TOKEN, new Uint8Array([0xff, 0xfe, 0x00, 0x15, 0x88, 0x99]));
  mockStoreA._store.set(STORAGE_KEYS.DEVICE_ID, new Uint8Array([0x80, 0x81, 0x82]));
  mockStoreA._store.set(STORAGE_KEYS.LICENSE_METADATA, new Uint8Array([0x00, 0x01, 0x02]));

  const storageA = createLicenseStorage({ secureStorage: mockStoreA });
  const readTokenA = await storageA.readToken();
  assert.equal(readTokenA, null, "Corrupt binary token must safely return null");

  const readDevIdA = await storageA.readDeviceId();
  assert.equal(readDevIdA, null, "Corrupt binary device ID must safely return null");

  const readMetaA = await storageA.readMetadata();
  assert.equal(readMetaA, null, "Corrupt binary metadata must safely return null");

  const managerA = createLicenseManager({ storage: storageA });
  const snapA = await managerA.initialize();
  assert.equal(snapA.state, LICENSE_STATES.UNACTIVATED, "Corrupt storage must safely resolve to UNACTIVATED");

  // Case B: empty Uint8Array
  const mockStoreB = createMockStorage();
  mockStoreB._store.set(STORAGE_KEYS.SIGNED_TOKEN, new Uint8Array(0));
  const storageB = createLicenseStorage({ secureStorage: mockStoreB });
  const readTokenB = await storageB.readToken();
  assert.equal(readTokenB, null, "Empty Uint8Array must return null");
});

test("V2-37. no new device ID generated when valid stored device ID exists", async () => {
  const mockStore = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStore });

  // Store a valid pre-existing device ID
  const existingDeviceId = "existing_permanent_device_id_abcdef123456";
  await storage.writeDeviceId(existingDeviceId);

  // Initialize manager
  const manager = createLicenseManager({ storage });
  const deviceId = await manager._getOrCreateDeviceId();
  assert.equal(deviceId, existingDeviceId, "Manager must reuse existing valid device ID");

  // Verify getInstallationDeviceId also preserves it
  const helperDeviceId = await getInstallationDeviceId(storage);
  assert.equal(helperDeviceId, existingDeviceId, "getInstallationDeviceId must reuse existing valid device ID");

  // Verify storage was not overwritten
  const storedAfter = await storage.readDeviceId();
  assert.equal(storedAfter, existingDeviceId, "Stored device ID must remain untouched");
});
