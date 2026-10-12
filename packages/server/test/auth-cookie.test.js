import test from 'node:test';
import assert from 'node:assert/strict';
import {
    AUTH_COOKIE_NAME,
    expiredSessionCookie,
    getCookieValue,
    isTrustedCookieRequest,
    sessionCookie,
} from '../utils/authCookie.js';

test('session cookie is HttpOnly, strict and scoped to the API', () => {
    const cookie = sessionCookie('header.payload.signature', { secure: true });
    assert.match(cookie, new RegExp(`^${AUTH_COOKIE_NAME}=`));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Path=\/api/);
    assert.match(cookie, /Secure/);
});

test('cookie parser extracts and decodes the named cookie safely', () => {
    assert.equal(getCookieValue(null), null);
    assert.equal(getCookieValue('flag; custom=value', 'custom'), 'value');
    assert.equal(getCookieValue('theme=dark; wsm_session=a%2Eb%2Ec; other=1'), 'a.b.c');
    assert.equal(getCookieValue('theme=dark'), null);
    assert.equal(getCookieValue('wsm_session=%E0%A4%A'), null);
});

test('expired cookie clears the same secure scope', () => {
    const cookie = expiredSessionCookie({ secure: true });
    assert.match(cookie, /Max-Age=0/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /Path=\/api/);
    assert.doesNotMatch(expiredSessionCookie(), /; Secure/);
    assert.doesNotMatch(sessionCookie('token'), /; Secure/);
});

test('cookie-authenticated mutations require an explicitly trusted Origin', () => {
    const allowed = ['http://localhost:5173'];
    assert.equal(isTrustedCookieRequest('GET', undefined, allowed), true);
    assert.equal(isTrustedCookieRequest('POST', 'http://localhost:5173', allowed), true);
    assert.equal(isTrustedCookieRequest('POST', 'https://evil.example', allowed), false);
    assert.equal(isTrustedCookieRequest('DELETE', undefined, allowed), false);
    assert.equal(isTrustedCookieRequest('head', undefined, allowed), true);
    assert.equal(isTrustedCookieRequest('PATCH', '', allowed), false);
});
