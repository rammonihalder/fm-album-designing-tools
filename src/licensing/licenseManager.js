"use strict";

const { LICENSE_STATES, normalizeState } = require("./licenseState");
const { createLicenseStorage } = require("./licenseStorage");
const { LOG_PREFIX } = require("./constants");

/**
 * Creates a normalized license snapshot object with safe defaults.
 * @param {object} [raw={}]
 * @returns {object}
 */
function normalizeSnapshot(raw = {}) {
  const safe = (raw && typeof raw === "object") ? raw : {};
  return {
    state: normalizeState(safe.state, LICENSE_STATES.UNACTIVATED),
    licenseId: typeof safe.licenseId === "string" ? safe.licenseId : null,
    plan: typeof safe.plan === "string" ? safe.plan : null,
    deviceId: typeof safe.deviceId === "string" ? safe.deviceId : null,
    expiresAt: typeof safe.expiresAt === "number" ? safe.expiresAt : null,
    refreshAfter: typeof safe.refreshAfter === "number" ? safe.refreshAfter : null,
    graceUntil: typeof safe.graceUntil === "number" ? safe.graceUntil : null,
    lastValidatedAt: typeof safe.lastValidatedAt === "number" ? safe.lastValidatedAt : null,
    reason: typeof safe.reason === "string" ? safe.reason : null
  };
}

/**
 * License Manager - Central licensing service / state machine for Phase 1.
 *
 * Designed for future extension:
 * - Signature verifier (Phase 2)
 * - Remote API client (Phase 2)
 * - Clock / device provider (Phase 2)
 *
 * Phase 1 guarantees:
 * - No network requests.
 * - No enforcement / locking of existing tools.
 * - No local-only permanent activation bypass.
 * - Idempotent, safe initialization.
 */
class LicenseManager {
  /**
   * @param {object} [dependencies]
   * @param {object} [dependencies.storage] Storage implementation.
   * @param {object} [dependencies.verifier] Future cryptographic signature verifier.
   * @param {object} [dependencies.apiClient] Future backend API client.
   * @param {Function} [dependencies.clock] Clock provider returning ms timestamp.
   * @param {object} [dependencies.deviceProvider] Future device fingerprint provider.
   * @param {object} [dependencies.logger] Logger instance.
   */
  constructor(dependencies = {}) {
    this._storage = dependencies.storage || createLicenseStorage();
    this._verifier = dependencies.verifier || null;
    this._apiClient = dependencies.apiClient || null;
    this._clock = typeof dependencies.clock === "function" ? dependencies.clock : () => Date.now();
    this._deviceProvider = dependencies.deviceProvider || null;
    this._logger = dependencies.logger || console;

    this._initialized = false;
    this._initPromise = null;
    this._snapshot = normalizeSnapshot({ state: LICENSE_STATES.UNACTIVATED });
  }

  /**
   * Initializes licensing state once. Tolerates empty or failing storage.
   * @returns {Promise<object>} Current normalized snapshot.
   */
  async initialize() {
    if (this._initialized) {
      return this.getSnapshot();
    }
    if (this._initPromise) {
      return this._initPromise;
    }

    this._initPromise = (async () => {
      try {
        const cached = await this._storage.readToken();

        if (!cached) {
          this._snapshot = normalizeSnapshot({
            state: LICENSE_STATES.UNACTIVATED,
            reason: "no-cached-token"
          });
        } else if (this._verifier && typeof this._verifier.verify === "function") {
          // Extensibility hook: if a signature verifier is injected
          const verification = await this._verifier.verify(cached);
          if (verification && verification.ok && verification.payload) {
            this._snapshot = normalizeSnapshot(verification.payload);
          } else {
            this._snapshot = normalizeSnapshot({
              state: LICENSE_STATES.INVALID,
              reason: verification?.reason || "signature-verification-failed"
            });
          }
        } else {
          // Security Rule: locally stored state cannot be trusted without a signature verifier.
          // In Phase 1 without a verifier, unverified material remains unactivated/invalid.
          this._snapshot = normalizeSnapshot({
            state: LICENSE_STATES.UNACTIVATED,
            reason: "unverified-token"
          });
        }

        this._logger.log?.(`${LOG_PREFIX} Initialized: ${this._snapshot.state}`);
      } catch (err) {
        this._logger.warn?.(`${LOG_PREFIX} Initialization error:`, err?.message || err);
        this._snapshot = normalizeSnapshot({
          state: LICENSE_STATES.ERROR,
          reason: "storage-error"
        });
      } finally {
        this._initialized = true;
        this._initPromise = null;
      }

      return this.getSnapshot();
    })();

    return this._initPromise;
  }

  /**
   * Returns current license state string.
   * @returns {string}
   */
  getState() {
    return this._snapshot.state;
  }

  /**
   * Returns a copy of the current normalized license snapshot.
   * @returns {object}
   */
  getSnapshot() {
    return { ...this._snapshot };
  }

  /**
   * Clears cached tokens and resets snapshot to UNACTIVATED.
   * @returns {Promise<object>}
   */
  async clearCachedLicense() {
    try {
      await this._storage.clearAll();
    } catch (err) {
      this._logger.warn?.(`${LOG_PREFIX} Error clearing cache:`, err?.message || err);
    }
    this._snapshot = normalizeSnapshot({
      state: LICENSE_STATES.UNACTIVATED,
      reason: "cache-cleared"
    });
    return this.getSnapshot();
  }

  /**
   * Future-facing activation stub.
   * Phase 1 does NOT contain a backend endpoint or server verifier.
   * Returns structured failure without faking activation or marking active.
   * @param {string} [licenseKey]
   * @param {object} [options]
   * @returns {Promise<{ ok: boolean, reason: string }>}
   */
  async activate(licenseKey, options = {}) {
    if (!this._apiClient || !this._verifier) {
      return {
        ok: false,
        reason: "service-not-configured"
      };
    }

    return {
      ok: false,
      reason: "service-not-configured"
    };
  }

  /**
   * Future-facing refresh stub.
   * Phase 1 does NOT contain a backend endpoint.
   * @param {object} [options]
   * @returns {Promise<{ ok: boolean, reason: string }>}
   */
  async refresh(options = {}) {
    if (!this._apiClient || !this._verifier) {
      return {
        ok: false,
        reason: "service-not-configured"
      };
    }

    return {
      ok: false,
      reason: "service-not-configured"
    };
  }
}

/**
 * Creates a new LicenseManager instance with optional dependencies.
 * @param {object} [dependencies]
 * @returns {LicenseManager}
 */
function createLicenseManager(dependencies) {
  return new LicenseManager(dependencies);
}

let defaultManager = null;

/**
 * Returns shared LicenseManager instance.
 * @returns {LicenseManager}
 */
function getLicenseManager() {
  if (!defaultManager) {
    defaultManager = createLicenseManager();
  }
  return defaultManager;
}

/**
 * Resets the shared instance (useful for test isolation).
 */
function resetLicenseManager() {
  defaultManager = null;
}

module.exports = {
  LicenseManager,
  normalizeSnapshot,
  createLicenseManager,
  getLicenseManager,
  resetLicenseManager
};
