import pool from '../config/db.js';

class DashboardService {
    async getDashboardStats() {
        // 1. Sales metrics
        const [[salesTodayRow]] = await pool.query(
            "SELECT COALESCE(SUM(amount), 0) AS amount FROM transactions WHERE type = 'sale' AND DATE(date) = CURDATE()"
        );
        const [[salesYesterdayRow]] = await pool.query(
            "SELECT COALESCE(SUM(amount), 0) AS amount FROM transactions WHERE type = 'sale' AND DATE(date) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)"
        );
        const [[operationsTodayRow]] = await pool.query(
            "SELECT COUNT(*) AS count FROM transactions WHERE type = 'sale' AND DATE(date) = CURDATE()"
        );

        let salesToday = Number(salesTodayRow?.amount || 0);
        let salesYesterday = Number(salesYesterdayRow?.amount || 0);
        let todayOperations = Number(operationsTodayRow?.count || 0);

        // Fallback to orders if there are no transactions (e.g. fresh database setup)
        if (salesToday === 0 && todayOperations === 0) {
            const [[ordersTodayRow]] = await pool.query(
                "SELECT COALESCE(SUM(total_amount), 0) AS amount, COUNT(*) AS count FROM orders WHERE status != 'cancelled' AND DATE(created_at) = CURDATE() AND deleted_at IS NULL"
            );
            salesToday = Number(ordersTodayRow?.amount || 0);
            todayOperations = Number(ordersTodayRow?.count || 0);

            const [[ordersYesterdayRow]] = await pool.query(
                "SELECT COALESCE(SUM(total_amount), 0) AS amount FROM orders WHERE status != 'cancelled' AND DATE(created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY) AND deleted_at IS NULL"
            );
            salesYesterday = Number(ordersYesterdayRow?.amount || 0);
        }

        // 2. Pending orders count (depósito)
        const [[pendingOrdersRow]] = await pool.query(
            "SELECT COUNT(*) AS count FROM orders WHERE status IN ('pending', 'picking', 'packed') AND deleted_at IS NULL"
        );
        const pendingOrders = Number(pendingOrdersRow?.count || 0);

        // 3. Ready to dispatch (empaquetado)
        const [[readyToDispatchRow]] = await pool.query(
            "SELECT COUNT(*) AS count FROM orders WHERE status = 'packed' AND deleted_at IS NULL"
        );
        const readyToDispatch = Number(readyToDispatchRow?.count || 0);

        // 4. Low stock alert
        const [[lowStockRow]] = await pool.query(
            "SELECT COUNT(DISTINCT product_id) AS count FROM inventory WHERE min_stock_level > 0 AND quantity <= min_stock_level"
        );
        const lowStockCount = Number(lowStockRow?.count || 0);

        // 5. Completion rate (Rendimiento)
        const [[completionRow]] = await pool.query(`
            SELECT 
                COUNT(*) AS total,
                SUM(CASE WHEN status IN ('delivered', 'completed') THEN 1 ELSE 0 END) AS closed
            FROM orders
            WHERE status != 'cancelled' AND deleted_at IS NULL
        `);
        const totalActionable = Number(completionRow?.total || 0);
        const closedOrdersCount = Number(completionRow?.closed || 0);
        const completionRate = totalActionable > 0 ? Math.round((closedOrdersCount / totalActionable) * 100) : 0;

        // 6. 7-Day sales history
        const historyMap = new Map();
        const [txHistory] = await pool.query(`
            SELECT DATE(date) AS day, COALESCE(SUM(amount), 0) AS total
            FROM transactions
            WHERE type = 'sale' AND date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
            GROUP BY DATE(date)
        `);

        let historyRows = txHistory;
        const totalTxSales = historyRows.reduce((sum, r) => sum + Number(r.total || 0), 0);

        if (totalTxSales === 0) {
            const [orderHistory] = await pool.query(`
                SELECT DATE(created_at) AS day, COALESCE(SUM(total_amount), 0) AS total
                FROM orders
                WHERE status != 'cancelled' AND created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) AND deleted_at IS NULL
                GROUP BY DATE(created_at)
            `);
            historyRows = orderHistory;
        }

        const formatDateKey = (d) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        };

        for (const row of historyRows) {
            if (!row.day) continue;
            const key = row.day instanceof Date ? formatDateKey(row.day) : String(row.day).split('T')[0];
            historyMap.set(key, Number(row.total || 0));
        }

        const dailySalesHistory = [];
        const today = new Date();
        for (let i = 6; i >= 0; i--) {
            const current = new Date(today);
            current.setDate(today.getDate() - i);
            const key = formatDateKey(current);
            const label = current.toLocaleDateString("es-AR", { weekday: "short" });
            dailySalesHistory.push({
                label,
                amount: historyMap.get(key) || 0
            });
        }

        // 7. Recent activities
        const [recentTx] = await pool.query(`
            SELECT id, type, amount, description, date
            FROM transactions
            ORDER BY date DESC
            LIMIT 5
        `);

        let activities = [];
        if (recentTx.length > 0) {
            activities = recentTx.map(row => ({
                id: row.id,
                title: row.description || "Venta registrada",
                date: row.date,
                amount: Number(row.amount || 0),
                positive: row.type !== "refund" && row.type !== "expense"
            }));
        } else {
            const [recentOrders] = await pool.query(`
                SELECT id, status, total_amount, created_at
                FROM orders
                WHERE deleted_at IS NULL
                ORDER BY created_at DESC
                LIMIT 5
            `);
            activities = recentOrders.map(row => ({
                id: row.id,
                title: `Pedido #${row.id.slice(0, 8).toUpperCase()}`,
                status: row.status,
                date: row.created_at,
                amount: Number(row.total_amount || 0),
                positive: row.status !== "cancelled"
            }));
        }

        // 8. WMS Picking Leaderboard
        const [pickerLeaderboard] = await pool.query(`
            SELECT 
                u.name AS picker_name,
                COUNT(ps.id) AS sessions_count,
                COALESCE(SUM(ps.total_items_picked), 0) AS total_picked,
                COALESCE(ROUND(AVG(TIMESTAMPDIFF(SECOND, ps.started_at, ps.completed_at))), 0) AS avg_duration_sec,
                COALESCE((
                    SELECT COUNT(*) 
                    FROM picking_session_events pse 
                    JOIN picking_sessions ps2 ON pse.session_id = ps2.id 
                    WHERE ps2.picker_id = u.id AND pse.action_type = 'shortage_closed'
                ), 0) AS shortage_count
            FROM users u
            JOIN picking_sessions ps ON ps.picker_id = u.id
            WHERE ps.status = 'completed'
            GROUP BY u.id, u.name
            ORDER BY total_picked DESC, sessions_count DESC
            LIMIT 5
        `);

        return {
            salesToday,
            salesYesterday,
            todayOperations,
            pendingOrders,
            readyToDispatch,
            lowStockCount,
            totalActionable,
            closedOrdersCount,
            completionRate,
            dailySalesHistory,
            activities,
            pickerLeaderboard
        };
    }
}

export default new DashboardService();
