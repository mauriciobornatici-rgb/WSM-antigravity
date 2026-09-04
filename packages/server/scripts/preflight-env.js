#!/usr/bin/env node

/**
 * Preflight Environment Configuration Validator
 *
 * Validates environment variables for development, staging, or production
 * against schema constraints (JWT length, DB_SSL, CORS, encryption keys, URLs).
 *
 * Usage:
 *   node scripts/preflight-env.js
 *   node scripts/preflight-env.js --target=staging
 *   node scripts/preflight-env.js --target=production
 *   node scripts/preflight-env.js --file=.env.production
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { buildEnvConfig } from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repositoryRoot = path.resolve(__dirname, '../../..');

function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        target: null,
        file: null
    };

    for (const arg of args) {
        if (arg.startsWith('--target=')) {
            options.target = arg.split('=')[1].trim().toLowerCase();
        } else if (arg.startsWith('--file=')) {
            options.file = arg.split('=')[1].trim();
        } else if (arg === '--help' || arg === '-h') {
            console.log(`
Preflight Environment Validator — WSM SportsERP

Options:
  --target=<env>   Force validation for specific target: development | staging | production
  --file=<path>    Load environment from a specific file path relative to root
  --help, -h       Display this help message
`);
            process.exit(0);
        }
    }

    return options;
}

function run() {
    const { target, file } = parseArgs();

    console.log('================================================================');
    console.log('WSM SportsERP — Preflight Environment Validator');
    console.log('================================================================');

    const envToValidate = { ...process.env };

    if (file) {
        const fullPath = path.isAbsolute(file) ? file : path.join(repositoryRoot, file);
        if (!fs.existsSync(fullPath)) {
            console.error(`[ERROR] Specified env file does not exist: ${fullPath}`);
            process.exit(1);
        }
        console.log(`[INFO] Loading custom environment file: ${path.relative(repositoryRoot, fullPath)}`);
        const parsed = dotenv.parse(fs.readFileSync(fullPath));
        Object.assign(envToValidate, parsed);
    } else {
        // Check default files in priority order
        const envFiles = target
            ? [`.env.${target}`, '.env']
            : ['.env.local', '.env'];

        for (const candidate of envFiles) {
            const candidatePath = path.join(repositoryRoot, candidate);
            if (fs.existsSync(candidatePath)) {
                console.log(`[INFO] Loading variables from: ${candidate}`);
                const parsed = dotenv.parse(fs.readFileSync(candidatePath));
                Object.assign(envToValidate, parsed);
                break;
            }
        }
    }

    if (target) {
        console.log(`[INFO] Forcing target evaluation for: ${target.toUpperCase()}`);
        envToValidate.NODE_ENV = target;
    }

    const currentEnv = envToValidate.NODE_ENV || 'development';
    console.log(`[INFO] Target Environment: ${currentEnv.toUpperCase()}`);

    const warnings = [];
    const customWarn = (msg) => warnings.push(msg);

    try {
        const config = buildEnvConfig(envToValidate, customWarn);

        console.log('\n--- Configuration Summary ---');
        console.log(`- NODE_ENV:              ${config.nodeEnv}`);
        console.log(`- PORT:                  ${config.port}`);
        console.log(`- DB_PORT:               ${config.dbPort}`);
        console.log(`- DB_SSL:                ${config.dbSsl} (rejectUnauthorized: ${config.dbSslRejectUnauthorized})`);
        console.log(`- JWT_EXPIRES_IN:        ${config.jwtExpiresIn}`);
        console.log(`- JWT_SECRET:            ${config.jwtSecret ? `[configured (${config.jwtSecret.length} chars)]` : '[missing]'}`);
        console.log(`- ENCRYPTION_KEY:        ${config.encryptionKey ? `[configured (${config.encryptionKey.length} chars)]` : '[missing]'}`);
        console.log(`- CORS_ORIGINS:          ${config.corsOrigins.length > 0 ? config.corsOrigins.join(', ') : '[none]'}`);
        console.log(`- TRUST_PROXY:           ${config.trustProxy ?? 'disabled'}`);
        console.log(`- APP_BASE_URL:          ${config.appBaseUrl || '[none]'}`);
        console.log(`- TIENDANUBE_WEBHOOK:    ${config.tiendanubeWebhookUrl || '[none]'}`);

        if (warnings.length > 0) {
            console.log('\n--- Warnings (non-blocking) ---');
            warnings.forEach((w) => console.log(`  ! ${w}`));
        }

        console.log('\n================================================================');
        console.log(`[SUCCESS] Environment configuration is VALID for ${currentEnv.toUpperCase()}`);
        console.log('================================================================');
        process.exit(0);
    } catch (err) {
        console.error('\n================================================================');
        console.error(`[FAILURE] Environment configuration is INVALID for ${currentEnv.toUpperCase()}`);
        console.error('================================================================');
        console.error(err.message);
        if (warnings.length > 0) {
            console.error('\nAdditional Warnings:');
            warnings.forEach((w) => console.error(`  ! ${w}`));
        }
        process.exit(1);
    }
}

run();
