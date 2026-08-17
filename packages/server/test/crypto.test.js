import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt } from '../utils/crypto.js';

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

test('decrypt falls back to original string on tampered cipher', () => {
    const encrypted = encrypt('TEXTO_A_ALTERAR');
    const parts = encrypted.split(':');
    // Alter cipher text
    const tampered = `${parts[0]}:ff${parts[1].slice(2)}:${parts[2]}`;

    const decrypted = decrypt(tampered);
    assert.equal(decrypted, tampered);
});
