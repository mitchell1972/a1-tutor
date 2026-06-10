#!/usr/bin/env node
// scripts/ingest-pending.js — Run during deploy to ingest any pending JSONL files
// Reads data/ingest_now.jsonl if it exists, runs two-stage validation, inserts into DB.
// Deletes the file on success so it's not re-ingested on next deploy.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const dir = path.dirname(fileURLToPath(import.meta.url));
const INGEST_FILE = path.resolve(dir, '../data/ingest_now.jsonl');
const GENERATOR = path.resolve(dir, 'generate-questions.js');

async function main() {
  if (!fs.existsSync(INGEST_FILE)) {
    console.log('📥 No pending ingest file — skipping.');
    return;
  }

  const stat = fs.statSync(INGEST_FILE);
  console.log(`📥 Pending ingest file found: ${stat.size} bytes`);

  const args = [GENERATOR, '--ingest', INGEST_FILE];
  const env = { ...process.env };

  return new Promise((resolve, reject) => {
    const child = spawn('node', args, { env, stdio: 'inherit' });
    child.on('close', (code) => {
      if (code === 0) {
        console.log('📥 Ingest complete — removing ingest file');
        fs.unlinkSync(INGEST_FILE);
        resolve();
      } else {
        console.error(`📥 Ingest failed with exit code ${code}`);
        reject(new Error(`Exit ${code}`));
      }
    });
  });
}

main().catch((err) => {
  console.error('📥 Ingest hook failed:', err.message);
  // Don't crash the service for a failed ingest
});
