import express from 'express';
import * as importController from '../controllers/importController.js';
import { validate, schemas } from '../middleware/validationMiddleware.js';
import { PERMISSIONS, hasPermission } from '@wsm/common';

const router = express.Router();

// The same permission as creating one by hand: products need inventory management (the opening
// stock and prices too), clients and suppliers their own permission.
const IMPORT_PERMISSION = {
    products: PERMISSIONS.INVENTORY_MANAGE,
    clients: PERMISSIONS.CLIENTS_MANAGE,
    suppliers: PERMISSIONS.SUPPLIERS_MANAGE,
};

// Checked before reading the body: without the permission nothing about the rows is answered.
export const canImport = (req, res, next) => {
    const entity = req.params.entity;
    const permission = Object.hasOwn(IMPORT_PERMISSION, entity) ? IMPORT_PERMISSION[entity] : null;
    if (!permission) return res.status(404).json({ error: 'not_found', message: 'No se puede importar ese tipo de datos' });
    if (!hasPermission(req.user?.role, permission)) {
        return res.status(403).json({ error: 'forbidden', message: 'No tiene permisos para realizar esta accion' });
    }
    return next();
};

// Up to IMPORT_MAX_ROWS rows to check; the batches that are saved are small.
const importJson = express.json({ limit: '4mb' });

router.post('/imports/:entity/preview', canImport, importJson, validate(schemas.importPreview), importController.previewImport);
router.post('/imports/:entity/commit', canImport, importJson, validate(schemas.importCommit), importController.commitImport);

export default router;
