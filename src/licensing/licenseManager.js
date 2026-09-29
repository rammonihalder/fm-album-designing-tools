"use strict";

const { LICENSE_STATES, normalizeState, isOperationalState } = require("./licenseState");
const { createLicenseStorage } = require("./licenseStorage");
const { LOG_PREFIX, REFRESH_INTERVAL_DAYS, OFFLINE_GRACE_PERIOD_DAYS, PLUGIN_VERSION } = require("./constants");
const { verifyToken } = require("./crypto/tokenVerifier");
const { createLicenseApiClient } = require("./licenseApi");
const { generateOpaqueDeviceId, getGenericDeviceName } = require("./deviceId");

// Small clock rollback tolerance (e.g. 5 minutes)
const CLOCK_ROLLBACK_TOLERANCE_SECONDS = 300;

// User-friendly safe error messages
const SAFE_USER_MESSAGES = Object.freeze({
  UNACTIVATED: "Activate FM Album Designing Tools to continue.",
  ACTIVE: "License Active",
  GRACE: "License in Offline Grace. Please connect to the internet to refresh.",
  TRIAL: "30-day free trial active.",
  TRIAL_EXPIRED: "Your 30-day free trial has ended. Activate a license to continue.",
  EXPIRED: "License validation is required. Connect to the internet and try again.",
  REVOKED: "This license is no longer active.",
  SUSPENDED: "This license is temporarily unavailable. Please contact Frame Mitra.",
  DEVICE_LIMIT_REACHED: "This license is already active on the maximum number of computers.",
  DEVICE_REVOKED: "This device activation has been revoked.",
  INVALID_LICENSE: "Invalid license key. Please check and try again.",
  SERVER_CONFIGURATION_ERROR: "License server configuration error. Please contact support.",
  NETWORK_ERROR: "Unable to reach the licensing server. Please check your internet connection.",
  DEFAULT_ERROR: "License validation error. Please try again."
});

/**
 * Creates a normalized license snapshot object with safe defaults.
 * @param {object} [raw={}]
 * @returns {object}
 */
function normalizeSnapshot(raw = {}) {
  const safe = raw && typeof raw === "object" ? raw : {};
  return {
    state: normalizeState(safe.state, LICENSE_STATES.UNACTIVATED),
    licenseId: typeof safe.licenseId === "string" ? safe.licenseId : null,
    activationId: typeof safe.activationId === "string" ? safe.activationId : null,
    plan: typeof safe.plan === "string" ? safe.plan : null,
    deviceId: typeof safe.deviceId === "string" ? safe.deviceId : null,
    entitlements: Array.isArray(safe.entitlements) ? safe.entitlements : [],
    expiresAt: typeof safe.expiresAt === "number" ? safe.expiresAt : null,
    refreshAfter: typeof safe.refreshAfter === "number" ? safe.refreshAfter : null,
    graceUntil: typeof safe.graceUntil === "number" ? safe.graceUntil : null,
    lastValidatedAt: typeof safe.lastValidatedAt === "number" ? safe.lastValidatedAt : null,
    lastObservedTime: typeof safe.lastObservedTime === "number" ? safe.lastObservedTime : null,
    reason: typeof safe.reason === "string" ? safe.reason : null,
    userMessage: typeof safe.userMessage === "string" ? safe.userMessage : null
  };
}

/**
 * License Manager - Production Runtime Service
 */
class LicenseManager {
  /**
   * @param {object} [dependencies]
   * @param {object} [dependencies.storage] Storage implementation.
   * @param {object} [dependencies.apiClient] API client implementation.
   * @param {Function} [dependencies.verifier] Token verifier function.
   * @param {Function} [dependencies.clock] Clock provider returning ms timestamp.
   * @param {string} [dependencies.pluginVersion] Plugin version string.
   * @param {object} [dependencies.logger] Logger instance.
   */
  constructor(dependencies = {}) {
    this._storage = dependencies.storage || createLicenseStorage();
    this._apiClient = dependencies.apiClient !== undefined ? dependencies.apiClient : null;
    this._verifier = dependencies.verifier !== undefined ? dependencies.verifier : (t => verifyToken(t, { expectedDeviceHash: this._deviceId }));
    this._clock = typeof dependencies.clock === "function" ? dependencies.clock : () => Date.now();
    this._pluginVersion = dependencies.pluginVersion || PLUGIN_VERSION;
    this._logger = dependencies.logger || console;

    this._deviceId = null;
    this._currentToken = null;
    this._initialized = false;
    this._initPromise = null;
    this._snapshot = normalizeSnapshot({
      state: LICENSE_STATES.UNACTIVATED,
      userMessage: SAFE_USER_MESSAGES.UNACTIVATED
    });
  }

  /**
   * Current time in seconds.
   * @returns {number}
   */
  _nowSeconds() {
    return Math.floor(this._clock() / 1000);
  }

  /**
   * Checks whether the current license state is operational (ACTIVE or GRACE).
   * @returns {boolean}
   */
  isOperational() {
    return isOperationalState(this._snapshot?.state || this._state);
  }

  /**
   * Cryptographically verifies a signed token string using injected or default verifier.
   * @private
   */
  async _verifyToken(token, expectedDeviceHash) {
    if (typeof this._verifier === "function") {
      return this._verifier(token);
    }
    if (this._verifier && typeof this._verifier.verify === "function") {
      return this._verifier.verify(token);
    }
    return verifyToken(token, { expectedDeviceHash });
  }

  /**
   * Resolves or generates the persistent opaque device ID.
   * @returns {Promise<string>}
   */
  async _getOrCreateDeviceId() {
    if (this._deviceId) {
      return this._deviceId;
    }
    try {
      let storedId = await this._storage.readDeviceId();
      if (!storedId || typeof storedId !== "string" || !storedId.trim()) {
        storedId = generateOpaqueDeviceId();
        await this._storage.writeDeviceId(storedId);
      }
      this._deviceId = storedId.trim();
      return this._deviceId;
    } catch (err) {
      this._logger.warn?.(`${LOG_PREFIX} Failed reading device ID, generating ephemeral:`, err?.message || err);
      this._deviceId = generateOpaqueDeviceId();
      return this._deviceId;
    }
  }

  /**
   * Initializes licensing state once. Fast local verification if token is fresh.
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
        const cachedToken = await this._storage.readToken();

        if (!cachedToken) {
          this._snapshot = normalizeSnapshot({
            state: LICENSE_STATES.UNACTIVATED,
            reason: "no-cached-token",
            userMessage: SAFE_USER_MESSAGES.UNACTIVATED
          });
          this._logger.log?.(`${LOG_PREFIX} Initialized: ${this._snapshot.state}`);
          return this.getSnapshot();
        }

        const deviceId = await this._getOrCreateDeviceId();
        const metadata = (await this._storage.readMetadata()) || {};

        const rawTokenString = typeof cachedToken === "string" ? cachedToken : cachedToken.token;
        if (!rawTokenString) {
          this._snapshot = normalizeSnapshot({
            state: LICENSE_STATES.UNACTIVATED,
            deviceId,
            reason: "empty-cached-token",
            userMessage: SAFE_USER_MESSAGES.UNACTIVATED
          });
          return this.getSnapshot();
        }

        // Verify cryptographic signature and payload using injected or default verifier
        const verification = await this._verifyToken(rawTokenString, deviceId);

        if (!verification || !verification.ok || !verification.payload) {
          this._logger.warn?.(`${LOG_PREFIX} Cached token failed verification:`, verification?.error || verification?.reason);
          this._snapshot = normalizeSnapshot({
            state: LICENSE_STATES.INVALID,
            deviceId,
            reason: verification?.error || verification?.reason || "signature-verification-failed",
            userMessage: SAFE_USER_MESSAGES.DEFAULT_ERROR
          });
          return this.getSnapshot();
        }

        const payload = verification.payload;
        this._currentToken = rawTokenString;

        const now = this._nowSeconds();
        const lastObserved = typeof metadata.lastObservedTime === "number" ? metadata.lastObservedTime : 0;

        // Check for severe clock rollback
        if (lastObserved > 0 && now < (lastObserved - CLOCK_ROLLBACK_TOLERANCE_SECONDS)) {
          this._logger.warn?.(`${LOG_PREFIX} System clock rollback detected. Online validation required.`);
          if (payload.plan === "trial") {
            const refreshResult = await this._attemptOnlineTrialRefresh({ token: rawTokenString, deviceHash: deviceId });
            if (refreshResult.ok) {
              return this.getSnapshot();
            }
            this._snapshot = normalizeSnapshot({
              state: LICENSE_STATES.TRIAL_EXPIRED,
              deviceId,
              licenseId: payload.licenseId,
              activationId: payload.activationId,
              plan: payload.plan,
              entitlements: payload.entitlements,
              expiresAt: payload.expiresAt,
              refreshAfter: payload.refreshAfter,
              graceUntil: payload.graceUntil,
              lastObservedTime: lastObserved,
              reason: "clock-rollback",
              userMessage: "System clock change detected. Connect to the internet to validate your trial."
            });
            return this.getSnapshot();
          } else {
            // Attempt online refresh to recover
            const refreshResult = await this._attemptOnlineRefresh({ token: rawTokenString, deviceHash: deviceId });
            if (refreshResult.ok) {
              return this.getSnapshot();
            }
            // Block until online recovery succeeds
            this._snapshot = normalizeSnapshot({
              state: LICENSE_STATES.EXPIRED,
              deviceId,
              licenseId: payload.licenseId,
              plan: payload.plan,
              entitlements: payload.entitlements,
              expiresAt: payload.expiresAt,
              refreshAfter: payload.refreshAfter,
              graceUntil: payload.graceUntil,
              lastObservedTime: lastObserved,
              reason: "clock-rollback",
              userMessage: "System clock change detected. Connect to the internet to validate your license."
            });
            return this.getSnapshot();
          }
        }

        // Update lastObservedTime monotonically
        const newObservedTime = Math.max(lastObserved, now);
        await this._storage.writeMetadata({
          ...metadata,
          lastObservedTime: newObservedTime
        });

        // Evaluate token lifecycle against current time
        if (payload.plan === "trial") {
          if (now >= payload.expiresAt) {
            // Trial is expired - blocked immediately. Zero extra grace!
            this._snapshot = normalizeSnapshot({
              state: LICENSE_STATES.TRIAL_EXPIRED,
              licenseId: payload.licenseId,
              activationId: payload.activationId,
              deviceId,
              plan: payload.plan,
              entitlements: payload.entitlements,
              expiresAt: payload.expiresAt,
              refreshAfter: payload.refreshAfter,
              graceUntil: payload.graceUntil,
              lastValidatedAt: metadata.lastValidatedAt || payload.issuedAt,
              lastObservedTime: newObservedTime,
              reason: "trial-expired",
              userMessage: SAFE_USER_MESSAGES.TRIAL_EXPIRED
            });
          } else if (now <= payload.refreshAfter) {
            // Trial token is fresh and TRIAL - NO NETWORK REQUEST
            this._snapshot = normalizeSnapshot({
              state: LICENSE_STATES.TRIAL,
              licenseId: payload.licenseId,
              activationId: payload.activationId,
              deviceId,
              plan: payload.plan,
              entitlements: payload.entitlements,
              expiresAt: payload.expiresAt,
              refreshAfter: payload.refreshAfter,
              graceUntil: payload.graceUntil,
              lastValidatedAt: metadata.lastValidatedAt || payload.issuedAt,
              lastObservedTime: newObservedTime,
              reason: "trial-active",
              userMessage: SAFE_USER_MESSAGES.TRIAL
            });
          } else {
            // Trial refresh is due (now > refreshAfter and now < expiresAt)
            this._logger.log?.(`${LOG_PREFIX} Trial token refresh due. Attempting online refresh...`);
            const refreshResult = await this._attemptOnlineTrialRefresh({
              token: rawTokenString,
              deviceHash: deviceId,
              currentPayload: payload,
              metadata
            });

            if (!refreshResult.ok) {
              if (refreshResult.authoritativeState) {
                this._snapshot = normalizeSnapshot({
                  state: refreshResult.authoritativeState,
                  deviceId,
                  licenseId: payload.licenseId,
                  activationId: payload.activationId,
                  plan: payload.plan,
                  entitlements: payload.entitlements,
                  expiresAt: payload.expiresAt,
                  refreshAfter: payload.refreshAfter,
                  graceUntil: payload.graceUntil,
                  reason: refreshResult.reason,
                  userMessage: refreshResult.userMessage
                });
              } else {
                // Network failure before expiresAt: trial works offline until original expiresAt!
                this._snapshot = normalizeSnapshot({
                  state: LICENSE_STATES.TRIAL,
                  licenseId: payload.licenseId,
                  activationId: payload.activationId,
                  deviceId,
                  plan: payload.plan,
                  entitlements: payload.entitlements,
                  expiresAt: payload.expiresAt,
                  refreshAfter: payload.refreshAfter,
                  graceUntil: payload.graceUntil,
                  lastValidatedAt: metadata.lastValidatedAt || payload.issuedAt,
                  lastObservedTime: newObservedTime,
                  reason: "trial-offline-unexpired",
                  userMessage: SAFE_USER_MESSAGES.TRIAL
                });
              }
            }
          }
        } else {
          if (now <= payload.refreshAfter) {
            // Token is fresh and ACTIVE - NO NETWORK REQUEST
            this._snapshot = normalizeSnapshot({
              state: LICENSE_STATES.ACTIVE,
              licenseId: payload.licenseId,
              activationId: payload.activationId,
              deviceId,
              plan: payload.plan,
              entitlements: payload.entitlements,
              expiresAt: payload.expiresAt,
              refreshAfter: payload.refreshAfter,
              graceUntil: payload.graceUntil,
              lastValidatedAt: metadata.lastValidatedAt || payload.issuedAt,
              lastObservedTime: newObservedTime,
              reason: "token-active",
              userMessage: SAFE_USER_MESSAGES.ACTIVE
            });
          } else {
            // Refresh is due (now > refreshAfter)
            // Attempt ONE online refresh during initialization
            this._logger.log?.(`${LOG_PREFIX} Token refresh due. Attempting online refresh...`);
            const refreshResult = await this._attemptOnlineRefresh({
              token: rawTokenString,
              deviceHash: deviceId,
              currentPayload: payload,
              metadata
            });

            if (!refreshResult.ok) {
              // Check if failure is authoritative or network reachability
              if (refreshResult.authoritativeState) {
                this._snapshot = normalizeSnapshot({
                  state: refreshResult.authoritativeState,
                  deviceId,
                  licenseId: payload.licenseId,
                  plan: payload.plan,
                  entitlements: payload.entitlements,
                  reason: refreshResult.reason,
                  userMessage: refreshResult.userMessage
                });
              } else if (now <= payload.graceUntil && now <= payload.expiresAt) {
                // Within offline grace period
                this._snapshot = normalizeSnapshot({
                  state: LICENSE_STATES.GRACE,
                  licenseId: payload.licenseId,
                  activationId: payload.activationId,
                  deviceId,
                  plan: payload.plan,
                  entitlements: payload.entitlements,
                  expiresAt: payload.expiresAt,
                  refreshAfter: payload.refreshAfter,
                  graceUntil: payload.graceUntil,
                  lastValidatedAt: metadata.lastValidatedAt || payload.issuedAt,
                  lastObservedTime: newObservedTime,
                  reason: "offline-grace",
                  userMessage: SAFE_USER_MESSAGES.GRACE
                });
              } else {
                // Grace expired
                this._snapshot = normalizeSnapshot({
                  state: LICENSE_STATES.EXPIRED,
                  licenseId: payload.licenseId,
                  deviceId,
                  plan: payload.plan,
                  entitlements: payload.entitlements,
                  expiresAt: payload.expiresAt,
                  refreshAfter: payload.refreshAfter,
                  graceUntil: payload.graceUntil,
                  reason: "grace-expired",
                  userMessage: SAFE_USER_MESSAGES.EXPIRED
                });
              }
            }
          }
        }

        this._logger.log?.(`${LOG_PREFIX} Initialized: ${this._snapshot.state}`);
      } catch (err) {
        this._logger.warn?.(`${LOG_PREFIX} Initialization error:`, err?.message || err);
        this._snapshot = normalizeSnapshot({
          state: LICENSE_STATES.ERROR,
          reason: "storage-error",
          userMessage: SAFE_USER_MESSAGES.DEFAULT_ERROR
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
   * Internal helper to attempt an online refresh.
   * If successful, locally verifies the new token BEFORE saving.
   * @private
   */
  async _attemptOnlineRefresh({ token, deviceHash, currentPayload, metadata = {} }) {
    try {
      const response = await this._apiClient.refresh({
        token,
        deviceHash,
        pluginVersion: this._pluginVersion
      });

      if (response.ok && response.data?.token) {
        const newToken = response.data.token;
        const verification = await this._verifyToken(newToken, deviceHash);

        if (!verification.ok || !verification.payload) {
          this._logger.warn?.(`${LOG_PREFIX} Refresh returned invalid token:`, verification.error);
          return { ok: false, reason: "invalid-server-token" };
        }

        const newPayload = verification.payload;
        const now = this._nowSeconds();

        // Update cached token and metadata
        await this._storage.writeToken({ token: newToken, savedAt: Date.now() });
        await this._storage.writeMetadata({
          ...metadata,
          lastValidatedAt: now,
          lastObservedTime: now
        });

        this._currentToken = newToken;
        this._snapshot = normalizeSnapshot({
          state: LICENSE_STATES.ACTIVE,
          licenseId: newPayload.licenseId,
          activationId: newPayload.activationId,
          deviceId: deviceHash,
          plan: newPayload.plan,
          entitlements: newPayload.entitlements,
          expiresAt: newPayload.expiresAt,
          refreshAfter: newPayload.refreshAfter,
          graceUntil: newPayload.graceUntil,
          lastValidatedAt: now,
          lastObservedTime: now,
          reason: "refreshed",
          userMessage: SAFE_USER_MESSAGES.ACTIVE
        });

        return { ok: true };
      }

      // Handle backend errors
      const errCode = response.error;
      if (errCode === "LICENSE_REVOKED") {
        return {
          ok: false,
          authoritativeState: LICENSE_STATES.REVOKED,
          reason: "license-revoked",
          userMessage: SAFE_USER_MESSAGES.REVOKED
        };
      }
      if (errCode === "LICENSE_SUSPENDED") {
        return {
          ok: false,
          authoritativeState: LICENSE_STATES.SUSPENDED,
          reason: "license-suspended",
          userMessage: SAFE_USER_MESSAGES.SUSPENDED
        };
      }
      if (errCode === "DEVICE_REVOKED" || errCode === "ACTIVATION_NOT_ACTIVE") {
        return {
          ok: false,
          authoritativeState: LICENSE_STATES.REVOKED,
          reason: "device-revoked",
          userMessage: SAFE_USER_MESSAGES.DEVICE_REVOKED
        };
      }
      if (errCode === "LICENSE_EXPIRED") {
        return {
          ok: false,
          authoritativeState: LICENSE_STATES.EXPIRED,
          reason: "license-expired",
          userMessage: SAFE_USER_MESSAGES.EXPIRED
        };
      }

      return { ok: false, reason: errCode || "network-error" };
    } catch (err) {
      return { ok: false, reason: err?.message || "network-exception" };
    }
  }

  /**
   * Internal helper to attempt an online trial refresh.
   * If successful, locally verifies the new token BEFORE saving.
   * @private
   */
  async _attemptOnlineTrialRefresh({ token, deviceHash, currentPayload, metadata = {} }) {
    if (!this._apiClient) {
      return { ok: false, reason: "service-not-configured" };
    }
    try {
      const response = await this._apiClient.refreshTrial({
        token,
        deviceHash,
        pluginVersion: this._pluginVersion
      });

      if (response.ok && response.data?.token) {
        const newToken = response.data.token;
        const verification = await this._verifyToken(newToken, deviceHash);

        if (!verification.ok || !verification.payload) {
          this._logger.warn?.(`${LOG_PREFIX} Trial refresh returned invalid token:`, verification.error);
          return { ok: false, reason: "invalid-server-token" };
        }

        const newPayload = verification.payload;
        if (newPayload.plan !== "trial") {
          return { ok: false, reason: "non-trial-token" };
        }

        const now = this._nowSeconds();

        await this._storage.writeToken({ token: newToken, savedAt: Date.now() });
        await this._storage.writeMetadata({
          ...metadata,
          lastValidatedAt: now,
          lastObservedTime: now
        });

        this._currentToken = newToken;
        this._snapshot = normalizeSnapshot({
          state: LICENSE_STATES.TRIAL,
          licenseId: newPayload.licenseId,
          activationId: newPayload.activationId,
          deviceId: deviceHash,
          plan: newPayload.plan,
          entitlements: newPayload.entitlements,
          expiresAt: newPayload.expiresAt,
          refreshAfter: newPayload.refreshAfter,
          graceUntil: newPayload.graceUntil,
          lastValidatedAt: now,
          lastObservedTime: now,
          reason: "trial-refreshed",
          userMessage: SAFE_USER_MESSAGES.TRIAL
        });

        return { ok: true };
      }

      const errCode = response.error;
      if (errCode === "TRIAL_EXPIRED") {
        return {
          ok: false,
          authoritativeState: LICENSE_STATES.TRIAL_EXPIRED,
          reason: "trial-expired",
          userMessage: SAFE_USER_MESSAGES.TRIAL_EXPIRED
        };
      }
      if (errCode === "TRIAL_REVOKED") {
        return {
          ok: false,
          authoritativeState: LICENSE_STATES.REVOKED,
          reason: "trial-revoked",
          userMessage: SAFE_USER_MESSAGES.REVOKED
        };
      }

      return { ok: false, reason: errCode || "network-error" };
    } catch (err) {
      return { ok: false, reason: err?.message || "network-exception" };
    }
  }

  /**
   * Activates a license with a key.
   * Calls /v1/activate, strictly verifies the token locally BEFORE saving.
   *
   * @param {string} licenseKey
   * @returns {Promise<{ ok: boolean, error?: string, message?: string }>}
   */
  async activate(licenseKey) {
    if (!this._apiClient || !this._verifier) {
      return {
        ok: false,
        reason: "service-not-configured"
      };
    }

    if (!licenseKey || typeof licenseKey !== "string" || !licenseKey.trim()) {
      return {
        ok: false,
        error: "INVALID_KEY",
        message: "Please enter a valid license key."
      };
    }

    const deviceId = await this._getOrCreateDeviceId();
    const deviceName = getGenericDeviceName();

    this._logger.log?.(`${LOG_PREFIX} Activating license on device...`);

    const response = await this._apiClient.activate({
      licenseKey: licenseKey.trim(),
      deviceHash: deviceId,
      deviceName,
      pluginVersion: this._pluginVersion
    });

    if (!response.ok) {
      const errCode = response.error || "ACTIVATION_FAILED";
      let userMsg = SAFE_USER_MESSAGES[errCode] || response.message || SAFE_USER_MESSAGES.DEFAULT_ERROR;

      if (errCode === "DEVICE_LIMIT_REACHED") {
        userMsg = SAFE_USER_MESSAGES.DEVICE_LIMIT_REACHED;
      } else if (errCode === "LICENSE_REVOKED") {
        userMsg = SAFE_USER_MESSAGES.REVOKED;
      } else if (errCode === "LICENSE_SUSPENDED") {
        userMsg = SAFE_USER_MESSAGES.SUSPENDED;
      } else if (errCode === "INVALID_LICENSE") {
        userMsg = SAFE_USER_MESSAGES.INVALID_LICENSE;
      }

      return {
        ok: false,
        error: errCode,
        message: userMsg
      };
    }

    const token = response.data?.token;
    if (!token) {
      return {
        ok: false,
        error: "INVALID_SERVER_RESPONSE",
        message: "Server did not return a signed token."
      };
    }

    // CRITICAL: Strictly verify token locally BEFORE writing to storage
    const verification = await this._verifyToken(token, deviceId);
    if (!verification.ok || !verification.payload) {
      this._logger.warn?.(`${LOG_PREFIX} Activation token failed verification:`, verification.error);
      return {
        ok: false,
        error: "TOKEN_VERIFICATION_FAILED",
        message: "Server returned a token that failed local signature verification."
      };
    }

    const payload = verification.payload;
    const now = this._nowSeconds();

    // Persist verified token and metadata, preserving trialPreviouslyStarted marker if present
    const prevMetadata = (await this._storage.readMetadata()) || {};
    await this._storage.writeToken({ token, savedAt: Date.now() });
    await this._storage.writeMetadata({
      ...prevMetadata,
      lastValidatedAt: now,
      lastObservedTime: now,
      trialPreviouslyStarted: prevMetadata.trialPreviouslyStarted === true
    });

    this._currentToken = token;
    this._snapshot = normalizeSnapshot({
      state: LICENSE_STATES.ACTIVE,
      licenseId: payload.licenseId,
      activationId: payload.activationId,
      deviceId,
      plan: payload.plan,
      entitlements: payload.entitlements,
      expiresAt: payload.expiresAt,
      refreshAfter: payload.refreshAfter,
      graceUntil: payload.graceUntil,
      lastValidatedAt: now,
      lastObservedTime: now,
      reason: "activated",
      userMessage: SAFE_USER_MESSAGES.ACTIVE
    });

    this._logger.log?.(`${LOG_PREFIX} Activation successful. State: ACTIVE`);
    return { ok: true, message: SAFE_USER_MESSAGES.ACTIVE };
  }

  /**
   * Starts a 30-day free trial for this device.
   * Calls /v1/trial/start, strictly verifies the token locally BEFORE saving.
   *
   * @returns {Promise<{ ok: boolean, error?: string, message?: string }>}
   */
  async startTrial() {
    if (!this._apiClient || !this._verifier) {
      return {
        ok: false,
        reason: "service-not-configured"
      };
    }

    const deviceId = await this._getOrCreateDeviceId();
    const deviceName = getGenericDeviceName();

    this._logger.log?.(`${LOG_PREFIX} Starting trial on device...`);

    const response = await this._apiClient.startTrial({
      deviceHash: deviceId,
      deviceName,
      pluginVersion: this._pluginVersion
    });

    if (!response.ok) {
      const errCode = response.error || "TRIAL_START_FAILED";
      let userMsg = SAFE_USER_MESSAGES[errCode] || response.message || SAFE_USER_MESSAGES.DEFAULT_ERROR;

      if (errCode === "TRIAL_EXPIRED") {
        userMsg = SAFE_USER_MESSAGES.TRIAL_EXPIRED;
        const prevMetadata = (await this._storage.readMetadata()) || {};
        await this._storage.writeMetadata({
          ...prevMetadata,
          trialPreviouslyStarted: true
        });
        this._snapshot = normalizeSnapshot({
          state: LICENSE_STATES.TRIAL_EXPIRED,
          deviceId,
          reason: "trial-expired",
          userMessage: SAFE_USER_MESSAGES.TRIAL_EXPIRED
        });
      } else if (errCode === "TRIAL_REVOKED") {
        userMsg = SAFE_USER_MESSAGES.REVOKED;
        const prevMetadata = (await this._storage.readMetadata()) || {};
        await this._storage.writeMetadata({
          ...prevMetadata,
          trialPreviouslyStarted: true
        });
        this._snapshot = normalizeSnapshot({
          state: LICENSE_STATES.REVOKED,
          deviceId,
          reason: "trial-revoked",
          userMessage: SAFE_USER_MESSAGES.REVOKED
        });
      }

      return {
        ok: false,
        error: errCode,
        message: userMsg
      };
    }

    const token = response.data?.token;
    if (!token) {
      return {
        ok: false,
        error: "INVALID_SERVER_RESPONSE",
        message: "Server did not return a signed trial token."
      };
    }

    // Strictly verify token locally BEFORE writing to storage
    const verification = await this._verifyToken(token, deviceId);
    if (!verification.ok || !verification.payload) {
      this._logger.warn?.(`${LOG_PREFIX} Trial token failed verification:`, verification.error);
      return {
        ok: false,
        error: "TOKEN_VERIFICATION_FAILED",
        message: "Server returned a token that failed local signature verification."
      };
    }

    const payload = verification.payload;

    if (payload.plan !== "trial") {
      return {
        ok: false,
        error: "INVALID_TOKEN_PLAN",
        message: "Server returned a non-trial token for trial start."
      };
    }

    if (payload.deviceHash !== deviceId) {
      return {
        ok: false,
        error: "DEVICE_MISMATCH",
        message: "Token device binding mismatch."
      };
    }

    if (payload.pluginId !== "in.memorymaker.albumplacer") {
      return {
        ok: false,
        error: "PLUGIN_ID_MISMATCH",
        message: "Token plugin ID mismatch."
      };
    }

    const now = this._nowSeconds();
    const prevMetadata = (await this._storage.readMetadata()) || {};

    await this._storage.writeToken({ token, savedAt: Date.now() });
    await this._storage.writeMetadata({
      ...prevMetadata,
      lastValidatedAt: now,
      lastObservedTime: now,
      trialPreviouslyStarted: true
    });

    this._currentToken = token;
    this._snapshot = normalizeSnapshot({
      state: LICENSE_STATES.TRIAL,
      licenseId: payload.licenseId,
      activationId: payload.activationId,
      deviceId,
      plan: payload.plan,
      entitlements: payload.entitlements,
      expiresAt: payload.expiresAt,
      refreshAfter: payload.refreshAfter,
      graceUntil: payload.graceUntil,
      lastValidatedAt: now,
      lastObservedTime: now,
      reason: "trial-started",
      userMessage: SAFE_USER_MESSAGES.TRIAL
    });

    this._logger.log?.(`${LOG_PREFIX} Trial started successfully. State: TRIAL`);
    return { ok: true, message: "30-day free trial started." };
  }

  /**
   * Deactivates this computer with the server.
   * Requires online success before freeing local token.
   * Preserves persistent device ID.
   * If trial was previously started, resolves trial against server.
   * If trial was never started, returns to UNACTIVATED without calling trial API.
   *
   * @returns {Promise<{ ok: boolean, error?: string, message?: string }>}
   */
  async deactivate() {
    if (this._snapshot?.plan === "trial") {
      return {
        ok: false,
        error: "NOT_SUPPORTED",
        message: "Trial activations cannot be deactivated."
      };
    }

    const deviceId = await this._getOrCreateDeviceId();
    const metadata = (await this._storage.readMetadata()) || {};
    const hadTrial = metadata.trialPreviouslyStarted === true;

    if (!this._currentToken) {
      // Already unactivated locally
      await this._storage.clearLicenseToken();
      if (hadTrial) {
        await this._storage.writeMetadata({ trialPreviouslyStarted: true });
        return this._restoreTrialAfterDeactivation(deviceId);
      }
      this._snapshot = normalizeSnapshot({
        state: LICENSE_STATES.UNACTIVATED,
        deviceId: this._deviceId,
        userMessage: SAFE_USER_MESSAGES.UNACTIVATED
      });
      return { ok: true, message: "License deactivated." };
    }

    this._logger.log?.(`${LOG_PREFIX} Deactivating license on server...`);

    const response = await this._apiClient.deactivate({
      token: this._currentToken,
      deviceHash: deviceId
    });

    if (!response.ok) {
      this._logger.warn?.(`${LOG_PREFIX} Server deactivation failed:`, response.error);
      return {
        ok: false,
        error: response.error || "DEACTIVATION_FAILED",
        message: response.message || "Failed to deactivate license with the server. Please check your internet connection."
      };
    }

    // Online deactivation succeeded: delete cached token while RETAINING device ID
    await this._storage.deleteToken();
    this._currentToken = null;

    if (!hadTrial) {
      // CASE A: User NEVER used trial
      // Paid deactivation must NOT automatically start a trial!
      await this._storage.deleteMetadata();
      this._snapshot = normalizeSnapshot({
        state: LICENSE_STATES.UNACTIVATED,
        deviceId,
        userMessage: SAFE_USER_MESSAGES.UNACTIVATED
      });
      this._logger.log?.(`${LOG_PREFIX} Deactivation complete. State: UNACTIVATED`);
      return { ok: true, message: "This computer has been deactivated successfully." };
    }

    // User previously started a trial
    // Retain trialPreviouslyStarted marker in metadata
    await this._storage.writeMetadata({
      trialPreviouslyStarted: true
    });

    return this._restoreTrialAfterDeactivation(deviceId);
  }

  /**
   * Helper to restore trial state after paid deactivation when trialPreviouslyStarted === true.
   * @private
   */
  async _restoreTrialAfterDeactivation(deviceId) {
    this._logger.log?.(`${LOG_PREFIX} Resolving previous trial after paid deactivation...`);
    try {
      const trialResult = await this.startTrial();
      if (trialResult.ok) {
        // CASE B: Original trial still active and restored!
        this._logger.log?.(`${LOG_PREFIX} Original trial restored successfully. State: TRIAL`);
        return {
          ok: true,
          message: "This computer has been deactivated successfully. Previous trial restored."
        };
      }

      // CASE C: Expired old trial
      if (trialResult.error === "TRIAL_EXPIRED") {
        this._snapshot = normalizeSnapshot({
          state: LICENSE_STATES.TRIAL_EXPIRED,
          deviceId,
          reason: "trial-expired",
          userMessage: SAFE_USER_MESSAGES.TRIAL_EXPIRED
        });
        return {
          ok: true,
          message: "This computer has been deactivated successfully. Trial has expired."
        };
      }

      // CASE D: Revoked old trial
      if (trialResult.error === "TRIAL_REVOKED") {
        this._snapshot = normalizeSnapshot({
          state: LICENSE_STATES.REVOKED,
          deviceId,
          reason: "trial-revoked",
          userMessage: SAFE_USER_MESSAGES.REVOKED
        });
        return {
          ok: true,
          message: "This computer has been deactivated successfully. Trial was revoked."
        };
      }

      // Network error or other failure during trial restoration: Fail closed!
      this._snapshot = normalizeSnapshot({
        state: LICENSE_STATES.ERROR,
        deviceId,
        reason: "network-error-restoring-trial",
        userMessage: SAFE_USER_MESSAGES.NETWORK_ERROR
      });
      return {
        ok: true,
        message: "Deactivated successfully, but unable to restore trial due to network error."
      };
    } catch (err) {
      // Network failure / unexpected error: Fail closed!
      this._snapshot = normalizeSnapshot({
        state: LICENSE_STATES.ERROR,
        deviceId,
        reason: "exception-restoring-trial",
        userMessage: SAFE_USER_MESSAGES.NETWORK_ERROR
      });
      return {
        ok: true,
        message: "Deactivated successfully, but unable to restore trial due to network error."
      };
    }
  }

  /**
   * Refreshes license manually.
   * @returns {Promise<{ ok: boolean, message?: string }>}
   */
  async refresh() {
    if (!this._apiClient || !this._verifier) {
      return {
        ok: false,
        reason: "service-not-configured"
      };
    }

    if (!this._currentToken) {
      return { ok: false, message: "No active license to refresh." };
    }
    const deviceId = await this._getOrCreateDeviceId();
    if (this._snapshot?.plan === "trial") {
      return await this._attemptOnlineTrialRefresh({
        token: this._currentToken,
        deviceHash: deviceId
      });
    }
    const result = await this._attemptOnlineRefresh({
      token: this._currentToken,
      deviceHash: deviceId
    });
    return result;
  }

  /**
   * Returns current state string.
   * @returns {string}
   */
  getState() {
    return this._snapshot.state;
  }

  /**
   * Checks if current license state allows tool operations (ACTIVE or GRACE).
   * @returns {boolean}
   */
  isOperational() {
    return isOperationalState(this._snapshot.state);
  }

  /**
   * Returns a copy of the current license snapshot.
   * @returns {object}
   */
  getSnapshot() {
    return { ...this._snapshot };
  }

  /**
   * Checks whether an entitlement is granted in the current verified license.
   * @param {string} slug
   * @returns {boolean}
   */
  hasEntitlement(slug) {
    if (!this.isOperational()) return false;
    return this._snapshot.entitlements.includes(slug);
  }

  /**
   * Clears cached tokens and resets snapshot to UNACTIVATED (preserves deviceId).
   * @returns {Promise<object>}
   */
  async clearCachedLicense() {
    try {
      await this._storage.clearLicenseToken();
    } catch (err) {
      this._logger.warn?.(`${LOG_PREFIX} Error clearing cache:`, err?.message || err);
    }
    this._currentToken = null;
    this._snapshot = normalizeSnapshot({
      state: LICENSE_STATES.UNACTIVATED,
      deviceId: this._deviceId,
      reason: "cache-cleared",
      userMessage: SAFE_USER_MESSAGES.UNACTIVATED
    });
    return this.getSnapshot();
  }
}

/**
 * Creates a new LicenseManager instance.
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
    defaultManager = createLicenseManager({
      apiClient: createLicenseApiClient()
    });
  }
  return defaultManager;
}

/**
 * Resets the shared instance (for testing).
 */
function resetLicenseManager() {
  defaultManager = null;
}

module.exports = {
  LicenseManager,
  normalizeSnapshot,
  createLicenseManager,
  getLicenseManager,
  resetLicenseManager,
  SAFE_USER_MESSAGES
};
