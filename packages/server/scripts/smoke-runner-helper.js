import http from 'node:http';
import { app } from '../index.js';

/**
 * Ensures a live backend server is available for smoke tests.
 * If the configured target URL is reachable, uses it directly.
 * Otherwise, spins up an ephemeral HTTP server on an available port.
 *
 * @param {string} targetUrl - Default URL to probe (e.g. http://localhost:3001)
 * @returns {Promise<{ baseUrl: string, cleanup: () => Promise<void> }>}
 */
export async function ensureSmokeServer(targetUrl) {
    try {
        const probeUrl = `${targetUrl}/api/live`;
        const res = await fetch(probeUrl, {
            signal: AbortSignal.timeout(1200)
        });
        if (res.ok) {
            return {
                baseUrl: targetUrl,
                cleanup: async () => {}
            };
        }
    } catch {
        // Target server is not answering, spin up ephemeral instance
    }

    const server = http.createServer(app);
    await new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => resolve());
        server.on('error', reject);
    });

    const { port } = server.address();
    const ephemeralBaseUrl = `http://127.0.0.1:${port}`;
    console.log(`[SMOKE HELPER] Started ephemeral in-memory server on ${ephemeralBaseUrl}`);

    return {
        baseUrl: ephemeralBaseUrl,
        cleanup: async () => {
            await new Promise((resolve) => server.close(resolve));
        }
    };
}
