"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { PLUGIN_VERSION, STORAGE_KEYS, ADMIN_CONTACT_DISPLAY, ADMIN_CONTACT_E164, ADMIN_WHATSAPP_MESSAGE, getAdminWhatsAppUrl } = require("../src/licensing/constants");
const { LICENSE_STATES, isOperationalState } = require("../src/licensing/licenseState");
const { createLicenseManager, LicenseManager, SAFE_USER_MESSAGES } = require("../src/licensing/licenseManager");
const { createLicenseStorage } = require("../src/licensing/licenseStorage");
const { verifyToken } = require("../src/licensing/crypto/tokenVerifier");
const PRODUCTION_CONFIG = require("../src/licensing/productionConfig");
const { LicenseApiClient } = require("../src/licensing/licenseApi");

// Tool imports to prove regression stability
const { extractAlbumSerial, buildPageBaseName, getNextPageNumber } = require("../src/tools/savePage");
const { buildEditedPhotoFileName, extractEditedPhotoNumber, findNextEditedPhotoNumber } = require("../src/tools/saveEditedPhotos");

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

const manifestPath = path.resolve(__dirname, "../manifest.json");
const readManifest = () => JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const readIndexHtml = () => fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");

// =============================================================================
// ADOBE MARKETPLACE BUILD SPECIFICATION TESTS
// =============================================================================

test("1. manifest.json id is exactly 9beaddeb for Adobe Marketplace", () => {
  const manifest = readManifest();
  assert.equal(manifest.id, "9beaddeb", "Marketplace manifest ID must be exactly '9beaddeb'");
  assert.notEqual(manifest.id, "in.memorymaker.albumplacer", "Marketplace build must not use direct-distribution manifest ID");
});

test("2. manifest name remains 'FM Album Designing Tools'", () => {
  const manifest = readManifest();
  assert.equal(manifest.name, "FM Album Designing Tools");
  assert.equal(manifest.entrypoints?.[0]?.label?.default, "FM Album Designing Tools");

  const html = readIndexHtml();
  assert.match(html, />FM Album Designing Tools</);
  assert.match(html, />FRAME MITRA</);
});

test("3. manifest version remains 1.4.2", () => {
  const manifest = readManifest();
  assert.equal(manifest.version, "1.4.2");
  assert.equal(manifest.manifestVersion, 5);
  assert.equal(PLUGIN_VERSION, "1.4.2");

  const html = readIndexHtml();
  assert.match(html, /v1\.4\.2/);
});

test("4. Photoshop host remains unchanged", () => {
  const manifest = readManifest();
  assert.deepEqual(manifest.host, {
    app: "PS",
    minVersion: "23.3.0",
    data: {
      apiVersion: 2
    }
  });
  assert.equal(manifest.host.app, "PS");
  assert.equal(manifest.host.minVersion, "23.3.0");
  assert.equal(manifest.host.data.apiVersion, 2);
});

test("5. internal licensing product/plugin ID remains in.memorymaker.albumplacer", async () => {
  const keypair = generateTestKeypair();
  const now = Math.floor(Date.now() / 1000);

  // Valid internal plugin ID token passes verification
  const validPayload = {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    licenseId: "lic_test_123",
    activationId: "act_test_123",
    plan: "trial",
    status: "active",
    deviceHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    entitlements: ["all-tools"],
    issuedAt: now,
    refreshAfter: now + 86400 * 7,
    graceUntil: now + 86400 * 14,
    expiresAt: now + 86400 * 30
  };
  const validToken = signTestToken("k1", validPayload, keypair.privateKey);
  const verifyRes = verifyToken(validToken, {
    publicKeySpki: keypair.spkiB64,
    expectedKid: "k1",
    expectedDeviceHash: validPayload.deviceHash
  });
  assert.equal(verifyRes.ok, true);
  assert.equal(verifyRes.payload.pluginId, "in.memorymaker.albumplacer");

  // A token carrying marketplace ID '9beaddeb' MUST BE REJECTED by internal licensing crypto
  const marketplacePayload = { ...validPayload, pluginId: "9beaddeb" };
  const marketplaceToken = signTestToken("k1", marketplacePayload, keypair.privateKey);
  const verifyResMarketplace = verifyToken(marketplaceToken, {
    publicKeySpki: keypair.spkiB64,
    expectedKid: "k1",
    expectedDeviceHash: validPayload.deviceHash
  });
  assert.equal(verifyResMarketplace.ok, false);
  assert.equal(verifyResMarketplace.error, "INVALID_TOKEN_PLUGIN_ID");

  // LicenseManager also rejects mismatched pluginId in startTrial
  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  await storage.writeDeviceId(validPayload.deviceHash);
  const manager = createLicenseManager({
    storage,
    apiClient: {
      startTrial: async () => ({ ok: true, data: { token: marketplaceToken } })
    },
    verifier: () => ({ ok: true, payload: marketplacePayload })
  });
  await manager.initialize();
  const trialRes = await manager.startTrial();
  assert.equal(trialRes.ok, false);
  assert.equal(trialRes.error, "PLUGIN_ID_MISMATCH");
});

test("6. MM1 signed token prefix remains unchanged", () => {
  const keypair = generateTestKeypair();
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    licenseId: "lic_mm1_test",
    activationId: "act_mm1_test",
    plan: "pro",
    status: "active",
    deviceHash: "1111111111111111111111111111111111111111111111111111111111111111",
    entitlements: ["all-tools"],
    issuedAt: now,
    refreshAfter: now + 86400 * 7,
    graceUntil: now + 86400 * 14,
    expiresAt: now + 86400 * 30
  };

  const mm1Token = signTestToken("k1", payload, keypair.privateKey);
  assert.ok(mm1Token.startsWith("MM1.k1."));

  const res = verifyToken(mm1Token, {
    publicKeySpki: keypair.spkiB64,
    expectedKid: "k1",
    expectedDeviceHash: payload.deviceHash
  });
  assert.equal(res.ok, true);

  // Prefixes other than MM1 are strictly rejected
  const nonMm1Token = mm1Token.replace(/^MM1\./, "FM1.");
  const resBad = verifyToken(nonMm1Token, {
    publicKeySpki: keypair.spkiB64,
    expectedKid: "k1",
    expectedDeviceHash: payload.deviceHash
  });
  assert.equal(resBad.ok, false);
  assert.equal(resBad.error, "INVALID_TOKEN_PREFIX");
});

test("7. secureStorage keys remain unchanged", () => {
  assert.equal(STORAGE_KEYS.SIGNED_TOKEN, "mm_license_signed_token_v1");
  assert.equal(STORAGE_KEYS.LICENSE_METADATA, "mm_license_metadata_v1");
  assert.equal(STORAGE_KEYS.DEVICE_ID, "mm_license_device_id_v1");

  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  assert.equal(typeof storage.readToken, "function");
  assert.equal(typeof storage.writeToken, "function");
  assert.equal(typeof storage.readDeviceId, "function");
  assert.equal(typeof storage.writeDeviceId, "function");
  assert.equal(typeof storage.readMetadata, "function");
  assert.equal(typeof storage.writeMetadata, "function");
  assert.equal(typeof storage.clearAll, "function");
});

test("8. API URLs, permissions and endpoints remain unchanged", () => {
  const manifest = readManifest();
  assert.equal(PRODUCTION_CONFIG.API_BASE_URL, "https://mm-license-server.rammonihalder.workers.dev");
  assert.ok(manifest.requiredPermissions.network.domains.includes("https://mm-license-server.rammonihalder.workers.dev"));
  assert.notEqual(manifest.requiredPermissions.network.domains, "all");

  assert.equal(PRODUCTION_CONFIG.SIGNING_KEY_ID, "k1");
  assert.ok(PRODUCTION_CONFIG.SIGNING_PUBLIC_KEY_SPKI_B64);
  assert.equal(PRODUCTION_CONFIG.SIGNING_PUBLIC_KEY_SPKI_B64.length, 60);

  const api = new LicenseApiClient({ baseUrl: PRODUCTION_CONFIG.API_BASE_URL });
  assert.equal(typeof api.activate, "function");
  assert.equal(typeof api.refresh, "function");
  assert.equal(typeof api.deactivate, "function");
  assert.equal(typeof api.startTrial, "function");
  assert.equal(typeof api.refreshTrial, "function");
});

test("9. existing paid-license lifecycle remains operational", async () => {
  const keypair = generateTestKeypair();
  const deviceHash = "2222222222222222222222222222222222222222222222222222222222222222";
  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  await storage.writeDeviceId(deviceHash);
  const now = Math.floor(Date.now() / 1000);

  const payload = {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    licenseId: "lic_paid_999",
    activationId: "act_paid_999",
    plan: "pro",
    status: "active",
    deviceHash,
    entitlements: ["all-tools"],
    issuedAt: now,
    refreshAfter: now + 86400 * 7,
    graceUntil: now + 86400 * 14,
    expiresAt: now + 86400 * 365
  };
  const token = signTestToken("k1", payload, keypair.privateKey);

  const mockApi = {
    async activate() { return { ok: true, data: { token } }; },
    async refresh() { return { ok: true, data: { token } }; },
    async deactivate() { return { ok: true, data: { deactivated: true } }; }
  };

  const manager = createLicenseManager({
    storage,
    apiClient: mockApi,
    verifier: (t) => verifyToken(t, {
      publicKeySpki: keypair.spkiB64,
      expectedKid: "k1",
      expectedDeviceHash: deviceHash
    })
  });

  await manager.initialize();
  assert.equal(manager.getState(), LICENSE_STATES.UNACTIVATED);
  assert.equal(manager.isOperational(), false);

  const actResult = await manager.activate("VALID-LICENSE-KEY");
  assert.equal(actResult.ok, true);
  assert.equal(manager.getState(), LICENSE_STATES.ACTIVE);
  assert.equal(manager.isOperational(), true);

  const refResult = await manager.refresh();
  assert.equal(refResult.ok, true);
  assert.equal(manager.getState(), LICENSE_STATES.ACTIVE);
  assert.equal(manager.isOperational(), true);

  const deactResult = await manager.deactivate();
  assert.equal(deactResult.ok, true);
  assert.equal(manager.getState(), LICENSE_STATES.UNACTIVATED);
  assert.equal(manager.isOperational(), false);
});

test("10. existing trial lifecycle remains operational", async () => {
  const keypair = generateTestKeypair();
  const deviceHash = "3333333333333333333333333333333333333333333333333333333333333333";
  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  await storage.writeDeviceId(deviceHash);
  const now = Math.floor(Date.now() / 1000);

  const trialPayload = {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    licenseId: "lic_trial_30d",
    activationId: "act_trial_30d",
    plan: "trial",
    status: "active",
    deviceHash,
    entitlements: ["all-tools"],
    issuedAt: now,
    refreshAfter: now + 86400 * 7,
    graceUntil: now + 86400 * 30,
    expiresAt: now + 86400 * 30
  };
  const trialToken = signTestToken("k1", trialPayload, keypair.privateKey);

  let trialStartCalls = 0;
  const mockApi = {
    async startTrial() {
      trialStartCalls++;
      if (trialStartCalls === 1) {
        return { ok: true, data: { token: trialToken } };
      }
      return { ok: false, error: "TRIAL_ALREADY_USED", message: "Trial already used" };
    },
    async refreshTrial() { return { ok: true, data: { token: trialToken } }; }
  };

  const manager = createLicenseManager({
    storage,
    apiClient: mockApi,
    verifier: (t) => verifyToken(t, {
      publicKeySpki: keypair.spkiB64,
      expectedKid: "k1",
      expectedDeviceHash: deviceHash
    })
  });

  await manager.initialize();
  assert.equal(manager.getState(), LICENSE_STATES.UNACTIVATED);

  const startRes = await manager.startTrial();
  assert.equal(startRes.ok, true);
  assert.equal(manager.getState(), LICENSE_STATES.TRIAL);
  assert.equal(manager.isOperational(), true);

  // trialPreviouslyStarted flag is persisted in metadata
  const meta = await storage.readMetadata();
  assert.equal(meta.trialPreviouslyStarted, true);

  // Re-starting trial when already used is rejected
  const restartRes = await manager.startTrial();
  assert.equal(restartRes.ok, false);
});

test("11. full tool regression invariants and branding remain intact", () => {
  // Brand and Contact Constants
  assert.equal(ADMIN_CONTACT_DISPLAY, "7001514367");
  assert.equal(ADMIN_CONTACT_E164, "917001514367");
  assert.equal(ADMIN_WHATSAPP_MESSAGE, "I want to buy a license for FM Album Designing Tools.");
  assert.equal(
    getAdminWhatsAppUrl(),
    "https://wa.me/917001514367?text=" + encodeURIComponent("I want to buy a license for FM Album Designing Tools.")
  );

  // Page naming invariants (FMRLT<n>)
  assert.equal(extractAlbumSerial("FMRLT1.psd"), 1);
  assert.equal(extractAlbumSerial("Wedding_FMRLT12.psd"), 12);
  assert.equal(extractAlbumSerial("MMRLT1.psd"), null, "legacy MMRLT ignored");
  assert.equal(buildPageBaseName("", 1), "FMRLT1");
  assert.equal(buildPageBaseName("Wedding", 5), "Wedding_FMRLT5");
  assert.equal(getNextPageNumber(["FMRLT5.psd"], ["Wedding_FMRLT9.jpg"]), 10);

  // Edited photo naming invariants (FM<n> LT.jpg, FM<n> DT.jpg)
  assert.equal(buildEditedPhotoFileName(1, "LT"), "FM1 LT.jpg");
  assert.equal(buildEditedPhotoFileName(1, "DT"), "FM1 DT.jpg");
  assert.equal(extractEditedPhotoNumber("FM1 LT.jpg"), 1);
  assert.equal(extractEditedPhotoNumber("FM2 DT.jpg"), 2);
  assert.equal(findNextEditedPhotoNumber(["FM1 LT.jpg", "FM2 DT.jpg"]), 3);
});
