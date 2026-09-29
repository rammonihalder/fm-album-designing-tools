"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  STORAGE_KEYS,
  SCHEMA_VERSION,
  REFRESH_INTERVAL_DAYS,
  REFRESH_INTERVAL_MS,
  OFFLINE_GRACE_PERIOD_DAYS,
  OFFLINE_GRACE_PERIOD_MS
} = require("../src/licensing/constants");

const {
  LICENSE_STATES,
  isValidState,
  normalizeState,
  isOperationalState
} = require("../src/licensing/licenseState");

const {
  LicenseStorage,
  createLicenseStorage
} = require("../src/licensing/licenseStorage");

const {
  LicenseManager,
  normalizeSnapshot,
  createLicenseManager
} = require("../src/licensing/licenseManager");

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
 * Creates an in-memory mock implementation of UXP secureStorage.
 * Mimics real Adobe UXP secureStorage by storing and returning Uint8Array.
 * @param {object} [initial={}]
 * @returns {object}
 */
function createMockSecureStorage(initial = {}) {
  const store = new Map();
  for (const [key, value] of Object.entries(initial)) {
    if (value == null) continue;
    store.set(key, toMockBytes(value));
  }
  return {
    async getItem(key) {
      if (!store.has(key)) return null;
      const val = store.get(key);
      return val != null ? toMockBytes(val) : null;
    },
    async setItem(key, value) {
      store.set(key, toMockBytes(value));
    },
    async removeItem(key) {
      store.delete(key);
    },
    _store: store
  };
}

// -----------------------------------------------------------------------------
// 1. clean / no secureStorage data -> UNACTIVATED
// -----------------------------------------------------------------------------
test("1. clean / no secureStorage data -> UNACTIVATED", async () => {
  const mockStorage = createMockSecureStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  const manager = createLicenseManager({ storage });

  const snapshot = await manager.initialize();
  assert.equal(snapshot.state, LICENSE_STATES.UNACTIVATED);
  assert.equal(manager.getState(), LICENSE_STATES.UNACTIVATED);
});

// -----------------------------------------------------------------------------
// 2. missing storage item is safe
// -----------------------------------------------------------------------------
test("2. missing storage item is safe", async () => {
  const mockStorage = createMockSecureStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });

  const item = await storage.readItem("non_existent_key");
  assert.equal(item, null);

  const token = await storage.readToken();
  assert.equal(token, null);

  const meta = await storage.readMetadata();
  assert.equal(meta, null);
});

// -----------------------------------------------------------------------------
// 3. malformed cached JSON is handled safely
// -----------------------------------------------------------------------------
test("3. malformed cached JSON is handled safely", async () => {
  const mockStorage = createMockSecureStorage({
    [STORAGE_KEYS.SIGNED_TOKEN]: "{ this is definitely not valid json :::"
  });
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  const manager = createLicenseManager({ storage });

  const token = await storage.readToken();
  assert.equal(token, null, "Malformed JSON must return null without throwing");

  const snapshot = await manager.initialize();
  assert.equal(snapshot.state, LICENSE_STATES.UNACTIVATED);
});

// -----------------------------------------------------------------------------
// 4. unsupported schema/version is rejected safely
// -----------------------------------------------------------------------------
test("4. unsupported schema/version is rejected safely", async () => {
  const invalidSchemaPayload = JSON.stringify({
    schemaVersion: 999, // Future/unknown version
    savedAt: Date.now(),
    payload: { state: "ACTIVE", licenseId: "test-license" }
  });
  const mockStorage = createMockSecureStorage({
    [STORAGE_KEYS.SIGNED_TOKEN]: invalidSchemaPayload
  });
  const storage = createLicenseStorage({
    secureStorage: mockStorage,
    schemaVersion: 1
  });

  const read = await storage.readToken();
  assert.equal(read, null, "Mismatched schemaVersion must be safely rejected");

  const manager = createLicenseManager({ storage });
  const snapshot = await manager.initialize();
  assert.equal(snapshot.state, LICENSE_STATES.UNACTIVATED);
});

// -----------------------------------------------------------------------------
// 5. secure storage write/read round trip with mocked storage
// -----------------------------------------------------------------------------
test("5. secure storage write/read round trip with mocked storage", async () => {
  const mockStorage = createMockSecureStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });

  const tokenPayload = {
    token: "mock-signed-jwt-token-string",
    issuedAt: 1727400000000
  };

  const writeSuccess = await storage.writeToken(tokenPayload);
  assert.equal(writeSuccess, true);

  const readBack = await storage.readToken();
  assert.deepEqual(readBack, tokenPayload);

  // Verify Uint8Array / Buffer decoding as UXP secureStorage can return bytes
  const rawJson = mockStorage._store.get(STORAGE_KEYS.SIGNED_TOKEN);
  mockStorage._store.set(
    STORAGE_KEYS.SIGNED_TOKEN,
    Buffer.from(rawJson, "utf-8")
  );

  const readBytes = await storage.readToken();
  assert.deepEqual(readBytes, tokenPayload, "Uint8Array / Buffer raw payloads must decode properly");
});

// -----------------------------------------------------------------------------
// 6. secure storage delete
// -----------------------------------------------------------------------------
test("6. secure storage delete", async () => {
  const mockStorage = createMockSecureStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });

  await storage.writeToken({ test: 123 });
  assert.ok(mockStorage._store.has(STORAGE_KEYS.SIGNED_TOKEN));

  const deleteSuccess = await storage.deleteToken();
  assert.equal(deleteSuccess, true);
  assert.equal(mockStorage._store.has(STORAGE_KEYS.SIGNED_TOKEN), false);

  const afterDelete = await storage.readToken();
  assert.equal(afterDelete, null);
});

// -----------------------------------------------------------------------------
// 7. normalized license state values
// -----------------------------------------------------------------------------
test("7. normalized license state values and helpers", () => {
  assert.deepEqual(Object.keys(LICENSE_STATES).sort(), [
    "ACTIVE",
    "ERROR",
    "EXPIRED",
    "GRACE",
    "INVALID",
    "REVOKED",
    "SUSPENDED",
    "UNACTIVATED"
  ].sort());

  assert.equal(isValidState(LICENSE_STATES.ACTIVE), true);
  assert.equal(isValidState(LICENSE_STATES.UNACTIVATED), true);
  assert.equal(isValidState(LICENSE_STATES.SUSPENDED), true);
  assert.equal(isValidState("RANDOM_STATE"), false);
  assert.equal(isValidState(null), false);
  assert.equal(isValidState(undefined), false);

  assert.equal(normalizeState("ACTIVE"), "ACTIVE");
  assert.equal(normalizeState("SUSPENDED"), "SUSPENDED");
  assert.equal(normalizeState("UNKNOWN_STATE"), "INVALID");
  assert.equal(normalizeState(null, "UNACTIVATED"), "UNACTIVATED");

  assert.equal(isOperationalState("ACTIVE"), true);
  assert.equal(isOperationalState("GRACE"), true);
  assert.equal(isOperationalState("UNACTIVATED"), false);
  assert.equal(isOperationalState("EXPIRED"), false);
  assert.equal(isOperationalState("REVOKED"), false);
  assert.equal(isOperationalState("SUSPENDED"), false);
  assert.equal(isOperationalState("INVALID"), false);
});

// -----------------------------------------------------------------------------
// 8. manager initializes only once where appropriate
// -----------------------------------------------------------------------------
test("8. manager initializes only once where appropriate", async () => {
  let readCount = 0;
  const mockStorage = {
    async getItem() {
      readCount++;
      return null;
    },
    async setItem() {},
    async removeItem() {}
  };
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  const manager = createLicenseManager({ storage });

  const first = await manager.initialize();
  const second = await manager.initialize();
  const third = await manager.initialize();

  assert.equal(readCount, 1, "Storage should only be read once during initialization");
  assert.deepEqual(first, second);
  assert.deepEqual(second, third);
});

// -----------------------------------------------------------------------------
// 9. no backend means activation cannot succeed
// -----------------------------------------------------------------------------
test("9. no backend means activation cannot succeed", async () => {
  const manager = createLicenseManager();
  await manager.initialize();

  const result = await manager.activate("XXXX-XXXX-XXXX-XXXX");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "service-not-configured");
  assert.equal(manager.getState(), LICENSE_STATES.UNACTIVATED, "Device must not be marked active");
});

// -----------------------------------------------------------------------------
// 10. no backend means refresh cannot silently create ACTIVE state
// -----------------------------------------------------------------------------
test("10. no backend means refresh cannot silently create ACTIVE state", async () => {
  const manager = createLicenseManager();
  await manager.initialize();

  const result = await manager.refresh();
  assert.equal(result.ok, false);
  assert.equal(result.reason, "service-not-configured");
  assert.equal(manager.getState(), LICENSE_STATES.UNACTIVATED);
});

// -----------------------------------------------------------------------------
// 11. snapshot contains expected normalized fields
// -----------------------------------------------------------------------------
test("11. snapshot contains expected normalized fields", () => {
  const emptySnapshot = normalizeSnapshot({});
  assert.equal(emptySnapshot.state, LICENSE_STATES.UNACTIVATED);
  assert.equal(emptySnapshot.licenseId, null);
  assert.equal(emptySnapshot.plan, null);
  assert.equal(emptySnapshot.deviceId, null);
  assert.equal(emptySnapshot.expiresAt, null);
  assert.equal(emptySnapshot.refreshAfter, null);
  assert.equal(emptySnapshot.graceUntil, null);
  assert.equal(emptySnapshot.lastValidatedAt, null);
  assert.equal(emptySnapshot.reason, null);

  const populated = normalizeSnapshot({
    state: "ACTIVE",
    licenseId: "lic_123",
    plan: "pro",
    deviceId: "dev_abc",
    expiresAt: 1800000000000,
    refreshAfter: 1750000000000,
    graceUntil: 1810000000000,
    lastValidatedAt: 1720000000000,
    reason: "verified"
  });
  assert.equal(populated.state, "ACTIVE");
  assert.equal(populated.licenseId, "lic_123");
  assert.equal(populated.plan, "pro");
  assert.equal(populated.deviceId, "dev_abc");
  assert.equal(populated.expiresAt, 1800000000000);
  assert.equal(populated.refreshAfter, 1750000000000);
  assert.equal(populated.graceUntil, 1810000000000);
  assert.equal(populated.lastValidatedAt, 1720000000000);
  assert.equal(populated.reason, "verified");
});

// -----------------------------------------------------------------------------
// 12. storage error does not crash initialization
// -----------------------------------------------------------------------------
test("12. storage error does not crash initialization", async () => {
  const brokenStorage = {
    async getItem() {
      throw new Error("Disk hardware failure");
    },
    async setItem() {
      throw new Error("Disk hardware failure");
    },
    async removeItem() {
      throw new Error("Disk hardware failure");
    }
  };
  const storage = createLicenseStorage({ secureStorage: brokenStorage });
  const manager = createLicenseManager({ storage });

  let initError = null;
  let snapshot = null;
  try {
    snapshot = await manager.initialize();
  } catch (err) {
    initError = err;
  }

  assert.equal(initError, null, "Manager initialization must never throw fatal error");
  assert.ok(snapshot, "Snapshot should be returned");
  assert.equal(snapshot.state, LICENSE_STATES.ERROR);
  assert.equal(snapshot.reason, "storage-error");
});

// -----------------------------------------------------------------------------
// 13. existing 8 tool actions are still present
// -----------------------------------------------------------------------------
test("13. existing 8 tool actions are still present in index.html", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const expectedToolIds = [
    "openPsdBtn",
    "autoPhotoFillBtn",
    "swapPhotosBtn",
    "flipPhotoBtn",
    "savePageBtn",
    "saveEditedPhotosBtn",
    "savePsdCategoryBtn",
    "removePhotosBtn"
  ];

  for (const id of expectedToolIds) {
    assert.ok(html.includes(`id="${id}"`), `index.html must retain ${id}`);
  }
});

// -----------------------------------------------------------------------------
// 14. existing tool handler wiring remains intact
// -----------------------------------------------------------------------------
test("14. existing tool handler wiring remains intact in main.js", () => {
  const main = require("../main");
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

  for (const handlerName of expectedHandlers) {
    assert.equal(typeof main[handlerName], "function", `${handlerName} must be exported function`);
  }
  assert.equal(typeof main.attachActionHandler, "function");
  assert.equal(typeof main.setButtonsDisabled, "function");
});

// -----------------------------------------------------------------------------
// 15. licensing foundation does NOT perform fetch/network calls
// -----------------------------------------------------------------------------
test("15. licensing foundation does NOT perform fetch/network calls", async () => {
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    fetchCalled = true;
    throw new Error("Network call forbidden in Phase 1");
  };

  try {
    const manager = createLicenseManager();
    await manager.initialize();
    await manager.activate("TEST-KEY");
    await manager.refresh();
    manager.getState();
    manager.getSnapshot();
    await manager.clearCachedLicense();

    assert.equal(fetchCalled, false, "Phase 1 licensing must never trigger network fetch");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// -----------------------------------------------------------------------------
// 16. manifest plugin ID remains unchanged
// -----------------------------------------------------------------------------
test("16. manifest plugin ID remains unchanged", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../manifest.json"), "utf8")
  );
  assert.equal(manifest.id, "in.memorymaker.albumplacer");
  assert.ok(manifest.version === "1.2.0" || manifest.version === "1.1.0");
  assert.equal(manifest.manifestVersion, 5);
  assert.equal(manifest.requiredPermissions?.localFileSystem, "fullAccess");
});

// -----------------------------------------------------------------------------
// 17. manifest network permissions strictly restricted to Worker domain
// -----------------------------------------------------------------------------
test("17. manifest network permissions are strictly limited to Worker domain and not 'all'", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../manifest.json"), "utf8")
  );
  assert.ok(manifest.requiredPermissions?.network, "Manifest must define requiredPermissions.network");
  assert.notEqual(manifest.requiredPermissions.network.domains, "all", "network.domains must NOT be 'all'");
  assert.deepEqual(
    manifest.requiredPermissions.network.domains,
    ["https://mm-license-server.rammonihalder.workers.dev"]
  );
});

// -----------------------------------------------------------------------------
// 18. Phase 1 does not disable existing tools
// -----------------------------------------------------------------------------
test("18. Phase 1 does not disable existing tools", () => {
  const main = require("../main");
  assert.ok(main.licenseManager, "License manager should be instantiated");
  // The license manager state in Phase 1 is UNACTIVATED, yet tools remain operational
  assert.equal(main.licenseManager.getState(), LICENSE_STATES.UNACTIVATED);

  // Verify that tool handlers are not wrapped in blocking license checks
  const mainSrc = fs.readFileSync(path.join(__dirname, "../main.js"), "utf8");
  assert.equal(
    mainSrc.includes("if (!licenseManager.isOperational)"),
    false,
    "Tools must not be gated by license state in Phase 1"
  );
  assert.equal(
    mainSrc.includes("isOperationalState"),
    false,
    "isOperationalState should not be applied to existing tools in Phase 1"
  );
});

// -----------------------------------------------------------------------------
// 19. Clear cached license resets storage and state
// -----------------------------------------------------------------------------
test("19. Clear cached license resets storage and state", async () => {
  const mockStorage = createMockSecureStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  await storage.writeToken({ mock: "token" });
  await storage.writeMetadata({ mock: "meta" });

  const manager = createLicenseManager({ storage });
  await manager.initialize();

  const resetSnapshot = await manager.clearCachedLicense();
  assert.equal(resetSnapshot.state, LICENSE_STATES.UNACTIVATED);
  assert.equal(await storage.readToken(), null);
  assert.equal(await storage.readMetadata(), null);
});

// -----------------------------------------------------------------------------
// 20. Licensing UI foundation elements exist in index.html
// -----------------------------------------------------------------------------
test("20. Licensing UI foundation elements exist in index.html", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.ok(html.includes('<dialog id="licenseDialog"'), "licenseDialog must exist");
  assert.ok(html.includes('id="licenseKeyInput"'), "License key input must exist");
  assert.ok(html.includes('id="licenseActivateBtn"'), "Activate button must exist");
  assert.ok(html.includes('id="licenseStatusMessage"'), "Status message placeholder must exist");
  assert.ok(html.includes('id="licenseInfoArea"'), "License info area must exist");
  // Root dialog must NOT have hidden attribute (UXP uxpShowModal controls modal presentation)
  assert.equal(/<dialog id="licenseDialog"[^>]*hidden/.test(html), false, "Root license dialog must not have hidden attribute");
  // State-specific controls retain hidden attribute by default
  assert.match(html, /id="licenseDeactivateBtn"[^>]*hidden/, "Deactivate button is hidden by default");
});

// -----------------------------------------------------------------------------
// 21. Constants match specified intervals and schema
// -----------------------------------------------------------------------------
test("21. Constants match specified intervals and schema", () => {
  assert.equal(SCHEMA_VERSION, 1);
  assert.equal(REFRESH_INTERVAL_DAYS, 7);
  assert.equal(REFRESH_INTERVAL_MS, 7 * 24 * 60 * 60 * 1000);
  assert.equal(OFFLINE_GRACE_PERIOD_DAYS, 14);
  assert.equal(OFFLINE_GRACE_PERIOD_MS, 14 * 24 * 60 * 60 * 1000);
});

// -----------------------------------------------------------------------------
// 22. No private key, master key, or hardcoded secrets in source files
// -----------------------------------------------------------------------------
test("22. No private keys, master keys, or hardcoded secrets in source files", () => {
  const licensingFiles = [
    "../src/licensing/constants.js",
    "../src/licensing/licenseState.js",
    "../src/licensing/licenseStorage.js",
    "../src/licensing/licenseManager.js"
  ];

  const forbiddenPatterns = [
    /-----BEGIN (RSA|EC|PRIVATE) KEY-----/i,
    /isPremium\s*=\s*true/i,
    /licensed\s*=\s*true/i,
    /master[_-]?key/i,
    /admin[_-]?secret/i,
    /bypass[_-]?password/i
  ];

  for (const relPath of licensingFiles) {
    const content = fs.readFileSync(path.join(__dirname, relPath), "utf8");
    for (const pattern of forbiddenPatterns) {
      assert.equal(
        pattern.test(content),
        false,
        `File ${relPath} must not match forbidden security pattern ${pattern}`
      );
    }
  }
});
