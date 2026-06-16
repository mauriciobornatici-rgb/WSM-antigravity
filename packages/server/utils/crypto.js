import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard for GCM
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey() {
    const keyEnv = process.env.ENCRYPTION_KEY || 'default_wsm_secret_key_change_me_in_prod';
    if (!process.env.ENCRYPTION_KEY && process.env.NODE_ENV === 'production') {
        console.warn('WARNING: ENCRYPTION_KEY variable is missing in production environment!');
    }
    return crypto.createHash('sha256').update(keyEnv).digest();
}

/**
 * Encrypts plain text using aes-256-gcm
 * @param {string} text - Plain text to encrypt
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
 * Decrypts encrypted text using aes-256-gcm
 * Fallbacks to returning the input if it is not encrypted (backward compatibility)
 * @param {string} encryptedText - Encrypted text in format iv:encryptedData:authTag
 * @returns {string} Decrypted plain text
 */
export function decrypt(encryptedText) {
    if (!encryptedText) return encryptedText;
    
    const parts = String(encryptedText).split(':');
    if (parts.length !== 3) {
        // If it doesn't match the format, treat it as legacy plain text
        return encryptedText;
    }
    
    try {
        const key = getEncryptionKey();
        const iv = Buffer.from(parts[0], 'hex');
        const encrypted = parts[1];
        const authTag = Buffer.from(parts[2], 'hex');
        
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (err) {
        console.error('Decryption failed, falling back to original string:', err.message);
        return encryptedText;
    }
}
