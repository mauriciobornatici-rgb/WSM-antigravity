#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    assertQaDatabaseEnvironment,
    buildQaEnvironment,
    installCleanEnvironment,
    QA_BOOTSTRAP_FLAG,
} from './qa-env.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

/**
 * Run the existing migrations and smoke-user fixture only after the complete
 * QA target has been validated. This process deliberately imports migration and
 * DB modules only after the guard succeeds.
 */
export async function runQaBootstrap(args = process.argv.slice(2)) {
    if (!args.includes('--allow-qa-bootstrap')) {
        throw new Error(
            'QA bootstrap is disabled by default. Re-run with --allow-qa-bootstrap after starting docker-compose.test.yml.'
        );
    }

    const environment = {
        ...buildQaEnvironment(),
        [QA_BOOTSTRAP_FLAG]: '1',
    };
    installCleanEnvironment(environment);
    assertQaDatabaseEnvironment(process.env, { requireBootstrapFlag: true });

    const runStep = async (relativeModule, label) => {
        process.exitCode = undefined;
        const moduleUrl = pathToFileURL(path.resolve(scriptDirectory, '..', relativeModule)).href;
        await import(moduleUrl);
        if ((process.exitCode ?? 0) !== 0) {
            throw new Error(`${label} failed with exit code ${process.exitCode}`);
        }
    };

    await runStep('packages/server/scripts/run-migrations.js', 'QA migrations');
    await runStep('packages/server/scripts/seed-smoke-users.js', 'QA smoke-user seed');
    console.log('[QA] Bootstrap completed against 127.0.0.1:33308/wsm_qa.');
    return 0;
}

const isDirectRun = Boolean(process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]));
if (isDirectRun) {
    runQaBootstrap()
        .then((exitCode) => {
            process.exitCode = exitCode;
        })
        .catch((error) => {
            console.error(`[QA] ${error.message}`);
            process.exitCode = 1;
        });
}
