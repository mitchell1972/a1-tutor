// src/services/QuestionService.js
// Orchestrates: daily question generation per subject, answer processing, and feedback.
import { allocatePerSubject, pickWithDifficultyMix, shuffleArray } from '../domain/QuestionAllocator.js';
import { calculateDailyStats, calculateStreak, identifyWeakAreas } from '../domain/StreakTracker.js';
import { DIFFICULTY_MIX, SUBJECTS, QUESTIONS_PER_SUBJECT, formatTopic } from '../config/subjects.js';

export class QuestionService {
  constructor({ repo }) {
    this.repo = repo;
  }

  // ─── Daily Set Generation ──────────────────────────

  /**
   * Generate today's question set for a user.
   * Returns 10 questions per subject, filtered by exam type.
   * Guarantees zero duplicate questions ever.
   */
  generateDailySet(user) {
    const subjects = user.subjects || [];
    if (subjects.length === 0) throw new Error('No subjects selected');

    const questionsPerSubject = user.questions_per_subject || QUESTIONS_PER_SUBJECT;
    const examType = user.exam_type || null;

    // Get ALL question IDs ever sent to this user — permanent exclusion
    const allTimeIds = this.repo.getAllDispatchedIds(user.id);
    const todayDispatched = this.repo.getTodayDispatches(user.id);
    const todayIds = todayDispatched.flatMap(d => d.question_ids || []);

    // Exclude all-time + today (belt and suspenders)
    const excludeIds = [...new Set([...allTimeIds, ...todayIds])];

    const allocation = allocatePerSubject(subjects, questionsPerSubject);
    const dailySet = [];
    const usedIds = new Set();

    for (const { subject, count } of allocation) {
      // Fetch more than needed so difficulty mix has room to work
      const pool = this.repo.getQuestionsBySubject(subject, count * 4, {
        excludeIds: [...excludeIds, ...usedIds],
        exam: examType, // JAMB students get JAMB questions, SSCE get SSCE
      });

      const picked = pickWithDifficultyMix(pool, count, DIFFICULTY_MIX);
      for (const q of picked) {
        dailySet.push(q);
        usedIds.add(q.id);
      }

      if (picked.length < count) {
        console.warn(`QuestionService: only ${picked.length}/${count} available for ${subject} (user ${user.id}, exam ${examType})`);
      }
    }

    // Shuffle within subjects but keep subject groups together for better UX
    // Actually, interleave subjects so student sees variety
    const interleaved = interleaveBySubject(dailySet, subjects);

    // Mark questions as used
    for (const q of interleaved) this.repo.markQuestionUsed(q.id);
    this.repo.logDispatch(user.id, interleaved.map(q => q.id));

    return interleaved;
  }

  /**
   * Check if user has already been dispatched questions today.
   */
  isAlreadyDispatchedToday(userId) {
    return this.repo.getTodayDispatches(userId).length > 0;
  }

  /**
   * Get the total count of questions dispatched today for a user.
   */
  getTotalDispatchedToday(userId) {
    const dispatches = this.repo.getTodayDispatches(userId);
    return dispatches.reduce((sum, d) => sum + (d.question_ids?.length || 0), 0);
  }

  // ─── Answer Processing ─────────────────────────────

  processAnswer(userId, questionId, chosenAnswer) {
    const question = this.repo.getQuestion(questionId);
    if (!question) return { error: 'question_not_found' };

    const correct = chosenAnswer.toUpperCase() === question.answer.toUpperCase();

    this.repo.recordResponse({
      user_id: userId,
      question_id: questionId,
      chosen_answer: chosenAnswer,
      correct,
    });

    return {
      correct,
      chosenAnswer,
      correctAnswer: question.answer,
      explanation: question.explanation || '',
      question,
    };
  }

  // ─── Formatting ────────────────────────────────────

  formatQuestion(question, index, total) {
    const subject = SUBJECTS[question.subject] || {};
    const difficulty = question.difficulty === 3 ? ' 🔥' : question.difficulty === 1 ? ' 💡' : '';

    return {
      header: `Q${index + 1}/${total} | ${subject.icon || '📝'} ${subject.name || question.subject} | ${formatTopic(question.topic)}${difficulty}`,
      body: question.text,
      options: question.options || {},
    };
  }

  formatFeedback(result) {
    const emoji = result.correct ? '✅' : '❌';
    let msg = result.correct
      ? `${emoji} Correct!`
      : `${emoji} Wrong. The answer is ${result.correctAnswer}.`;

    if (result.explanation) msg += `\n\n💡 ${result.explanation}`;
    return msg;
  }

  formatDailyReport(userId, responses) {
    const total = responses.length;
    const correct = responses.filter(r => r.correct).length;
    const score = total ? Math.round((correct / total) * 100) : 0;

    const answerDates = this.repo.getAllUserResponseDates(userId);
    const streak = calculateStreak(answerDates);
    const weakAreas = identifyWeakAreas(responses, (id) => this.repo.getQuestion(id));

    let report = `🏁 *Daily Report*\n━━━━━━━━━━━━━━━\n`;
    report += `📊 Score: ${correct}/${total} (${score}%)\n`;
    report += `🔥 Streak: ${streak} day${streak !== 1 ? 's' : ''}\n`;

    if (score >= 80) report += `\n🌟 Excellent work!\n`;
    else if (score >= 60) report += `\n👍 Good effort. Push for 80%+ tomorrow.\n`;
    else report += `\n📚 Review your weak areas and try again.\n`;

    if (weakAreas.length > 0) {
      report += `\n🎯 *Areas to improve:*\n`;
      for (const area of weakAreas) {
        report += `  • ${formatTopic(area.topic)} (${SUBJECTS[area.subject]?.name || area.subject}: ${area.accuracy}%)\n`;
      }
    }

    return report;
  }

  getCumulativeProgress(userId, totalDispatchedToday) {
    const today = new Date().toISOString().split('T')[0];
    const start = new Date(today);
    start.setHours(0, 0, 0, 0);

    const todayResponses = this.repo.getResponses(userId, {
      since: start.toISOString(),
    });

    return {
      answered: todayResponses.length,
      correct: todayResponses.filter(r => r.correct).length,
      total: totalDispatchedToday,
      isComplete: todayResponses.length >= totalDispatchedToday,
    };
  }
}

// ─── Helpers ─────────────────────────────────────────

/**
 * Interleave questions from different subjects so the student
 * sees variety rather than 10 English then 10 Physics then 10 Chemistry.
 */
function interleaveBySubject(questions, subjectOrder) {
  const bySubject = new Map();
  for (const q of questions) {
    if (!bySubject.has(q.subject)) bySubject.set(q.subject, []);
    bySubject.get(q.subject).push(q);
  }

  const result = [];
  let added = true;
  while (added) {
    added = false;
    for (const subject of subjectOrder) {
      const group = bySubject.get(subject);
      if (group && group.length > 0) {
        result.push(group.shift());
        added = true;
      }
    }
  }

  return result;
}
