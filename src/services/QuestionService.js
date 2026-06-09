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
  async generateDailySet(user) {
    const subjects = user.subjects || [];
    if (subjects.length === 0) throw new Error('No subjects selected');

    const questionsPerSubject = user.questions_per_subject || QUESTIONS_PER_SUBJECT;
    const examType = user.exam_type || null;

    // Get ALL question IDs ever sent to this user — permanent exclusion
    const allTimeIds = await this.repo.getAllDispatchedIds(user.id);
    const todayDispatched = await this.repo.getTodayDispatches(user.id);
    const todayIds = todayDispatched.flatMap(d => d.question_ids || []);

    // Exclude all-time + today (belt and suspenders)
    const excludeIds = [...new Set([...allTimeIds, ...todayIds])];

    const allocation = allocatePerSubject(subjects, questionsPerSubject);
    const dailySet = [];
    const usedIds = new Set();

    for (const { subject, count } of allocation) {
      // Fetch more than needed so difficulty mix has room to work
      const pool = await this.repo.getQuestionsBySubject(subject, count * 4, {
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
    for (const q of interleaved) await this.repo.markQuestionUsed(q.id);
    await this.repo.logDispatch(user.id, interleaved.map(q => q.id));

    return interleaved;
  }

  /**
   * Check if user has already been dispatched questions today.
   */
  async isAlreadyDispatchedToday(userId) {
    return (await this.repo.getTodayDispatches(userId)).length > 0;
  }

  /**
   * Get the total count of questions dispatched today for a user.
   */
  async getTotalDispatchedToday(userId) {
    const dispatches = await this.repo.getTodayDispatches(userId);
    return dispatches.reduce((sum, d) => sum + (d.question_ids?.length || 0), 0);
  }

  /**
   * Ordered list of question IDs dispatched to the user today. Drives
   * send-on-answer: question N+1 is sent only after question N is answered.
   */
  async getTodayQuestionIds(userId) {
    const dispatches = await this.repo.getTodayDispatches(userId);
    return dispatches.flatMap(d => d.question_ids || []);
  }

  /**
   * Given the question just answered, return the next one to send (or null if
   * that was the last). Looks up the day's order from the dispatch log.
   */
  async getNextQuestion(userId, answeredQuestionId) {
    const orderedIds = await this.getTodayQuestionIds(userId);
    const idx = orderedIds.indexOf(answeredQuestionId);
    if (idx === -1 || idx + 1 >= orderedIds.length) {
      return { question: null, index: idx, total: orderedIds.length };
    }
    const question = await this.repo.getQuestion(orderedIds[idx + 1]);
    return { question, index: idx + 1, total: orderedIds.length };
  }

  // ─── Answer Processing ─────────────────────────────

  async processAnswer(userId, questionId, chosenAnswer) {
    const question = await this.repo.getQuestion(questionId);
    if (!question) return { error: 'question_not_found' };

    const correct = chosenAnswer.toUpperCase() === question.answer.toUpperCase();

    await this.repo.recordResponse({
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
    let msg = result.correct
      ? `✅ Correct — nice work!`
      : `❌ Not quite — the right answer is ${result.correctAnswer}. No stress, let's understand it:`;

    // The explanation is the teaching moment — always show it, even when correct (it reinforces).
    if (result.explanation) msg += `\n\n💡 ${result.explanation}`;
    else if (!result.correct) msg += `\n\n💡 Revisit this topic and you'll have it next time.`;
    return msg;
  }

  async formatDailyReport(userId, responses) {
    const total = responses.length;
    const correct = responses.filter(r => r.correct).length;
    const score = total ? Math.round((correct / total) * 100) : 0;

    const answerDates = await this.repo.getAllUserResponseDates(userId);
    const streak = calculateStreak(answerDates);
    // Batch-fetch the questions these responses touched, then pass a sync lookup
    // to the (synchronous) domain function — one query instead of N.
    const qMap = await this._questionMap(responses);
    const weakAreas = identifyWeakAreas(responses, (id) => qMap.get(id));

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

  async getCumulativeProgress(userId, totalDispatchedToday) {
    const today = new Date().toISOString().split('T')[0];
    const start = new Date(today);
    start.setHours(0, 0, 0, 0);

    const todayResponses = await this.repo.getResponses(userId, {
      since: start.toISOString(),
    });

    return {
      answered: todayResponses.length,
      correct: todayResponses.filter(r => r.correct).length,
      total: totalDispatchedToday,
      isComplete: todayResponses.length >= totalDispatchedToday,
    };
  }

  // Batch-fetch the questions referenced by a set of responses into a Map.
  async _questionMap(responses) {
    const ids = [...new Set(responses.map(r => r.question_id))];
    const questions = await this.repo.getQuestionsByIds(ids);
    return new Map(questions.map(q => [q.id, q]));
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
