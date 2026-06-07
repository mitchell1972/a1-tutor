// src/infrastructure/repositories/helpers.js
// Pure, storage-agnostic helpers shared by every repository implementation.
// No I/O, no side effects.

export function genId(prefix) {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${ts}_${rand}`;
}

export function normalizePhone(phone) {
  let cleaned = String(phone).replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+234')) cleaned = cleaned.slice(1);
  if (cleaned.startsWith('234') && cleaned.length === 13) return cleaned;
  if (cleaned.startsWith('0') && cleaned.length === 11) return `234${cleaned.slice(1)}`;
  return cleaned;
}

export function nowISO() { return new Date().toISOString(); }

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}
