import catchAsync from '../utils/catchAsync.js';
import productImportService from '../domains/imports/ProductImportService.js';
import { clientImportService, supplierImportService } from '../domains/imports/PartyImportService.js';
import { PERMISSIONS, hasPermission } from '@wsm/common';

const SERVICES = {
    products: productImportService,
    clients: clientImportService,
    suppliers: supplierImportService,
};

// canEditCost: a new cost on an existing product revalues its stock (ADR-027, D5).
const importOptions = (req) => ({
    updateExisting: req.body.update_existing,
    canEditCost: hasPermission(req.user?.role, PERMISSIONS.PRODUCTS_COST_EDIT),
});

// Checks every row and says what would happen, without saving anything.
export const previewImport = catchAsync(async (req, res) => {
    const service = SERVICES[req.params.entity];
    res.json(await service.preview(req.body.rows, importOptions(req)));
});

// Saves one batch of rows (the screen sends the file in batches).
export const commitImport = catchAsync(async (req, res) => {
    const service = SERVICES[req.params.entity];
    res.json(await service.commit(
        req.body.rows,
        { ...importOptions(req), batchId: req.body.batch_id },
        req.user?.id || null
    ));
});
