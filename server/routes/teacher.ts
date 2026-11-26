import crypto from 'crypto';
import { Router } from 'express';
import QRCode from 'qrcode';
import {
  createTeacherToken,
  getEnvTeacherPasscode,
  getStoredPasscodeHash,
  hashPasscode,
  requireTeacherAuth,
  verifyTeacherPasscode,
} from '../auth';
import {
  autoFinalizeExpiredSessions,
  db,
  type ExamRow,
  type QuestionRow,
  type StudentSessionRow,
} from '../db';

export const teacherRouter = Router();

function validateImageData(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') {
    throw new Error('Format gambar tidak valid.');
  }
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(trimmed)) {
    throw new Error('Gambar harus berupa format PNG, JPEG, atau WebP.');
  }
  if (trimmed.length > 350000) {
    throw new Error('Ukuran gambar terlalu besar (maksimal ~250 KB agar ringan di HP siswa).');
  }
  return trimmed;
}

function generateExamToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars[crypto.randomInt(0, chars.length)];
  }
  return result;
}

function csvEscape(val: unknown): string {
  const str = String(val ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Auth status check (checks if env passcode or first-run claimed hash exists)
teacherRouter.get('/auth-status', (_req, res) => {
  const envPass = getEnvTeacherPasscode();
  if (envPass !== null) {
    res.json({ configured: true, source: 'env' });
    return;
  }
  const storedHash = getStoredPasscodeHash();
  res.json({ configured: Boolean(storedHash), source: storedHash ? 'claimed' : 'setup' });
});

// First-run passcode setup (only allowed if TEACHER_PASSCODE env is unset AND no hash claimed yet)
teacherRouter.post('/setup', (req, res) => {
  if (getEnvTeacherPasscode() !== null) {
    res.status(409).json({ error: 'Sandi guru sudah diatur melalui konfigurasi server.' });
    return;
  }

  const { passcode } = req.body as { passcode?: string };
  const clean = typeof passcode === 'string' ? passcode.trim() : '';
  if (clean.length < 4 || clean.length > 64) {
    res.status(400).json({ error: 'Sandi guru minimal 4 karakter dan maksimal 64 karakter.' });
    return;
  }

  const hashed = hashPasscode(clean);
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    const existing = getStoredPasscodeHash();
    if (existing) {
      return false;
    }
    db.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ('teacher_passcode_hash', ?, ?)
    `).run(hashed, now);
    return true;
  });

  const claimed = tx();
  if (!claimed) {
    res.status(409).json({ error: 'Sandi guru sudah pernah diatur. Silakan masuk dengan sandi tersebut.' });
    return;
  }

  const token = createTeacherToken();
  res.status(201).json({ ok: true, token });
});

// Teacher login
teacherRouter.post('/login', (req, res) => {
  const { passcode } = req.body as { passcode?: string };
  const clean = typeof passcode === 'string' ? passcode.trim() : '';
  if (!clean) {
    res.status(400).json({ error: 'Masukkan sandi guru.' });
    return;
  }

  if (!verifyTeacherPasscode(clean)) {
    res.status(401).json({ error: 'Sandi guru salah.' });
    return;
  }

  const token = createTeacherToken();
  res.json({ ok: true, token });
});

// All routes below require teacher bearer token
teacherRouter.use(requireTeacherAuth);

// List all exams with summary counts
teacherRouter.get('/exams', (_req, res) => {
  const exams = db.prepare('SELECT * FROM exams ORDER BY id DESC').all() as ExamRow[];

  const enriched = exams.map((exam) => {
    autoFinalizeExpiredSessions(exam.id);
    const qCount = db
      .prepare('SELECT COUNT(*) AS cnt FROM questions WHERE exam_id = ?')
      .get(exam.id) as { cnt: number };
    const sessionStats = db
      .prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'MENGERJAKAN' THEN 1 ELSE 0 END) AS active_count,
          SUM(CASE WHEN status = 'TERKUNCI' THEN 1 ELSE 0 END) AS locked_count,
          SUM(CASE WHEN status = 'SELESAI' THEN 1 ELSE 0 END) AS finished_count
        FROM student_sessions WHERE exam_id = ?
      `)
      .get(exam.id) as {
        total: number;
        active_count: number | null;
        locked_count: number | null;
        finished_count: number | null;
      };

    return {
      ...exam,
      is_active: Boolean(exam.is_active),
      shuffle_questions: Boolean(exam.shuffle_questions),
      shuffle_options: Boolean(exam.shuffle_options),
      question_count: qCount.cnt,
      session_stats: {
        total: sessionStats.total || 0,
        active: sessionStats.active_count || 0,
        locked: sessionStats.locked_count || 0,
        finished: sessionStats.finished_count || 0,
      },
    };
  });

  res.json({ exams: enriched });
});

// Create new exam
teacherRouter.post('/exams', (req, res) => {
  const {
    title,
    subject,
    class_level,
    duration_minutes,
    max_warnings,
    token,
    is_active,
    shuffle_questions,
    shuffle_options,
  } = req.body as {
    title?: string;
    subject?: string;
    class_level?: string;
    duration_minutes?: number;
    max_warnings?: number;
    token?: string;
    is_active?: boolean;
    shuffle_questions?: boolean;
    shuffle_options?: boolean;
  };

  const cleanTitle = typeof title === 'string' ? title.trim() : '';
  const cleanSubject = typeof subject === 'string' ? subject.trim() : '';
  const cleanClass = typeof class_level === 'string' ? class_level.trim() : '';
  const duration = Number(duration_minutes);
  const warnings = max_warnings === undefined ? 2 : Number(max_warnings);
  let cleanToken = typeof token === 'string' && token.trim() ? token.trim().toUpperCase() : generateExamToken();
  cleanToken = cleanToken.replace(/[^A-Z0-9]/g, '');

  if (!cleanTitle || !cleanSubject || !cleanClass) {
    res.status(400).json({ error: 'Judul ujian, mata pelajaran, dan kelas wajib diisi.' });
    return;
  }
  if (!Number.isFinite(duration) || duration < 5 || duration > 300) {
    res.status(400).json({ error: 'Durasi ujian harus antara 5 hingga 300 menit.' });
    return;
  }
  if (!Number.isInteger(warnings) || warnings < 0 || warnings > 10) {
    res.status(400).json({ error: 'Batas peringatan harus antara 0 hingga 10.' });
    return;
  }
  if (cleanToken.length < 4 || cleanToken.length > 16) {
    res.status(400).json({ error: 'Token ujian harus 4–16 karakter huruf/angka.' });
    return;
  }

  try {
    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO exams (title, subject, class_level, duration_minutes, max_warnings, token, is_active, shuffle_questions, shuffle_options, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      cleanTitle,
      cleanSubject,
      cleanClass,
      Math.round(duration),
      warnings,
      cleanToken,
      is_active === false ? 0 : 1,
      shuffle_questions === false ? 0 : 1,
      shuffle_options === false ? 0 : 1,
      now
    );

    const created = db.prepare('SELECT * FROM exams WHERE id = ?').get(result.lastInsertRowid) as ExamRow;
    res.status(201).json({
      exam: {
        ...created,
        is_active: Boolean(created.is_active),
        shuffle_questions: Boolean(created.shuffle_questions),
        shuffle_options: Boolean(created.shuffle_options),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message.includes('UNIQUE')) {
      res.status(409).json({ error: `Token "${cleanToken}" sudah dipakai ujian lain. Gunakan token lain.` });
      return;
    }
    res.status(500).json({ error: 'Gagal membuat paket ujian.' });
  }
});

// Update exam settings / token / active state
teacherRouter.put('/exams/:id', (req, res) => {
  const examId = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM exams WHERE id = ?').get(examId) as ExamRow | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Paket ujian tidak ditemukan.' });
    return;
  }

  const body = req.body as Partial<{
    title: string;
    subject: string;
    class_level: string;
    duration_minutes: number;
    max_warnings: number;
    token: string;
    regenerate_token: boolean;
    is_active: boolean;
    shuffle_questions: boolean;
    shuffle_options: boolean;
  }>;

  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : existing.title;
  const subject = typeof body.subject === 'string' && body.subject.trim() ? body.subject.trim() : existing.subject;
  const classLevel = typeof body.class_level === 'string' && body.class_level.trim() ? body.class_level.trim() : existing.class_level;
  const duration = body.duration_minutes !== undefined ? Number(body.duration_minutes) : existing.duration_minutes;
  const maxWarnings = body.max_warnings !== undefined ? Number(body.max_warnings) : existing.max_warnings;
  let token = existing.token;
  if (body.regenerate_token) {
    token = generateExamToken();
  } else if (typeof body.token === 'string' && body.token.trim()) {
    token = body.token.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  if (duration < 5 || duration > 300 || !Number.isFinite(duration)) {
    res.status(400).json({ error: 'Durasi ujian harus antara 5 hingga 300 menit.' });
    return;
  }
  if (maxWarnings < 0 || maxWarnings > 10 || !Number.isInteger(maxWarnings)) {
    res.status(400).json({ error: 'Batas peringatan harus antara 0 hingga 10.' });
    return;
  }
  if (token.length < 4 || token.length > 16) {
    res.status(400).json({ error: 'Token ujian harus 4–16 karakter huruf/angka.' });
    return;
  }

  const isActive = body.is_active !== undefined ? (body.is_active ? 1 : 0) : existing.is_active;
  const shuffleQ = body.shuffle_questions !== undefined ? (body.shuffle_questions ? 1 : 0) : existing.shuffle_questions;
  const shuffleO = body.shuffle_options !== undefined ? (body.shuffle_options ? 1 : 0) : existing.shuffle_options;

  try {
    db.prepare(`
      UPDATE exams
      SET title = ?, subject = ?, class_level = ?, duration_minutes = ?, max_warnings = ?,
          token = ?, is_active = ?, shuffle_questions = ?, shuffle_options = ?
      WHERE id = ?
    `).run(title, subject, classLevel, Math.round(duration), maxWarnings, token, isActive, shuffleQ, shuffleO, examId);

    const updated = db.prepare('SELECT * FROM exams WHERE id = ?').get(examId) as ExamRow;
    res.json({
      exam: {
        ...updated,
        is_active: Boolean(updated.is_active),
        shuffle_questions: Boolean(updated.shuffle_questions),
        shuffle_options: Boolean(updated.shuffle_options),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('UNIQUE')) {
      res.status(409).json({ error: `Token "${token}" sudah digunakan ujian lain.` });
      return;
    }
    res.status(500).json({ error: 'Gagal memperbarui ujian.' });
  }
});

// Delete exam
teacherRouter.delete('/exams/:id', (req, res) => {
  const examId = Number(req.params.id);
  const info = db.prepare('DELETE FROM exams WHERE id = ?').run(examId);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Ujian tidak ditemukan.' });
    return;
  }
  res.json({ ok: true });
});

// Generate lightweight SVG QR code for portal link
teacherRouter.get('/exams/:id/qr', async (req, res) => {
  const examId = Number(req.params.id);
  const exam = db.prepare('SELECT id, title, token FROM exams WHERE id = ?').get(examId) as Pick<ExamRow, 'id' | 'title' | 'token'> | undefined;
  if (!exam) {
    res.status(404).json({ error: 'Ujian tidak ditemukan.' });
    return;
  }

  const origin =
    typeof req.query.origin === 'string' && /^https?:\/\//i.test(req.query.origin)
      ? req.query.origin.replace(/\/+$/, '')
      : process.env.APP_URL?.replace(/\/+$/, '') || '';

  const portalUrl = origin ? `${origin}/?token=${encodeURIComponent(exam.token)}` : `/?token=${encodeURIComponent(exam.token)}`;
  const svg = await QRCode.toString(portalUrl, {
    type: 'svg',
    margin: 2,
    width: 260,
    color: { dark: '#0f172a', light: '#ffffff' },
  });

  res.json({ portalUrl, svg, token: exam.token, title: exam.title });
});

// List questions for an exam
teacherRouter.get('/exams/:id/questions', (req, res) => {
  const examId = Number(req.params.id);
  const questions = db
    .prepare('SELECT * FROM questions WHERE exam_id = ? ORDER BY order_index ASC, id ASC')
    .all(examId) as QuestionRow[];
  res.json({ questions });
});

// Add single question
teacherRouter.post('/exams/:id/questions', (req, res) => {
  const examId = Number(req.params.id);
  const exam = db.prepare('SELECT id FROM exams WHERE id = ?').get(examId);
  if (!exam) {
    res.status(404).json({ error: 'Ujian tidak ditemukan.' });
    return;
  }

  const { question_text, option_a, option_b, option_c, option_d, correct_option, points, image_data } = req.body as {
    question_text?: string;
    option_a?: string;
    option_b?: string;
    option_c?: string;
    option_d?: string;
    correct_option?: string;
    points?: number;
    image_data?: string | null;
  };

  if (!question_text?.trim() || !option_a?.trim() || !option_b?.trim() || !option_c?.trim() || !option_d?.trim()) {
    res.status(400).json({ error: 'Pertanyaan dan seluruh opsi A–D wajib diisi.' });
    return;
  }
  const key = (correct_option || '').trim().toUpperCase();
  if (key !== 'A' && key !== 'B' && key !== 'C' && key !== 'D') {
    res.status(400).json({ error: 'Kunci jawaban harus A, B, C, atau D.' });
    return;
  }
  const pts = Number(points ?? 1);
  if (!Number.isFinite(pts) || pts <= 0 || pts > 1000) {
    res.status(400).json({ error: 'Bobot poin soal harus antara 1 hingga 1000.' });
    return;
  }

  let validatedImage: string | null = null;
  try {
    validatedImage = validateImageData(image_data);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Gambar tidak valid.' });
    return;
  }

  const maxOrder = db
    .prepare('SELECT COALESCE(MAX(order_index), 0) AS m FROM questions WHERE exam_id = ?')
    .get(examId) as { m: number };

  const now = new Date().toISOString();
  const resInsert = db.prepare(`
    INSERT INTO questions (exam_id, question_text, option_a, option_b, option_c, option_d, correct_option, points, image_data, order_index, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    examId,
    question_text.trim(),
    option_a.trim(),
    option_b.trim(),
    option_c.trim(),
    option_d.trim(),
    key,
    pts,
    validatedImage,
    maxOrder.m + 1,
    now
  );

  const created = db.prepare('SELECT * FROM questions WHERE id = ?').get(resInsert.lastInsertRowid) as QuestionRow;
  res.status(201).json({ question: created });
});

// Bulk import questions
teacherRouter.post('/exams/:id/questions/bulk', (req, res) => {
  const examId = Number(req.params.id);
  const exam = db.prepare('SELECT id FROM exams WHERE id = ?').get(examId);
  if (!exam) {
    res.status(404).json({ error: 'Ujian tidak ditemukan.' });
    return;
  }

  const { questions } = req.body as {
    questions?: Array<{
      question_text: string;
      option_a: string;
      option_b: string;
      option_c: string;
      option_d: string;
      correct_option: string;
      points?: number;
    }>;
  };

  if (!Array.isArray(questions) || questions.length === 0) {
    res.status(400).json({ error: 'Daftar soal impor kosong.' });
    return;
  }

  if (questions.length > 200) {
    res.status(400).json({ error: 'Maksimal 200 soal per impor massal.' });
    return;
  }

  const maxOrder = db
    .prepare('SELECT COALESCE(MAX(order_index), 0) AS m FROM questions WHERE exam_id = ?')
    .get(examId) as { m: number };

  const now = new Date().toISOString();
  const insertStmt = db.prepare(`
    INSERT INTO questions (exam_id, question_text, option_a, option_b, option_c, option_d, correct_option, points, image_data, order_index, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `);

  const tx = db.transaction(() => {
    let idx = maxOrder.m;
    let inserted = 0;
    for (const q of questions) {
      const text = q.question_text?.trim();
      const a = q.option_a?.trim();
      const b = q.option_b?.trim();
      const c = q.option_c?.trim();
      const d = q.option_d?.trim();
      const key = (q.correct_option || '').trim().toUpperCase();
      const pts = Number(q.points ?? 1);

      if (!text || !a || !b || !c || !d) {
        throw new Error(`Soal ke-${inserted + 1} belum lengkap pertanyaan atau opsi A–D.`);
      }
      if (key !== 'A' && key !== 'B' && key !== 'C' && key !== 'D') {
        throw new Error(`Kunci jawaban soal ke-${inserted + 1} harus A, B, C, atau D.`);
      }
      if (!Number.isFinite(pts) || pts <= 0) {
        throw new Error(`Bobot poin soal ke-${inserted + 1} tidak valid.`);
      }

      idx += 1;
      insertStmt.run(examId, text, a, b, c, d, key, pts, idx, now);
      inserted += 1;
    }
    return inserted;
  });

  try {
    const count = tx();
    res.status(201).json({ ok: true, inserted: count });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal mengimpor soal.' });
  }
});

// Update single question
teacherRouter.put('/questions/:id', (req, res) => {
  const qId = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM questions WHERE id = ?').get(qId) as QuestionRow | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Soal tidak ditemukan.' });
    return;
  }

  const body = req.body as Partial<{
    question_text: string;
    option_a: string;
    option_b: string;
    option_c: string;
    option_d: string;
    correct_option: string;
    points: number;
    image_data: string | null;
  }>;

  const text = body.question_text?.trim() || existing.question_text;
  const a = body.option_a?.trim() || existing.option_a;
  const b = body.option_b?.trim() || existing.option_b;
  const c = body.option_c?.trim() || existing.option_c;
  const d = body.option_d?.trim() || existing.option_d;
  const key = (body.correct_option || existing.correct_option).trim().toUpperCase();
  const pts = body.points !== undefined ? Number(body.points) : existing.points;

  if (key !== 'A' && key !== 'B' && key !== 'C' && key !== 'D') {
    res.status(400).json({ error: 'Kunci jawaban harus A, B, C, atau D.' });
    return;
  }
  if (!Number.isFinite(pts) || pts <= 0) {
    res.status(400).json({ error: 'Bobot poin tidak valid.' });
    return;
  }

  let imgData = existing.image_data;
  if (body.image_data !== undefined) {
    try {
      imgData = validateImageData(body.image_data);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Gambar tidak valid.' });
      return;
    }
  }

  db.prepare(`
    UPDATE questions
    SET question_text = ?, option_a = ?, option_b = ?, option_c = ?, option_d = ?,
        correct_option = ?, points = ?, image_data = ?
    WHERE id = ?
  `).run(text, a, b, c, d, key, pts, imgData, qId);

  const updated = db.prepare('SELECT * FROM questions WHERE id = ?').get(qId) as QuestionRow;
  res.json({ question: updated });
});

// Delete question
teacherRouter.delete('/questions/:id', (req, res) => {
  const qId = Number(req.params.id);
  const info = db.prepare('DELETE FROM questions WHERE id = ?').run(qId);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Soal tidak ditemukan.' });
    return;
  }
  res.json({ ok: true });
});

// Live monitor + violation logs + results for an exam
teacherRouter.get('/exams/:id/monitor', (req, res) => {
  const examId = Number(req.params.id);
  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(examId) as ExamRow | undefined;
  if (!exam) {
    res.status(404).json({ error: 'Ujian tidak ditemukan.' });
    return;
  }

  autoFinalizeExpiredSessions(examId);

  const totalQuestions = (
    db.prepare('SELECT COUNT(*) AS cnt FROM questions WHERE exam_id = ?').get(examId) as { cnt: number }
  ).cnt;

  const sessions = db
    .prepare('SELECT * FROM student_sessions WHERE exam_id = ? ORDER BY CASE status WHEN \'TERKUNCI\' THEN 1 WHEN \'MENGERJAKAN\' THEN 2 WHEN \'BELUM_MULAI\' THEN 3 ELSE 4 END, nis ASC')
    .all(examId) as StudentSessionRow[];

  const answerCounts = db
    .prepare(`
      SELECT a.session_id, COUNT(*) AS cnt
      FROM answers a
      JOIN student_sessions s ON s.id = a.session_id
      WHERE s.exam_id = ?
      GROUP BY a.session_id
    `)
    .all(examId) as Array<{ session_id: number; cnt: number }>;
  const ansCountMap = new Map(answerCounts.map((r) => [r.session_id, r.cnt]));

  const logs = db
    .prepare(`
      SELECT v.*
      FROM violation_logs v
      JOIN student_sessions s ON s.id = v.session_id
      WHERE s.exam_id = ?
      ORDER BY v.id DESC
    `)
    .all(examId) as Array<{
      id: number;
      session_id: number;
      violation_type: string;
      detail: string;
      created_at: string;
    }>;

  const logsBySession = new Map<number, typeof logs>();
  for (const log of logs) {
    const arr = logsBySession.get(log.session_id) ?? [];
    arr.push(log);
    logsBySession.set(log.session_id, arr);
  }

  const nowMs = Date.now();
  const participants = sessions.map((s) => {
    let remainingSeconds: number | null = null;
    if (s.status === 'MENGERJAKAN' && s.ends_at) {
      remainingSeconds = Math.max(0, Math.floor((Date.parse(s.ends_at) - nowMs) / 1000));
    } else if (s.status === 'TERKUNCI' && s.ends_at) {
      remainingSeconds = Math.max(0, Math.floor((Date.parse(s.ends_at) - nowMs) / 1000));
    }

    return {
      id: s.id,
      exam_id: s.exam_id,
      nis: s.nis,
      student_name: s.student_name,
      student_class: s.student_class,
      status: s.status,
      violation_count: s.violation_count,
      answered_count: ansCountMap.get(s.id) ?? 0,
      total_questions: totalQuestions,
      remaining_seconds: remainingSeconds,
      started_at: s.started_at,
      ends_at: s.ends_at,
      submitted_at: s.submitted_at,
      last_heartbeat_at: s.last_heartbeat_at,
      correct_count: s.correct_count,
      wrong_count: s.wrong_count,
      unanswered_count: s.unanswered_count,
      score: s.score,
      max_score: s.max_score,
      final_grade: s.final_grade,
      violations: logsBySession.get(s.id) ?? [],
    };
  });

  res.json({
    exam: {
      ...exam,
      is_active: Boolean(exam.is_active),
      shuffle_questions: Boolean(exam.shuffle_questions),
      shuffle_options: Boolean(exam.shuffle_options),
      total_questions: totalQuestions,
    },
    participants,
    server_now: new Date().toISOString(),
  });
});

// Add pre-registered student (BELUM_MULAI) to exam roster
teacherRouter.post('/exams/:id/participants', (req, res) => {
  const examId = Number(req.params.id);
  const exam = db.prepare('SELECT id FROM exams WHERE id = ?').get(examId);
  if (!exam) {
    res.status(404).json({ error: 'Ujian tidak ditemukan.' });
    return;
  }

  const { nis, student_name, student_class } = req.body as {
    nis?: string;
    student_name?: string;
    student_class?: string;
  };
  const cleanNis = nis?.trim().toUpperCase() || '';
  const cleanName = student_name?.trim() || '';
  const cleanClass = student_class?.trim() || '';

  if (!cleanNis || !cleanName || !cleanClass) {
    res.status(400).json({ error: 'Nomor Ujian/NIS, Nama, dan Kelas wajib diisi.' });
    return;
  }

  try {
    db.prepare(`
      INSERT INTO student_sessions (exam_id, nis, student_name, student_class, status)
      VALUES (?, ?, ?, ?, 'BELUM_MULAI')
    `).run(examId, cleanNis, cleanName, cleanClass);
    res.status(201).json({ ok: true });
  } catch {
    res.status(409).json({ error: `Peserta dengan NIS ${cleanNis} sudah terdaftar di ujian ini.` });
  }
});

// Bulk import pre-registered students (NIS, Nama, Kelas) into exam roster
teacherRouter.post('/exams/:id/participants/bulk', (req, res) => {
  const examId = Number(req.params.id);
  const exam = db.prepare('SELECT id FROM exams WHERE id = ?').get(examId);
  if (!exam) {
    res.status(404).json({ error: 'Ujian tidak ditemukan.' });
    return;
  }

  const { participants } = req.body as {
    participants?: Array<{
      nis?: string;
      student_name?: string;
      student_class?: string;
    }>;
  };

  if (!Array.isArray(participants) || participants.length === 0) {
    res.status(400).json({ error: 'Daftar peserta impor kosong.' });
    return;
  }

  if (participants.length > 1000) {
    res.status(400).json({ error: 'Maksimal 1000 peserta dalam satu kali impor.' });
    return;
  }

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO student_sessions (exam_id, nis, student_name, student_class, status)
    VALUES (?, ?, ?, ?, 'BELUM_MULAI')
  `);

  const tx = db.transaction(() => {
    let inserted = 0;
    let skipped = 0;
    for (let i = 0; i < participants.length; i++) {
      const p = participants[i];
      const cleanNis = typeof p?.nis === 'string' ? p.nis.trim().toUpperCase() : '';
      const cleanName = typeof p?.student_name === 'string' ? p.student_name.trim() : '';
      const cleanClass = typeof p?.student_class === 'string' ? p.student_class.trim() : '';

      if (!cleanNis || !cleanName || !cleanClass) {
        throw new Error(`Baris ke-${i + 1}: NIS, Nama, dan Kelas wajib diisi.`);
      }
      if (cleanNis.length > 40 || cleanName.length > 100 || cleanClass.length > 40) {
        throw new Error(`Baris ke-${i + 1}: panjang data melebihi batas karakter.`);
      }

      const info = insertStmt.run(examId, cleanNis, cleanName, cleanClass);
      if (info.changes > 0) {
        inserted += 1;
      } else {
        skipped += 1;
      }
    }
    return { inserted, skipped };
  });

  try {
    const result = tx();
    res.status(201).json({ ok: true, inserted: result.inserted, skipped: result.skipped });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal mengimpor daftar peserta.' });
  }
});

// Unlock a locked student session
teacherRouter.post('/sessions/:id/unlock', (req, res) => {
  const sessionId = Number(req.params.id);
  const session = db.prepare('SELECT * FROM student_sessions WHERE id = ?').get(sessionId) as StudentSessionRow | undefined;
  if (!session) {
    res.status(404).json({ error: 'Sesi siswa tidak ditemukan.' });
    return;
  }

  if (session.status === 'SELESAI') {
    res.status(409).json({ error: 'Sesi ini sudah selesai dan dikumpulkan.' });
    return;
  }

  const nowIso = new Date().toISOString();
  // Reset violation_count to max_warnings - 1 or 0 so student gets fresh continuation?
  // Resetting violation_count to 0 while keeping historical violation_logs intact in DB is fairest & clearest!
  // Wait: keep total violation count in violation_logs, or track violation_count?
  // Wait: prompt says: "lihat jumlah pelanggaran layar" & "ekspor rekap memuat jumlah pelanggaran layar".
  // If we keep `violation_count` as total recorded violations, and adjust lock check or add a `warnings_reset_offset`?
  // Better: keep `violation_count` untouched in `student_sessions` AND simply set `status = 'MENGERJAKAN'` AND update `ends_at`? No, if `violation_count` is already 3 and `max_warnings` is 2, the next violation (4) checks `nextCount > exam.max_warnings` which would immediately lock again unless we give +1 grace or track `unlocked_at`!
  // Let's handle that smartly: on unlock, if `violation_count` >= `max_warnings`, log an UNLOCK note and only re-lock after 1 additional violation? Even cleaner: add `violation_count` = total violations for reporting, OR count violations since last unlock? Let's check: in `violation_logs`, `violation_type != 'BUKA_KUNCI'` is the real violation count! Wait—if we keep `violation_count` as the live counter reset to `0` on unlock? No, teacher wants total violation count in recap CSV!
  // Let's check `studentRouter.post('/violations')`: if we simply log `'BUKA_KUNCI'` in `violation_logs`, wait: if `violation_count` stays 3 and `max_warnings` is 2, then on violation #4 `4 > 2` locks on the very next violation (1 grace violation), OR if we set `status = 'MENGERJAKAN'`, then the student continues immediately and only locks again if another violation occurs! That's actually ideal: after being unlocked by the proctor, 1 more violation locks them again, while `violation_count` preserves the true total number of violations!
  db.prepare(`
    INSERT INTO violation_logs (session_id, violation_type, detail, created_at)
    VALUES (?, 'BUKA_KUNCI', 'Kunci layar dibuka oleh guru/pengawas', ?)
  `).run(sessionId, nowIso);

  db.prepare(`
    UPDATE student_sessions
    SET status = 'MENGERJAKAN',
        last_heartbeat_at = ?
    WHERE id = ?
  `).run(nowIso, sessionId);

  res.json({ ok: true, status: 'MENGERJAKAN' });
});

// Reset bound device ID (if student's phone died and they need to switch phones)
teacherRouter.post('/sessions/:id/reset-device', (req, res) => {
  const sessionId = Number(req.params.id);
  const session = db.prepare('SELECT * FROM student_sessions WHERE id = ?').get(sessionId) as StudentSessionRow | undefined;
  if (!session) {
    res.status(404).json({ error: 'Sesi siswa tidak ditemukan.' });
    return;
  }

  db.prepare('UPDATE student_sessions SET device_id = NULL WHERE id = ?').run(sessionId);
  res.json({ ok: true });
});

// Export CSV (UTF-8 BOM for Excel Indonesia compatibility)
teacherRouter.get('/exams/:id/export', (req, res) => {
  const examId = Number(req.params.id);
  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(examId) as ExamRow | undefined;
  if (!exam) {
    res.status(404).json({ error: 'Ujian tidak ditemukan.' });
    return;
  }

  autoFinalizeExpiredSessions(examId);

  const sessions = db
    .prepare('SELECT * FROM student_sessions WHERE exam_id = ? ORDER BY student_class ASC, nis ASC')
    .all(examId) as StudentSessionRow[];

  const header = [
    'Nomor Ujian / NIS',
    'Nama Siswa',
    'Kelas',
    'Status',
    'Jumlah Benar',
    'Jumlah Salah',
    'Tidak Dijawab',
    'Skor Poin',
    'Skor Maksimal',
    'Nilai Akhir (0-100)',
    'Jumlah Pelanggaran Layar',
    'Waktu Mulai',
    'Waktu Selesai',
  ];

  const lines = [header.map(csvEscape).join(',')];

  for (const s of sessions) {
    lines.push(
      [
        s.nis,
        s.student_name,
        s.student_class,
        s.status,
        s.correct_count,
        s.wrong_count,
        s.unanswered_count,
        s.score,
        s.max_score,
        s.final_grade,
        s.violation_count,
        s.started_at || '-',
        s.submitted_at || '-',
      ]
        .map(csvEscape)
        .join(',')
    );
  }

  const safeFile = exam.subject.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const csvContent = '\uFEFF' + lines.join('\r\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="rekap-nilai-${safeFile}-${exam.token}.csv"`);
  res.send(csvContent);
});
