import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(serverDirectory, '../../..');

export function loadEnvironment({
    environment = process.env,
    rootDirectory = repositoryRoot,
    exists = fs.existsSync,
    load = (file) => dotenv.config({ path: file, quiet: true }),
    warn = console.warn,
} = {}) {
    const requestedEnvironment = String(environment.NODE_ENV || 'development').trim().toLowerCase();
    const explicitEnvFile = environment.ENV_FILE?.trim();
    const environmentFile = explicitEnvFile
        ? path.resolve(rootDirectory, explicitEnvFile)
        : path.join(rootDirectory, `.env.${requestedEnvironment}`);

    if (exists(environmentFile)) {
        load(environmentFile);
        return environmentFile;
    }

    if (explicitEnvFile) {
        throw new Error(`Explicit ENV_FILE does not exist: ${environmentFile}`);
    }

    if (requestedEnvironment === 'development') {
        const legacyDevelopmentFile = path.join(rootDirectory, '.env');
        if (exists(legacyDevelopmentFile)) {
            warn('[env-warning] .env.development is missing; using legacy .env for development only');
            load(legacyDevelopmentFile);
            return legacyDevelopmentFile;
        }
    } else {
        warn(`[env-warning] ${path.basename(environmentFile)} is missing; using process environment only`);
    }

    return null;
}

loadEnvironment();
