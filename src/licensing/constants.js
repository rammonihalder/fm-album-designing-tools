"use strict";

/**
 * Central Licensing Constants - Phase 1 Foundation
 *
 * ARCHITECTURE & SECURITY NOTES:
 * - Production licensing will rely on cryptographically verified server-issued signed tokens (Phase 2).
 * - UXP secureStorage serves exclusively as an encrypted local cache for the token.
 * - No private keys, API secrets, admin credentials, or backend endpoints are present.
 * - Network permissions are strictly deferred until the exact licensing API endpoint domain is chosen.
 */

const STORAGE_KEYS = Object.freeze({
  SIGNED_TOKEN: "mm_license_signed_token_v1",
  LICENSE_METADATA: "mm_license_metadata_v1",
  DEVICE_ID: "mm_license_device_id_v1"
});

const SCHEMA_VERSION = 1;

// Future validation intervals (Phase 2)
const REFRESH_INTERVAL_DAYS = 7;
const REFRESH_INTERVAL_MS = REFRESH_INTERVAL_DAYS * 24 * 60 * 60 * 1000;

const OFFLINE_GRACE_PERIOD_DAYS = 14;
const OFFLINE_GRACE_PERIOD_MS = OFFLINE_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;

const LOG_PREFIX = "[FM License]";

const PLUGIN_VERSION = "1.4.0";

const TRIAL_DURATION_DAYS = 30;
const TRIAL_DURATION_MS = TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000;

// Public Admin Contact Constants
const ADMIN_CONTACT_DISPLAY = "7001514367";
const ADMIN_CONTACT_E164 = "917001514367";
const ADMIN_WHATSAPP_MESSAGE = "I want to buy a license for FM Album Designing Tools.";

function getAdminWhatsAppUrl() {
  return `https://wa.me/${ADMIN_CONTACT_E164}?text=${encodeURIComponent(ADMIN_WHATSAPP_MESSAGE)}`;
}

module.exports = {
  STORAGE_KEYS,
  SCHEMA_VERSION,
  PLUGIN_VERSION,
  TRIAL_DURATION_DAYS,
  TRIAL_DURATION_MS,
  REFRESH_INTERVAL_DAYS,
  REFRESH_INTERVAL_MS,
  OFFLINE_GRACE_PERIOD_DAYS,
  OFFLINE_GRACE_PERIOD_MS,
  LOG_PREFIX,
  ADMIN_CONTACT_DISPLAY,
  ADMIN_CONTACT_E164,
  ADMIN_WHATSAPP_MESSAGE,
  getAdminWhatsAppUrl
};

