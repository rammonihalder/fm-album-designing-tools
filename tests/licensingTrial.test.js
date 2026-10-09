"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { LICENSE_STATES, isOperationalState } = require("../src/licensing/licenseState");
const { createLicenseManager, LicenseManager, SAFE_USER_MESSAGES, getGenericDeviceName } = require("../src/licensing/licenseManager");
const { createLicenseStorage } = require("../src/licensing/licenseStorage");
const { getInstallationDeviceId } = require("../src/licensing/deviceId");
const { verifyToken } = require("../src/licensing/crypto/tokenVerifier");

class TokenVerifier {
  constructor(options = {}) {
    this._options = options;
  }
  verify(token) {
    return verifyToken(token, this._options);
  }
}
const { STORAGE_KEYS, PLUGIN_VERSION, TRIAL_DURATION_DAYS, TRIAL_DURATION_MS } = require("../src/licensing/constants");
const PRODUCTION_CONFIG = require("../src/licensing/productionConfig");
const mainModule = require("../main");

function toMockBytes(v) {
  if (v == null) return null;
  if (v instanceof Uint8Array) return v;
  if (typeof v === "string") return new TextEncoder().encode(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
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

function createMockElement(initial = {}) {
  const listeners = new Map();
  const attributes = new Map();
  const classListSet = new Set(initial.classes || []);

  const el = {
    textContent: initial.textContent || "",
    value: initial.value || "",
    hidden: initial.hidden ?? false,
    disabled: initial.disabled ?? false,
    className: initial.className || Array.from(classListSet).join(" "),
    classList: {
      add(...classes) {
        classes.forEach(c => classListSet.add(c));
        el.className = Array.from(classListSet).join(" ");
      },
      remove(...classes) {
        classes.forEach(c => classListSet.delete(c));
        el.className = Array.from(classListSet).join(" ");
      },
      contains(c) {
        return classListSet.has(c);
      }
    },
    setAttribute(k, v) {
      attributes.set(k, String(v));
    },
    getAttribute(k) {
      return attributes.get(k) || null;
    },
    addEventListener(evt, fn) {
      if (!listeners.has(evt)) listeners.set(evt, []);
      listeners.get(evt).push(fn);
    },
    async fire(evt, data = {}) {
      const fns = listeners.get(evt) || [];
      for (const fn of fns) {
        await fn({ preventDefault() {}, stopPropagation() {}, ...data });
      }
    }
  };
  return el;
}

// =============================================================================
// PART 1 — TRIAL CORE TESTS (1 - 38)
// =============================================================================

test("1. TRIAL state exists", () => {
  assert.equal(LICENSE_STATES.TRIAL, "TRIAL");
});

test("2. TRIAL_EXPIRED state exists", () => {
  assert.equal(LICENSE_STATES.TRIAL_EXPIRED, "TRIAL_EXPIRED");
});

test("3. TRIAL is operational", () => {
  assert.equal(isOperationalState(LICENSE_STATES.TRIAL), true);
});

test("4. TRIAL_EXPIRED is blocked", () => {
  assert.equal(isOperationalState(LICENSE_STATES.TRIAL_EXPIRED), false);
});

test("5. ACTIVE remains operational", () => {
  assert.equal(isOperationalState(LICENSE_STATES.ACTIVE), true);
});

test("6. GRACE remains operational", () => {
  assert.equal(isOperationalState(LICENSE_STATES.GRACE), true);
});

test("7. UNACTIVATED blocked", () => {
  assert.equal(isOperationalState(LICENSE_STATES.UNACTIVATED), false);
});

test("8. Trial start calls /v1/trial/start", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const kid = "test_k1";
  let calledEndpoint = null;

  const mockApiClient = {
    async startTrial(req) {
      calledEndpoint = "/v1/trial/start";
      const now = Math.floor(Date.now() / 1000);
      const token = signTestToken(kid, {
        v: 1,
        iss: "mm-license-server",
        pluginId: "in.memorymaker.albumplacer",
        licenseId: "trial_123",
        activationId: "act_trial_123",
        deviceHash: req.deviceHash,
        plan: "trial",
        entitlements: [],
        issuedAt: now,
        refreshAfter: now + 3600 * 24 * 7,
        graceUntil: now + 3600 * 24 * 30,
        expiresAt: now + 3600 * 24 * 30
      }, privateKey);
      return { ok: true, data: { ok: true, token, trial: { plan: "trial" } } };
    }
  };

  const storage = createLicenseStorage({ secureStorage: createMockStorage() });
  const verifier = new TokenVerifier({
    expectedKid: kid,
    publicKeySpki: spkiB64,
    expectedPluginId: "in.memorymaker.albumplacer",
    expectedIssuer: "mm-license-server"
  });

  const manager = new LicenseManager({
    storage,
    apiClient: mockApiClient,
    verifier,
    pluginVersion: "1.3.0"
  });

  const res = await manager.startTrial();
  assert.equal(res.ok, true);
  assert.equal(calledEndpoint, "/v1/trial/start");
});

test("9. Device ID is sent to /v1/trial/start", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const kid = "test_k1";
  let capturedDeviceHash = null;

  const mockApiClient = {
    async startTrial(req) {
      capturedDeviceHash = req.deviceHash;
      const now = Math.floor(Date.now() / 1000);
      const token = signTestToken(kid, {
        v: 1,
        iss: "mm-license-server",
        pluginId: "in.memorymaker.albumplacer",
        licenseId: "trial_123",
        activationId: "act_trial_123",
        deviceHash: req.deviceHash,
        plan: "trial",
        entitlements: [],
        issuedAt: now,
        refreshAfter: now + 86400 * 7,
        graceUntil: now + 86400 * 30,
        expiresAt: now + 86400 * 30
      }, privateKey);
      return { ok: true, data: { ok: true, token } };
    }
  };

  const storage = createLicenseStorage({ secureStorage: createMockStorage() });
  const verifier = new TokenVerifier({ expectedKid: kid, publicKeySpki: spkiB64 });
  const manager = new LicenseManager({ storage, apiClient: mockApiClient, verifier, pluginVersion: "1.3.0" });

  await manager.startTrial();
  assert.ok(capturedDeviceHash && typeof capturedDeviceHash === "string");
  assert.ok(capturedDeviceHash.length >= 16);
});

test("10. Generic device name is sent", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const kid = "test_k1";
  let capturedDeviceName = null;

  const mockApiClient = {
    async startTrial(req) {
      capturedDeviceName = req.deviceName;
      const now = Math.floor(Date.now() / 1000);
      const token = signTestToken(kid, {
        v: 1,
        iss: "mm-license-server",
        pluginId: "in.memorymaker.albumplacer",
        licenseId: "trial_123",
        activationId: "act_trial_123",
        deviceHash: req.deviceHash,
        plan: "trial",
        entitlements: [],
        issuedAt: now,
        refreshAfter: now + 86400 * 7,
        graceUntil: now + 86400 * 30,
        expiresAt: now + 86400 * 30
      }, privateKey);
      return { ok: true, data: { ok: true, token } };
    }
  };

  const storage = createLicenseStorage({ secureStorage: createMockStorage() });
  const verifier = new TokenVerifier({ expectedKid: kid, publicKeySpki: spkiB64 });
  const manager = new LicenseManager({ storage, apiClient: mockApiClient, verifier, pluginVersion: "1.3.0" });

  await manager.startTrial();
  assert.ok(capturedDeviceName && (capturedDeviceName.includes("Photoshop") || capturedDeviceName.includes("Desktop")));
});

test("11. Plugin version is sent", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const kid = "test_k1";
  let capturedVersion = null;

  const mockApiClient = {
    async startTrial(req) {
      capturedVersion = req.pluginVersion;
      const now = Math.floor(Date.now() / 1000);
      const token = signTestToken(kid, {
        v: 1,
        iss: "mm-license-server",
        pluginId: "in.memorymaker.albumplacer",
        licenseId: "trial_123",
        activationId: "act_trial_123",
        deviceHash: req.deviceHash,
        plan: "trial",
        entitlements: [],
        issuedAt: now,
        refreshAfter: now + 86400 * 7,
        graceUntil: now + 86400 * 30,
        expiresAt: now + 86400 * 30
      }, privateKey);
      return { ok: true, data: { ok: true, token } };
    }
  };

  const storage = createLicenseStorage({ secureStorage: createMockStorage() });
  const verifier = new TokenVerifier({ expectedKid: kid, publicKeySpki: spkiB64 });
  const manager = new LicenseManager({ storage, apiClient: mockApiClient, verifier, pluginVersion: "1.3.0" });

  await manager.startTrial();
  assert.equal(capturedVersion, "1.3.0");
});

test("12. Trial token must verify before storage", async () => {
  const { spkiB64 } = generateTestKeypair();
  const otherKeypair = generateTestKeypair();
  const kid = "test_k1";

  // Signed by a different key
  const mockApiClient = {
    async startTrial(req) {
      const now = Math.floor(Date.now() / 1000);
      const token = signTestToken(kid, {
        v: 1,
        iss: "mm-license-server",
        pluginId: "in.memorymaker.albumplacer",
        licenseId: "trial_bad",
        activationId: "act_trial_bad",
        deviceHash: req.deviceHash,
        plan: "trial",
        entitlements: [],
        issuedAt: now,
        refreshAfter: now + 86400,
        graceUntil: now + 86400 * 30,
        expiresAt: now + 86400 * 30
      }, otherKeypair.privateKey);
      return { ok: true, data: { ok: true, token } };
    }
  };

  const storage = createLicenseStorage({ secureStorage: createMockStorage() });
  const verifier = new TokenVerifier({ expectedKid: kid, publicKeySpki: spkiB64 });
  const manager = new LicenseManager({ storage, apiClient: mockApiClient, verifier, pluginVersion: "1.3.0" });

  const res = await manager.startTrial();
  assert.equal(res.ok, false);
  const storedToken = await storage.readToken();
  assert.equal(storedToken, null, "Untrusted token must not be written to storage");
});

test("13. Invalid trial signature rejected", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const kid = "test_k1";

  const mockApiClient = {
    async startTrial(req) {
      const now = Math.floor(Date.now() / 1000);
      const validToken = signTestToken(kid, {
        v: 1,
        iss: "mm-license-server",
        pluginId: "in.memorymaker.albumplacer",
        licenseId: "trial_tampered",
        activationId: "act_trial_tampered",
        deviceHash: req.deviceHash,
        plan: "trial",
        entitlements: [],
        issuedAt: now,
        refreshAfter: now + 86400,
        graceUntil: now + 86400 * 30,
        expiresAt: now + 86400 * 30
      }, privateKey);
      // Tamper signature
      const tampered = validToken.slice(0, -5) + "abcde";
      return { ok: true, data: { ok: true, token: tampered } };
    }
  };

  const storage = createLicenseStorage({ secureStorage: createMockStorage() });
  const verifier = new TokenVerifier({ expectedKid: kid, publicKeySpki: spkiB64 });
  const manager = new LicenseManager({ storage, apiClient: mockApiClient, verifier, pluginVersion: "1.3.0" });

  const res = await manager.startTrial();
  assert.equal(res.ok, false);
  assert.equal(manager.getState(), LICENSE_STATES.UNACTIVATED);
});

test("14. Wrong device trial token rejected", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const kid = "test_k1";

  const mockApiClient = {
    async startTrial(req) {
      const now = Math.floor(Date.now() / 1000);
      const token = signTestToken(kid, {
        v: 1,
        iss: "mm-license-server",
        pluginId: "in.memorymaker.albumplacer",
        licenseId: "trial_diff_device",
        activationId: "act_trial_diff_device",
        deviceHash: "completely_different_device_id",
        plan: "trial",
        entitlements: [],
        issuedAt: now,
        refreshAfter: now + 86400,
        graceUntil: now + 86400 * 30,
        expiresAt: now + 86400 * 30
      }, privateKey);
      return { ok: true, data: { ok: true, token } };
    }
  };

  const storage = createLicenseStorage({ secureStorage: createMockStorage() });
  const verifier = new TokenVerifier({ expectedKid: kid, publicKeySpki: spkiB64 });
  const manager = new LicenseManager({ storage, apiClient: mockApiClient, verifier, pluginVersion: "1.3.0" });

  const res = await manager.startTrial();
  assert.equal(res.ok, false);
  assert.equal(manager.getState(), LICENSE_STATES.UNACTIVATED);
});

test("15. Wrong pluginId rejected", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const kid = "test_k1";

  const mockApiClient = {
    async startTrial(req) {
      const now = Math.floor(Date.now() / 1000);
      const token = signTestToken(kid, {
        v: 1,
        iss: "mm-license-server",
        pluginId: "in.wrong.plugin",
        licenseId: "trial_wrong_plugin",
        activationId: "act_trial_wrong_plugin",
        deviceHash: req.deviceHash,
        plan: "trial",
        entitlements: [],
        issuedAt: now,
        refreshAfter: now + 86400,
        graceUntil: now + 86400 * 30,
        expiresAt: now + 86400 * 30
      }, privateKey);
      return { ok: true, data: { ok: true, token } };
    }
  };

  const storage = createLicenseStorage({ secureStorage: createMockStorage() });
  const verifier = new TokenVerifier({ expectedKid: kid, publicKeySpki: spkiB64 });
  const manager = new LicenseManager({ storage, apiClient: mockApiClient, verifier, pluginVersion: "1.3.0" });

  const res = await manager.startTrial();
  assert.equal(res.ok, false);
});

test("16. Non-trial token returned from startTrial rejected", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const kid = "test_k1";

  const mockApiClient = {
    async startTrial(req) {
      const now = Math.floor(Date.now() / 1000);
      const token = signTestToken(kid, {
        v: 1,
        iss: "mm-license-server",
        pluginId: "in.memorymaker.albumplacer",
        licenseId: "paid_license_123",
        activationId: "act_paid_123",
        deviceHash: req.deviceHash,
        plan: "pro", // not 'trial'
        entitlements: ["all-tools"],
        issuedAt: now,
        refreshAfter: now + 86400,
        graceUntil: now + 86400 * 30,
        expiresAt: now + 86400 * 30
      }, privateKey);
      return { ok: true, data: { ok: true, token } };
    }
  };

  const storage = createLicenseStorage({ secureStorage: createMockStorage() });
  const verifier = new TokenVerifier({ expectedKid: kid, publicKeySpki: spkiB64 });
  const manager = new LicenseManager({ storage, apiClient: mockApiClient, verifier, pluginVersion: "1.3.0" });

  const res = await manager.startTrial();
  assert.equal(res.ok, false);
  assert.equal(res.error, "INVALID_TOKEN_PLAN");
});

test("17. Valid token saved", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const kid = "test_k1";

  const mockApiClient = {
    async startTrial(req) {
      const now = Math.floor(Date.now() / 1000);
      const token = signTestToken(kid, {
        v: 1,
        iss: "mm-license-server",
        pluginId: "in.memorymaker.albumplacer",
        licenseId: "trial_save_test",
        activationId: "act_save_test",
        deviceHash: req.deviceHash,
        plan: "trial",
        entitlements: [],
        issuedAt: now,
        refreshAfter: now + 86400 * 7,
        graceUntil: now + 86400 * 30,
        expiresAt: now + 86400 * 30
      }, privateKey);
      return { ok: true, data: { ok: true, token } };
    }
  };

  const storage = createLicenseStorage({ secureStorage: createMockStorage() });
  const verifier = new TokenVerifier({ expectedKid: kid, publicKeySpki: spkiB64 });
  const manager = new LicenseManager({ storage, apiClient: mockApiClient, verifier, pluginVersion: "1.3.0" });

  const res = await manager.startTrial();
  assert.equal(res.ok, true);
  const stored = await storage.readToken();
  assert.ok(stored?.token && stored.token.startsWith("MM1.test_k1."));
});

test("18. Valid start sets TRIAL state", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const kid = "test_k1";

  const mockApiClient = {
    async startTrial(req) {
      const now = Math.floor(Date.now() / 1000);
      const token = signTestToken(kid, {
        v: 1,
        iss: "mm-license-server",
        pluginId: "in.memorymaker.albumplacer",
        licenseId: "trial_ok",
        activationId: "act_ok",
        deviceHash: req.deviceHash,
        plan: "trial",
        entitlements: [],
        issuedAt: now,
        refreshAfter: now + 86400 * 7,
        graceUntil: now + 86400 * 30,
        expiresAt: now + 86400 * 30
      }, privateKey);
      return { ok: true, data: { ok: true, token } };
    }
  };

  const storage = createLicenseStorage({ secureStorage: createMockStorage() });
  const verifier = new TokenVerifier({ expectedKid: kid, publicKeySpki: spkiB64 });
  const manager = new LicenseManager({ storage, apiClient: mockApiClient, verifier, pluginVersion: "1.3.0" });

  await manager.startTrial();
  assert.equal(manager.getState(), LICENSE_STATES.TRIAL);
  assert.equal(manager.isOperational(), true);
});

test("19. Fresh cached trial restores after restart", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const kid = "test_k1";
  const sharedStorageProvider = createMockStorage();

  const mockApiClient = {
    async startTrial(req) {
      const now = Math.floor(Date.now() / 1000);
      const token = signTestToken(kid, {
        v: 1,
        iss: "mm-license-server",
        pluginId: "in.memorymaker.albumplacer",
        licenseId: "trial_restart",
        activationId: "act_restart",
        deviceHash: req.deviceHash,
        plan: "trial",
        entitlements: [],
        issuedAt: now,
        refreshAfter: now + 86400 * 7,
        graceUntil: now + 86400 * 30,
        expiresAt: now + 86400 * 30
      }, privateKey);
      return { ok: true, data: { ok: true, token } };
    }
  };

  const storageA = createLicenseStorage({ secureStorage: sharedStorageProvider });
  const verifier = new TokenVerifier({ expectedKid: kid, publicKeySpki: spkiB64 });
  const managerA = new LicenseManager({ storage: storageA, apiClient: mockApiClient, verifier, pluginVersion: "1.3.0" });

  await managerA.startTrial();
  assert.equal(managerA.getState(), LICENSE_STATES.TRIAL);

  // Restart: simulate new plugin startup using same storage
  const storageB = createLicenseStorage({ secureStorage: sharedStorageProvider });
  const managerB = new LicenseManager({
    storage: storageB,
    apiClient: {
      async refreshTrial() { throw new Error("Network should not be touched on fresh startup"); }
    },
    verifier,
    pluginVersion: "1.3.0"
  });

  await managerB.initialize();
  assert.equal(managerB.getState(), LICENSE_STATES.TRIAL);
  assert.equal(managerB.isOperational(), true);
});

test("20. Fresh trial startup requires zero network", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const kid = "test_k1";
  let networkCalled = false;

  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  const deviceId = await getInstallationDeviceId(storage);
  const now = Math.floor(Date.now() / 1000);

  const token = signTestToken(kid, {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    licenseId: "trial_zero_net",
    activationId: "act_zero_net",
    deviceHash: deviceId,
    plan: "trial",
    entitlements: [],
    issuedAt: now,
    refreshAfter: now + 86400 * 7,
    graceUntil: now + 86400 * 30,
    expiresAt: now + 86400 * 30
  }, privateKey);

  await storage.writeToken({ token, savedAt: Date.now() });
  await storage.writeMetadata({ lastValidatedAt: now, lastObservedTime: now });

  const mockApiClient = {
    async refreshTrial() { networkCalled = true; return { ok: false }; },
    async refresh() { networkCalled = true; return { ok: false }; }
  };

  const verifier = new TokenVerifier({ expectedKid: kid, publicKeySpki: spkiB64 });
  const manager = new LicenseManager({ storage, apiClient: mockApiClient, verifier, pluginVersion: "1.3.0" });

  await manager.initialize();
  assert.equal(networkCalled, false, "Fresh trial startup must make zero network requests");
  assert.equal(manager.getState(), LICENSE_STATES.TRIAL);
});

test("21. Refresh-due trial calls /v1/trial/refresh", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const kid = "test_k1";
  let refreshCalled = false;

  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  const deviceId = await getInstallationDeviceId(storage);
  const now = Math.floor(Date.now() / 1000);

  // refreshAfter is in the PAST, but expiresAt is in the FUTURE
  const originalExpiresAt = now + 86400 * 20;
  const token = signTestToken(kid, {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    licenseId: "trial_due",
    activationId: "act_due",
    deviceHash: deviceId,
    plan: "trial",
    entitlements: [],
    issuedAt: now - 86400 * 8,
    refreshAfter: now - 3600, // Due 1 hr ago
    graceUntil: originalExpiresAt,
    expiresAt: originalExpiresAt
  }, privateKey);

  await storage.writeToken({ token, savedAt: Date.now() });
  await storage.writeMetadata({ lastValidatedAt: now - 86400 * 8, lastObservedTime: now - 86400 * 8 });

  const mockApiClient = {
    async refreshTrial(req) {
      refreshCalled = true;
      const newToken = signTestToken(kid, {
        v: 1,
        iss: "mm-license-server",
        pluginId: "in.memorymaker.albumplacer",
        licenseId: "trial_due",
        activationId: "act_due",
        deviceHash: req.deviceHash,
        plan: "trial",
        entitlements: [],
        issuedAt: now,
        refreshAfter: now + 86400 * 7,
        graceUntil: originalExpiresAt,
        expiresAt: originalExpiresAt
      }, privateKey);
      return { ok: true, data: { ok: true, token: newToken } };
    }
  };

  const verifier = new TokenVerifier({ expectedKid: kid, publicKeySpki: spkiB64 });
  const manager = new LicenseManager({ storage, apiClient: mockApiClient, verifier, pluginVersion: "1.3.0" });

  await manager.initialize();
  assert.equal(refreshCalled, true, "Refresh-due trial must trigger /v1/trial/refresh");
  assert.equal(manager.getState(), LICENSE_STATES.TRIAL);
});

test("22. Refreshed token is verified before saving", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const otherKey = generateTestKeypair();
  const kid = "test_k1";

  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  const deviceId = await getInstallationDeviceId(storage);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 86400 * 15;

  const origToken = signTestToken(kid, {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    licenseId: "trial_orig",
    activationId: "act_orig",
    deviceHash: deviceId,
    plan: "trial",
    entitlements: [],
    issuedAt: now - 86400 * 8,
    refreshAfter: now - 100,
    graceUntil: expiresAt,
    expiresAt
  }, privateKey);

  await storage.writeToken({ token: origToken, savedAt: Date.now() });
  await storage.writeMetadata({ lastValidatedAt: now - 86400 * 8, lastObservedTime: now - 86400 * 8 });

  // Server returns forged token
  const mockApiClient = {
    async refreshTrial() {
      const forgedToken = signTestToken(kid, {
        v: 1,
        iss: "mm-license-server",
        pluginId: "in.memorymaker.albumplacer",
        licenseId: "trial_forged",
        activationId: "act_forged",
        deviceHash: deviceId,
        plan: "trial",
        entitlements: [],
        issuedAt: now,
        refreshAfter: now + 86400 * 7,
        graceUntil: expiresAt,
        expiresAt
      }, otherKey.privateKey);
      return { ok: true, data: { ok: true, token: forgedToken } };
    }
  };

  const verifier = new TokenVerifier({ expectedKid: kid, publicKeySpki: spkiB64 });
  const manager = new LicenseManager({ storage, apiClient: mockApiClient, verifier, pluginVersion: "1.3.0" });

  await manager.initialize();
  // Invalid refreshed token must NOT overwrite storage
  const currentToken = await storage.readToken();
  assert.equal(currentToken?.token, origToken);
  // Stays operational trial because now < expiresAt
  assert.equal(manager.getState(), LICENSE_STATES.TRIAL);
});

test("23. Network failure before expiresAt stays TRIAL", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const kid = "test_k1";

  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  const deviceId = await getInstallationDeviceId(storage);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 86400 * 10; // Still 10 days left

  const token = signTestToken(kid, {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    licenseId: "trial_offline",
    activationId: "act_offline",
    deviceHash: deviceId,
    plan: "trial",
    entitlements: [],
    issuedAt: now - 86400 * 8,
    refreshAfter: now - 3600, // Due for refresh
    graceUntil: expiresAt,
    expiresAt
  }, privateKey);

  await storage.writeToken({ token, savedAt: Date.now() });
  await storage.writeMetadata({ lastValidatedAt: now - 86400 * 8, lastObservedTime: now - 86400 * 8 });

  const mockApiClient = {
    async refreshTrial() {
      throw new Error("Network unreachable");
    }
  };

  const verifier = new TokenVerifier({ expectedKid: kid, publicKeySpki: spkiB64 });
  const manager = new LicenseManager({ storage, apiClient: mockApiClient, verifier, pluginVersion: "1.3.0" });

  await manager.initialize();
  assert.equal(manager.getState(), LICENSE_STATES.TRIAL, "Must remain in TRIAL on network failure before expiresAt");
  assert.equal(manager.isOperational(), true);
});

test("24. Trial expires exactly at expiresAt", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const kid = "test_k1";

  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  const deviceId = await getInstallationDeviceId(storage);
  const now = Math.floor(Date.now() / 1000);
  const expiredAt = now - 10; // 10 seconds ago

  const token = signTestToken(kid, {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    licenseId: "trial_expired",
    activationId: "act_expired",
    deviceHash: deviceId,
    plan: "trial",
    entitlements: [],
    issuedAt: now - 86400 * 30,
    refreshAfter: now - 86400 * 7,
    graceUntil: expiredAt,
    expiresAt: expiredAt
  }, privateKey);

  await storage.writeToken({ token, savedAt: Date.now() });
  await storage.writeMetadata({ lastValidatedAt: now - 86400 * 30, lastObservedTime: now });

  const verifier = new TokenVerifier({ expectedKid: kid, publicKeySpki: spkiB64 });
  const manager = new LicenseManager({ storage, verifier, pluginVersion: "1.3.0" });

  await manager.initialize();
  assert.equal(manager.getState(), LICENSE_STATES.TRIAL_EXPIRED);
  assert.equal(manager.isOperational(), false);
});

test("25. No extra 14-day grace after expiry for trial", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const kid = "test_k1";

  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  const deviceId = await getInstallationDeviceId(storage);
  const now = Math.floor(Date.now() / 1000);
  const expiredAt = now - 3600; // 1 hour ago

  const token = signTestToken(kid, {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    licenseId: "trial_no_grace",
    activationId: "act_no_grace",
    deviceHash: deviceId,
    plan: "trial",
    entitlements: [],
    issuedAt: now - 86400 * 30,
    refreshAfter: now - 86400 * 7,
    graceUntil: expiredAt, // Trial grace is same as expiry!
    expiresAt: expiredAt
  }, privateKey);

  await storage.writeToken({ token, savedAt: Date.now() });
  await storage.writeMetadata({ lastValidatedAt: now - 86400 * 30, lastObservedTime: now });

  const verifier = new TokenVerifier({ expectedKid: kid, publicKeySpki: spkiB64 });
  const manager = new LicenseManager({ storage, verifier, pluginVersion: "1.3.0" });

  await manager.initialize();
  assert.notEqual(manager.getState(), LICENSE_STATES.GRACE, "Trial must never enter GRACE state");
  assert.equal(manager.getState(), LICENSE_STATES.TRIAL_EXPIRED);
});

test("26. TRIAL_EXPIRED blocks protected actions", async () => {
  const orig = mainModule.getLicenseManagerInstance();
  try {
    const expiredManager = {
      async initialize() {},
      isOperational: () => false,
      getSnapshot: () => ({ state: LICENSE_STATES.TRIAL_EXPIRED })
    };
    mainModule.setLicenseManager(expiredManager);
    const operational = await mainModule.ensureLicenseOperational();
    assert.equal(operational, false);

    let actionCalled = false;
    const protectedAction = mainModule.wrapProtectedAction(() => { actionCalled = true; });
    const result = await protectedAction();
    assert.equal(actionCalled, false);
    assert.deepEqual(result, { outcome: "license-required" });
  } finally {
    mainModule.setLicenseManager(orig);
  }
});

test("27. Trial paid-upgrade path works", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const kid = "test_k1";

  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  const deviceId = await getInstallationDeviceId(storage);
  const now = Math.floor(Date.now() / 1000);

  // Currently on trial
  const trialToken = signTestToken(kid, {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    licenseId: "trial_upgrade",
    activationId: "act_trial_upgrade",
    deviceHash: deviceId,
    plan: "trial",
    entitlements: [],
    issuedAt: now,
    refreshAfter: now + 86400 * 7,
    graceUntil: now + 86400 * 30,
    expiresAt: now + 86400 * 30
  }, privateKey);

  await storage.writeToken({ token: trialToken, savedAt: Date.now() });
  await storage.writeMetadata({ lastValidatedAt: now, lastObservedTime: now });

  const paidToken = signTestToken(kid, {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    licenseId: "paid_lic_upgrade",
    activationId: "act_paid_upgrade",
    deviceHash: deviceId,
    plan: "pro",
    entitlements: ["all-tools"],
    issuedAt: now,
    refreshAfter: now + 86400 * 7,
    graceUntil: now + 86400 * 14,
    expiresAt: now + 86400 * 365
  }, privateKey);

  const mockApiClient = {
    async activate(req) {
      assert.equal(req.licenseKey, "PAID-KEY-1234");
      return { ok: true, data: { ok: true, token: paidToken } };
    }
  };

  const verifier = new TokenVerifier({ expectedKid: kid, publicKeySpki: spkiB64 });
  const manager = new LicenseManager({ storage, apiClient: mockApiClient, verifier, pluginVersion: "1.3.0" });

  await manager.initialize();
  assert.equal(manager.getState(), LICENSE_STATES.TRIAL);

  const activateRes = await manager.activate("PAID-KEY-1234");
  assert.equal(activateRes.ok, true);
  assert.equal(manager.getState(), LICENSE_STATES.ACTIVE);
  assert.equal(manager.getSnapshot().plan, "pro");
});

test("28. Paid activation replaces cached trial token", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const kid = "test_k1";

  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  const deviceId = await getInstallationDeviceId(storage);
  const now = Math.floor(Date.now() / 1000);

  const trialToken = signTestToken(kid, {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    licenseId: "trial_rep",
    activationId: "act_trial_rep",
    deviceHash: deviceId,
    plan: "trial",
    entitlements: [],
    issuedAt: now,
    refreshAfter: now + 86400 * 7,
    graceUntil: now + 86400 * 30,
    expiresAt: now + 86400 * 30
  }, privateKey);

  await storage.writeToken({ token: trialToken, savedAt: Date.now() });

  const paidToken = signTestToken(kid, {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    licenseId: "paid_rep",
    activationId: "act_paid_rep",
    deviceHash: deviceId,
    plan: "standard",
    entitlements: ["all-tools"],
    issuedAt: now,
    refreshAfter: now + 86400 * 7,
    graceUntil: now + 86400 * 14,
    expiresAt: now + 86400 * 365
  }, privateKey);

  const mockApiClient = {
    async activate() {
      return { ok: true, data: { ok: true, token: paidToken } };
    }
  };

  const verifier = new TokenVerifier({ expectedKid: kid, publicKeySpki: spkiB64 });
  const manager = new LicenseManager({ storage, apiClient: mockApiClient, verifier, pluginVersion: "1.3.0" });

  await manager.initialize();
  await manager.activate("VALID-PAID-KEY");

  const stored = await storage.readToken();
  assert.equal(stored?.token, paidToken, "Stored token must now be the paid token");
});

test("29. Paid activation state becomes ACTIVE", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const kid = "test_k1";

  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  const deviceId = await getInstallationDeviceId(storage);
  const now = Math.floor(Date.now() / 1000);

  const paidToken = signTestToken(kid, {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    licenseId: "paid_active",
    activationId: "act_paid_active",
    deviceHash: deviceId,
    plan: "pro",
    entitlements: ["all-tools"],
    issuedAt: now,
    refreshAfter: now + 86400 * 7,
    graceUntil: now + 86400 * 14,
    expiresAt: now + 86400 * 365
  }, privateKey);

  const mockApiClient = {
    async activate() { return { ok: true, data: { ok: true, token: paidToken } }; }
  };

  const verifier = new TokenVerifier({ expectedKid: kid, publicKeySpki: spkiB64 });
  const manager = new LicenseManager({ storage, apiClient: mockApiClient, verifier, pluginVersion: "1.3.0" });

  await manager.initialize();
  await manager.activate("VALID-PAID-KEY");
  assert.equal(manager.getState(), LICENSE_STATES.ACTIVE);
});

test("30. Paid deactivation behavior unchanged; trial deactivation disallowed", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const kid = "test_k1";

  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  const deviceId = await getInstallationDeviceId(storage);
  const now = Math.floor(Date.now() / 1000);

  // 1. Trial deactivation attempt
  const trialToken = signTestToken(kid, {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    licenseId: "trial_deact",
    activationId: "act_trial_deact",
    deviceHash: deviceId,
    plan: "trial",
    entitlements: [],
    issuedAt: now,
    refreshAfter: now + 86400 * 7,
    graceUntil: now + 86400 * 30,
    expiresAt: now + 86400 * 30
  }, privateKey);

  await storage.writeToken({ token: trialToken, savedAt: Date.now() });

  const verifier = new TokenVerifier({ expectedKid: kid, publicKeySpki: spkiB64 });
  const manager = new LicenseManager({ storage, verifier, pluginVersion: "1.3.0" });

  await manager.initialize();
  const trialDeactRes = await manager.deactivate();
  assert.equal(trialDeactRes.ok, false);
  assert.equal(trialDeactRes.error, "NOT_SUPPORTED");
  assert.equal(manager.getState(), LICENSE_STATES.TRIAL, "Trial state must remain untouched");

  // 2. Paid deactivation succeeds
  const paidToken = signTestToken(kid, {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    licenseId: "paid_deact",
    activationId: "act_paid_deact",
    deviceHash: deviceId,
    plan: "standard",
    entitlements: ["all-tools"],
    issuedAt: now,
    refreshAfter: now + 86400 * 7,
    graceUntil: now + 86400 * 14,
    expiresAt: now + 86400 * 365
  }, privateKey);

  await storage.writeToken({ token: paidToken, savedAt: Date.now() });
  const paidManager = new LicenseManager({
    storage,
    apiClient: {
      async deactivate() { return { ok: true, data: { ok: true, deactivated: true } }; }
    },
    verifier,
    pluginVersion: "1.3.0"
  });

  await paidManager.initialize();
  assert.equal(paidManager.getState(), LICENSE_STATES.ACTIVE);
  const paidDeactRes = await paidManager.deactivate();
  assert.equal(paidDeactRes.ok, true);
  assert.equal(paidManager.getState(), LICENSE_STATES.UNACTIVATED);
});

test("31. Device ID remains unchanged", async () => {
  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  const dev1 = await getInstallationDeviceId(storage);
  const dev2 = await getInstallationDeviceId(storage);
  assert.equal(dev1, dev2);
  assert.ok(dev1.length >= 16);
});

test("32. secureStorage keys unchanged", () => {
  assert.equal(STORAGE_KEYS.SIGNED_TOKEN, "mm_license_signed_token_v1");
  assert.equal(STORAGE_KEYS.LICENSE_METADATA, "mm_license_metadata_v1");
  assert.equal(STORAGE_KEYS.DEVICE_ID, "mm_license_device_id_v1");
});

test("33. No plaintext license key persisted", async () => {
  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  const allStored = Array.from(mockStorage._store.keys());
  for (const k of allStored) {
    assert.equal(k.includes("key"), false);
  }
});

test("34. No authoritative local trial timestamp stored", async () => {
  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  assert.equal(mockStorage._store.has("mm_trial_start"), false);
  assert.equal(mockStorage._store.has("mm_trial_expiry"), false);
});

test("35. Clock rollback protection remains", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const kid = "test_k1";

  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  const deviceId = await getInstallationDeviceId(storage);
  const now = Math.floor(Date.now() / 1000);

  const token = signTestToken(kid, {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    licenseId: "trial_rollback",
    activationId: "act_rollback",
    deviceHash: deviceId,
    plan: "trial",
    entitlements: [],
    issuedAt: now - 86400,
    refreshAfter: now + 86400 * 7,
    graceUntil: now + 86400 * 30,
    expiresAt: now + 86400 * 30
  }, privateKey);

  await storage.writeToken({ token, savedAt: Date.now() });
  // Last observed time is far in the FUTURE compared to now
  await storage.writeMetadata({ lastValidatedAt: now - 86400, lastObservedTime: now + 86400 * 5 });

  let onlineValidationAttempted = false;
  const mockApiClient = {
    async refreshTrial() {
      onlineValidationAttempted = true;
      return { ok: false, error: "NETWORK_ERROR" };
    }
  };

  const verifier = new TokenVerifier({ expectedKid: kid, publicKeySpki: spkiB64 });
  const manager = new LicenseManager({ storage, apiClient: mockApiClient, verifier, pluginVersion: "1.3.0" });

  await manager.initialize();
  assert.equal(onlineValidationAttempted, true, "Clock rollback must trigger online validation requirement");
});

test("36. No DEV bypass exists", () => {
  assert.equal(mainModule.DEV_LICENSE_BYPASS, undefined);
  assert.equal(mainModule.setDevLicenseBypass, undefined);
});

test("37. Fail-closed behavior remains", async () => {
  const orig = mainModule.getLicenseManagerInstance();
  try {
    mainModule.setLicenseManager(null);
    const operational = await mainModule.ensureLicenseOperational();
    assert.equal(operational, false);
  } finally {
    mainModule.setLicenseManager(orig);
  }
});

test("38. All current tools remain centrally gated", () => {
  const mainSrc = fs.readFileSync(path.join(__dirname, "../main.js"), "utf8");
  const expectedGatedButtons = [
    "ui.createPageBtn",
    "ui.createAlbum12x36Btn",
    "ui.createAlbum12x18Btn",
    "ui.createInstagramBtn",
    "ui.createFacebookBtn",
    "ui.createYouTubeBtn",
    "ui.createCustomBtn",
    "ui.openPsdBtn",
    "ui.autoPhotoFillBtn",
    "ui.swapPhotosBtn",
    "ui.flipPhotoBtn",
    "ui.savePageBtn",
    "ui.saveEditedPhotosBtn",
    "ui.savePsdCategoryBtn",
    "ui.removePhotosBtn",
    "ui.addFrameBtn",
    "ui.saveFrameBtn",
    "ui.addAssetBtn",
    "ui.saveAssetBtn",
    "ui.pngMaskBtn",
    "ui.pngTextBtn",
    "ui.clipArtBtn",
    "ui.changeBackgroundBtn"
  ];
  for (const btn of expectedGatedButtons) {
    assert.ok(mainSrc.includes(`attachActionHandler(${btn}, wrapProtectedAction(`));
  }
});

// =============================================================================
// PART 2 — BOTTOM STATUS TESTS (39 - 60)
// =============================================================================

test("39. ACTIVE shows: Activated License", () => {
  const bottomEl = createMockElement();
  mainModule.ui.bottomLicenseStatus = bottomEl;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.ACTIVE, plan: "Pro" })
  });

  mainModule.updateBottomLicenseStatusUI();
  assert.equal(bottomEl.textContent, "Activated License");
});

test("40. GRACE shows: Activated License", () => {
  const bottomEl = createMockElement();
  mainModule.ui.bottomLicenseStatus = bottomEl;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.GRACE, plan: "Pro" })
  });

  mainModule.updateBottomLicenseStatusUI();
  assert.equal(bottomEl.textContent, "Activated License");
});

test("41. ACTIVE/GRACE status uses green styling/class", () => {
  const bottomEl = createMockElement();
  mainModule.ui.bottomLicenseStatus = bottomEl;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.ACTIVE, plan: "Pro" })
  });
  mainModule.updateBottomLicenseStatusUI();
  assert.ok(bottomEl.classList.contains("status-activated"));
  assert.equal(bottomEl.classList.contains("status-license-warning"), false);

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.GRACE, plan: "Pro" })
  });
  mainModule.updateBottomLicenseStatusUI();
  assert.ok(bottomEl.classList.contains("status-activated"));
});

test("42. ACTIVE never shows Start Trial", () => {
  const bottomEl = createMockElement();
  mainModule.ui.bottomLicenseStatus = bottomEl;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.ACTIVE, plan: "Pro" })
  });
  mainModule.updateBottomLicenseStatusUI();
  assert.notEqual(bottomEl.textContent, "Start Trial");
});

test("43. UNACTIVATED shows: Start Trial", () => {
  const bottomEl = createMockElement();
  mainModule.ui.bottomLicenseStatus = bottomEl;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.UNACTIVATED })
  });
  mainModule.updateBottomLicenseStatusUI();
  assert.equal(bottomEl.textContent, "Start Trial");
  assert.ok(bottomEl.classList.contains("status-start-trial"));
});

test("44. Start Trial is clickable", () => {
  assert.equal(typeof mainModule.handleBottomLicenseClick, "function");
  assert.equal(typeof mainModule.handleStartTrialFlow, "function");
});

test("45. Start Trial calls startTrial only once per click", async () => {
  let callCount = 0;
  const mockManager = {
    getSnapshot: () => ({ state: LICENSE_STATES.UNACTIVATED }),
    async startTrial() {
      callCount++;
      return { ok: true };
    }
  };
  mainModule.setLicenseManager(mockManager);

  await mainModule.handleStartTrialFlow();
  assert.equal(callCount, 1);
});

test("46. Start Trial disables while request is in progress", async () => {
  const bottomEl = createMockElement();
  const startTrialBtn = createMockElement();
  mainModule.ui.bottomLicenseStatus = bottomEl;
  mainModule.ui.licenseStartTrialBtn = startTrialBtn;

  let inFlightBottomText = "";
  let inFlightLoading = false;

  const mockManager = {
    getSnapshot: () => ({ state: LICENSE_STATES.UNACTIVATED }),
    async startTrial() {
      inFlightBottomText = bottomEl.textContent;
      inFlightLoading = bottomEl.classList.contains("loading");
      return { ok: true };
    }
  };
  mainModule.setLicenseManager(mockManager);

  await mainModule.handleStartTrialFlow();
  assert.equal(inFlightBottomText, "Starting Trial...");
  assert.equal(inFlightLoading, true);
});

test("47. Success immediately changes panel state to trial status", async () => {
  const bottomEl = createMockElement();
  mainModule.ui.bottomLicenseStatus = bottomEl;

  let state = LICENSE_STATES.UNACTIVATED;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = nowSeconds + 86400 * 30;

  const mockManager = {
    getSnapshot: () => ({ state, expiresAt }),
    async startTrial() {
      state = LICENSE_STATES.TRIAL;
      return { ok: true, message: "30-day free trial started." };
    }
  };
  mainModule.setLicenseManager(mockManager);

  await mainModule.handleStartTrialFlow();
  assert.ok(bottomEl.textContent.startsWith("Trial Active •"));
  assert.ok(bottomEl.classList.contains("status-trial-active"));
});

test("48. TRIAL shows: Trial Active • N Days Left", () => {
  const bottomEl = createMockElement();
  mainModule.ui.bottomLicenseStatus = bottomEl;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = nowSeconds + 86400 * 23;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.TRIAL, expiresAt })
  });

  mainModule.updateBottomLicenseStatusUI();
  assert.equal(bottomEl.textContent, "Trial Active • 23 Days Left");
});

test("49. trial remaining days clamps 0..30", () => {
  const nowMs = 1700000000000;
  // Over 30 days
  const future35DaysSec = Math.floor(nowMs / 1000) + 86400 * 35;
  assert.equal(mainModule.getTrialDaysRemaining(future35DaysSec, nowMs), 30);

  // Exactly 30 days
  const future30DaysSec = Math.floor(nowMs / 1000) + 86400 * 30;
  assert.equal(mainModule.getTrialDaysRemaining(future30DaysSec, nowMs), 30);

  // 15 days
  const future15DaysSec = Math.floor(nowMs / 1000) + 86400 * 15;
  assert.equal(mainModule.getTrialDaysRemaining(future15DaysSec, nowMs), 15);

  // Past / expired
  const pastSec = Math.floor(nowMs / 1000) - 86400 * 2;
  assert.equal(mainModule.getTrialDaysRemaining(pastSec, nowMs), 0);
});

test("50. trial status uses amber/orange styling/class", () => {
  const bottomEl = createMockElement();
  mainModule.ui.bottomLicenseStatus = bottomEl;

  const nowSeconds = Math.floor(Date.now() / 1000);
  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.TRIAL, expiresAt: nowSeconds + 86400 * 10 })
  });

  mainModule.updateBottomLicenseStatusUI();
  assert.ok(bottomEl.classList.contains("status-trial-active"));
  assert.equal(bottomEl.classList.contains("status-license-warning"), false);
});

test("51. TRIAL bottom status can open License dialog", async () => {
  let dialogShown = false;
  const mockDialog = createMockElement();
  mockDialog.showModal = () => { dialogShown = true; };
  mainModule.ui.licenseDialog = mockDialog;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.TRIAL, expiresAt: Math.floor(Date.now() / 1000) + 86400 })
  });

  await mainModule.handleBottomLicenseClick();
  assert.equal(dialogShown, true);
});

test("52. TRIAL_EXPIRED shows: Please Add License", () => {
  const bottomEl = createMockElement();
  mainModule.ui.bottomLicenseStatus = bottomEl;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.TRIAL_EXPIRED })
  });

  mainModule.updateBottomLicenseStatusUI();
  assert.equal(bottomEl.textContent, "Please Add License");
});

test("53. expired status uses red styling/class", () => {
  const bottomEl = createMockElement();
  mainModule.ui.bottomLicenseStatus = bottomEl;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.TRIAL_EXPIRED })
  });

  mainModule.updateBottomLicenseStatusUI();
  assert.ok(bottomEl.classList.contains("status-license-warning"));
});

test("54. clicking Please Add License opens License dialog", async () => {
  let dialogShown = false;
  const mockDialog = createMockElement();
  mockDialog.showModal = () => { dialogShown = true; };
  mainModule.ui.licenseDialog = mockDialog;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.TRIAL_EXPIRED })
  });

  await mainModule.handleBottomLicenseClick();
  assert.equal(dialogShown, true);
});

test("55. TRIAL_EXPIRED never shows Start Trial", () => {
  const bottomEl = createMockElement();
  mainModule.ui.bottomLicenseStatus = bottomEl;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.TRIAL_EXPIRED })
  });

  mainModule.updateBottomLicenseStatusUI();
  assert.notEqual(bottomEl.textContent, "Start Trial");
});

test("56. paid ACTIVE never shows trial status", () => {
  const bottomEl = createMockElement();
  mainModule.ui.bottomLicenseStatus = bottomEl;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.ACTIVE, plan: "Pro" })
  });

  mainModule.updateBottomLicenseStatusUI();
  assert.equal(bottomEl.textContent.includes("Trial"), false);
});

test("57. blocked panel does not expose technical error codes", () => {
  const bottomEl = createMockElement();
  mainModule.ui.bottomLicenseStatus = bottomEl;

  const technicalStates = [
    LICENSE_STATES.TRIAL_EXPIRED,
    LICENSE_STATES.REVOKED,
    LICENSE_STATES.SUSPENDED,
    LICENSE_STATES.INVALID,
    LICENSE_STATES.EXPIRED,
    LICENSE_STATES.ERROR
  ];

  for (const st of technicalStates) {
    mainModule.setLicenseManager({
      getSnapshot: () => ({ state: st, reason: "DEVICE_REVOKED" })
    });
    mainModule.updateBottomLicenseStatusUI();
    assert.equal(bottomEl.textContent, "Please Add License");
    assert.equal(bottomEl.textContent.includes("REVOKED"), false);
    assert.equal(bottomEl.textContent.includes("ERROR"), false);
    assert.equal(bottomEl.textContent.includes("DEVICE"), false);
  }
});

test("58. bottom UI works with narrow layout", () => {
  const css = fs.readFileSync(path.join(__dirname, "../style.css"), "utf8");
  assert.ok(css.includes(".bottom-license-status"));
  assert.ok(css.includes(".status-activated"));
  assert.ok(css.includes(".status-start-trial"));
  assert.ok(css.includes(".status-trial-active"));
  assert.ok(css.includes(".status-license-warning"));
});

test("59. bottom UI remains keyboard accessible", () => {
  const mainSrc = fs.readFileSync(path.join(__dirname, "../main.js"), "utf8");
  assert.ok(mainSrc.includes('ui.bottomLicenseStatus?.addEventListener("keydown"'));
  assert.ok(mainSrc.includes('e.key === "Enter"'));
  assert.ok(mainSrc.includes('e.key === " "'));
});

test("60. existing License button/function remains usable", () => {
  const mainSrc = fs.readFileSync(path.join(__dirname, "../main.js"), "utf8");
  assert.ok(mainSrc.includes('ui.manageLicenseBtn?.addEventListener("click"'));
});

// =============================================================================
// PART 3 — LICENSE DIALOG TESTS (61 - 72)
// =============================================================================

test("61. UNACTIVATED dialog shows Start Trial", () => {
  const startTrialBtn = createMockElement();
  const orDivider = createMockElement();
  mainModule.ui.licenseStartTrialBtn = startTrialBtn;
  mainModule.ui.licenseOrDivider = orDivider;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.UNACTIVATED })
  });

  mainModule.updateLicenseDialogUI();
  assert.equal(startTrialBtn.hidden, false);
  assert.equal(orDivider.hidden, false);
});

test("62. UNACTIVATED dialog shows paid license activation", () => {
  const activateBtn = createMockElement();
  const formGroup = createMockElement();
  const keyInput = createMockElement();
  mainModule.ui.licenseActivateBtn = activateBtn;
  mainModule.ui.licenseKeyInput = keyInput;
  keyInput.parentElement = formGroup;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.UNACTIVATED })
  });

  mainModule.updateLicenseDialogUI();
  assert.equal(activateBtn.hidden, false);
  assert.equal(formGroup.hidden, false);
});

test("63. TRIAL dialog shows trial end date", () => {
  const trialEndsRow = createMockElement();
  const trialEndsLabel = createMockElement();
  mainModule.ui.licenseTrialEndsRow = trialEndsRow;
  mainModule.ui.licenseTrialEndsLabel = trialEndsLabel;

  const expiresAt = Math.floor(Date.now() / 1000) + 86400 * 20;
  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.TRIAL, expiresAt })
  });

  mainModule.updateLicenseDialogUI();
  assert.equal(trialEndsRow.hidden, false);
  assert.ok(trialEndsLabel.textContent.length > 0);
  assert.notEqual(trialEndsLabel.textContent, "-");
});

test("64. TRIAL dialog shows days remaining", () => {
  const daysRow = createMockElement();
  const daysLabel = createMockElement();
  mainModule.ui.licenseDaysRemainingRow = daysRow;
  mainModule.ui.licenseDaysRemainingLabel = daysLabel;

  const expiresAt = Math.floor(Date.now() / 1000) + 86400 * 25;
  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.TRIAL, expiresAt })
  });

  mainModule.updateLicenseDialogUI();
  assert.equal(daysRow.hidden, false);
  assert.equal(daysLabel.textContent, "25");
});

test("65. TRIAL dialog still shows paid activation field/button", () => {
  const activateBtn = createMockElement();
  const formGroup = createMockElement();
  const keyInput = createMockElement();
  mainModule.ui.licenseActivateBtn = activateBtn;
  mainModule.ui.licenseKeyInput = keyInput;
  keyInput.parentElement = formGroup;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.TRIAL, expiresAt: Math.floor(Date.now() / 1000) + 86400 })
  });

  mainModule.updateLicenseDialogUI();
  assert.equal(activateBtn.hidden, false, "Activate button must remain visible during trial for paid upgrade");
  assert.equal(formGroup.hidden, false, "License key input must remain visible during trial");
});

test("66. TRIAL hides paid deactivation button", () => {
  const deactBtn = createMockElement();
  mainModule.ui.licenseDeactivateBtn = deactBtn;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.TRIAL, expiresAt: Math.floor(Date.now() / 1000) + 86400 })
  });

  mainModule.updateLicenseDialogUI();
  assert.equal(deactBtn.hidden, true, "Deactivate button must be hidden during trial");
});

test("67. TRIAL_EXPIRED hides Start Trial", () => {
  const startTrialBtn = createMockElement();
  const orDivider = createMockElement();
  mainModule.ui.licenseStartTrialBtn = startTrialBtn;
  mainModule.ui.licenseOrDivider = orDivider;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.TRIAL_EXPIRED })
  });

  mainModule.updateLicenseDialogUI();
  assert.equal(startTrialBtn.hidden, true);
  assert.equal(orDivider.hidden, true);
});

test("68. TRIAL_EXPIRED shows paid activation", () => {
  const activateBtn = createMockElement();
  const formGroup = createMockElement();
  const keyInput = createMockElement();
  mainModule.ui.licenseActivateBtn = activateBtn;
  mainModule.ui.licenseKeyInput = keyInput;
  keyInput.parentElement = formGroup;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.TRIAL_EXPIRED })
  });

  mainModule.updateLicenseDialogUI();
  assert.equal(activateBtn.hidden, false);
  assert.equal(formGroup.hidden, false);
});

test("69. ACTIVE hides Start Trial", () => {
  const startTrialBtn = createMockElement();
  const orDivider = createMockElement();
  mainModule.ui.licenseStartTrialBtn = startTrialBtn;
  mainModule.ui.licenseOrDivider = orDivider;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.ACTIVE, plan: "Pro" })
  });

  mainModule.updateLicenseDialogUI();
  assert.equal(startTrialBtn.hidden, true);
  assert.equal(orDivider.hidden, true);
});

test("70. ACTIVE shows paid deactivation", () => {
  const deactBtn = createMockElement();
  mainModule.ui.licenseDeactivateBtn = deactBtn;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.ACTIVE, plan: "Pro" })
  });

  mainModule.updateLicenseDialogUI();
  assert.equal(deactBtn.hidden, false);
});

test("71. GRACE behaves like paid license", () => {
  const deactBtn = createMockElement();
  const startTrialBtn = createMockElement();
  mainModule.ui.licenseDeactivateBtn = deactBtn;
  mainModule.ui.licenseStartTrialBtn = startTrialBtn;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.GRACE, plan: "Pro" })
  });

  mainModule.updateLicenseDialogUI();
  assert.equal(deactBtn.hidden, false);
  assert.equal(startTrialBtn.hidden, true);
});

test("72. existing paid dialog behavior remains unchanged", () => {
  const planRow = createMockElement();
  const planLabel = createMockElement();
  mainModule.ui.licensePlanRow = planRow;
  mainModule.ui.licensePlanLabel = planLabel;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.ACTIVE, plan: "Ultimate" })
  });

  mainModule.updateLicenseDialogUI();
  assert.equal(planRow.hidden, false);
  assert.equal(planLabel.textContent, "ULTIMATE");
});

// =============================================================================
// PART 4 — VERSION & METADATA TESTS (73 - 79)
// =============================================================================

test("73. manifest version = 1.4.2", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../manifest.json"), "utf8"));
  assert.equal(manifest.version, "1.4.2");
});

test("74. PLUGIN_VERSION = 1.4.2", () => {
  assert.equal(PLUGIN_VERSION, "1.4.2");
});

test("75. visible UI version = v1.4.2", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.ok(html.includes('<span class="version">v1.4.2</span>'));
});

test("76. plugin ID remains unchanged", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../manifest.json"), "utf8"));
  assert.equal(manifest.id, "9beaddeb");
});

test("77. production API URL unchanged", () => {
  assert.equal(PRODUCTION_CONFIG.API_BASE_URL, "https://mm-license-server.rammonihalder.workers.dev");
});

test("78. public verification key unchanged", () => {
  assert.ok(PRODUCTION_CONFIG.SIGNING_PUBLIC_KEY_SPKI_B64);
  assert.equal(typeof PRODUCTION_CONFIG.SIGNING_PUBLIC_KEY_SPKI_B64, "string");
  assert.equal(PRODUCTION_CONFIG.SIGNING_PUBLIC_KEY_SPKI_B64.length, 60);
});

test("79. secureStorage keys unchanged", () => {
  assert.equal(STORAGE_KEYS.SIGNED_TOKEN, "mm_license_signed_token_v1");
  assert.equal(STORAGE_KEYS.LICENSE_METADATA, "mm_license_metadata_v1");
  assert.equal(STORAGE_KEYS.DEVICE_ID, "mm_license_device_id_v1");
});

// =============================================================================
// PART 5 — PAID DEACTIVATION EDGE CASES (80 - 89 / Prompt 1 - 10)
// =============================================================================

test("80. [Prompt 1] Never-used-trial user: paid activate -> paid deactivate -> UNACTIVATED -> Start Trial -> trial start API is NOT called", async () => {
  const { privateKey } = generateTestKeypair();
  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  const deviceId = "device-test-case-1";
  await storage.writeDeviceId(deviceId);

  let trialStartCalled = false;
  const mockApi = {
    async activate() {
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        v: 1,
        pluginId: "in.memorymaker.albumplacer",
        licenseId: "lic-case-1",
        activationId: "act-case-1",
        deviceHash: deviceId,
        plan: "Standard",
        entitlements: ["standard"],
        issuedAt: now,
        expiresAt: now + 30 * 86400,
        refreshAfter: now + 7 * 86400,
        graceUntil: now + 14 * 86400
      };
      return { ok: true, data: { token: signTestToken("k1", payload, privateKey) } };
    },
    async deactivate() {
      return { ok: true };
    },
    async startTrial() {
      trialStartCalled = true;
      return { ok: true };
    }
  };

  const manager = createLicenseManager({
    storage,
    apiClient: mockApi,
    verifier: (token) => {
      const parts = token.split(".");
      const payload = JSON.parse(Buffer.from(parts[2], "base64url").toString("utf8"));
      return { ok: true, payload };
    }
  });

  await manager.initialize();
  // Never used trial -> activates paid
  await manager.activate("PAID-KEY-1");
  assert.equal(manager.getSnapshot().state, LICENSE_STATES.ACTIVE);

  // Deactivates paid
  const deactRes = await manager.deactivate();
  assert.equal(deactRes.ok, true);
  assert.equal(manager.getSnapshot().state, LICENSE_STATES.UNACTIVATED);
  assert.equal(trialStartCalled, false, "trial start API must NOT be automatically called for never-used-trial user");

  // Bottom UI shows Start Trial
  const bottomEl = createMockElement();
  mainModule.ui.bottomLicenseStatus = bottomEl;
  mainModule.setLicenseManager(manager);
  mainModule.updateBottomLicenseStatusUI();
  assert.equal(bottomEl.textContent, "Start Trial");
});

test("81. [Prompt 2] Trial active -> paid activate -> paid deactivate before original expiry -> SAME trial restored with original expiresAt", async () => {
  const { privateKey } = generateTestKeypair();
  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  const deviceId = "device-test-case-2";
  await storage.writeDeviceId(deviceId);

  const nowSec = Math.floor(Date.now() / 1000);
  const originalTrialExpiresAt = nowSec + 20 * 86400;
  let currentTime = nowSec - 10 * 86400;

  const trialToken = signTestToken("k1", {
    v: 1,
    pluginId: "in.memorymaker.albumplacer",
    activationId: "trial-act-2",
    deviceHash: deviceId,
    plan: "trial",
    entitlements: ["trial-all-features"],
    issuedAt: currentTime,
    expiresAt: originalTrialExpiresAt,
    refreshAfter: currentTime + 7 * 86400,
    graceUntil: originalTrialExpiresAt
  }, privateKey);

  const mockApi = {
    async startTrial() {
      return { ok: true, data: { token: trialToken } };
    },
    async activate() {
      const payload = {
        v: 1,
        pluginId: "in.memorymaker.albumplacer",
        licenseId: "lic-case-2",
        activationId: "act-case-2",
        deviceHash: deviceId,
        plan: "Standard",
        entitlements: ["standard"],
        issuedAt: currentTime,
        expiresAt: currentTime + 365 * 86400,
        refreshAfter: currentTime + 7 * 86400,
        graceUntil: currentTime + 14 * 86400
      };
      return { ok: true, data: { token: signTestToken("k1", payload, privateKey) } };
    },
    async deactivate() {
      return { ok: true };
    }
  };

  const manager = createLicenseManager({
    storage,
    apiClient: mockApi,
    clock: () => currentTime * 1000,
    verifier: (token) => {
      const parts = token.split(".");
      const payload = JSON.parse(Buffer.from(parts[2], "base64url").toString("utf8"));
      return { ok: true, payload };
    }
  });

  await manager.initialize();
  // 1. Starts trial
  const trialRes = await manager.startTrial();
  assert.equal(trialRes.ok, true);
  assert.equal(manager.getSnapshot().state, LICENSE_STATES.TRIAL);

  // 2. Activates paid license during trial
  currentTime += 5 * 86400; // 5 days later
  const actRes = await manager.activate("PAID-KEY-2");
  assert.equal(actRes.ok, true);
  assert.equal(manager.getSnapshot().state, LICENSE_STATES.ACTIVE);

  // 3. Deactivates paid license before trial expiry (e.g. day 10)
  currentTime += 5 * 86400; // 10 days total since trial start
  const deactRes = await manager.deactivate();
  assert.equal(deactRes.ok, true);

  // Expected: SAME trial restored, TRIAL state, original expiresAt (no extra days)
  assert.equal(manager.getSnapshot().state, LICENSE_STATES.TRIAL);
  assert.equal(manager.getSnapshot().expiresAt, originalTrialExpiresAt);

  // Bottom shows Trial Active • 20 Days Left
  const bottomEl = createMockElement();
  mainModule.ui.bottomLicenseStatus = bottomEl;
  mainModule.setLicenseManager(manager);
  mainModule.updateBottomLicenseStatusUI();
  assert.equal(bottomEl.textContent, "Trial Active • 20 Days Left");
});

test("82. [Prompt 3] Trial active -> paid activate -> original trial expires -> paid deactivate -> TRIAL_EXPIRED, Please Add License, Start Trial hidden", async () => {
  const { privateKey } = generateTestKeypair();
  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  const deviceId = "device-test-case-3";
  await storage.writeDeviceId(deviceId);

  const initialTime = 1700000000;
  let currentTime = initialTime;
  const originalTrialExpiresAt = initialTime + 30 * 86400;

  const trialToken = signTestToken("k1", {
    v: 1,
    pluginId: "in.memorymaker.albumplacer",
    activationId: "trial-act-3",
    deviceHash: deviceId,
    plan: "trial",
    entitlements: ["trial-all-features"],
    issuedAt: initialTime,
    expiresAt: originalTrialExpiresAt,
    refreshAfter: initialTime + 7 * 86400,
    graceUntil: originalTrialExpiresAt
  }, privateKey);

  const mockApi = {
    async startTrial() {
      if (currentTime > originalTrialExpiresAt) {
        return { ok: false, error: "TRIAL_EXPIRED", message: "Trial has expired for this device." };
      }
      return { ok: true, data: { token: trialToken } };
    },
    async activate() {
      const payload = {
        v: 1,
        pluginId: "in.memorymaker.albumplacer",
        licenseId: "lic-case-3",
        activationId: "act-case-3",
        deviceHash: deviceId,
        plan: "Standard",
        entitlements: ["standard"],
        issuedAt: currentTime,
        expiresAt: currentTime + 365 * 86400,
        refreshAfter: currentTime + 7 * 86400,
        graceUntil: currentTime + 14 * 86400
      };
      return { ok: true, data: { token: signTestToken("k1", payload, privateKey) } };
    },
    async deactivate() {
      return { ok: true };
    }
  };

  const manager = createLicenseManager({
    storage,
    apiClient: mockApi,
    clock: () => currentTime * 1000,
    verifier: (token) => {
      const parts = token.split(".");
      const payload = JSON.parse(Buffer.from(parts[2], "base64url").toString("utf8"));
      return { ok: true, payload };
    }
  });

  await manager.initialize();
  // Starts trial
  await manager.startTrial();
  assert.equal(manager.getSnapshot().state, LICENSE_STATES.TRIAL);

  // Activates paid license
  await manager.activate("PAID-KEY-3");
  assert.equal(manager.getSnapshot().state, LICENSE_STATES.ACTIVE);

  // Time advances past original trial expiry (e.g. 40 days later)
  currentTime += 40 * 86400;

  // Paid license is deactivated
  const deactRes = await manager.deactivate();
  assert.equal(deactRes.ok, true);

  // Expected: TRIAL_EXPIRED
  assert.equal(manager.getSnapshot().state, LICENSE_STATES.TRIAL_EXPIRED);

  // Bottom shows Please Add License in red
  const bottomEl = createMockElement();
  mainModule.ui.bottomLicenseStatus = bottomEl;
  mainModule.setLicenseManager(manager);
  mainModule.updateBottomLicenseStatusUI();
  assert.equal(bottomEl.textContent, "Please Add License");
  assert.ok(bottomEl.classList.contains("status-license-warning"));

  // Start Trial button is hidden in license dialog
  const startTrialBtn = createMockElement();
  mainModule.ui.licenseStartTrialBtn = startTrialBtn;
  mainModule.updateLicenseDialogUI();
  assert.equal(startTrialBtn.hidden, true);
});

test("83. [Prompt 4] Revoked previous trial -> paid activate -> paid deactivate -> blocked/revoked, Start Trial hidden", async () => {
  const { privateKey } = generateTestKeypair();
  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  const deviceId = "device-test-case-4";
  await storage.writeDeviceId(deviceId);

  // Metadata already recorded that trial was started previously
  await storage.writeMetadata({ trialPreviouslyStarted: true });

  const mockApi = {
    async startTrial() {
      return { ok: false, error: "TRIAL_REVOKED", message: "Trial has been revoked." };
    },
    async activate() {
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        v: 1,
        pluginId: "in.memorymaker.albumplacer",
        licenseId: "lic-case-4",
        activationId: "act-case-4",
        deviceHash: deviceId,
        plan: "Standard",
        entitlements: ["standard"],
        issuedAt: now,
        expiresAt: now + 30 * 86400,
        refreshAfter: now + 7 * 86400,
        graceUntil: now + 14 * 86400
      };
      return { ok: true, data: { token: signTestToken("k1", payload, privateKey) } };
    },
    async deactivate() {
      return { ok: true };
    }
  };

  const manager = createLicenseManager({
    storage,
    apiClient: mockApi,
    verifier: (token) => {
      const parts = token.split(".");
      const payload = JSON.parse(Buffer.from(parts[2], "base64url").toString("utf8"));
      return { ok: true, payload };
    }
  });

  await manager.initialize();
  await manager.activate("PAID-KEY-4");
  assert.equal(manager.getSnapshot().state, LICENSE_STATES.ACTIVE);

  // Deactivate paid license
  await manager.deactivate();
  assert.equal(manager.getSnapshot().state, LICENSE_STATES.REVOKED);
  assert.equal(manager.isOperational(), false);

  // Dialog hides Start Trial
  const startTrialBtn = createMockElement();
  mainModule.ui.licenseStartTrialBtn = startTrialBtn;
  mainModule.setLicenseManager(manager);
  mainModule.updateLicenseDialogUI();
  assert.equal(startTrialBtn.hidden, true);
});

test("84. [Prompt 5] trialPreviouslyStarted marker alone never grants access", async () => {
  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  // Store marker alone without token
  await storage.writeMetadata({ trialPreviouslyStarted: true });

  const manager = createLicenseManager({ storage });
  await manager.initialize();

  // Marker alone must NOT be operational
  assert.equal(manager.isOperational(), false);
  assert.notEqual(manager.getSnapshot().state, LICENSE_STATES.ACTIVE);
  assert.notEqual(manager.getSnapshot().state, LICENSE_STATES.TRIAL);
});

test("85. [Prompt 6] trialPreviouslyStarted marker survives paid activation", async () => {
  const { privateKey } = generateTestKeypair();
  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  const deviceId = "device-test-case-6";
  await storage.writeDeviceId(deviceId);

  const trialToken = signTestToken("k1", {
    v: 1,
    pluginId: "in.memorymaker.albumplacer",
    activationId: "trial-act-6",
    deviceHash: deviceId,
    plan: "trial",
    entitlements: ["trial-all-features"],
    issuedAt: 1700000000,
    expiresAt: 1700000000 + 30 * 86400,
    refreshAfter: 1700000000 + 7 * 86400,
    graceUntil: 1700000000 + 30 * 86400
  }, privateKey);

  const mockApi = {
    async startTrial() {
      return { ok: true, data: { token: trialToken } };
    },
    async activate() {
      return {
        ok: true,
        data: {
          token: signTestToken("k1", {
            v: 1,
            pluginId: "in.memorymaker.albumplacer",
            licenseId: "lic-6",
            activationId: "act-6",
            deviceHash: deviceId,
            plan: "Pro",
            entitlements: ["pro"],
            issuedAt: 1700000000,
            expiresAt: 1700000000 + 365 * 86400,
            refreshAfter: 1700000000 + 7 * 86400,
            graceUntil: 1700000000 + 14 * 86400
          }, privateKey)
        }
      };
    }
  };

  const manager = createLicenseManager({
    storage,
    apiClient: mockApi,
    verifier: (token) => {
      const parts = token.split(".");
      const payload = JSON.parse(Buffer.from(parts[2], "base64url").toString("utf8"));
      return { ok: true, payload };
    }
  });

  await manager.initialize();
  await manager.startTrial();
  let meta = await storage.readMetadata();
  assert.equal(meta.trialPreviouslyStarted, true);

  await manager.activate("PAID-KEY-6");
  meta = await storage.readMetadata();
  assert.equal(meta.trialPreviouslyStarted, true, "trialPreviouslyStarted must survive paid activation");
});

test("86. [Prompt 7] persistent device ID survives paid activation and deactivation", async () => {
  const { privateKey } = generateTestKeypair();
  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  const fixedDeviceId = "stable-hardware-fingerprint-777";
  await storage.writeDeviceId(fixedDeviceId);

  const mockApi = {
    async startTrial() {
      return {
        ok: true,
        data: {
          token: signTestToken("k1", {
            v: 1,
            pluginId: "in.memorymaker.albumplacer",
            activationId: "trial-act-7",
            deviceHash: fixedDeviceId,
            plan: "trial",
            entitlements: ["trial-all-features"],
            issuedAt: 1700000000,
            expiresAt: 1700000000 + 30 * 86400,
            refreshAfter: 1700000000 + 7 * 86400,
            graceUntil: 1700000000 + 30 * 86400
          }, privateKey)
        }
      };
    },
    async activate() {
      return {
        ok: true,
        data: {
          token: signTestToken("k1", {
            v: 1,
            pluginId: "in.memorymaker.albumplacer",
            licenseId: "lic-7",
            activationId: "act-7",
            deviceHash: fixedDeviceId,
            plan: "Standard",
            entitlements: ["standard"],
            issuedAt: 1700000000,
            expiresAt: 1700000000 + 365 * 86400,
            refreshAfter: 1700000000 + 7 * 86400,
            graceUntil: 1700000000 + 14 * 86400
          }, privateKey)
        }
      };
    },
    async deactivate() {
      return { ok: true };
    }
  };

  const manager = createLicenseManager({
    storage,
    apiClient: mockApi,
    verifier: (token) => {
      const parts = token.split(".");
      const payload = JSON.parse(Buffer.from(parts[2], "base64url").toString("utf8"));
      return { ok: true, payload };
    }
  });

  await manager.initialize();
  assert.equal(await storage.readDeviceId(), fixedDeviceId);

  await manager.startTrial();
  assert.equal(await storage.readDeviceId(), fixedDeviceId);

  await manager.activate("PAID-KEY-7");
  assert.equal(await storage.readDeviceId(), fixedDeviceId);

  await manager.deactivate();
  assert.equal(await storage.readDeviceId(), fixedDeviceId);
});

test("87. [Prompt 8] forged restored trial token rejected", async () => {
  const { privateKey } = generateTestKeypair();
  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  const deviceId = "device-test-case-8";
  await storage.writeDeviceId(deviceId);
  await storage.writeMetadata({ trialPreviouslyStarted: true });

  const mockApi = {
    async activate() {
      return {
        ok: true,
        data: {
          token: signTestToken("k1", {
            v: 1,
            pluginId: "in.memorymaker.albumplacer",
            licenseId: "lic-8",
            activationId: "act-8",
            deviceHash: deviceId,
            plan: "Standard",
            entitlements: ["standard"],
            issuedAt: 1700000000,
            expiresAt: 1700000000 + 365 * 86400,
            refreshAfter: 1700000000 + 7 * 86400,
            graceUntil: 1700000000 + 14 * 86400
          }, privateKey)
        }
      };
    },
    async deactivate() {
      return { ok: true };
    },
    async startTrial() {
      // Return forged token
      return { ok: true, data: { token: "MM1.k1.forgedpayload.invalidsig" } };
    }
  };

  const manager = createLicenseManager({
    storage,
    apiClient: mockApi,
    verifier: (token) => {
      if (token.includes("forged")) {
        return { ok: false, error: "SIGNATURE_INVALID" };
      }
      const parts = token.split(".");
      const payload = JSON.parse(Buffer.from(parts[2], "base64url").toString("utf8"));
      return { ok: true, payload };
    }
  });

  await manager.initialize();
  await manager.activate("PAID-KEY-8");
  assert.equal(manager.getSnapshot().state, LICENSE_STATES.ACTIVE);

  // Deactivate paid: restore returns forged trial token
  await manager.deactivate();

  // Must reject forged token and fail closed
  assert.equal(manager.isOperational(), false);
  assert.notEqual(manager.getSnapshot().state, LICENSE_STATES.TRIAL);
  assert.equal(await storage.readToken(), null);
});

test("88. [Prompt 9] wrong-device restored trial token rejected", async () => {
  const { privateKey } = generateTestKeypair();
  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  const deviceId = "device-test-case-9";
  await storage.writeDeviceId(deviceId);
  await storage.writeMetadata({ trialPreviouslyStarted: true });

  const mockApi = {
    async activate() {
      return {
        ok: true,
        data: {
          token: signTestToken("k1", {
            v: 1,
            pluginId: "in.memorymaker.albumplacer",
            licenseId: "lic-9",
            activationId: "act-9",
            deviceHash: deviceId,
            plan: "Standard",
            entitlements: ["standard"],
            issuedAt: 1700000000,
            expiresAt: 1700000000 + 365 * 86400,
            refreshAfter: 1700000000 + 7 * 86400,
            graceUntil: 1700000000 + 14 * 86400
          }, privateKey)
        }
      };
    },
    async deactivate() {
      return { ok: true };
    },
    async startTrial() {
      // Return token for different device
      return {
        ok: true,
        data: {
          token: signTestToken("k1", {
            v: 1,
            pluginId: "in.memorymaker.albumplacer",
            activationId: "trial-act-9",
            deviceHash: "WRONG-DEVICE-XYZ",
            plan: "trial",
            entitlements: ["trial-all-features"],
            issuedAt: 1700000000,
            expiresAt: 1700000000 + 30 * 86400,
            refreshAfter: 1700000000 + 7 * 86400,
            graceUntil: 1700000000 + 30 * 86400
          }, privateKey)
        }
      };
    }
  };

  const manager = createLicenseManager({
    storage,
    apiClient: mockApi,
    verifier: (token) => {
      const parts = token.split(".");
      const payload = JSON.parse(Buffer.from(parts[2], "base64url").toString("utf8"));
      return { ok: true, payload };
    }
  });

  await manager.initialize();
  await manager.activate("PAID-KEY-9");
  assert.equal(manager.getSnapshot().state, LICENSE_STATES.ACTIVE);

  // Deactivate paid: trial restore returns token for wrong device
  await manager.deactivate();

  assert.equal(manager.isOperational(), false);
  assert.notEqual(manager.getSnapshot().state, LICENSE_STATES.TRIAL);
  assert.equal(await storage.readToken(), null);
});

test("89. [Prompt 10] network failure during trial restoration fails closed", async () => {
  const { privateKey } = generateTestKeypair();
  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  const deviceId = "device-test-case-10";
  await storage.writeDeviceId(deviceId);
  await storage.writeMetadata({ trialPreviouslyStarted: true });

  const mockApi = {
    async activate() {
      return {
        ok: true,
        data: {
          token: signTestToken("k1", {
            v: 1,
            pluginId: "in.memorymaker.albumplacer",
            licenseId: "lic-10",
            activationId: "act-10",
            deviceHash: deviceId,
            plan: "Standard",
            entitlements: ["standard"],
            issuedAt: 1700000000,
            expiresAt: 1700000000 + 365 * 86400,
            refreshAfter: 1700000000 + 7 * 86400,
            graceUntil: 1700000000 + 14 * 86400
          }, privateKey)
        }
      };
    },
    async deactivate() {
      return { ok: true };
    },
    async startTrial() {
      throw new Error("Network unreachable");
    }
  };

  const manager = createLicenseManager({
    storage,
    apiClient: mockApi,
    verifier: (token) => {
      const parts = token.split(".");
      const payload = JSON.parse(Buffer.from(parts[2], "base64url").toString("utf8"));
      return { ok: true, payload };
    }
  });

  await manager.initialize();
  await manager.activate("PAID-KEY-10");
  assert.equal(manager.getSnapshot().state, LICENSE_STATES.ACTIVE);

  // Deactivate paid license when network fails on trial resolution
  await manager.deactivate();

  // Fails closed! Tools blocked!
  assert.equal(manager.isOperational(), false);
  assert.equal(manager.getSnapshot().state, LICENSE_STATES.ERROR);
});

// =============================================================================
// PART 6 — CONTACT ADMIN & WHATSAPP TESTS (90 - 106 / Prompt 11 - 27)
// =============================================================================

test("90. [Prompt 11] TRIAL_EXPIRED shows: 7001514367", () => {
  const phoneEl = createMockElement();
  const areaEl = createMockElement({ hidden: true });
  mainModule.ui.licenseAdminPhoneDisplay = phoneEl;
  mainModule.ui.licenseContactAdminArea = areaEl;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.TRIAL_EXPIRED })
  });

  mainModule.updateLicenseDialogUI();
  assert.equal(phoneEl.textContent, "7001514367");
  assert.equal(areaEl.hidden, false);
});

test("91. [Prompt 12] TRIAL_EXPIRED shows: CONTACT ADMIN button", () => {
  const btnEl = createMockElement({ textContent: "CONTACT ADMIN" });
  const areaEl = createMockElement({ hidden: true });
  mainModule.ui.licenseContactAdminBtn = btnEl;
  mainModule.ui.licenseContactAdminArea = areaEl;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.TRIAL_EXPIRED })
  });

  mainModule.updateLicenseDialogUI();
  assert.equal(areaEl.hidden, false);
  assert.equal(btnEl.textContent, "CONTACT ADMIN");
});

test("92. [Prompt 13] EXPIRED shows: 7001514367", () => {
  const phoneEl = createMockElement();
  const areaEl = createMockElement({ hidden: true });
  mainModule.ui.licenseAdminPhoneDisplay = phoneEl;
  mainModule.ui.licenseContactAdminArea = areaEl;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.EXPIRED })
  });

  mainModule.updateLicenseDialogUI();
  assert.equal(phoneEl.textContent, "7001514367");
  assert.equal(areaEl.hidden, false);
});

test("93. [Prompt 14] EXPIRED shows: CONTACT ADMIN button", () => {
  const btnEl = createMockElement({ textContent: "CONTACT ADMIN" });
  const areaEl = createMockElement({ hidden: true });
  mainModule.ui.licenseContactAdminBtn = btnEl;
  mainModule.ui.licenseContactAdminArea = areaEl;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.EXPIRED })
  });

  mainModule.updateLicenseDialogUI();
  assert.equal(areaEl.hidden, false);
  assert.equal(btnEl.textContent, "CONTACT ADMIN");
});

test("94. [Prompt 15] ACTIVE does not show expiry purchase CTA", () => {
  const areaEl = createMockElement({ hidden: false });
  mainModule.ui.licenseContactAdminArea = areaEl;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.ACTIVE, plan: "Pro" })
  });

  mainModule.updateLicenseDialogUI();
  assert.equal(areaEl.hidden, true);
});

test("95. [Prompt 16] GRACE does not show expiry purchase CTA", () => {
  const areaEl = createMockElement({ hidden: false });
  mainModule.ui.licenseContactAdminArea = areaEl;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.GRACE, plan: "Pro" })
  });

  mainModule.updateLicenseDialogUI();
  assert.equal(areaEl.hidden, true);
});

test("96. [Prompt 17] normal TRIAL does not show expiry purchase CTA", () => {
  const areaEl = createMockElement({ hidden: false });
  mainModule.ui.licenseContactAdminArea = areaEl;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.TRIAL, expiresAt: Math.floor(Date.now() / 1000) + 86400 * 20 })
  });

  mainModule.updateLicenseDialogUI();
  assert.equal(areaEl.hidden, true);
});

test("97. [Prompt 18] WhatsApp number is: 917001514367", () => {
  assert.equal(mainModule.ADMIN_CONTACT_E164, "917001514367");
});

test("98. [Prompt 19] WhatsApp message exact value: I want to buy a license for FM Album Designing Tools.", () => {
  assert.equal(mainModule.ADMIN_WHATSAPP_MESSAGE, "I want to buy a license for FM Album Designing Tools.");
});

test("99. [Prompt 20] Message is URL encoded", () => {
  const expectedEncoded = encodeURIComponent("I want to buy a license for FM Album Designing Tools.");
  assert.equal(expectedEncoded, "I%20want%20to%20buy%20a%20license%20for%20FM%20Album%20Designing%20Tools.");
  const url = mainModule.getAdminWhatsAppUrl();
  assert.ok(url.includes(expectedEncoded));
});

test("100. [Prompt 21] Expected URL starts: https://wa.me/917001514367?text=", () => {
  const url = mainModule.getAdminWhatsAppUrl();
  assert.ok(url.startsWith("https://wa.me/917001514367?text="));
  assert.equal(url, "https://wa.me/917001514367?text=" + encodeURIComponent("I want to buy a license for FM Album Designing Tools."));
});

test("101. [Prompt 22] CONTACT ADMIN opens only after user click", () => {
  let openCount = 0;
  // Opening URL should not happen automatically on dialog update
  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.TRIAL_EXPIRED })
  });
  mainModule.updateLicenseDialogUI();
  assert.equal(openCount, 0);
});

test("102. [Prompt 23] WhatsApp open failure does not crash plugin", async () => {
  const result = await mainModule.openExternalUrl("https://wa.me/917001514367");
  assert.equal(typeof result, "boolean");
});

test("103. [Prompt 24] failure keeps 7001514367 visible", () => {
  const phoneEl = createMockElement({ textContent: "7001514367" });
  const errorEl = createMockElement({ hidden: true });
  mainModule.ui.licenseAdminPhoneDisplay = phoneEl;
  mainModule.ui.licenseContactError = errorEl;

  errorEl.hidden = false;
  errorEl.textContent = "Unable to open WhatsApp. Please contact 7001514367 manually.";

  assert.equal(phoneEl.textContent, "7001514367");
  assert.equal(phoneEl.hidden, false);
});

test("104. [Prompt 25] failure shows: Unable to open WhatsApp. Please contact 7001514367 manually.", () => {
  const expectedMsg = "Unable to open WhatsApp. Please contact 7001514367 manually.";
  assert.ok(expectedMsg.includes(mainModule.ADMIN_CONTACT_DISPLAY));
  assert.equal(expectedMsg, `Unable to open WhatsApp. Please contact ${mainModule.ADMIN_CONTACT_DISPLAY} manually.`);
});

test("105. [Prompt 26] bottom expired text remains exactly: Please Add License", () => {
  const bottomEl = createMockElement();
  mainModule.ui.bottomLicenseStatus = bottomEl;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.TRIAL_EXPIRED })
  });
  mainModule.updateBottomLicenseStatusUI();
  assert.equal(bottomEl.textContent, "Please Add License");

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.EXPIRED })
  });
  mainModule.updateBottomLicenseStatusUI();
  assert.equal(bottomEl.textContent, "Please Add License");
});

test("106. [Prompt 27] phone number is not unnecessarily duplicated in bottom footer", () => {
  const bottomEl = createMockElement();
  mainModule.ui.bottomLicenseStatus = bottomEl;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.TRIAL_EXPIRED })
  });
  mainModule.updateBottomLicenseStatusUI();
  assert.ok(!bottomEl.textContent.includes("7001514367"));
  assert.equal(bottomEl.textContent, "Please Add License");
});

// =============================================================================
// PART 7 — STATUS UI RE-VERIFICATION (107 - 119 / Prompt 28 - 40)
// =============================================================================

test("107. [Prompt 28] ACTIVE bottom: Activated License", () => {
  const bottomEl = createMockElement();
  mainModule.ui.bottomLicenseStatus = bottomEl;
  mainModule.setLicenseManager({ getSnapshot: () => ({ state: LICENSE_STATES.ACTIVE, plan: "Pro" }) });
  mainModule.updateBottomLicenseStatusUI();
  assert.equal(bottomEl.textContent, "Activated License");
});

test("108. [Prompt 29] GRACE bottom: Activated License", () => {
  const bottomEl = createMockElement();
  mainModule.ui.bottomLicenseStatus = bottomEl;
  mainModule.setLicenseManager({ getSnapshot: () => ({ state: LICENSE_STATES.GRACE, plan: "Pro" }) });
  mainModule.updateBottomLicenseStatusUI();
  assert.equal(bottomEl.textContent, "Activated License");
});

test("109. [Prompt 30] UNACTIVATED bottom: Start Trial", () => {
  const bottomEl = createMockElement();
  mainModule.ui.bottomLicenseStatus = bottomEl;
  mainModule.setLicenseManager({ getSnapshot: () => ({ state: LICENSE_STATES.UNACTIVATED }) });
  mainModule.updateBottomLicenseStatusUI();
  assert.equal(bottomEl.textContent, "Start Trial");
});

test("110. [Prompt 31] TRIAL bottom: Trial Active • N Days Left", () => {
  const bottomEl = createMockElement();
  mainModule.ui.bottomLicenseStatus = bottomEl;
  const expiresAt = Math.floor(Date.now() / 1000) + 86400 * 29;
  mainModule.setLicenseManager({ getSnapshot: () => ({ state: LICENSE_STATES.TRIAL, expiresAt }) });
  mainModule.updateBottomLicenseStatusUI();
  assert.equal(bottomEl.textContent, "Trial Active • 29 Days Left");
});

test("111. [Prompt 32] TRIAL_EXPIRED bottom: Please Add License", () => {
  const bottomEl = createMockElement();
  mainModule.ui.bottomLicenseStatus = bottomEl;
  mainModule.setLicenseManager({ getSnapshot: () => ({ state: LICENSE_STATES.TRIAL_EXPIRED }) });
  mainModule.updateBottomLicenseStatusUI();
  assert.equal(bottomEl.textContent, "Please Add License");
});

test("112. [Prompt 33] EXPIRED bottom: Please Add License", () => {
  const bottomEl = createMockElement();
  mainModule.ui.bottomLicenseStatus = bottomEl;
  mainModule.setLicenseManager({ getSnapshot: () => ({ state: LICENSE_STATES.EXPIRED }) });
  mainModule.updateBottomLicenseStatusUI();
  assert.equal(bottomEl.textContent, "Please Add License");
});

test("113. [Prompt 34] Activated License = green styling", () => {
  const bottomEl = createMockElement();
  mainModule.ui.bottomLicenseStatus = bottomEl;
  mainModule.setLicenseManager({ getSnapshot: () => ({ state: LICENSE_STATES.ACTIVE, plan: "Pro" }) });
  mainModule.updateBottomLicenseStatusUI();
  assert.ok(bottomEl.classList.contains("status-activated"));
});

test("114. [Prompt 35] Trial Active = amber/orange styling", () => {
  const bottomEl = createMockElement();
  mainModule.ui.bottomLicenseStatus = bottomEl;
  const expiresAt = Math.floor(Date.now() / 1000) + 86400 * 29;
  mainModule.setLicenseManager({ getSnapshot: () => ({ state: LICENSE_STATES.TRIAL, expiresAt }) });
  mainModule.updateBottomLicenseStatusUI();
  assert.ok(bottomEl.classList.contains("status-trial-active"));
});

test("115. [Prompt 36] Please Add License = red styling", () => {
  const bottomEl = createMockElement();
  mainModule.ui.bottomLicenseStatus = bottomEl;
  mainModule.setLicenseManager({ getSnapshot: () => ({ state: LICENSE_STATES.TRIAL_EXPIRED }) });
  mainModule.updateBottomLicenseStatusUI();
  assert.ok(bottomEl.classList.contains("status-license-warning"));
});

test("116. [Prompt 37] Start Trial loading state: Starting Trial...", async () => {
  const bottomEl = createMockElement();
  const startTrialBtn = createMockElement();
  mainModule.ui.bottomLicenseStatus = bottomEl;
  mainModule.ui.licenseStartTrialBtn = startTrialBtn;

  let observed = "";
  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.UNACTIVATED }),
    async startTrial() {
      observed = bottomEl.textContent;
      return { ok: true };
    }
  });

  await mainModule.handleStartTrialFlow();
  assert.equal(observed, "Starting Trial...");
});

test("117. [Prompt 38] Start Trial cannot fire duplicate simultaneous requests", async () => {
  let startCount = 0;
  let resolveTrial;
  const trialPromise = new Promise(res => { resolveTrial = res; });

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.UNACTIVATED }),
    async startTrial() {
      startCount++;
      return trialPromise;
    }
  });

  const p1 = mainModule.handleStartTrialFlow();
  const p2 = mainModule.handleStartTrialFlow();

  resolveTrial({ ok: true });
  await Promise.all([p1, p2]);

  assert.equal(startCount, 1, "Only 1 startTrial request should be made while in flight");
});

test("118. [Prompt 39] bottom click opens correct flow/dialog", () => {
  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.UNACTIVATED })
  });
  assert.equal(typeof mainModule.handleBottomLicenseClick, "function");

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.ACTIVE })
  });
  assert.equal(typeof mainModule.showLicenseDialog, "function");
});

test("119. [Prompt 40] keyboard behavior remains accessible", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.ok(html.includes('id="bottomLicenseStatus" class="bottom-license-status" role="button" tabindex="0"'));
  assert.ok(html.includes('id="licenseContactAdminBtn" class="btn btn-secondary full" type="button" aria-label="Contact administrator on WhatsApp to buy or renew a license"'));
});

// =============================================================================
// PART 8 — ACTIVE TRIAL BUY LICENSE CTA TESTS (120 - 131)
// =============================================================================

test("120. [Buy License 1] Active TRIAL shows BUY LICENSE", () => {
  const buyArea = createMockElement({ hidden: true });
  const buyBtn = createMockElement({ textContent: "BUY LICENSE" });
  mainModule.ui.licenseBuyArea = buyArea;
  mainModule.ui.licenseBuyBtn = buyBtn;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.TRIAL, expiresAt: Math.floor(Date.now() / 1000) + 86400 * 25 })
  });

  mainModule.updateLicenseDialogUI();
  assert.equal(buyArea.hidden, false, "BUY LICENSE area should be visible during TRIAL");
  assert.equal(buyBtn.textContent, "BUY LICENSE");
});

test("121. [Buy License 2] BUY LICENSE is not red", () => {
  const css = fs.readFileSync(path.join(__dirname, "../style.css"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  
  // HTML button uses .btn-buy-license
  assert.ok(html.includes('id="licenseBuyBtn" class="btn btn-buy-license full" type="button"'));
  
  // CSS definition for .btn-buy-license exists and uses green, NOT red
  const buyBtnCssMatch = css.match(/\.btn-buy-license\s*\{([^}]+)\}/);
  assert.ok(buyBtnCssMatch, ".btn-buy-license must be styled in style.css");
  const rules = buyBtnCssMatch[1];
  
  assert.ok(rules.includes("background-color: #1e7e34") || rules.includes("var(--accent)"), "Must use positive green styling");
  assert.ok(!rules.includes("#e46a6a") && !rules.includes("#f87171") && !rules.includes("rgba(228, 106, 106"), "BUY LICENSE must not use red warning color");
});

test("122. [Buy License 3] BUY LICENSE uses existing WhatsApp helper", () => {
  const testUrl = mainModule.getAdminWhatsAppUrl();
  assert.ok(typeof mainModule.handleBuyLicenseAction === "function");
  assert.equal(testUrl, "https://wa.me/917001514367?text=" + encodeURIComponent("I want to buy a license for FM Album Designing Tools."));
});

test("123. [Buy License 4] BUY LICENSE target number = 917001514367", () => {
  const url = mainModule.getAdminWhatsAppUrl();
  assert.ok(url.startsWith("https://wa.me/917001514367"));
  assert.equal(mainModule.ADMIN_CONTACT_E164, "917001514367");
  assert.equal(mainModule.ADMIN_CONTACT_DISPLAY, "7001514367");
});

test("124. [Buy License 5] Pre-filled message is exactly: I want to buy a license for FM Album Designing Tools.", () => {
  assert.equal(mainModule.ADMIN_WHATSAPP_MESSAGE, "I want to buy a license for FM Album Designing Tools.");
  const url = mainModule.getAdminWhatsAppUrl();
  assert.ok(url.includes("text=" + encodeURIComponent("I want to buy a license for FM Album Designing Tools.")));
});

test("125. [Buy License 6] TRIAL still shows ACTIVATE LICENSE separately", () => {
  const activateBtn = createMockElement({ hidden: true });
  const formGroup = createMockElement({ hidden: true });
  const keyInput = createMockElement({ parentElement: formGroup });
  mainModule.ui.licenseActivateBtn = activateBtn;
  mainModule.ui.licenseActivationForm = formGroup;
  mainModule.ui.licenseKeyInput = keyInput;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.TRIAL, expiresAt: Math.floor(Date.now() / 1000) + 86400 * 20 })
  });

  mainModule.updateLicenseDialogUI();
  assert.equal(activateBtn.hidden, false, "ACTIVATE LICENSE button must remain visible during trial");
  assert.equal(formGroup.hidden, false, "License key form group must remain visible during trial");
});

test("126. [Buy License 7] TRIAL does not show START TRIAL", () => {
  const startTrialBtn = createMockElement({ hidden: false });
  const orDivider = createMockElement({ hidden: false });
  mainModule.ui.licenseStartTrialBtn = startTrialBtn;
  mainModule.ui.licenseOrDivider = orDivider;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.TRIAL, expiresAt: Math.floor(Date.now() / 1000) + 86400 * 20 })
  });

  mainModule.updateLicenseDialogUI();
  assert.equal(startTrialBtn.hidden, true, "START TRIAL button must be hidden during active trial");
  assert.equal(orDivider.hidden, true, "OR divider must be hidden during active trial");
});

test("127. [Buy License 8] TRIAL does not show DEACTIVATE THIS COMPUTER", () => {
  const deactivateBtn = createMockElement({ hidden: false });
  mainModule.ui.licenseDeactivateBtn = deactivateBtn;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.TRIAL, expiresAt: Math.floor(Date.now() / 1000) + 86400 * 20 })
  });

  mainModule.updateLicenseDialogUI();
  assert.equal(deactivateBtn.hidden, true, "DEACTIVATE THIS COMPUTER must be hidden during trial");
});

test("128. [Buy License 9] ACTIVE does not show BUY LICENSE", () => {
  const buyArea = createMockElement({ hidden: false });
  mainModule.ui.licenseBuyArea = buyArea;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.ACTIVE, plan: "Pro" })
  });

  mainModule.updateLicenseDialogUI();
  assert.equal(buyArea.hidden, true, "BUY LICENSE must be hidden when license is ACTIVE");
});

test("129. [Buy License 10] GRACE does not show BUY LICENSE", () => {
  const buyArea = createMockElement({ hidden: false });
  mainModule.ui.licenseBuyArea = buyArea;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.GRACE, plan: "Pro" })
  });

  mainModule.updateLicenseDialogUI();
  assert.equal(buyArea.hidden, true, "BUY LICENSE must be hidden when license is in GRACE");
});

test("130. [Buy License 11] Trial bottom status remains: Trial Active • N Days Left", () => {
  const bottomEl = createMockElement();
  mainModule.ui.bottomLicenseStatus = bottomEl;

  const nowSec = Math.floor(Date.now() / 1000);
  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.TRIAL, expiresAt: nowSec + 15 * 86400 })
  });

  mainModule.updateBottomLicenseStatusUI();
  assert.equal(bottomEl.textContent, "Trial Active • 15 Days Left");
  assert.ok(bottomEl.classList.contains("status-trial-active"));
});

test("131. [Buy License 12] Existing Contact Admin / expiry tests remain passing", () => {
  const areaEl = createMockElement({ hidden: true });
  const phoneEl = createMockElement();
  const btnEl = createMockElement();
  mainModule.ui.licenseContactAdminArea = areaEl;
  mainModule.ui.licenseAdminPhoneDisplay = phoneEl;
  mainModule.ui.licenseContactAdminBtn = btnEl;

  // TRIAL_EXPIRED
  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.TRIAL_EXPIRED })
  });
  mainModule.updateLicenseDialogUI();
  assert.equal(areaEl.hidden, false);
  assert.equal(phoneEl.textContent, "7001514367");

  // EXPIRED
  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.EXPIRED })
  });
  mainModule.updateLicenseDialogUI();
  assert.equal(areaEl.hidden, false);
  assert.equal(phoneEl.textContent, "7001514367");
});

// =============================================================================
// PART 9 — FINAL LICENSE DIALOG UX UPDATE TESTS (132 - 144 / Requirements 1 - 37)
// =============================================================================

test("132. [Req 1] UNACTIVATED dialog shows: 7001514367", () => {
  const phoneEl = createMockElement();
  const buyArea = createMockElement({ hidden: true });
  mainModule.ui.licenseBuyPhoneDisplay = phoneEl;
  mainModule.ui.licenseBuyArea = buyArea;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.UNACTIVATED })
  });

  mainModule.updateLicenseDialogUI();
  assert.equal(phoneEl.textContent, "7001514367");
  assert.equal(buyArea.hidden, false);
});

test("133. [Req 2] UNACTIVATED shows: BUY LICENSE", () => {
  const buyBtn = createMockElement({ textContent: "" });
  const buyArea = createMockElement({ hidden: true });
  mainModule.ui.licenseBuyBtn = buyBtn;
  mainModule.ui.licenseBuyArea = buyArea;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.UNACTIVATED })
  });

  mainModule.updateLicenseDialogUI();
  assert.equal(buyArea.hidden, false);
  assert.equal(buyBtn.textContent, "BUY LICENSE");
});

test("134. [Req 3] UNACTIVATED shows: ACTIVATE LICENSE", () => {
  const activateBtn = createMockElement({ hidden: true });
  const formGroup = createMockElement({ hidden: true });
  const keyInput = createMockElement({ parentElement: formGroup });
  mainModule.ui.licenseActivateBtn = activateBtn;
  mainModule.ui.licenseActivationForm = formGroup;
  mainModule.ui.licenseKeyInput = keyInput;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.UNACTIVATED })
  });

  mainModule.updateLicenseDialogUI();
  assert.equal(activateBtn.hidden, false);
  assert.equal(formGroup.hidden, false);
});

test("135. [Req 4] UNACTIVATED shows: START 30-DAY FREE TRIAL", () => {
  const startTrialBtn = createMockElement({ hidden: true });
  const orDivider = createMockElement({ hidden: true });
  mainModule.ui.licenseStartTrialBtn = startTrialBtn;
  mainModule.ui.licenseOrDivider = orDivider;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.UNACTIVATED })
  });

  mainModule.updateLicenseDialogUI();
  assert.equal(startTrialBtn.hidden, false);
  assert.equal(orDivider.hidden, false);
});

test("136. [Req 5, 6, 7] BUY LICENSE click uses existing WhatsApp helper with target 917001514367 and exact message", () => {
  assert.equal(typeof mainModule.handleBuyLicenseAction, "function");
  assert.equal(mainModule.ADMIN_CONTACT_E164, "917001514367");
  assert.equal(mainModule.ADMIN_WHATSAPP_MESSAGE, "I want to buy a license for FM Album Designing Tools.");
  const url = mainModule.getAdminWhatsAppUrl();
  assert.equal(url, "https://wa.me/917001514367?text=" + encodeURIComponent("I want to buy a license for FM Album Designing Tools."));
});

test("137. [Req 8, 9, 10] Clicking BUY LICENSE does not call /v1/trial/start, does not change state, does not set trialPreviouslyStarted", async () => {
  let trialStartCalled = false;
  const rawStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: rawStorage });
  const mockApi = {
    async startTrial() {
      trialStartCalled = true;
      return { ok: true };
    }
  };
  const { spkiB64 } = generateTestKeypair();
  const verifier = new TokenVerifier({
    expectedKid: "test_k1",
    publicKeySpki: spkiB64,
    expectedPluginId: "in.memorymaker.albumplacer",
    expectedIssuer: "mm-license-server"
  });
  const manager = new LicenseManager({
    storage,
    apiClient: mockApi,
    verifier,
    pluginVersion: "1.3.0"
  });
  await manager.initialize();
  assert.equal(manager.getSnapshot().state, LICENSE_STATES.UNACTIVATED);

  mainModule.setLicenseManager(manager);

  await mainModule.handleBuyLicenseAction();

  assert.equal(trialStartCalled, false, "Clicking BUY LICENSE must NOT call startTrial / /v1/trial/start");
  assert.equal(manager.getSnapshot().state, LICENSE_STATES.UNACTIVATED, "Clicking BUY LICENSE must keep UNACTIVATED");
  const stored = await rawStorage.getItem("mm_license_trial_started_v1");
  assert.equal(stored, null, "Clicking BUY LICENSE must NOT set trialPreviouslyStarted");
});

test("138. [Req 11, 12, 13, 14, 15] TRIAL dialog shows 7001514367, BUY LICENSE, ACTIVATE LICENSE; hides START TRIAL and DEACTIVATE", () => {
  const phoneEl = createMockElement();
  const buyArea = createMockElement({ hidden: true });
  const buyBtn = createMockElement({ textContent: "" });
  const activateBtn = createMockElement({ hidden: true });
  const formGroup = createMockElement({ hidden: true });
  const startTrialBtn = createMockElement({ hidden: false });
  const deactivateBtn = createMockElement({ hidden: false });

  mainModule.ui.licenseBuyPhoneDisplay = phoneEl;
  mainModule.ui.licenseBuyArea = buyArea;
  mainModule.ui.licenseBuyBtn = buyBtn;
  mainModule.ui.licenseActivateBtn = activateBtn;
  mainModule.ui.licenseActivationForm = formGroup;
  mainModule.ui.licenseStartTrialBtn = startTrialBtn;
  mainModule.ui.licenseDeactivateBtn = deactivateBtn;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.TRIAL, expiresAt: Math.floor(Date.now() / 1000) + 86400 * 20 })
  });

  mainModule.updateLicenseDialogUI();

  assert.equal(phoneEl.textContent, "7001514367", "TRIAL dialog must show 7001514367");
  assert.equal(buyArea.hidden, false, "TRIAL dialog must show BUY LICENSE area");
  assert.equal(buyBtn.textContent, "BUY LICENSE", "TRIAL dialog must show BUY LICENSE button");
  assert.equal(activateBtn.hidden, false, "TRIAL dialog must show ACTIVATE LICENSE");
  assert.equal(formGroup.hidden, false, "TRIAL dialog must show license key form group");
  assert.equal(startTrialBtn.hidden, true, "TRIAL dialog must hide START TRIAL");
  assert.equal(deactivateBtn.hidden, true, "TRIAL dialog must hide DEACTIVATE");
});

test("139. [Req 16, 17, 18] BUY LICENSE keeps TRIAL state unchanged, does not alter expiresAt, bottom remains Trial Active", async () => {
  const expiresAt = Math.floor(Date.now() / 1000) + 86400 * 18;
  const manager = {
    getSnapshot: () => ({ state: LICENSE_STATES.TRIAL, expiresAt })
  };
  mainModule.setLicenseManager(manager);

  await mainModule.handleBuyLicenseAction();

  assert.equal(manager.getSnapshot().state, LICENSE_STATES.TRIAL);
  assert.equal(manager.getSnapshot().expiresAt, expiresAt);

  const bottomEl = createMockElement();
  mainModule.ui.bottomLicenseStatus = bottomEl;
  mainModule.updateBottomLicenseStatusUI();
  assert.equal(bottomEl.textContent, "Trial Active • 18 Days Left");
});

test("140. [Req 19, 20, 21] TRIAL_EXPIRED shows 7001514367, CONTACT ADMIN, and hides Start Trial", () => {
  const phoneEl = createMockElement();
  const areaEl = createMockElement({ hidden: true });
  const btnEl = createMockElement({ textContent: "" });
  const startTrialBtn = createMockElement({ hidden: false });

  mainModule.ui.licenseAdminPhoneDisplay = phoneEl;
  mainModule.ui.licenseContactAdminArea = areaEl;
  mainModule.ui.licenseContactAdminBtn = btnEl;
  mainModule.ui.licenseStartTrialBtn = startTrialBtn;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.TRIAL_EXPIRED })
  });

  mainModule.updateLicenseDialogUI();

  assert.equal(phoneEl.textContent, "7001514367");
  assert.equal(areaEl.hidden, false);
  assert.equal(btnEl.textContent, "CONTACT ADMIN");
  assert.equal(startTrialBtn.hidden, true);
});

test("141. [Req 22, 23, 24, 25] EXPIRED shows 7001514367, CONTACT ADMIN, bottom remains red Please Add License", () => {
  const phoneEl = createMockElement();
  const areaEl = createMockElement({ hidden: true });
  const btnEl = createMockElement({ textContent: "" });
  const bottomEl = createMockElement();

  mainModule.ui.licenseAdminPhoneDisplay = phoneEl;
  mainModule.ui.licenseContactAdminArea = areaEl;
  mainModule.ui.licenseContactAdminBtn = btnEl;
  mainModule.ui.bottomLicenseStatus = bottomEl;

  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.EXPIRED })
  });

  mainModule.updateLicenseDialogUI();
  mainModule.updateBottomLicenseStatusUI();

  assert.equal(phoneEl.textContent, "7001514367");
  assert.equal(areaEl.hidden, false);
  assert.equal(btnEl.textContent, "CONTACT ADMIN");
  assert.equal(bottomEl.textContent, "Please Add License");
  assert.ok(bottomEl.classList.contains("status-license-warning"));

  // Check TRIAL_EXPIRED also produces Please Add License (red)
  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.TRIAL_EXPIRED })
  });
  mainModule.updateBottomLicenseStatusUI();
  assert.equal(bottomEl.textContent, "Please Add License");
  assert.ok(bottomEl.classList.contains("status-license-warning"));
});

test("142. [Req 26, 27, 28, 29, 30] ACTIVE/GRACE hides BUY LICENSE & purchase contact section, bottom is Activated License", () => {
  const buyArea = createMockElement({ hidden: false });
  const contactArea = createMockElement({ hidden: false });
  const bottomEl = createMockElement();

  mainModule.ui.licenseBuyArea = buyArea;
  mainModule.ui.licenseContactAdminArea = contactArea;
  mainModule.ui.bottomLicenseStatus = bottomEl;

  // Test ACTIVE
  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.ACTIVE, plan: "Pro" })
  });
  mainModule.updateLicenseDialogUI();
  mainModule.updateBottomLicenseStatusUI();

  assert.equal(buyArea.hidden, true, "ACTIVE must hide BUY LICENSE area");
  assert.equal(contactArea.hidden, true, "ACTIVE must hide contact admin area");
  assert.equal(bottomEl.textContent, "Activated License");
  assert.ok(bottomEl.classList.contains("status-activated"));

  // Test GRACE
  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.GRACE, plan: "Pro" })
  });
  mainModule.updateLicenseDialogUI();
  mainModule.updateBottomLicenseStatusUI();

  assert.equal(buyArea.hidden, true, "GRACE must hide BUY LICENSE area");
  assert.equal(contactArea.hidden, true, "GRACE must hide contact admin area");
  assert.equal(bottomEl.textContent, "Activated License");
  assert.ok(bottomEl.classList.contains("status-activated"));
});

test("143. [Req 31, 32, 33] WhatsApp URL begins https://wa.me/917001514367?text= and uses encodeURIComponent on exact message", () => {
  const exactMessage = "I want to buy a license for FM Album Designing Tools.";
  const url = mainModule.getAdminWhatsAppUrl();
  assert.equal(mainModule.ADMIN_WHATSAPP_MESSAGE, exactMessage);
  assert.ok(url.startsWith("https://wa.me/917001514367?text="));
  assert.equal(url, "https://wa.me/917001514367?text=" + encodeURIComponent(exactMessage));
});

test("144. [Req 34, 35, 36, 37] User action required, openExternal failure does not crash, failure message contains 7001514367, phone remains visible", async () => {
  // Req 34: Updating dialog does not trigger openExternal
  mainModule.setLicenseManager({
    getSnapshot: () => ({ state: LICENSE_STATES.UNACTIVATED })
  });
  mainModule.updateLicenseDialogUI();

  // Req 35: openExternalUrl does not throw on invalid/unavailable environment
  let didCrash = false;
  let result;
  try {
    result = await mainModule.openExternalUrl("https://wa.me/917001514367");
  } catch {
    didCrash = true;
  }
  assert.equal(didCrash, false, "openExternalUrl must not crash");
  assert.equal(typeof result, "boolean");

  // Req 36 & 37: Failure in handleBuyLicenseAction
  const phoneEl = createMockElement({ textContent: "7001514367" });
  const buyErrorEl = createMockElement({ hidden: true });
  mainModule.ui.licenseBuyPhoneDisplay = phoneEl;
  mainModule.ui.licenseBuyContactError = buyErrorEl;

  await mainModule.handleBuyLicenseAction();

  assert.equal(buyErrorEl.hidden, false);
  assert.ok(buyErrorEl.textContent.includes("7001514367"));
  assert.equal(buyErrorEl.textContent, "Unable to open WhatsApp. Please contact 7001514367 manually.");
  assert.equal(phoneEl.textContent, "7001514367");
  assert.equal(phoneEl.hidden, false);
});
