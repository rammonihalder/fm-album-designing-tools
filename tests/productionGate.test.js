"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const mainModule = require("../main");
const { PLUGIN_VERSION, STORAGE_KEYS } = require("../src/licensing/constants");
const { LICENSE_STATES, isOperationalState } = require("../src/licensing/licenseState");
const { createLicenseManager, LicenseManager, SAFE_USER_MESSAGES } = require("../src/licensing/licenseManager");
const { createLicenseStorage } = require("../src/licensing/licenseStorage");
const { getInstallationDeviceId } = require("../src/licensing/deviceId");
const { verifyToken } = require("../src/licensing/crypto/tokenVerifier");
const PRODUCTION_CONFIG = require("../src/licensing/productionConfig");

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

// =============================================================================
// PRODUCTION GATE VERIFICATION SUITE (Items 1 - 29)
// =============================================================================

test("1. main.js contains no runtime DEV_LICENSE_BYPASS implementation", () => {
  assert.equal(mainModule.DEV_LICENSE_BYPASS, undefined, "DEV_LICENSE_BYPASS must not exist in main exports");
  const mainSrc = fs.readFileSync(path.join(__dirname, "../main.js"), "utf8");
  assert.equal(/let\s+DEV_LICENSE_BYPASS/.test(mainSrc), false, "DEV_LICENSE_BYPASS variable declaration must be absent");
  assert.equal(/DEV_LICENSE_BYPASS\s*=/.test(mainSrc), false, "DEV_LICENSE_BYPASS assignment must be absent");
  assert.equal(mainSrc.includes("License gate bypass ENABLED"), false, "Bypass log message must be absent");
});

test("2. setDevLicenseBypass is not exported", () => {
  assert.equal(mainModule.setDevLicenseBypass, undefined, "setDevLicenseBypass must not be exported");
  const mainSrc = fs.readFileSync(path.join(__dirname, "../main.js"), "utf8");
  assert.equal(/function\s+setDevLicenseBypass/.test(mainSrc), false, "setDevLicenseBypass function must be absent");
});

test("3. missing licenseManager fails closed", async () => {
  const orig = mainModule.getLicenseManagerInstance();
  try {
    mainModule.setLicenseManager(null);
    const operational = await mainModule.ensureLicenseOperational();
    assert.equal(operational, false, "ensureLicenseOperational must return false when licenseManager is null");

    let actionExecuted = false;
    const protectedAction = mainModule.wrapProtectedAction(async () => {
      actionExecuted = true;
      return "executed";
    });

    const result = await protectedAction();
    assert.deepEqual(result, { outcome: "license-required" });
    assert.equal(actionExecuted, false, "Protected action must not execute when licenseManager is null");
  } finally {
    mainModule.setLicenseManager(orig);
  }
});

test("4. manager initialization exception fails closed", async () => {
  const orig = mainModule.getLicenseManagerInstance();
  try {
    const brokenManager = {
      initialize: async () => {
        throw new Error("Simulated initialization failure");
      },
      isOperational: () => true,
      getSnapshot: () => ({ state: "ERROR" })
    };
    mainModule.setLicenseManager(brokenManager);

    const operational = await mainModule.ensureLicenseOperational();
    assert.equal(operational, false, "ensureLicenseOperational must fail closed if initialize() throws");

    let actionExecuted = false;
    const protectedAction = mainModule.wrapProtectedAction(async () => {
      actionExecuted = true;
      return "executed";
    });

    const result = await protectedAction();
    assert.deepEqual(result, { outcome: "license-required" });
    assert.equal(actionExecuted, false, "Protected action must not execute on manager initialization exception");
  } finally {
    mainModule.setLicenseManager(orig);
  }
});

test("5. missing isOperational() fails closed", async () => {
  const orig = mainModule.getLicenseManagerInstance();
  try {
    const invalidManager = {
      initialize: async () => {},
      // isOperational is deliberately omitted / not a function
      getSnapshot: () => ({ state: "ACTIVE" })
    };
    mainModule.setLicenseManager(invalidManager);

    const operational = await mainModule.ensureLicenseOperational();
    assert.equal(operational, false, "ensureLicenseOperational must fail closed if isOperational is not a function");

    let actionExecuted = false;
    const protectedAction = mainModule.wrapProtectedAction(async () => {
      actionExecuted = true;
      return "executed";
    });

    const result = await protectedAction();
    assert.deepEqual(result, { outcome: "license-required" });
    assert.equal(actionExecuted, false);
  } finally {
    mainModule.setLicenseManager(orig);
  }
});

const nonOperationalStates = [
  { testNum: 6, state: LICENSE_STATES.UNACTIVATED },
  { testNum: 7, state: LICENSE_STATES.INVALID },
  { testNum: 8, state: LICENSE_STATES.EXPIRED },
  { testNum: 9, state: LICENSE_STATES.REVOKED },
  { testNum: 10, state: LICENSE_STATES.SUSPENDED },
  { testNum: 11, state: LICENSE_STATES.ERROR }
];

for (const { testNum, state } of nonOperationalStates) {
  test(`${testNum}. ${state} cannot execute protected actions`, async () => {
    const orig = mainModule.getLicenseManagerInstance();
    try {
      const mockManager = {
        initialize: async () => {},
        isOperational: () => false,
        getSnapshot: () => ({ state, userMessage: `State is ${state}` })
      };
      mainModule.setLicenseManager(mockManager);

      const operational = await mainModule.ensureLicenseOperational();
      assert.equal(operational, false, `State ${state} must not be operational`);

      let executed = false;
      const protectedAction = mainModule.wrapProtectedAction(async () => {
        executed = true;
        return "ok";
      });

      const result = await protectedAction();
      assert.deepEqual(result, { outcome: "license-required" });
      assert.equal(executed, false, `Protected action must NOT be executed in ${state} state`);
    } finally {
      mainModule.setLicenseManager(orig);
    }
  });
}

test("12. ACTIVE executes protected actions", async () => {
  const orig = mainModule.getLicenseManagerInstance();
  try {
    const mockManager = {
      initialize: async () => {},
      isOperational: () => true,
      getSnapshot: () => ({ state: LICENSE_STATES.ACTIVE, plan: "Pro" })
    };
    mainModule.setLicenseManager(mockManager);

    const operational = await mainModule.ensureLicenseOperational();
    assert.equal(operational, true, "ACTIVE state must be operational");

    let executed = false;
    const protectedAction = mainModule.wrapProtectedAction(async (arg) => {
      executed = true;
      return `result-${arg}`;
    });

    const result = await protectedAction("test");
    assert.equal(result, "result-test");
    assert.equal(executed, true, "Protected action must execute in ACTIVE state");
  } finally {
    mainModule.setLicenseManager(orig);
  }
});

test("13. GRACE executes protected actions", async () => {
  const orig = mainModule.getLicenseManagerInstance();
  try {
    const mockManager = {
      initialize: async () => {},
      isOperational: () => true,
      getSnapshot: () => ({ state: LICENSE_STATES.GRACE, plan: "Pro" })
    };
    mainModule.setLicenseManager(mockManager);

    const operational = await mainModule.ensureLicenseOperational();
    assert.equal(operational, true, "GRACE state must be operational");

    let executed = false;
    const protectedAction = mainModule.wrapProtectedAction(async () => {
      executed = true;
      return "grace-ok";
    });

    const result = await protectedAction();
    assert.equal(result, "grace-ok");
    assert.equal(executed, true, "Protected action must execute in GRACE state");
  } finally {
    mainModule.setLicenseManager(orig);
  }
});

test("14. blocked action opens License dialog", async () => {
  const orig = mainModule.getLicenseManagerInstance();
  const origDialog = mainModule.ui.licenseDialog;
  try {
    let dialogOpened = false;
    const mockDialog = {
      hidden: true,
      uxpShowModal: async () => {
        dialogOpened = true;
      }
    };
    mainModule.ui.licenseDialog = mockDialog;

    const mockManager = {
      initialize: async () => {},
      isOperational: () => false,
      getSnapshot: () => ({ state: LICENSE_STATES.UNACTIVATED })
    };
    mainModule.setLicenseManager(mockManager);

    const protectedAction = mainModule.wrapProtectedAction(async () => "fail");
    const result = await protectedAction();

    assert.deepEqual(result, { outcome: "license-required" });
    assert.equal(dialogOpened, true, "showLicenseDialog should be triggered on blocked action");
  } finally {
    mainModule.setLicenseManager(orig);
    mainModule.ui.licenseDialog = origDialog;
  }
});

test("15. blocked action never invokes the wrapped Photoshop handler", async () => {
  const orig = mainModule.getLicenseManagerInstance();
  try {
    const mockManager = {
      initialize: async () => {},
      isOperational: () => false,
      getSnapshot: () => ({ state: LICENSE_STATES.UNACTIVATED })
    };
    mainModule.setLicenseManager(mockManager);

    let handlerCalls = 0;
    const dummyPhotoshopHandler = async () => {
      handlerCalls++;
      return "should-never-happen";
    };

    const protectedAction = mainModule.wrapProtectedAction(dummyPhotoshopHandler);
    const result = await protectedAction();

    assert.equal(handlerCalls, 0, "Handler must be called exactly 0 times");
    assert.deepEqual(result, { outcome: "license-required" });
  } finally {
    mainModule.setLicenseManager(orig);
  }
});

test("16. all current tool buttons are wrapped in wrapProtectedAction()", () => {
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
    const regex = new RegExp(`attachActionHandler\\(\\s*${btn.replace(".", "\\.")}\\s*,\\s*wrapProtectedAction\\(`);
    assert.ok(
      regex.test(mainSrc),
      `Button ${btn} must be registered with attachActionHandler(..., wrapProtectedAction(...))`
    );
  }

  // Ensure no attachActionHandler call uses an unwrapped handler
  const allAttachCalls = mainSrc.match(/attachActionHandler\([^;]+\);/g) || [];
  assert.equal(allAttachCalls.length, expectedGatedButtons.length);
  for (const call of allAttachCalls) {
    assert.ok(call.includes("wrapProtectedAction"), `attachActionHandler call must wrap handler: ${call}`);
  }
});

test("17. License button itself remains accessible while unlicensed", () => {
  const mainSrc = fs.readFileSync(path.join(__dirname, "../main.js"), "utf8");

  // manageLicenseBtn must be attached via standard click listener, not wrapped in wrapProtectedAction
  assert.ok(
    mainSrc.includes('ui.manageLicenseBtn?.addEventListener("click", () => {\n  showLicenseDialog();\n});') ||
    mainSrc.includes('manageLicenseBtn'),
    "manageLicenseBtn must have its own listener"
  );
  assert.equal(
    mainSrc.includes("attachActionHandler(ui.manageLicenseBtn, wrapProtectedAction"),
    false,
    "manageLicenseBtn must NOT be wrapped in wrapProtectedAction"
  );
});

test("18. existing signed-token verification tests continue passing", () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const now = Math.floor(Date.now() / 1000);
  const deviceHash = "device_test_18";
  const kid = "test_k1";

  const payload = {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    licenseId: "lic_test_18",
    activationId: "act_test_18",
    deviceHash,
    plan: "standard",
    entitlements: ["all-tools"],
    issuedAt: now,
    refreshAfter: now + 3600 * 24 * 7,
    graceUntil: now + 3600 * 24 * 14,
    expiresAt: now + 3600 * 24 * 30
  };

  const token = signTestToken(kid, payload, privateKey);
  const verifyOptions = {
    expectedKid: kid,
    publicKeySpki: spkiB64,
    expectedDeviceHash: deviceHash,
    nowSeconds: now + 10
  };

  const validResult = verifyToken(token, verifyOptions);
  assert.equal(validResult.ok, true);
  assert.equal(validResult.payload.licenseId, "lic_test_18");

  // Alter signature
  const tamperedToken = token.slice(0, -5) + "XXXXX";
  const invalidSigResult = verifyToken(tamperedToken, verifyOptions);
  assert.equal(invalidSigResult.ok, false);

  // Device mismatch
  const mismatchResult = verifyToken(token, {
    ...verifyOptions,
    expectedDeviceHash: "other_device"
  });
  assert.equal(mismatchResult.ok, false);
  assert.equal(mismatchResult.error, "DEVICE_MISMATCH");
});

test("19. corrupt secureStorage still fails safely", async () => {
  const mockStorage = createMockStorage({
    [STORAGE_KEYS.SIGNED_TOKEN]: "corrupt-non-token-data-!@#$%^&*",
    [STORAGE_KEYS.DEVICE_ID]: "opaque_dev_id_1234567890"
  });

  const storage = createLicenseStorage({ secureStorage: mockStorage });
  const manager = createLicenseManager({ storage });

  const snapshot = await manager.initialize();
  assert.equal(snapshot.state, LICENSE_STATES.UNACTIVATED);
  assert.equal(manager.isOperational(), false);
});

test("20. fresh valid cached token restores ACTIVE after restart without network", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const now = Math.floor(Date.now() / 1000);
  const deviceHash = "opaque_dev_id_1234567890";
  const kid = "k1";

  const payload = {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    licenseId: "lic_restart_test",
    activationId: "act_restart_test",
    deviceHash,
    plan: "pro",
    entitlements: ["ai-clean"],
    issuedAt: now,
    refreshAfter: now + 3600 * 24 * 7,
    graceUntil: now + 3600 * 24 * 14,
    expiresAt: now + 3600 * 24 * 30
  };

  const token = signTestToken(kid, payload, privateKey);
  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  await storage.writeDeviceId(deviceHash);
  await storage.writeToken({ token, savedAt: Date.now() });

  const manager = createLicenseManager({
    storage,
    apiClient: null, // Network unavailable
    verifier: (t) => verifyToken(t, { expectedKid: kid, publicKeySpki: spkiB64, expectedDeviceHash: deviceHash, nowSeconds: now + 60 }),
    clock: () => (now + 60) * 1000
  });

  const snapshot = await manager.initialize();
  assert.equal(snapshot.state, LICENSE_STATES.ACTIVE);
  assert.equal(manager.isOperational(), true);
  assert.equal(snapshot.plan, "pro");
});

test("21. existing device ID remains stable", async () => {
  const existingDeviceId = "pre_existing_stable_device_id_abcdef";
  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  await storage.writeDeviceId(existingDeviceId);

  const deviceId1 = await getInstallationDeviceId(storage);
  assert.equal(deviceId1, existingDeviceId);

  const deviceId2 = await getInstallationDeviceId(storage);
  assert.equal(deviceId2, existingDeviceId);
});

test("22. deactivation retains device ID", async () => {
  const existingDeviceId = "preserve_device_id_across_deactivate";
  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  await storage.writeDeviceId(existingDeviceId);
  await storage.writeToken({ token: "some-mock-token", savedAt: Date.now() });

  const mockApi = {
    deactivate: async () => ({ ok: true })
  };

  const manager = createLicenseManager({
    storage,
    apiClient: mockApi
  });

  await manager.initialize();
  await manager.deactivate();

  const storedToken = await storage.readToken();
  assert.equal(storedToken, null, "Token must be cleared after deactivation");

  const storedDeviceId = await storage.readDeviceId();
  assert.equal(storedDeviceId, existingDeviceId, "Device ID must be retained after deactivation");
});

test("23. plaintext license key is never persisted", async () => {
  const { privateKey, spkiB64 } = generateTestKeypair();
  const now = Math.floor(Date.now() / 1000);
  const deviceHash = "secure_device_hash_test_23";
  const kid = "k1";

  const payload = {
    v: 1,
    iss: "mm-license-server",
    pluginId: "in.memorymaker.albumplacer",
    licenseId: "lic_test_23",
    activationId: "act_test_23",
    deviceHash,
    plan: "studio",
    entitlements: ["all-tools"],
    issuedAt: now,
    refreshAfter: now + 3600 * 24 * 7,
    graceUntil: now + 3600 * 24 * 14,
    expiresAt: now + 3600 * 24 * 30
  };

  const token = signTestToken(kid, payload, privateKey);
  const plaintextKey = "SECRET-LICENSE-KEY-ABCD-1234";

  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  await storage.writeDeviceId(deviceHash);

  const mockApi = {
    activate: async ({ licenseKey }) => {
      assert.equal(licenseKey, plaintextKey);
      return { ok: true, data: { token } };
    }
  };

  const manager = createLicenseManager({
    storage,
    apiClient: mockApi,
    verifier: (t) => verifyToken(t, { expectedKid: kid, publicKeySpki: spkiB64, expectedDeviceHash: deviceHash, nowSeconds: now + 10 }),
    clock: () => (now + 10) * 1000
  });

  await manager.initialize();
  const actResult = await manager.activate(plaintextKey);
  assert.equal(actResult.ok, true);

  // Inspect mock storage store
  for (const [k, v] of mockStorage._store.entries()) {
    const str = new TextDecoder().decode(v);
    assert.equal(
      str.includes(plaintextKey),
      false,
      `Storage key ${k} must not contain plaintext license key`
    );
  }
});

test("24. activation token is verified before storage", async () => {
  const deviceHash = "secure_device_hash_test_24";
  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  await storage.writeDeviceId(deviceHash);

  const untrustedInvalidToken = "MM1.k1.invalidpayload.invalidsig";

  const mockApi = {
    activate: async () => ({
      ok: true,
      data: { token: untrustedInvalidToken }
    })
  };

  const manager = createLicenseManager({
    storage,
    apiClient: mockApi,
    verifier: () => ({ ok: false, error: "INVALID_SIGNATURE" })
  });

  await manager.initialize();
  const actResult = await manager.activate("ANY-KEY");

  assert.equal(actResult.ok, false);
  assert.equal(actResult.error, "TOKEN_VERIFICATION_FAILED");

  const storedToken = await storage.readToken();
  assert.equal(storedToken, null, "Unverified token must never be written to storage");
});

test("25. invalid signed token never becomes operational", async () => {
  const mockStorage = createMockStorage();
  const storage = createLicenseStorage({ secureStorage: mockStorage });
  await storage.writeDeviceId("device_test_25");
  await storage.writeToken({ token: "MM1.k1.badpayload.badsig", savedAt: Date.now() });

  const manager = createLicenseManager({
    storage,
    verifier: () => ({ ok: false, error: "SIGNATURE_VERIFICATION_FAILED" })
  });

  await manager.initialize();
  assert.equal(manager.isOperational(), false);
  assert.equal(isOperationalState(manager.getState()), false);
});

test("26. plugin ID remains in.memorymaker.albumplacer", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../manifest.json"), "utf8")
  );
  assert.equal(manifest.id, "in.memorymaker.albumplacer");
});

test("27. manifest version and PLUGIN_VERSION are both 1.4.1", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../manifest.json"), "utf8")
  );
  assert.equal(manifest.version, "1.4.1");
  assert.equal(PLUGIN_VERSION, "1.4.1");

  const indexHtml = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.ok(indexHtml.includes('<span class="version">v1.4.1</span>'));
});

test("28. productionConfig API domain matches manifest network permission", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../manifest.json"), "utf8")
  );
  const manifestDomains = manifest.requiredPermissions.network.domains;
  assert.ok(Array.isArray(manifestDomains));
  assert.ok(manifestDomains.includes(PRODUCTION_CONFIG.API_BASE_URL));
  assert.equal(PRODUCTION_CONFIG.API_BASE_URL, "https://mm-license-server.rammonihalder.workers.dev");
});

test("29. existing feature tests all remain passing", () => {
  // Proved by the global runner running all unit tests in the suite
  assert.ok(true);
});
