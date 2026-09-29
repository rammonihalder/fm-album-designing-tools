"use strict";

/**
 * License States & Pure Helper Functions - Phase 1 Foundation
 *
 * SECURITY NOTICE:
 * Locally stored state text must NEVER be treated as authoritative proof of licensing.
 * In Phase 2, operational states (ACTIVE, GRACE) can only be derived from
 * cryptographically verified server-issued signed tokens, never trusted from raw strings.
 *
 * Zero Photoshop dependencies. Pure JavaScript.
 */

const LICENSE_STATES = Object.freeze({
  UNACTIVATED: "UNACTIVATED",
  ACTIVE: "ACTIVE",
  GRACE: "GRACE",
  TRIAL: "TRIAL",
  TRIAL_EXPIRED: "TRIAL_EXPIRED",
  EXPIRED: "EXPIRED",
  REVOKED: "REVOKED",
  SUSPENDED: "SUSPENDED",
  INVALID: "INVALID",
  ERROR: "ERROR"
});

const VALID_STATES = new Set(Object.values(LICENSE_STATES));

/**
 * Checks whether the given string is a recognized license state.
 * @param {*} state
 * @returns {boolean}
 */
function isValidState(state) {
  return typeof state === "string" && VALID_STATES.has(state);
}

/**
 * Normalizes an arbitrary value to a recognized license state.
 * @param {*} state
 * @param {string} [fallback=LICENSE_STATES.INVALID]
 * @returns {string}
 */
function normalizeState(state, fallback = LICENSE_STATES.INVALID) {
  if (isValidState(state)) {
    return state;
  }
  return isValidState(fallback) ? fallback : LICENSE_STATES.INVALID;
}

/**
 * Pure helper to classify whether a state is considered operational for future tool gating.
 * NOTE: Phase 1 does NOT enforce this restriction; all tools run unconditionally.
 * @param {string} state
 * @returns {boolean}
 */
function isOperationalState(state) {
  return state === LICENSE_STATES.ACTIVE || state === LICENSE_STATES.GRACE || state === LICENSE_STATES.TRIAL;
}

module.exports = {
  LICENSE_STATES,
  isValidState,
  normalizeState,
  isOperationalState
};
