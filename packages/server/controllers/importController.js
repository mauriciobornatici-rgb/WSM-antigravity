import catchAsync from '../utils/catchAsync.js';
import productImportService from '../domains/imports/ProductImportService.js';
import { clientImportService, supplierImportService } from '../domains/imports/PartyImportService.js';

const SERVICES = {
    products: productImportService,
    clients: clientImportService,
    suppliers: supplierImportService,
};

// Checks every row and says what would happen, without saving anything.
export const previewImport = catchAsync(async (req, res) => {
    const service = SERVICES[req.params.entity];
    res.json(await service.preview(req.body.rows, { updateExisting: req.body.update_existing }));
});

// Saves one batch of rows (the screen sends the file in batches).
export const commitImport = catchAsync(async (req, res) => {
    const service = SERVICES[req.params.entity];
    res.json(await service.commit(
        req.body.rows,
        { updateExisting: req.body.update_existing, batchId: req.body.batch_id },
        req.user?.id || null
    ));
});
