import catchAsync from '../utils/catchAsync.js';
import getRequestIp from '../utils/requestIp.js';
import supplierService from '../domains/procurement/SupplierService.js';

export const getSuppliers = catchAsync(async (req, res) => {
    const rows = await supplierService.getSuppliers();
    res.json(rows);
});

export const createSupplier = catchAsync(async (req, res) => {
    const supplier = await supplierService.createSupplier(req.body, req.user?.id, getRequestIp(req));
    res.json(supplier);
});

export const updateSupplier = catchAsync(async (req, res) => {
    const supplier = await supplierService.updateSupplier(req.params.id, req.body, req.user?.id, getRequestIp(req));
    res.json(supplier);
});

export const deleteSupplier = catchAsync(async (req, res) => {
    const result = await supplierService.deleteSupplier(req.params.id, req.user?.id, getRequestIp(req));
    res.json(result);
});
