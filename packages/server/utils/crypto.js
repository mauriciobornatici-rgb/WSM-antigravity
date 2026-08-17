import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard for GCM
const AUTH_TAG_LENGTH = 16;

// Key used before ENCRYPTION_KEY existed. Kept ONLY as read fallback so
// existing rows encrypted with it can still be decrypted (and re-encrypted
// with the real key on next save). Never used for new encryption.
const LEGACY_DEFAULT_KEY = 'default_wsm_secret_key_change_me_in_prod';

let warnedLegacyKey = false;

function deriveKey(keyEnv) {
    return crypto.createHash('sha256').update(keyEnv).digest();
}

function getEncryptionKey() {
    const keyEnv = process.env.ENCRYPTION_KEY;
    if (!keyEnv) {
        throw new Error(
            'ENCRYPTION_KEY is required. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
        );
    }
    return deriveKey(keyEnv);
}

function isEncryptedFormat(value) {
    const parts = String(value).split(':');
    return parts.length === 3 && parts.every((part) => /^[0-9a-f]+$/i.test(part));
}

function decryptWithKey(key, encryptedText) {
    const parts = String(encryptedText).split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[2], 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(parts[1], 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

/**
 * Encrypts plain text using aes-256-gcm
 * @param {string} text - Plain text
 * @returns {string} Encrypted text in format iv:encryptedData:authTag
 */
export function encrypt(text) {
    if (!text) return text;
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');

    return `${iv.toString('hex')}:${encrypted}:${authTag}`;
}

/**
 * Decrypts encrypted text using aes-256-gcm.
 * - Values not in encrypted format are returned as-is (legacy plaintext rows).
 * - Values encrypted with the legacy default key are decrypted via fallback
 *   (with a warning) so they keep working until re-saved.
 * - Anything else throws: silently returning ciphertext would leak garbage
 *   into API calls (e.g. OAuth tokens) and mask the misconfiguration.
 * @param {string} encryptedText - Encrypted text in format iv:encryptedData:authTag
 * @returns {string} Decrypted plain text
 */
export function decrypt(encryptedText) {
    if (!encryptedText) return encryptedText;

    if (!isEncryptedFormat(encryptedText)) {
        console.warn('[crypto] Value is not encrypted; returning as-is (legacy row?). Re-save to encrypt.');
        return encryptedText;
    }

    try {
        return decryptWithKey(getEncryptionKey(), encryptedText);
    } catch (err) {
        // Wrong key is the most likely cause: try the legacy default key once.
        try {
            const legacy = decryptWithKey(deriveKey(LEGACY_DEFAULT_KEY), encryptedText);
            if (!warnedLegacyKey) {
                warnedLegacyKey = true;
                console.warn(
                    '[crypto] Decrypted a value with the LEGACY default key. ' +
                    'Set ENCRYPTION_KEY and re-save integration credentials to re-encrypt.'
                );
            }
            return legacy;
        } catch {
            throw new Error(`Decryption failed (wrong ENCRYPTION_KEY or corrupted data): ${err.message}`);
        }
    }
}
