import test from 'node:test';
import assert from 'node:assert/strict';

import { businessYear } from '../utils/businessDate.js';
import { normalizeTaxId, taxIdKey, taxIdKeySql } from '../utils/taxId.js';
import { withNamedLockTransaction } from '../utils/namedLock.js';

test('document numbers take the year in Argentina, whatever the server timezone', () => {
    // 31/12 at 23:00 in Buenos Aires is already 1 January in UTC.
    assert.equal(businessYear(new Date('2026-01-01T02:00:00Z')), 2025);
    assert.equal(businessYear(new Date('2026-01-01T03:00:00Z')), 2026);
    assert.equal(businessYear(new Date('2026-07-15T12:00:00Z')), 2026);
});

test('a CUIT typed with dashes, dots, spaces or slashes is the same key; blank is none', () => {
    assert.equal(taxIdKey('20-12345678-9'), '20123456789');
    assert.equal(taxIdKey(' 20.12345678 9 '), '20123456789');
    assert.equal(taxIdKey('20/12345678/9'), '20123456789');
    assert.equal(taxIdKey('ab-12'), 'AB12');
    assert.equal(taxIdKey(null), '');
    assert.equal(normalizeTaxId('   '), null);
    assert.equal(normalizeTaxId(' 20-1 '), '20-1');
    // What a paste brings (security review): long dashes, full-width digits, invisible characters.
    // Built from code points: they would be invisible in the source.
    const c = (code) => String.fromCharCode(code);
    assert.equal(normalizeTaxId(`20${c(0x2013)}12345678${c(0x2014)}9`), '20-12345678-9');
    assert.equal(taxIdKey(`${c(0xFF12)}${c(0xFF10)}-12345678-9`), '20123456789');
    assert.equal(taxIdKey(`20${c(0x200B)}12345678${c(0xFEFF)}9`), '20123456789');
    assert.equal(normalizeTaxId(c(0x200B)), null);
    // The SQL side removes exactly the same characters.
    for (const character of ['-', '.', ' ', '/']) assert.ok(taxIdKeySql().includes(`'${character}', ''`));
});

test('withNamedLockTransaction commits under the lock, rolls back on error and always releases it', async () => {
    const events = [];
    const connection = {
        query: async (sql, params) => {
            events.push([sql.split('(')[0], params?.[0]]);
            if (sql.startsWith('SELECT GET_LOCK')) return [[{ acquired: connection.acquired }]];
            return [[]];
        },
        beginTransaction: async () => events.push(['begin']),
        commit: async () => events.push(['commit']),
        rollback: async () => events.push(['rollback']),
        release: () => events.push(['release']),
        acquired: 1,
    };
    const db = { getConnection: async () => connection };
    const busy = { error: 'busy', message: 'ocupado' };

    assert.equal(await withNamedLockTransaction(db, 'k', busy, async () => 'ok'), 'ok');
    assert.deepEqual(events.map(([kind]) => kind), ['SELECT GET_LOCK', 'begin', 'commit', 'SELECT RELEASE_LOCK', 'release']);

    events.length = 0;
    await assert.rejects(() => withNamedLockTransaction(db, 'k', busy, async () => { throw new Error('boom'); }), /boom/);
    assert.deepEqual(events.map(([kind]) => kind), ['SELECT GET_LOCK', 'begin', 'rollback', 'SELECT RELEASE_LOCK', 'release']);

    events.length = 0;
    connection.acquired = 0;
    await assert.rejects(
        () => withNamedLockTransaction(db, 'k', busy, async () => 'never'),
        (error) => error.statusCode === 409 && error.responseBody === busy
    );
    assert.deepEqual(events.map(([kind]) => kind), ['SELECT GET_LOCK', 'SELECT RELEASE_LOCK', 'release']);

    events.length = 0;
    await withNamedLockTransaction(db, null, busy, async () => 'plain');
    assert.deepEqual(events.map(([kind]) => kind), ['begin', 'commit', 'release'], 'no name, no lock');

    // A connection that could not release its lock is closed, never returned to the pool.
    events.length = 0;
    connection.acquired = 1;
    const realQuery = connection.query;
    connection.query = async (sql, params) => {
        if (sql.startsWith('SELECT RELEASE_LOCK')) throw new Error('connection lost');
        return realQuery(sql, params);
    };
    connection.destroy = () => events.push(['destroy']);
    await withNamedLockTransaction(db, 'k', busy, async () => 'ok');
    assert.deepEqual(events.map(([kind]) => kind), ['SELECT GET_LOCK', 'begin', 'commit', 'destroy']);
});
