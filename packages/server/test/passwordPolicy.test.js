import test from 'node:test';
import assert from 'node:assert/strict';
import { getPasswordPolicyMessage, isStrongPassword, passwordPolicy } from '../utils/passwordPolicy.js';

test('password policy message references configured limits', () => {
    const message = getPasswordPolicyMessage();
    assert.match(message, new RegExp(String(passwordPolicy.minLength)));
    assert.match(message, new RegExp(String(passwordPolicy.maxLength)));
});

test('accepts valid strong passwords', () => {
    assert.equal(isStrongPassword('Abcdef1!'), true);
    assert.equal(isStrongPassword('XyZ!1234@Secure'), true);
});

test('rejects weak passwords', () => {
    assert.equal(isStrongPassword('abcdefghi'), false, 'missing uppercase/number/symbol');
    assert.equal(isStrongPassword('ABCDEFGH1'), false, 'missing lowercase/symbol');
    assert.equal(isStrongPassword('Abcdefgh'), false, 'missing number/symbol');
    assert.equal(isStrongPassword('Abcdefg1'), false, 'missing symbol');
    assert.equal(isStrongPassword('A1!bc'), false, 'below min length');
    assert.equal(isStrongPassword(null), false, 'non-string values are invalid');
});
