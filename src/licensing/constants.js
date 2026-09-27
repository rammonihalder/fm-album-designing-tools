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
  LICENSE_METADATA: "mm_license_metadata_v1"
});

const SCHEMA_VERSION = 1;

// Future validation intervals (Phase 2)
const REFRESH_INTERVAL_DAYS = 7;
const REFRESH_INTERVAL_MS = REFRESH_INTERVAL_DAYS * 24 * 60 * 60 * 1000;

const OFFLINE_GRACE_PERIOD_DAYS = 14;
const OFFLINE_GRACE_PERIOD_MS = OFFLINE_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;

const LOG_PREFIX = "[MM License]";

module.exports = {
  STORAGE_KEYS,
  SCHEMA_VERSION,
  REFRESH_INTERVAL_DAYS,
  REFRESH_INTERVAL_MS,
  OFFLINE_GRACE_PERIOD_DAYS,
  OFFLINE_GRACE_PERIOD_MS,
  LOG_PREFIX
};
