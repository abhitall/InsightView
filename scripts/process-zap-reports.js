#!/usr/bin/env node

// This is a simple wrapper to execute TypeScript files in ESM environments
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(__dirname, './process-zap-reports.ts');

// Run the TypeScript script using ts-node with ESM mode
const child = spawn('npx', ['ts-node', '--esm', scriptPath], {
  stdio: 'inherit',
  env: process.env
});

child.on('close', (code) => {
  process.exit(code);
});