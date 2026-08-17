import { test } from 'node:test';
import assert from 'node:assert/strict';

// crypto.js reads the key lazily, so setting env vars per-test works.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

const { encrypt, decrypt } = await import('../utils/crypto.js');

test('encrypt and decrypt roundtrip produces original text', () => {
    const plainText = 'MI_SECRETO_AFIP_SUPER_CONFIDENCIAL_123';
    const encrypted = encrypt(plainText);

    assert.notEqual(encrypted, plainText);
    assert.match(encrypted, /^[0-9a-f]{24}:[0-9a-f]+:[0-9a-f]{32}$/i);

    const decrypted = decrypt(encrypted);
    assert.equal(decrypted, plainText);
});

test('decrypt handles legacy plain text gracefully without throwing', () => {
    const plainText = 'ESTO_NO_ESTA_CIFRADO_TODAVIA';
    const result = decrypt(plainText);

    assert.equal(result, plainText);
});

test('decrypt returns falsy input unchanged', () => {
    assert.equal(encrypt(null), null);
    assert.equal(encrypt(''), '');
    assert.equal(decrypt(null), null);
    assert.equal(decrypt(''), '');
});

test('decrypt throws on tampered cipher instead of returning ciphertext', () => {
    const encrypted = encrypt('TEXTO_A_ALTERAR');
    const parts = encrypted.split(':');
    // Alter cipher text
    const tampered = `${parts[0]}:ff${parts[1].slice(2)}:${parts[2]}`;

    assert.throws(() => decrypt(tampered), /Decryption failed/);
});

test('decrypt falls back to legacy default key for pre-rotation values', () => {
    const currentEnv = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = 'default_wsm_secret_key_change_me_in_prod';
    const legacyEncrypted = encrypt('VALOR_CIFRADO_CON_CLAVE_VIEJA');
    process.env.ENCRYPTION_KEY = currentEnv;

    assert.equal(decrypt(legacyEncrypted), 'VALOR_CIFRADO_CON_CLAVE_VIEJA');
});

test('encrypt and decrypt throw when ENCRYPTION_KEY is missing', () => {
    const currentEnv = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    try {
        assert.throws(() => encrypt('x'), /ENCRYPTION_KEY is required/);
    } finally {
        process.env.ENCRYPTION_KEY = currentEnv;
    }
});
