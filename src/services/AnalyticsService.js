// src/services/AnalyticsService.js
// Orchestrates statistics, reports, and leaderboards.
import { calculateStreak, calculateDailyStats, identifyWeakAreas } from '../domain/StreakTracker.js';
import { SUBJECTS } from '../config/subjects.js';

export class AnalyticsService {
  constructor({ repo }) {
    this.repo = repo;
  }

  getUserAnalytics(userId) {
    const user = this.repo.getUser(userId);
    if (!user) return null;

    const answerDates = this.repo.getAllUserResponseDates(userId);
    const streak = calculateStreak(answerDates);

    const today = new Date().toISOString().split('T')[0];
    const todayResponses = this.repo.getResponsesByDate(userId, today);
    const todayStats = calculateDailyStats(todayResponses, (id) => this.repo.getQuestion(id));

    const allResponses = this.repo.getResponses(userId, { limit: 10000 });
    const weakAreas = identifyWeakAreas(allResponses, (id) => this.repo.getQuestion(id));

    // 7-day trend
    const trend = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayResponses = this.repo.getResponsesByDate(userId, dateStr);
      const stats = calculateDailyStats(dayResponses, (id) => this.repo.getQuestion(id));
      trend.push({
        date: dateStr,
        day: d.toLocaleDateString('en-GB', { weekday: 'short' }),
        total: stats.total,
        correct: stats.correct,
        score: stats.score,
      });
    }

    // Overall
    const totalCorrect = allResponses.filter(r => r.correct).length;
    const overallAccuracy = allResponses.length
      ? Math.round((totalCorrect / allResponses.length) * 100)
      : 0;

    // Subject breakdown
    const bySubject = {};
    for (const r of allResponses) {
      const q = this.repo.getQuestion(r.question_id);
      if (!q) continue;
      if (!bySubject[q.subject]) bySubject[q.subject] = { total: 0, correct: 0 };
      bySubject[q.subject].total++;
      if (r.correct) bySubject[q.subject].correct++;
    }

    for (const [key, data] of Object.entries(bySubject)) {
      data.name = SUBJECTS[key]?.name || key;
      data.accuracy = data.total ? Math.round((data.correct / data.total) * 100) : 0;
    }

    return {
      streak,
      today: todayStats,
      overall: { totalAnswered: allResponses.length, totalCorrect, accuracy: overallAccuracy },
      trend,
      bySubject,
      weakAreas,
    };
  }

  getLeaderboard(type = 'streak', limit = 10) {
    const users = this.repo.all('users')
      .filter(u => u.subscription_status === 'active' || u.subscription_status === 'trial');

    const rankings = users.map(user => {
      if (type === 'streak') {
        return {
          userId: user.id,
          name: user.name || 'Scholar',
          score: calculateStreak(this.repo.getAllUserResponseDates(user.id)),
        };
      }
      // accuracy over last 7 days
      let total = 0, correct = 0;
      for (let i = 0; i < 7; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        const responses = this.repo.getResponsesByDate(user.id, dateStr);
        total += responses.length;
        correct += responses.filter(r => r.correct).length;
      }
      return {
        userId: user.id,
        name: user.name || 'Scholar',
        score: total >= 10 ? Math.round((correct / total) * 100) : 0,
      };
    });

    return rankings.filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  }

  getAdminStats() {
    const users = this.repo.all('users');
    const active = users.filter(u => u.subscription_status === 'active').length;
    const trial = users.filter(u => u.subscription_status === 'trial').length;
    const expired = users.filter(u => u.subscription_status === 'expired').length;

    const byExam = {};
    const bySubject = {};
    const byChannel = {};

    for (const u of users) {
      byExam[u.exam_type] = (byExam[u.exam_type] || 0) + 1;
      for (const s of (u.subjects || [])) bySubject[s] = (bySubject[s] || 0) + 1;
      byChannel[u.channel || 'unknown'] = (byChannel[u.channel || 'unknown'] || 0) + 1;
    }

    return {
      users: { total: users.length, active, trial, expired },
      revenue: { total: this.repo.getTotalRevenue(), currency: 'NGN' },
      questions: { total: this.repo.getTotalQuestions() },
      byExam,
      bySubject: Object.entries(bySubject).sort((a, b) => b[1] - a[1])
        .map(([id, count]) => ({ name: SUBJECTS[id]?.name || id, count })),
      byChannel,
    };
  }
}
