import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { db } from './db';

const TOKEN_SIGNING_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim().length >= 16
    ? process.env.SESSION_SECRET.trim()
    : crypto.randomBytes(32).toString('hex');

const TEACHER_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

export function getEnvTeacherPasscode(): string | null {
  const raw = process.env.TEACHER_PASSCODE;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'MY_TEACHER_PASSCODE') return null;
  return trimmed;
}

export function getStoredPasscodeHash(): string | null {
  const row = db
    .prepare("SELECT value FROM app_settings WHERE key = 'teacher_passcode_hash'")
    .get() as { value: string } | undefined;
  return row ? row.value : null;
}

export function hashPasscode(passcode: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(passcode, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPasscodeHash(passcode: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, originalHex] = parts;
  const derived = crypto.scryptSync(passcode, salt, 64);
  const original = Buffer.from(originalHex, 'hex');
  if (derived.length !== original.length) return false;
  return crypto.timingSafeEqual(derived, original);
}

export function verifyTeacherPasscode(passcode: string): boolean {
  const envPasscode = getEnvTeacherPasscode();
  if (envPasscode !== null) {
    const a = Buffer.from(passcode);
    const b = Buffer.from(envPasscode);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }
  const storedHash = getStoredPasscodeHash();
  if (!storedHash) return false;
  return verifyPasscodeHash(passcode, storedHash);
}

export function createTeacherToken(): string {
  const payload = Buffer.from(
    JSON.stringify({
      role: 'teacher',
      exp: Date.now() + TEACHER_TOKEN_TTL_MS,
      nonce: crypto.randomBytes(8).toString('hex'),
    })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', TOKEN_SIGNING_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyTeacherToken(token: string): boolean {
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return false;
  const payload = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  const expectedSig = crypto
    .createHmac('sha256', TOKEN_SIGNING_SECRET)
    .update(payload)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      role?: string;
      exp?: number;
    };
    return parsed.role === 'teacher' && typeof parsed.exp === 'number' && parsed.exp > Date.now();
  } catch {
    return false;
  }
}

export function requireTeacherAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Sesi guru tidak valid atau telah berakhir. Silakan masuk kembali.' });
    return;
  }
  const token = authHeader.slice(7).trim();
  if (!verifyTeacherToken(token)) {
    res.status(401).json({ error: 'Sesi guru telah kedaluwarsa. Silakan masuk kembali.' });
    return;
  }
  next();
}
