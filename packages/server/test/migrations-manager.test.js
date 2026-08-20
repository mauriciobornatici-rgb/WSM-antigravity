import test from 'node:test';
import assert from 'node:assert/strict';
import { migrationInternals } from '../config/migrations_manager.js';

test('migration checksums are deterministic and content-sensitive', () => {
    assert.equal(migrationInternals.checksum('SELECT 1'), migrationInternals.checksum('SELECT 1'));
    assert.notEqual(migrationInternals.checksum('SELECT 1'), migrationInternals.checksum('SELECT 2'));
});

test('migration statement splitter ignores empty trailing statements', () => {
    assert.deepEqual(
        migrationInternals.splitStatements('SELECT 1;\n\nUPDATE x SET y = 2;;'),
        ['SELECT 1', 'UPDATE x SET y = 2']
    );
});

test('migration runner distinguishes implicit-commit DDL from transactional data changes', () => {
    assert.equal(migrationInternals.isDdlStatement('ALTER TABLE x ADD COLUMN y INT'), true);
    assert.equal(migrationInternals.isDdlStatement('-- schema\nCREATE TABLE x (id INT)'), true);
    assert.equal(migrationInternals.isDdlStatement('CREATE TRIGGER t BEFORE UPDATE ON x FOR EACH ROW SET @x = 1'), true);
    assert.equal(migrationInternals.isDdlStatement('UPDATE x SET y = 2'), false);
});

test('partial migration recovery only accepts matching duplicate DDL errors', () => {
    assert.equal(
        migrationInternals.isRecoverableAlreadyAppliedDdl(
            { code: 'ER_DUP_KEYNAME' },
            'ALTER TABLE x ADD UNIQUE KEY uq_x (id)'
        ),
        true
    );
    assert.equal(
        migrationInternals.isRecoverableAlreadyAppliedDdl(
            { code: 'ER_PARSE_ERROR' },
            'ALTER TABLE x ADD UNIQUE KEY uq_x (id)'
        ),
        false
    );
    assert.equal(
        migrationInternals.isRecoverableAlreadyAppliedDdl(
            { code: 'ER_CANT_CREATE_TABLE', errno: 1005, sqlMessage: "errno: 121 Duplicate key on write or update" },
            'ALTER TABLE x ADD CONSTRAINT fk_x FOREIGN KEY (id) REFERENCES y(id)'
        ),
        true
    );
    assert.equal(
        migrationInternals.isRecoverableAlreadyAppliedDdl(
            { code: 'ER_CANT_CREATE_TABLE', errno: 1005, sqlMessage: "errno: 150 Foreign key is incorrectly formed" },
            'ALTER TABLE x ADD CONSTRAINT fk_x FOREIGN KEY (id) REFERENCES y(id)'
        ),
        false
    );
});

test('historical checksum compatibility is narrowly scoped to the applied migration variant', () => {
    assert.equal(
        migrationInternals.isAcceptedHistoricalChecksum(
            '028_add_core_referential_integrity.sql',
            '702573c87363580f9d6e21199125c9c1b0570bfe099a69ca4bd4e0f56bc28d52'
        ),
        true
    );
    assert.equal(
        migrationInternals.isAcceptedHistoricalChecksum(
            '028_add_core_referential_integrity.sql',
            'different-checksum'
        ),
        false
    );
    assert.equal(
        migrationInternals.isAcceptedHistoricalChecksum(
            '027_make_journal_entries_immutable.sql',
            '702573c87363580f9d6e21199125c9c1b0570bfe099a69ca4bd4e0f56bc28d52'
        ),
        false
    );
});
