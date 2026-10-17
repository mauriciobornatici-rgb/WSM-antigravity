import crypto from 'crypto';
import pool from '../../config/db.js';
import auditService from '../../services/audit.service.js';
import { withNamedLocksTransaction } from '../../utils/namedLock.js';
import { normalizeTaxId, taxIdKey, taxIdKeySql } from '../../utils/taxId.js';
import { CLIENT_TAX_CONDITIONS, IMPORT_COLUMNS } from '@wsm/common';
import { isEmail, plainText, RowIssues, summarize } from './importCells.js';

const BUSY = { error: 'busy', message: 'Otro usuario está guardando alguno de estos datos. Reintentá en unos segundos.' };

/**
 * Clients and suppliers from a spreadsheet. They are recognized by CUIT, compared without
 * dashes, dots or spaces (AUD-013), and saved under the same named lock per CUIT as the manual
 * forms, so an import and a person cannot create the same CUIT twice. A row without CUIT is
 * recognized by its exact name (without accents or case), so importing the file again never
 * duplicates it. An existing one is skipped, or updated with the non-empty cells when asked.
 */
class PartyImportService {
    constructor({ db = pool, table, lockPrefix, entity, label, columns, fields }) {
        this.db = db;
        this.table = table;
        this.lockPrefix = lockPrefix;
        this.namePrefix = `${table}_import_name`;
        this.entity = entity;
        this.label = label;
        this.header = Object.fromEntries(columns.map((column) => [column.key, column.header]));
        this.fields = fields;
    }

    async preview(rows, { updateExisting = false } = {}) {
        return this._response(await this._analyze(this.db, rows, { updateExisting }));
    }

    async commit(rows, { updateExisting = false, batchId }, userId = null) {
        // The CUITs the batch will save, locked as the manual forms lock them, read the same way
        // the rows are (a tab inside the cell or a CUIT typed as a number lock the key that is
        // saved). A row without CUIT locks its name: two imports cannot both create it.
        const lockNames = rows.map((raw) => {
            const { party } = this._parse(raw);
            const key = taxIdKey(party.tax_id);
            if (key) return `${this.lockPrefix}:${key}`;
            return party.name ? `${this.namePrefix}:${plainText(party.name)}` : null;
        });
        return withNamedLocksTransaction(this.db, lockNames, BUSY, async (connection) => {
            const analysis = await this._analyze(connection, rows, { updateExisting, lock: true });
            for (const item of analysis) {
                if (item.action === 'create') await this._create(connection, item, userId, batchId);
                else if (item.action === 'update') await this._update(connection, item, userId, batchId);
            }
            await auditService.log({
                user_id: userId,
                action: this.entity === 'clients' ? 'IMPORT_CLIENTS' : 'IMPORT_SUPPLIERS',
                entity_type: 'import',
                entity_id: batchId,
                new_values: { summary: summarize(analysis) },
            }, connection);
            return this._response(analysis);
        });
    }

    // Common cells, then the entity's own (clients: VAT condition and credit limit).
    _parse(raw) {
        const issues = new RowIssues();
        const party = {
            row: raw.row,
            name: issues.text(raw.name, this.header.name, 255),
            tax_id: normalizeTaxId(issues.text(raw.tax_id, this.header.tax_id, 50)),
            email: issues.text(raw.email, this.header.email, 255),
            phone: issues.text(raw.phone, this.header.phone, 50),
            address: issues.text(raw.address, this.header.address, 2000),
        };
        if (party.email && !isEmail(party.email)) issues.error(`${this.header.email}: "${party.email}" no es un correo válido.`);
        this._parseOwn(raw, party, issues);
        return { party, issues };
    }

    _parseOwn() {}

    async _analyze(db, rows, { updateExisting, lock = false }) {
        const parsed = rows.map((raw) => this._parse(raw));
        const firstByKey = new Map();
        const firstByName = new Map();
        for (const { party, issues } of parsed) {
            const key = taxIdKey(party.tax_id);
            if (key) {
                if (firstByKey.has(key)) issues.error(`${this.header.tax_id} repetido en el archivo (ya está en la fila ${firstByKey.get(key)}).`);
                else firstByKey.set(key, party.row);
            } else if (party.name) {
                // Without CUIT the name is the only way to tell them apart: the same name twice
                // in one file cannot be imported (which one would a later import update?).
                const name = plainText(party.name);
                if (firstByName.has(name)) issues.error(`Mismo nombre que la fila ${firstByName.get(name)} y ninguna tiene ${this.header.tax_id}: cargale el CUIT o el DNI a cada una para distinguirlas.`);
                else firstByName.set(name, party.row);
            }
        }

        const keys = [...firstByKey.keys()];
        const [byKeyRows] = keys.length > 0
            ? await db.query(`SELECT * FROM ${this.table} WHERE deleted_at IS NULL AND ${taxIdKeySql()} IN (?)`, [keys])
            : [[]];
        // A row without CUIT is the existing one with the same name (compared without accents or
        // case): importing the same file again, or after a cut, never creates it twice.
        const [byNameRows] = firstByName.size > 0
            ? await db.query(`SELECT * FROM ${this.table} WHERE deleted_at IS NULL`)
            : [[]];
        const nameMatches = byNameRows.filter((row) => firstByName.has(plainText(row.name)));
        let existingRows = [...byKeyRows, ...nameMatches.filter((row) => !byKeyRows.some((other) => other.id === row.id))];
        if (lock && existingRows.length > 0 && updateExisting) {
            // Rows to update are locked, as a manual edit locks them, and read again from the
            // locked (current) data, not the transaction's snapshot.
            [existingRows] = await db.query(
                `SELECT * FROM ${this.table} WHERE id IN (?) AND deleted_at IS NULL ORDER BY id FOR UPDATE`,
                [existingRows.map((row) => row.id)]
            );
        }
        const existingByKey = new Map();
        const existingByName = new Map();
        for (const row of existingRows) {
            const rowKey = taxIdKey(row.tax_id);
            if (rowKey) existingByKey.set(rowKey, row);
            const name = plainText(row.name);
            existingByName.set(name, [...(existingByName.get(name) || []), row]);
        }

        return parsed.map(({ party, issues }) => {
            const key = taxIdKey(party.tax_id);
            const sameName = !key && party.name ? (existingByName.get(plainText(party.name)) || []) : [];
            const existing = key ? existingByKey.get(key) : (sameName.length === 1 ? sameName[0] : null);
            const item = { row: party.row, key: party.tax_id || party.name || '', party, existing: existing || null, issues };
            if (sameName.length > 1) {
                if (!updateExisting) {
                    return this._finish(item, 'skip', [`Ya hay ${sameName.length} con ese nombre: se saltea. Si es otro ${this.label}, cargale el CUIT o el DNI.`]);
                }
                issues.error(`Hay ${sameName.length} con ese nombre y la fila no tiene ${this.header.tax_id}: cargale el CUIT para saber cuál actualizar.`);
                return this._finish(item, 'error');
            }
            if (existing && !updateExisting) {
                const how = key ? '' : ` (mismo nombre, sin ${this.header.tax_id}; si es otro ${this.label}, cargale el CUIT o el DNI)`;
                return this._finish(item, 'skip', [`Ya existe (${existing.name})${how}: se saltea. Marcá "Actualizar los que ya existen" para cambiar sus datos.`]);
            }
            if (!existing && (!party.name || party.name.length < 2)) issues.error(`Falta el ${this.header.name}.`);
            this._validateOwn(item);
            return this._finish(item, issues.errors.length > 0 ? 'error' : (existing ? 'update' : 'create'));
        });
    }

    _validateOwn() {}

    _finish(item, action, extraWarnings = []) {
        item.action = action;
        item.errors = action === 'skip' ? [] : item.issues.errors;
        item.warnings = [...extraWarnings, ...(action === 'skip' ? [] : item.issues.warnings)];
        return item;
    }

    // Values to store for a new row, in the order of `this.fields`.
    _values(item) {
        return this.fields.map((field) => item.party[field] ?? null);
    }

    async _create(connection, item, userId, batchId) {
        const id = crypto.randomUUID();
        const columns = ['id', ...this.fields];
        const values = [id, ...this._values(item)];
        await connection.query(
            `INSERT INTO ${this.table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
            values
        );
        await auditService.log({
            user_id: userId,
            action: this.entity === 'clients' ? 'CREATE_CLIENT' : 'CREATE_SUPPLIER',
            entity_type: this.entity === 'clients' ? 'client' : 'supplier',
            entity_id: id,
            new_values: { ...Object.fromEntries(columns.map((column, index) => [column, values[index]])), source: 'import', batch_id: batchId },
        }, connection);
    }

    // Only the non-empty cells change something, and only when they differ.
    async _update(connection, item, userId, batchId) {
        const { existing } = item;
        const changes = {};
        for (const field of this.fields) {
            const value = item.party[field];
            if (value == null) continue;
            // The same CUIT written with other dashes is not a change: the stored one stays.
            if (field === 'tax_id' && taxIdKey(value) === taxIdKey(existing.tax_id)) continue;
            const same = typeof value === 'number'
                ? Number(existing[field] ?? NaN) === value
                : String(value) === String(existing[field] ?? '');
            if (!same) changes[field] = value;
        }
        if (Object.keys(changes).length === 0) {
            item.warnings.push('No había nada distinto para actualizar.');
            return;
        }
        const columns = Object.keys(changes);
        await connection.query(
            `UPDATE ${this.table} SET ${columns.map((column) => `${column} = ?`).join(', ')} WHERE id = ? AND deleted_at IS NULL`,
            [...columns.map((column) => changes[column]), existing.id]
        );
        await auditService.log({
            user_id: userId,
            action: this.entity === 'clients' ? 'UPDATE_CLIENT' : 'UPDATE_SUPPLIER',
            entity_type: this.entity === 'clients' ? 'client' : 'supplier',
            entity_id: existing.id,
            old_values: Object.fromEntries(columns.map((column) => [column, existing[column] ?? null])),
            new_values: { ...changes, source: 'import', batch_id: batchId },
        }, connection);
    }

    _response(analysis) {
        return {
            summary: summarize(analysis),
            rows: analysis.map(({ row, action, key, errors, warnings }) => ({ row, action, key, errors, warnings })),
        };
    }
}

// What people write in the "Condición IVA" column, compared without accents or case.
const TAX_CONDITION_WORDS = new Map([
    ...['consumidor final', 'cf', 'consumidor', 'final', 'iva consumidor final'].map((word) => [plainText(word), 'tc_ConsFinal']),
    ...['responsable inscripto', 'ri', 'resp. inscripto', 'inscripto', 'iva responsable inscripto', 'responsable inscripto iva'].map((word) => [plainText(word), 'tc_RespInscripto']),
    ...['monotributista', 'monotributo', 'mono', 'monotributo social', 'responsable monotributo'].map((word) => [plainText(word), 'tc_Monotributo']),
    ...['exento', 'exenta', 'iva exento', 'sujeto exento'].map((word) => [plainText(word), 'tc_Exento']),
]);

export class ClientImportService extends PartyImportService {
    constructor({ db = pool } = {}) {
        super({
            db,
            table: 'clients',
            lockPrefix: 'client_tax_id',
            entity: 'clients',
            label: 'cliente',
            columns: IMPORT_COLUMNS.clients,
            fields: ['name', 'tax_id', 'email', 'phone', 'address', 'credit_limit', 'tax_condition_id'],
        });
    }

    _parseOwn(raw, party, issues) {
        party.credit_limit = issues.decimal(raw.credit_limit, this.header.credit_limit);
        const condition = issues.text(raw.tax_condition, this.header.tax_condition, 100);
        if (condition) {
            party.tax_condition_id = TAX_CONDITION_WORDS.get(plainText(condition)) || null;
            if (!party.tax_condition_id) {
                const names = CLIENT_TAX_CONDITIONS.map((option) => option.name).join(', ');
                issues.error(`${this.header.tax_condition}: "${condition}" no es válida (${names}).`);
            }
        }
    }

    // A Responsable Inscripto is invoiced with an A, which needs the CUIT (ADR-021), with the
    // condition and CUIT the client will have after the row (sent or kept).
    _validateOwn(item) {
        if (item.action === 'skip') return;
        const condition = item.party.tax_condition_id ?? item.existing?.tax_condition_id ?? null;
        const taxId = item.party.tax_id ?? item.existing?.tax_id ?? null;
        if (condition === 'tc_RespInscripto' && String(taxId || '').replace(/\D/g, '').length !== 11) {
            item.issues.error('Un Responsable Inscripto necesita el CUIT (11 dígitos).');
        }
    }

    _values(item) {
        return this.fields.map((field) => (field === 'credit_limit' ? (item.party.credit_limit ?? 0) : (item.party[field] ?? null)));
    }
}

export class SupplierImportService extends PartyImportService {
    constructor({ db = pool } = {}) {
        super({
            db,
            table: 'suppliers',
            lockPrefix: 'supplier_tax_id',
            entity: 'suppliers',
            label: 'proveedor',
            columns: IMPORT_COLUMNS.suppliers,
            fields: ['name', 'tax_id', 'contact_name', 'email', 'phone', 'address', 'category'],
        });
    }

    _parseOwn(raw, party, issues) {
        party.contact_name = issues.text(raw.contact_name, this.header.contact_name, 255);
        party.category = issues.text(raw.category, this.header.category, 100);
    }
}

export const clientImportService = new ClientImportService();
export const supplierImportService = new SupplierImportService();
