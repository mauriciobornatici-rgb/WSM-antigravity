import catchAsync from '../utils/catchAsync.js';
import getRequestIp from '../utils/requestIp.js';
import clientService from '../services/client.service.js';

export const getClients = catchAsync(async (req, res) => {
    res.json(await clientService.listClients());
});

export const getClientById = catchAsync(async (req, res) => {
    res.json(await clientService.getClientById(req.params.id));
});

export const createClient = catchAsync(async (req, res) => {
    const created = await clientService.createClient({ body: req.body, actorId: req.user?.id, ip: getRequestIp(req) });
    res.json(created);
});

export const updateClient = catchAsync(async (req, res) => {
    const updated = await clientService.updateClient({ id: req.params.id, body: req.body, actorId: req.user?.id, ip: getRequestIp(req) });
    res.json(updated);
});

export const setClientTaxCondition = catchAsync(async (req, res) => {
    res.json(await clientService.setTaxCondition({ id: req.params.id, body: req.body, actorId: req.user?.id, ip: getRequestIp(req) }));
});

export const deleteClient = catchAsync(async (req, res) => {
    await clientService.deleteClient({ id: req.params.id, actorId: req.user?.id, ip: getRequestIp(req) });
    res.json({ success: true });
});
