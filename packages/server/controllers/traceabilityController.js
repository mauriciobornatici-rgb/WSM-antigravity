import traceabilityService from '../services/traceability.service.js';
import catchAsync from '../utils/catchAsync.js';

export const getTimeline = catchAsync(async (req, res) => {
    const filters = {
        product_id: req.query.product_id,
        sku: req.query.sku,
        barcode: req.query.barcode,
        limit: req.query.limit
    };

    const events = await traceabilityService.getTimeline(filters);
    res.json(events);
});
