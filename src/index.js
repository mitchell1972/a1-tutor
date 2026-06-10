// src/index.js — Composition Root
// Boots the entire application. Wires layers, starts servers, begins scheduling.
import 'dotenv/config';
import { buildContainer } from './config/container.js';

const PORT = parseInt(process.env.PORT || '3456');

async function main() {
  console.log('🎓 ExamPrep Agent — Starting up (Layered Architecture)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // 1. Build the DI container — all layers wired
  const container = await buildContainer(process.env);

  // 2. Start the HTTP server FIRST so the platform health check (/health)
  //    passes immediately — independent of how long seeding takes on a fresh,
  //    volume-backed data directory. (A slow seed before this used to push the
  //    first response past the healthcheck window and fail the deploy.)
  await container.httpServer.start(PORT);

  // 3. Auto-seed the question bank if empty (e.g. first boot on a new volume).
  //    Wrapped so a seeding hiccup can never take the whole service down.
  try {
    let questionCount = await container.repo.getTotalQuestions();
    console.log(`📦 Questions in bank: ${questionCount}`);

    // 3a. Ingest pending scraped questions if any
    try {
      const { execSync } = await import('node:child_process');
      const ingestFile = new URL('../../pending/ingest_now.jsonl', import.meta.url).pathname;
      const { existsSync } = await import('node:fs');
      if (existsSync(ingestFile)) {
        console.log('📥 Pending ingest file found — processing...');
        const generateScript = new URL('../../scripts/generate-questions.js', import.meta.url).pathname;
        execSync(`node ${generateScript} --ingest ${ingestFile} --no-validate`, {
          env: process.env,
          stdio: 'inherit',
          timeout: 300000, // 5 minutes
        });
        const { unlinkSync } = await import('node:fs');
        unlinkSync(ingestFile);
        questionCount = await container.repo.getTotalQuestions();
        console.log(`📦 Questions after ingest: ${questionCount}`);
      } else {
        console.log('📥 No pending ingest file.');
      }
    } catch (e) {
      console.error('⚠️  Pending ingest failed:', e.message || e);
    }

    if (questionCount === 0) {
      console.log('🫙 Empty bank — seeding questions...');
      const { seed } = await import('../scripts/seed-questions.js');
      questionCount = await seed(container.repo);
      console.log(`🌱 Seeded ${questionCount} questions`);
    } else if (questionCount < 100) {
      console.warn('⚠️  Less than 100 questions. Run `npm run seed` to populate.');
    }
  } catch (err) {
    console.error('⚠️  Seeding failed (service still running):', err);
  }

  // 4. Start daily dispatch scheduler
  container.scheduler.start();

  // 5. Telegram: register the webhook (production) or rely on polling (local dev).
  if (container.telegramChannel.mode() === 'webhook') {
    await container.telegramChannel.setupWebhook();
    console.log('🤖 Telegram bot: webhook mode');
  } else {
    console.log('🤖 Telegram bot: polling mode');
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ ExamPrep Agent is live!');
  console.log('   Telegram: /start to register');
  console.log(`   Health:   http://localhost:${PORT}/health`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

// Graceful shutdown
['SIGINT', 'SIGTERM'].forEach(signal => {
  process.on(signal, () => {
    console.log('\n🛑 Shutting down...');
    process.exit(0);
  });
});

main().catch(err => {
  console.error('❌ Failed to start:', err);
  process.exit(1);
});
