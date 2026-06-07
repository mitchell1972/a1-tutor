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
    let questionCount = container.repo.getTotalQuestions();
    console.log(`📦 Questions in bank: ${questionCount}`);

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

  // 5. Telegram bot is already polling (started by TelegramChannel constructor)
  console.log('🤖 Telegram bot polling');

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
