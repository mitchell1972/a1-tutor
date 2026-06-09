// src/infrastructure/generation/dailyGenerator.js
// Runs the proven question generator (scripts/generate-questions.js) as a child process on a
// daily schedule. Predict mode = examiner-weighted from real past-question frequency, with a
// full-syllabus coverage floor. Volume is set by --per-topic; --max is a hard backstop.
//
// Reuses the CLI script verbatim (it self-executes on run), so generation logic lives in ONE
// place. Requires DEEPSEEK_API_KEY (or AI_API_KEY) + DATABASE_URL in the process env.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../scripts/generate-questions.js'
);

function runGenerator(exam, { perTopic, max, mode, year }) {
  return new Promise((resolve) => {
    const args = [SCRIPT, '--mode', mode, '--exams', exam, '--per-topic', String(perTopic), '--max', String(max)];
    if (year) args.push('--year', String(year));
    let out = '';
    let child;
    try {
      child = spawn('node', args, { env: process.env });
    } catch (err) {
      return resolve(`${exam}: spawn failed — ${err.message}`);
    }
    child.stdout?.on('data', (d) => { out += d.toString(); });
    child.stderr?.on('data', (d) => { out += d.toString(); });
    child.on('error', (err) => resolve(`${exam}: error — ${err.message}`));
    child.on('close', (code) => {
      const m = out.match(/📊[^\n]*/);          // the generator's summary line
      resolve(`${exam}: ${m ? m[0] : `finished (exit ${code})`}`);
    });
  });
}

// Generate for JAMB then WAEC/SSCE sequentially (gentle on DB + DeepSeek rate limits).
export async function runDailyGeneration({ perTopic = 4, maxPerExam = 700, mode = 'predict', year } = {}) {
  const yr = year || new Date().getFullYear();
  console.log(`🧠 Daily generation starting — jamb + ssce, mode=${mode}, per-topic=${perTopic}, max/exam=${maxPerExam}, year=${yr}`);
  const jamb = await runGenerator('jamb', { perTopic, max: maxPerExam, mode, year: yr });
  console.log('   ' + jamb);
  const ssce = await runGenerator('ssce', { perTopic, max: maxPerExam, mode, year: yr });
  console.log('   ' + ssce);
  console.log('🧠 Daily generation complete.');
  return { jamb, ssce };
}
