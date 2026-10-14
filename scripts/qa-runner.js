#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
    assertIsolatedTestEnvironment,
    assertQaDatabaseEnvironment,
    buildIsolatedTestEnvironment,
    buildQaEnvironment,
} from './qa-env.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const serverDirectory = path.join(repositoryRoot, 'packages', 'server');

const COMMANDS = Object.freeze({
    unit: {
        cwd: serverDirectory,
        args: ['--test'],
        environment: 'isolated',
        description: 'backend unit tests with DB port 1 and no inherited project secrets',
    },
    coverage: {
        cwd: serverDirectory,
        args: [
            '--experimental-test-coverage',
            '--test-coverage-lines=90',
            '--test-coverage-branches=90',
            '--test-coverage-functions=90',
            '--test',
        ],
        environment: 'isolated',
        description: 'backend coverage with the existing 90% line/branch/function gates',
    },
    integration: {
        cwd: serverDirectory,
        // Serial: the suites share one database and assert on real locks and constraints.
        args: ['--test', '--test-concurrency=1', 'integration/**/*.integration.js'],
        environment: 'qa',
        description: 'real-MySQL integration tests (locks, constraints, concurrency) against the loopback QA database',
    },
    rbac: {
        cwd: serverDirectory,
        args: ['scripts/rbac-validation-smoke.js'],
        environment: 'qa',
        description: 'RBAC smoke against the dedicated loopback QA database',
    },
    integrity: {
        cwd: serverDirectory,
        args: ['scripts/integrity-validation-smoke.js'],
        environment: 'qa',
        description: 'referential/integrity smoke against the dedicated loopback QA database',
    },
    preflight: {
        cwd: serverDirectory,
        args: ['scripts/preflight-referential-integrity.js'],
        environment: 'qa',
        description: 'referential preflight against the dedicated loopback QA database',
    },
});

export function commandFor(mode) {
    const command = COMMANDS[mode];
    if (!command) {
        throw new Error(`Unknown QA command '${mode}'. Expected one of: ${Object.keys(COMMANDS).join(', ')}`);
    }
    return command;
}

export function executeQaCommand(mode, sourceEnvironment = process.env, only = null) {
    const command = commandFor(mode);
    // `integration <file>` runs a single suite (only files inside integration/).
    const args = mode === 'integration' && only
        ? (() => {
            if (!/^integration[\\/][\w.-]+\.integration\.js$/.test(only)) throw new Error('Solo se admite un archivo de integration/*.integration.js');
            return ['--test', '--test-concurrency=1', only];
        })()
        : command.args;
    const environment = command.environment === 'isolated'
        ? buildIsolatedTestEnvironment(sourceEnvironment)
        : buildQaEnvironment(sourceEnvironment);

    // Validate before spawning the child. The child may then import app/db code
    // knowing that its complete configuration is fixed to the safe target.
    if (command.environment === 'isolated') {
        assertIsolatedTestEnvironment(environment);
    } else {
        assertQaDatabaseEnvironment(environment);
    }

    console.log(`[QA] ${command.description}`);
    const result = spawnSync(process.execPath, args, {
        cwd: command.cwd,
        env: environment,
        stdio: 'inherit',
        windowsHide: true,
    });

    if (result.error) throw result.error;
    return result.status ?? 1;
}

function printUsage() {
    console.log('Usage: node scripts/qa-runner.js <unit|coverage|rbac|integrity|preflight>');
    for (const [name, command] of Object.entries(COMMANDS)) {
        console.log(`  ${name.padEnd(10)} ${command.description}`);
    }
}

const isDirectRun = Boolean(process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]));
if (isDirectRun) {
    const mode = process.argv[2];
    if (!mode || mode === '--help' || mode === '-h') {
        printUsage();
        process.exitCode = mode ? 0 : 2;
    } else {
        try {
            process.exitCode = executeQaCommand(mode, process.env, process.argv[3] || null);
        } catch (error) {
            console.error(`[QA] ${error.message}`);
            process.exitCode = 1;
        }
    }
}
