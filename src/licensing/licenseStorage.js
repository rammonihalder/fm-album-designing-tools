"use strict";

const { STORAGE_KEYS, SCHEMA_VERSION, LOG_PREFIX } = require("./constants");

/**
 * Safely resolves UXP secureStorage if present in the runtime environment.
 * @returns {object|null}
 */
function getNativeSecureStorage() {
  try {
    const uxp = require("uxp");
    return uxp?.storage?.secureStorage || null;
  } catch {
    return null;
  }
}

/**
 * Abstraction layer for UXP secureStorage.
 *
 * Responsibilities:
 * - Versioned envelope serialization/deserialization.
 * - Non-fatal fault tolerance (corrupt JSON, empty storage, unavailable storage).
 * - Safe async CRUD operations.
 * - Test mock injection.
 */
class LicenseStorage {
  /**
   * @param {object} [options]
   * @param {object} [options.secureStorage] Injected secureStorage implementation.
   * @param {number} [options.schemaVersion] Envelope schema version.
   * @param {object} [options.logger] Injected logger (defaults to console).
   */
  constructor(options = {}) {
    this.secureStorage = options.secureStorage !== undefined
      ? options.secureStorage
      : getNativeSecureStorage();
    this.schemaVersion = typeof options.schemaVersion === "number"
      ? options.schemaVersion
      : SCHEMA_VERSION;
    this.logger = options.logger || console;
  }

  /**
   * Safely reads and parses a versioned payload from secure storage.
   * @param {string} key
   * @returns {Promise<*|null>}
   */
  async readItem(key) {
    if (!this.secureStorage || typeof this.secureStorage.getItem !== "function") {
      return null;
    }

    const raw = await this.secureStorage.getItem(key);
    if (raw == null) {
      return null;
    }

    let text;
    if (typeof raw === "string") {
      text = raw;
    } else if (raw instanceof Uint8Array || (typeof Buffer !== "undefined" && Buffer.isBuffer(raw))) {
      text = new TextDecoder("utf-8").decode(raw);
    } else {
      text = String(raw);
    }

    const trimmed = text.trim();
    if (!trimmed) {
      return null;
    }

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      this.logger.warn?.(`${LOG_PREFIX} Storage payload corrupted for key: ${key}`);
      return null;
    }

    if (!parsed || typeof parsed !== "object" || parsed.schemaVersion !== this.schemaVersion) {
      this.logger.warn?.(`${LOG_PREFIX} Unsupported schema version in storage for key: ${key}`);
      return null;
    }

    return parsed.payload !== undefined ? parsed.payload : null;
  }

  /**
   * Safely serializes and persists a versioned envelope to secure storage.
   * @param {string} key
   * @param {*} data
   * @returns {Promise<boolean>}
   */
  async writeItem(key, data) {
    try {
      if (!this.secureStorage || typeof this.secureStorage.setItem !== "function") {
        this.logger.warn?.(`${LOG_PREFIX} Secure storage unavailable for write`);
        return false;
      }

      const envelope = {
        schemaVersion: this.schemaVersion,
        savedAt: Date.now(),
        payload: data
      };

      const serialized = JSON.stringify(envelope);
      await this.secureStorage.setItem(key, serialized);
      return true;
    } catch (err) {
      this.logger.warn?.(`${LOG_PREFIX} Safe write failed for key "${key}":`, err?.message || err);
      return false;
    }
  }

  /**
   * Safely removes a key from secure storage.
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  async deleteItem(key) {
    try {
      if (!this.secureStorage) {
        return true;
      }

      if (typeof this.secureStorage.removeItem === "function") {
        await this.secureStorage.removeItem(key);
      } else if (typeof this.secureStorage.deleteItem === "function") {
        await this.secureStorage.deleteItem(key);
      }
      return true;
    } catch (err) {
      this.logger.warn?.(`${LOG_PREFIX} Safe delete failed for key "${key}":`, err?.message || err);
      return false;
    }
  }

  /**
   * Reads cached signed token payload.
   * @returns {Promise<*|null>}
   */
  async readToken() {
    return this.readItem(STORAGE_KEYS.SIGNED_TOKEN);
  }

  /**
   * Persists signed token payload.
   * @param {*} tokenPayload
   * @returns {Promise<boolean>}
   */
  async writeToken(tokenPayload) {
    return this.writeItem(STORAGE_KEYS.SIGNED_TOKEN, tokenPayload);
  }

  /**
   * Deletes cached signed token.
   * @returns {Promise<boolean>}
   */
  async deleteToken() {
    return this.deleteItem(STORAGE_KEYS.SIGNED_TOKEN);
  }

  /**
   * Reads license metadata.
   * @returns {Promise<*|null>}
   */
  async readMetadata() {
    return this.readItem(STORAGE_KEYS.LICENSE_METADATA);
  }

  /**
   * Persists license metadata.
   * @param {*} metadata
   * @returns {Promise<boolean>}
   */
  async writeMetadata(metadata) {
    return this.writeItem(STORAGE_KEYS.LICENSE_METADATA, metadata);
  }

  /**
   * Deletes license metadata.
   * @returns {Promise<boolean>}
   */
  async deleteMetadata() {
    return this.deleteItem(STORAGE_KEYS.LICENSE_METADATA);
  }

  /**
   * Clears all cached licensing data.
   * @returns {Promise<boolean>}
   */
  async clearAll() {
    const resToken = await this.deleteToken();
    const resMeta = await this.deleteMetadata();
    return resToken && resMeta;
  }
}

/**
 * Factory for LicenseStorage.
 * @param {object} [options]
 * @returns {LicenseStorage}
 */
function createLicenseStorage(options) {
  return new LicenseStorage(options);
}

module.exports = {
  LicenseStorage,
  createLicenseStorage
};
