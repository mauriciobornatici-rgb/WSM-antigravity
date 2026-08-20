import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(serverDirectory, '../../..');
const requestedEnvironment = String(process.env.NODE_ENV || 'development').trim().toLowerCase();
const explicitEnvFile = process.env.ENV_FILE?.trim();
const environmentFile = explicitEnvFile
    ? path.resolve(repositoryRoot, explicitEnvFile)
    : path.join(repositoryRoot, `.env.${requestedEnvironment}`);

if (fs.existsSync(environmentFile)) {
    dotenv.config({ path: environmentFile, quiet: true });
} else if (requestedEnvironment === 'development') {
    const legacyDevelopmentFile = path.join(repositoryRoot, '.env');
    if (fs.existsSync(legacyDevelopmentFile)) {
        console.warn('[env-warning] .env.development is missing; using legacy .env for development only');
        dotenv.config({ path: legacyDevelopmentFile, quiet: true });
    }
} else if (!explicitEnvFile) {
    console.warn(`[env-warning] ${path.basename(environmentFile)} is missing; using process environment only`);
}
