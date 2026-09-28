"use strict";

const config = require("./productionConfig");

const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Validates production config at startup.
 */
function validateConfig(cfg = config) {
  if (!cfg.API_BASE_URL || !cfg.API_BASE_URL.startsWith("https://")) {
    throw new Error("Invalid licensing configuration: API_BASE_URL must use https://");
  }
  if (!cfg.SIGNING_KEY_ID || typeof cfg.SIGNING_KEY_ID !== "string") {
    throw new Error("Invalid licensing configuration: SIGNING_KEY_ID is required");
  }
  if (!cfg.SIGNING_PUBLIC_KEY_SPKI_B64 || typeof cfg.SIGNING_PUBLIC_KEY_SPKI_B64 !== "string") {
    throw new Error("Invalid licensing configuration: SIGNING_PUBLIC_KEY_SPKI_B64 is required");
  }
}

// Validate on module evaluation
validateConfig();

/**
 * License API Client for MM License Server.
 * Communicates with production backend endpoints using standard fetch.
 *
 * Endpoints:
 * - POST /v1/activate
 * - POST /v1/refresh
 * - POST /v1/deactivate
 */
class LicenseApiClient {
  /**
   * @param {object} [options]
   * @param {string} [options.baseUrl] Defaults to config.API_BASE_URL
   * @param {number} [options.timeoutMs] Defaults to 10000ms
   * @param {Function} [options.fetchFn] Injected fetch implementation
   */
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || config.API_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.fetchFn = options.fetchFn || (typeof fetch !== "undefined" ? fetch : null);
  }

  /**
   * Internal HTTP POST helper with timeout and sanitized JSON parsing.
   * @private
   */
  async _post(endpoint, payload) {
    if (!this.fetchFn) {
      return {
        ok: false,
        error: "NETWORK_UNAVAILABLE",
        message: "Network fetch is not available in current environment."
      };
    }

    const url = `${this.baseUrl}${endpoint}`;
    let timerId;

    try {
      let signal;
      if (typeof AbortController !== "undefined") {
        const controller = new AbortController();
        signal = controller.signal;
        timerId = setTimeout(() => controller.abort(), this.timeoutMs);
      }

      const response = await this.fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        signal
      });

      if (timerId) clearTimeout(timerId);

      let data;
      try {
        data = await response.json();
      } catch {
        return {
          ok: false,
          error: "INVALID_SERVER_RESPONSE",
          message: "Server returned a non-JSON response.",
          status: response.status
        };
      }

      if (response.ok && data?.ok) {
        return {
          ok: true,
          data,
          status: response.status
        };
      }

      return {
        ok: false,
        error: data?.error || `HTTP_${response.status}`,
        message: data?.message || "Server request failed.",
        status: response.status
      };
    } catch (err) {
      if (timerId) clearTimeout(timerId);
      const isAbort = err?.name === "AbortError";
      return {
        ok: false,
        error: isAbort ? "TIMEOUT" : "NETWORK_ERROR",
        message: isAbort ? "Request timed out." : (err?.message || "Network error occurred.")
      };
    }
  }

  /**
   * Activates a license key for this device.
   * POST /v1/activate
   *
   * @param {object} params
   * @param {string} params.licenseKey
   * @param {string} params.deviceHash
   * @param {string} [params.deviceName] Generic platform name (e.g. "Photoshop Windows")
   * @param {string} [params.pluginVersion] Plugin version (e.g. "1.0.0")
   * @returns {Promise<{ ok: boolean, data?: object, error?: string, message?: string }>}
   */
  async activate({ licenseKey, deviceHash, deviceName, pluginVersion = "1.0.0" }) {
    if (!licenseKey || typeof licenseKey !== "string") {
      return { ok: false, error: "INVALID_ARGUMENT", message: "License key is required." };
    }
    if (!deviceHash || typeof deviceHash !== "string") {
      return { ok: false, error: "INVALID_ARGUMENT", message: "Device hash is required." };
    }

    return this._post("/v1/activate", {
      licenseKey: licenseKey.trim(),
      deviceHash,
      deviceName: deviceName || "Photoshop",
      pluginVersion
    });
  }

  /**
   * Refreshes an active license token.
   * POST /v1/refresh
   *
   * @param {object} params
   * @param {string} params.token Current signed token
   * @param {string} params.deviceHash
   * @param {string} [params.pluginVersion]
   * @returns {Promise<{ ok: boolean, data?: object, error?: string, message?: string }>}
   */
  async refresh({ token, deviceHash, pluginVersion = "1.0.0" }) {
    if (!token || typeof token !== "string") {
      return { ok: false, error: "INVALID_ARGUMENT", message: "Token is required." };
    }
    if (!deviceHash || typeof deviceHash !== "string") {
      return { ok: false, error: "INVALID_ARGUMENT", message: "Device hash is required." };
    }

    return this._post("/v1/refresh", {
      token,
      deviceHash,
      pluginVersion
    });
  }

  /**
   * Deactivates a license on this device.
   * POST /v1/deactivate
   *
   * @param {object} params
   * @param {string} params.token
   * @param {string} params.deviceHash
   * @returns {Promise<{ ok: boolean, data?: object, error?: string, message?: string }>}
   */
  async deactivate({ token, deviceHash }) {
    if (!token || typeof token !== "string") {
      return { ok: false, error: "INVALID_ARGUMENT", message: "Token is required." };
    }
    if (!deviceHash || typeof deviceHash !== "string") {
      return { ok: false, error: "INVALID_ARGUMENT", message: "Device hash is required." };
    }

    return this._post("/v1/deactivate", {
      token,
      deviceHash
    });
  }
}

/**
 * Factory for LicenseApiClient.
 * @param {object} [options]
 * @returns {LicenseApiClient}
 */
function createLicenseApiClient(options) {
  return new LicenseApiClient(options);
}

module.exports = {
  LicenseApiClient,
  createLicenseApiClient,
  validateConfig
};
