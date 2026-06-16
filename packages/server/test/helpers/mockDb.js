import pool from '../../config/db.js';

export function createMockConnection(queryMock) {
    return {
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
        query: queryMock
    };
}

export function mockPool(t, queryMock) {
    const originalQuery = pool.query;
    const originalGetConnection = pool.getConnection;

    const mockConn = createMockConnection(queryMock);

    pool.query = queryMock;
    pool.getConnection = async () => mockConn;

    t.after(() => {
        pool.query = originalQuery;
        pool.getConnection = originalGetConnection;
    });

    return mockConn;
}
