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

  // 2. Check question bank — auto-seed on fresh deploy
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

  // 3. Start HTTP server (Flutterwave + WhatsApp webhooks)
  await container.httpServer.start(PORT);

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
