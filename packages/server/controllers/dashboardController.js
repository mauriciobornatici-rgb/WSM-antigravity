import dashboardService from '../services/dashboard.service.js';
import catchAsync from '../utils/catchAsync.js';

export const getDashboardStats = catchAsync(async (req, res) => {
    const stats = await dashboardService.getDashboardStats();
    res.json(stats);
});

export const getSizeColorAnalytics = catchAsync(async (req, res) => {
    const data = await dashboardService.getSizeColorAnalytics();
    res.json(data);
});
