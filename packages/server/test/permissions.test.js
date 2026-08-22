import test from 'node:test';
import assert from 'node:assert/strict';
import { hasPermission, PERMISSIONS } from '@wsm/common';

test('warehouse can fulfill orders but cannot create sales or invoices', () => {
    assert.equal(hasPermission('warehouse', PERMISSIONS.ORDERS_READ), true);
    assert.equal(hasPermission('warehouse', PERMISSIONS.ORDERS_PICK), true);
    assert.equal(hasPermission('warehouse', PERMISSIONS.ORDERS_DISPATCH), true);
    assert.equal(hasPermission('warehouse', PERMISSIONS.ORDERS_SELL), false);
    assert.equal(hasPermission('warehouse', PERMISSIONS.INVOICES_MANAGE), false);
});

test('warehouse can count stock while only management can approve adjustments', () => {
    assert.equal(hasPermission('warehouse', PERMISSIONS.INVENTORY_COUNT), true);
    assert.equal(hasPermission('warehouse', PERMISSIONS.INVENTORY_ADJUST), false);
    assert.equal(hasPermission('manager', PERMISSIONS.INVENTORY_COUNT), true);
    assert.equal(hasPermission('manager', PERMISSIONS.INVENTORY_ADJUST), true);
    assert.equal(hasPermission('cashier', PERMISSIONS.INVENTORY_COUNT), false);
    assert.equal(hasPermission('admin', PERMISSIONS.INVENTORY_ADJUST), true);
});

test('accounting, settings and integrations remain admin-only', () => {
    for (const role of ['manager', 'cashier', 'warehouse']) {
        assert.equal(hasPermission(role, PERMISSIONS.ACCOUNTING_MANAGE), false);
        assert.equal(hasPermission(role, PERMISSIONS.SETTINGS_MANAGE), false);
        assert.equal(hasPermission(role, PERMISSIONS.INTEGRATIONS_MANAGE), false);
    }
    assert.equal(hasPermission('admin', PERMISSIONS.ACCOUNTING_MANAGE), true);
    assert.equal(hasPermission('admin', PERMISSIONS.SETTINGS_MANAGE), true);
    assert.equal(hasPermission('admin', PERMISSIONS.INTEGRATIONS_MANAGE), true);
});

test('unknown roles never inherit permissions', () => {
    assert.equal(hasPermission('superadmin', PERMISSIONS.SETTINGS_MANAGE), false);
    assert.equal(hasPermission(undefined, PERMISSIONS.DASHBOARD_READ), false);
});

test('online store separates daily operations from credential administration', () => {
    assert.equal(hasPermission('manager', PERMISSIONS.ONLINE_STORE_READ), true);
    assert.equal(hasPermission('manager', PERMISSIONS.ONLINE_STORE_MANAGE), true);
    assert.equal(hasPermission('manager', PERMISSIONS.INTEGRATIONS_MANAGE), false);
    assert.equal(hasPermission('warehouse', PERMISSIONS.ONLINE_STORE_READ), true);
    assert.equal(hasPermission('warehouse', PERMISSIONS.ONLINE_STORE_MANAGE), false);
    assert.equal(hasPermission('cashier', PERMISSIONS.ONLINE_STORE_READ), true);
    assert.equal(hasPermission('cashier', PERMISSIONS.ONLINE_STORE_MANAGE), false);
});
