import http from 'node:http';
import { assertQaDatabaseEnvironment, qaModeEnabled } from '../../../scripts/qa-env.js';

/**
 * Ensures a live backend server is available for smoke tests.
 * If the configured target URL is reachable, uses it directly.
 * Otherwise, spins up an ephemeral HTTP server on an available port.
 *
 * @param {string} targetUrl - Default URL to probe (e.g. http://localhost:3001)
 * @returns {Promise<{ baseUrl: string, cleanup: () => Promise<void> }>}
 */
export async function ensureSmokeServer(targetUrl, { application, environment = process.env } = {}) {
    // A QA run is only allowed to create its own local server. In particular,
    // never probe or reuse SMOKE_API_URL/localhost:3001 when the QA flag is set.
    const qaMode = qaModeEnabled(environment);
    if (qaMode) {
        assertQaDatabaseEnvironment(environment);
    } else {
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
    }

    const smokeApp = application ?? (await import('../index.js')).app;
    const server = http.createServer(smokeApp);
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
