#!/usr/bin/env node
// scripts/ingest-pending.js — Run during deploy to ingest any pending JSONL files
// Reads pending/ingest_now.jsonl if it exists, inserts into DB.
// Exports the promise so the caller can await it.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const dir = path.dirname(fileURLToPath(import.meta.url));
const INGEST_FILE = path.resolve(dir, '../pending/ingest_now.jsonl');
const GENERATOR = path.resolve(dir, 'generate-questions.js');

export default async function ingestPending() {
  if (!fs.existsSync(INGEST_FILE)) {
    console.log('📥 No pending ingest file — skipping.');
    return { ingested: 0 };
  }

  const stat = fs.statSync(INGEST_FILE);
  const lines = fs.readFileSync(INGEST_FILE, 'utf8').split('\n').filter(Boolean);
  console.log(`📥 Pending ingest: ${lines.length} questions (${stat.size} bytes)`);

  const args = [GENERATOR, '--ingest', INGEST_FILE, '--no-validate'];
  const env = { ...process.env };

  return new Promise((resolve, reject) => {
    const child = spawn('node', args, { env, stdio: 'inherit' });
    child.on('close', (code) => {
      if (code === 0) {
        console.log('📥 Ingest complete — removing ingest file');
        try { fs.unlinkSync(INGEST_FILE); } catch {}
        resolve({ ingested: lines.length });
      } else {
        console.error(`📥 Ingest failed with exit code ${code}`);
        reject(new Error(`Exit ${code}`));
      }
    });
    child.on('error', (err) => {
      console.error(`📥 Ingest spawn error: ${err.message}`);
      reject(err);
    });
  });
}
