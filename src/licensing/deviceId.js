"use strict";

const { base64UrlToBytes, bytesToBase64Url } = require("./crypto/base64");

/**
 * Gets or creates a persistent, high-entropy, privacy-friendly opaque device identity.
 *
 * Privacy Guarantees:
 * - NO MAC address
 * - NO motherboard serial
 * - NO BIOS ID
 * - NO Windows product key
 * - NO disk serial
 * - NO OS username
 * - NO Adobe account email
 *
 * It is a 256-bit random opaque installation identifier stored in secureStorage.
 */

function getCrypto() {
  if (typeof crypto !== "undefined") return crypto;
  if (typeof globalThis !== "undefined" && globalThis.crypto) return globalThis.crypto;
  return null;
}

/**
 * Generates a high-entropy random installation identifier (128+ bits).
 * @returns {string}
 */
function generateOpaqueDeviceId() {
  const c = getCrypto();
  if (c) {
    if (typeof c.randomUUID === "function") {
      try {
        return c.randomUUID();
      } catch {
        // Fall back to getRandomValues
      }
    }
    if (typeof c.getRandomValues === "function") {
      try {
        const buf = new Uint8Array(16);
        c.getRandomValues(buf);
        return Array.from(buf, b => b.toString(16).padStart(2, "0")).join("");
      } catch {
        // Fall back
      }
    }
  }

  // Safe failure: Photoshop Manifest v5 / UXP 7+ guarantees WebCrypto getRandomValues.
  // We prefer failing safely over weak pseudo-random predictability.
  throw new Error("Cryptographic random generator unavailable: host environment lacks crypto.getRandomValues");
}

/**
 * Gets the generic device name without leaking private host details.
 * e.g. "Photoshop Windows" or "Photoshop macOS"
 * @returns {string}
 */
function getGenericDeviceName() {
  let platform = "Desktop";
  try {
    if (typeof navigator !== "undefined" && navigator.platform) {
      const p = navigator.platform.toLowerCase();
      if (p.includes("win")) platform = "Windows";
      else if (p.includes("mac")) platform = "macOS";
    } else if (typeof process !== "undefined" && process.platform) {
      if (process.platform === "win32") platform = "Windows";
      else if (process.platform === "darwin") platform = "macOS";
    }
  } catch {
    // Ignore and use default
  }
  return `Photoshop ${platform}`;
}

/**
 * Gets or creates the persistent installation device ID using the given storage.
 * Regenerates only when missing or corrupt (< 16 characters).
 * @param {object} storage
 * @returns {Promise<string>}
 */
async function getInstallationDeviceId(storage) {
  if (!storage) return generateOpaqueDeviceId();
  if (typeof storage.readDeviceId === "function") {
    let id = await storage.readDeviceId();
    if (!id || typeof id !== "string" || id.trim().length < 16) {
      id = generateOpaqueDeviceId();
      await storage.writeDeviceId(id);
    }
    return id.trim();
  }
  if (typeof storage.getItem === "function") {
    const { createLicenseStorage } = require("./licenseStorage");
    const wrapped = createLicenseStorage({ secureStorage: storage });
    let id = await wrapped.readDeviceId();
    if (!id || typeof id !== "string" || id.trim().length < 16) {
      id = generateOpaqueDeviceId();
      await wrapped.writeDeviceId(id);
    }
    return id.trim();
  }
  return generateOpaqueDeviceId();
}

module.exports = {
  generateOpaqueDeviceId,
  generateFallbackRandomId: generateOpaqueDeviceId,
  getInstallationDeviceId,
  getGenericDeviceName
};
