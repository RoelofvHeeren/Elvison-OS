/**
 * Security and Cryptography Utilities
 * 
 * Purpose:
 * Provides safe, consistent access to cryptographic primitives across environments
 * that may or may not support the full Web Crypto API (e.g., older browsers, 
 * certain test runners, or non-secure contexts).
 */

/**
 * Generates a UUID (v4-like) string safely.
 * 
 * Priority:
 * 1. `crypto.randomUUID()` (Standard, Cryptographically Secure)
 * 2. Fallback: Timestamp + Math.random() (Not secure, but sufficient for non-security collisions)
 * 
 * Rationale:
 * - `window.crypto.randomUUID` is the modern standard but requires a secure context (HTTPS).
 * - Some development or internal tools may run over HTTP or in partial environments.
 * - For idempotency keys and UI element IDs, cryptographic security is desirable but not strict;
 *   uniqueness is the primary goal. The fallback provides sufficient entropy for these cases.
 * 
 * @returns {string} A UUID-like string
 */
export const safeUUID = () => {
    // 1. Try Standard Web Crypto API
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        try {
            return crypto.randomUUID();
        } catch (e) {
            console.warn('crypto.randomUUID() failed, falling back to insecure generator:', e);
        }
    }

    // 2. Fallback: Custom Generator (v4 format)
    // Not cryptographically secure, but collision-resistant enough for UI keys/idempotency.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
};

/**
 * Generates a simple random ID for simpler use cases (like DOM elements).
 * @param {string} prefix Optional prefix
 * @returns {string}
 */
export const generateSimpleId = (prefix = 'id') => {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
};
