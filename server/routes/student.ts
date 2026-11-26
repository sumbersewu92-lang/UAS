import crypto from 'crypto';
import { Router } from 'express';
import {
  db,
  finalizeSessionScore,
  shuffleArray,
  type ExamRow,
  type QuestionRow,
  type StudentSessionRow,
} from '../db';

export const studentRouter = Router();

interface PublicQuestion {
  id: number;
  question_text: string;
  image_data: string | null;
  points: number;
  options: Array<{
    displayKey: 'A' | 'B' | 'C' | 'D';
    originalKey: 'A' | 'B' | 'C' | 'D';
    text: string;
  }>;
}

function buildStudentQuestions(
  examId: number,
  questionOrder: number[],
  optionOrderMap: Record<string, Array<'A' | 'B' | 'C' | 'D'>>
): PublicQuestion[] {
  const rows = db
    .prepare('SELECT id, question_text, option_a, option_b, option_c, option_d, points, image_data FROM questions WHERE exam_id = ?')
    .all(examId) as Array<Omit<QuestionRow, 'exam_id' | 'correct_option' | 'order_index' | 'created_at'>>;

  const rowMap = new Map<number, typeof rows[number]>();
  for (const r of rows) {
    rowMap.set(r.id, r);
  }

  const displayKeys: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];
  const result: PublicQuestion[] = [];

  for (const qId of questionOrder) {
    const q = rowMap.get(qId);
    if (!q) continue;

    const origOrder = optionOrderMap[String(qId)] ?? ['A', 'B', 'C', 'D'];
    const textByKey: Record<'A' | 'B' | 'C' | 'D', string> = {
      A: q.option_a,
      B: q.option_b,
      C: q.option_c,
      D: q.option_d,
    };

    const options = origOrder.map((origKey, idx) => ({
      displayKey: displayKeys[idx],
      originalKey: origKey,
      text: textByKey[origKey],
    }));

    result.push({
      id: q.id,
      question_text: q.question_text,
      image_data: q.image_data,
      points: q.points,
      options,
    });
  }

  return result;
}

function getAuthenticatedStudentSession(
  sessionId: number,
  secretHeader: string | undefined
): StudentSessionRow | null {
  if (!secretHeader || !Number.isInteger(sessionId) || sessionId <= 0) return null;
  const session = db
    .prepare('SELECT * FROM student_sessions WHERE id = ?')
    .get(sessionId) as StudentSessionRow | undefined;
  if (!session || !session.session_secret) return null;

  const a = Buffer.from(secretHeader);
  const b = Buffer.from(session.session_secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return session;
}

// Lookup exam preview by token (before login)
studentRouter.get('/exam-lookup', (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token.trim().toUpperCase() : '';
  if (!token) {
    res.status(400).json({ error: 'Token ujian wajib diisi.' });
    return;
  }

  const exam = db
    .prepare('SELECT id, title, subject, class_level, duration_minutes, max_warnings, is_active FROM exams WHERE token = ?')
    .get(token) as Pick<ExamRow, 'id' | 'title' | 'subject' | 'class_level' | 'duration_minutes' | 'max_warnings' | 'is_active'> | undefined;

  if (!exam) {
    res.status(404).json({ error: 'Token ujian tidak ditemukan. Periksa kembali token dari guru.' });
    return;
  }

  const qCount = db
    .prepare('SELECT COUNT(*) AS cnt FROM questions WHERE exam_id = ?')
    .get(exam.id) as { cnt: number };

  res.json({
    exam: {
      ...exam,
      is_active: Boolean(exam.is_active),
      question_count: qCount.cnt,
    },
  });
});

// Join or resume student exam session
studentRouter.post('/join', (req, res) => {
  const { nis, studentName, studentClass, token, deviceId } = req.body as {
    nis?: string;
    studentName?: string;
    studentClass?: string;
    token?: string;
    deviceId?: string;
  };

  const cleanNis = typeof nis === 'string' ? nis.trim().toUpperCase() : '';
  const cleanName = typeof studentName === 'string' ? studentName.trim() : '';
  const cleanClass = typeof studentClass === 'string' ? studentClass.trim() : '';
  const cleanToken = typeof token === 'string' ? token.trim().toUpperCase() : '';
  const cleanDevice = typeof deviceId === 'string' ? deviceId.trim() : '';

  if (!cleanNis || !cleanName || !cleanClass || !cleanToken || !cleanDevice) {
    res.status(400).json({ error: 'Nomor Ujian/NIS, Nama Lengkap, Kelas, dan Token Ujian wajib diisi.' });
    return;
  }

  if (cleanNis.length > 40 || cleanName.length > 100 || cleanClass.length > 40) {
    res.status(400).json({ error: 'Panjang data identitas melebihi batas yang diizinkan.' });
    return;
  }

  const exam = db.prepare('SELECT * FROM exams WHERE token = ?').get(cleanToken) as ExamRow | undefined;
  if (!exam) {
    res.status(404).json({ error: 'Token ujian tidak valid atau tidak ditemukan.' });
    return;
  }

  if (!exam.is_active) {
    res.status(403).json({ error: 'Token ujian sedang dinonaktifkan oleh guru/pengawas.' });
    return;
  }

  const questions = db
    .prepare('SELECT id FROM questions WHERE exam_id = ? ORDER BY order_index ASC, id ASC')
    .all(exam.id) as Array<{ id: number }>;

  if (questions.length === 0) {
    res.status(400).json({ error: 'Paket ujian ini belum memiliki soal. Hubungi guru pengampu.' });
    return;
  }

  const now = new Date();
  const nowIso = now.toISOString();

  const existing = db
    .prepare('SELECT * FROM student_sessions WHERE exam_id = ? AND nis = ?')
    .get(exam.id, cleanNis) as StudentSessionRow | undefined;

  if (existing) {
    if (existing.status === 'SELESAI') {
      res.status(409).json({
        error: 'Ujian sudah dikumpulkan untuk Nomor Ujian/NIS ini.',
        completedSummary: {
          student_name: existing.student_name,
          nis: existing.nis,
          correct_count: existing.correct_count,
          wrong_count: existing.wrong_count,
          unanswered_count: existing.unanswered_count,
          final_grade: existing.final_grade,
          submitted_at: existing.submitted_at,
        },
      });
      return;
    }

    // Check single-active-session rule if session already started on another device
    if (existing.status !== 'BELUM_MULAI' && existing.device_id && existing.device_id !== cleanDevice) {
      res.status(409).json({
        error:
          'Sesi ganda ditolak: Nomor Ujian/NIS ini sedang aktif di perangkat lain. Hubungi pengawas jika HP sebelumnya bermasalah untuk melakukan Reset Perangkat.',
      });
      return;
    }

    // Check if existing session timer already expired
    if (existing.status === 'MENGERJAKAN' && existing.ends_at && Date.now() > Date.parse(existing.ends_at) + 5000) {
      const finalized = finalizeSessionScore(existing.id);
      res.status(409).json({
        error: 'Waktu ujian untuk sesi ini telah habis dan nilai sudah dikumpulkan otomatis.',
        completedSummary: {
          student_name: finalized.student_name,
          nis: finalized.nis,
          correct_count: finalized.correct_count,
          wrong_count: finalized.wrong_count,
          unanswered_count: finalized.unanswered_count,
          final_grade: finalized.final_grade,
          submitted_at: finalized.submitted_at,
        },
      });
      return;
    }

    // Either BELUM_MULAI transitioning to MENGERJAKAN, or same-device resuming MENGERJAKAN / TERKUNCI
    let questionOrder: number[];
    let optionOrderMap: Record<string, Array<'A' | 'B' | 'C' | 'D'>>;
    let startedAt = existing.started_at;
    let endsAt = existing.ends_at;
    let status = existing.status;
    let sessionSecret = existing.session_secret;

    if (existing.status === 'BELUM_MULAI') {
      const ids = questions.map((q) => q.id);
      questionOrder = exam.shuffle_questions ? shuffleArray(ids) : ids;
      optionOrderMap = {};
      for (const id of questionOrder) {
        optionOrderMap[String(id)] = exam.shuffle_options
          ? shuffleArray<'A' | 'B' | 'C' | 'D'>(['A', 'B', 'C', 'D'])
          : ['A', 'B', 'C', 'D'];
      }
      startedAt = nowIso;
      endsAt = new Date(now.getTime() + exam.duration_minutes * 60 * 1000).toISOString();
      status = 'MENGERJAKAN';
      sessionSecret = crypto.randomBytes(24).toString('hex');

      db.prepare(`
        UPDATE student_sessions
        SET student_name = ?,
            student_class = ?,
            device_id = ?,
            session_secret = ?,
            status = 'MENGERJAKAN',
            question_order_json = ?,
            option_order_json = ?,
            started_at = ?,
            ends_at = ?,
            last_heartbeat_at = ?
        WHERE id = ?
      `).run(
        cleanName,
        cleanClass,
        cleanDevice,
        sessionSecret,
        JSON.stringify(questionOrder),
        JSON.stringify(optionOrderMap),
        startedAt,
        endsAt,
        nowIso,
        existing.id
      );
    } else {
      questionOrder = JSON.parse(existing.question_order_json) as number[];
      optionOrderMap = JSON.parse(existing.option_order_json) as Record<string, Array<'A' | 'B' | 'C' | 'D'>>;
      if (!sessionSecret) {
        sessionSecret = crypto.randomBytes(24).toString('hex');
      }
      db.prepare(`
        UPDATE student_sessions
        SET device_id = ?,
            session_secret = ?,
            last_heartbeat_at = ?
        WHERE id = ?
      `).run(cleanDevice, sessionSecret, nowIso, existing.id);
    }

    const savedAnswersRows = db
      .prepare('SELECT question_id, selected_option FROM answers WHERE session_id = ?')
      .all(existing.id) as Array<{ question_id: number; selected_option: 'A' | 'B' | 'C' | 'D' }>;

    const savedAnswers: Record<number, 'A' | 'B' | 'C' | 'D'> = {};
    for (const r of savedAnswersRows) {
      savedAnswers[r.question_id] = r.selected_option;
    }

    const publicQuestions = buildStudentQuestions(exam.id, questionOrder, optionOrderMap);

    res.json({
      session: {
        id: existing.id,
        exam_id: exam.id,
        nis: existing.nis,
        student_name: existing.status === 'BELUM_MULAI' ? cleanName : existing.student_name,
        student_class: existing.status === 'BELUM_MULAI' ? cleanClass : existing.student_class,
        status,
        violation_count: existing.violation_count,
        started_at: startedAt,
        ends_at: endsAt,
        server_now: nowIso,
        session_secret: sessionSecret,
      },
      exam: {
        id: exam.id,
        title: exam.title,
        subject: exam.subject,
        class_level: exam.class_level,
        duration_minutes: exam.duration_minutes,
        max_warnings: exam.max_warnings,
      },
      questions: publicQuestions,
      savedAnswers,
    });
    return;
  }

  // Create fresh session
  const ids = questions.map((q) => q.id);
  const questionOrder = exam.shuffle_questions ? shuffleArray(ids) : ids;
  const optionOrderMap: Record<string, Array<'A' | 'B' | 'C' | 'D'>> = {};
  for (const id of questionOrder) {
    optionOrderMap[String(id)] = exam.shuffle_options
      ? shuffleArray<'A' | 'B' | 'C' | 'D'>(['A', 'B', 'C', 'D'])
      : ['A', 'B', 'C', 'D'];
  }

  const endsAtIso = new Date(now.getTime() + exam.duration_minutes * 60 * 1000).toISOString();
  const sessionSecret = crypto.randomBytes(24).toString('hex');

  const insertRes = db.prepare(`
    INSERT INTO student_sessions (
      exam_id, nis, student_name, student_class, device_id, session_secret,
      status, question_order_json, option_order_json, violation_count,
      started_at, ends_at, last_heartbeat_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'MENGERJAKAN', ?, ?, 0, ?, ?, ?)
  `).run(
    exam.id,
    cleanNis,
    cleanName,
    cleanClass,
    cleanDevice,
    sessionSecret,
    JSON.stringify(questionOrder),
    JSON.stringify(optionOrderMap),
    nowIso,
    endsAtIso,
    nowIso
  );

  const sessionId = Number(insertRes.lastInsertRowid);
  const publicQuestions = buildStudentQuestions(exam.id, questionOrder, optionOrderMap);

  res.status(201).json({
    session: {
      id: sessionId,
      exam_id: exam.id,
      nis: cleanNis,
      student_name: cleanName,
      student_class: cleanClass,
      status: 'MENGERJAKAN',
      violation_count: 0,
      started_at: nowIso,
      ends_at: endsAtIso,
      server_now: nowIso,
      session_secret: sessionSecret,
    },
    exam: {
      id: exam.id,
      title: exam.title,
      subject: exam.subject,
      class_level: exam.class_level,
      duration_minutes: exam.duration_minutes,
      max_warnings: exam.max_warnings,
    },
    questions: publicQuestions,
    savedAnswers: {},
  });
});

// Batch or single auto-save answers
studentRouter.put('/answers', (req, res) => {
  const { sessionId, answers } = req.body as {
    sessionId?: number;
    answers?: Record<string, string>;
  };
  const secret = req.headers['x-session-secret'] as string | undefined;
  const session = getAuthenticatedStudentSession(Number(sessionId), secret);

  if (!session) {
    res.status(401).json({ error: 'Sesi ujian tidak sah.' });
    return;
  }

  if (session.status === 'TERKUNCI') {
    res.status(423).json({ error: 'Sesi terkunci karena pelanggaran layar. Minta guru membuka kunci.', status: 'TERKUNCI' });
    return;
  }

  if (session.status === 'SELESAI') {
    res.status(409).json({ error: 'Ujian sudah dikumpulkan.', status: 'SELESAI' });
    return;
  }

  if (session.ends_at && Date.now() > Date.parse(session.ends_at) + 15000) {
    const finalized = finalizeSessionScore(session.id);
    res.status(409).json({
      error: 'Waktu ujian telah habis. Jawaban telah dikumpulkan otomatis.',
      status: 'SELESAI',
      result: finalized,
    });
    return;
  }

  if (!answers || typeof answers !== 'object') {
    res.status(400).json({ error: 'Format jawaban tidak valid.' });
    return;
  }

  const validQuestions = new Set(
    (
      db.prepare('SELECT id FROM questions WHERE exam_id = ?').all(session.exam_id) as Array<{ id: number }>
    ).map((q) => q.id)
  );

  const nowIso = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO answers (session_id, question_id, selected_option, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(session_id, question_id) DO UPDATE SET
      selected_option = excluded.selected_option,
      updated_at = excluded.updated_at
  `);

  const tx = db.transaction(() => {
    let savedCount = 0;
    for (const [qIdStr, opt] of Object.entries(answers)) {
      const qId = Number(qIdStr);
      if (!validQuestions.has(qId)) continue;
      if (opt !== 'A' && opt !== 'B' && opt !== 'C' && opt !== 'D') continue;
      upsert.run(session.id, qId, opt, nowIso);
      savedCount += 1;
    }
    db.prepare('UPDATE student_sessions SET last_heartbeat_at = ? WHERE id = ?').run(nowIso, session.id);
    return savedCount;
  });

  const savedCount = tx();
  res.json({
    ok: true,
    savedCount,
    syncedAt: nowIso,
    status: session.status,
  });
});

// Check session status + sync server clock (used for live unlock detection & timer sync)
studentRouter.get('/session-status/:id', (req, res) => {
  const sessionId = Number(req.params.id);
  const secret = req.headers['x-session-secret'] as string | undefined;
  const session = getAuthenticatedStudentSession(sessionId, secret);

  if (!session) {
    res.status(401).json({ error: 'Sesi ujian tidak sah.' });
    return;
  }

  const nowIso = new Date().toISOString();
  if (session.status === 'MENGERJAKAN' && session.ends_at && Date.now() > Date.parse(session.ends_at) + 15000) {
    const finalized = finalizeSessionScore(session.id);
    res.json({
      status: finalized.status,
      violation_count: finalized.violation_count,
      ends_at: finalized.ends_at,
      server_now: nowIso,
      result: {
        correct_count: finalized.correct_count,
        wrong_count: finalized.wrong_count,
        unanswered_count: finalized.unanswered_count,
        score: finalized.score,
        max_score: finalized.max_score,
        final_grade: finalized.final_grade,
        submitted_at: finalized.submitted_at,
      },
    });
    return;
  }

  db.prepare('UPDATE student_sessions SET last_heartbeat_at = ? WHERE id = ?').run(nowIso, session.id);

  res.json({
    status: session.status,
    violation_count: session.violation_count,
    ends_at: session.ends_at,
    server_now: nowIso,
    result:
      session.status === 'SELESAI'
        ? {
            correct_count: session.correct_count,
            wrong_count: session.wrong_count,
            unanswered_count: session.unanswered_count,
            score: session.score,
            max_score: session.max_score,
            final_grade: session.final_grade,
            submitted_at: session.submitted_at,
          }
        : null,
  });
});

// Log screen / focus violation and lock if threshold exceeded
studentRouter.post('/violations', (req, res) => {
  const { sessionId, violationType, detail } = req.body as {
    sessionId?: number;
    violationType?: string;
    detail?: string;
  };
  const secret = req.headers['x-session-secret'] as string | undefined;
  const session = getAuthenticatedStudentSession(Number(sessionId), secret);

  if (!session) {
    res.status(401).json({ error: 'Sesi ujian tidak sah.' });
    return;
  }

  if (session.status === 'SELESAI') {
    res.json({ status: 'SELESAI', violation_count: session.violation_count });
    return;
  }

  const exam = db.prepare('SELECT max_warnings FROM exams WHERE id = ?').get(session.exam_id) as {
    max_warnings: number;
  };

  const cleanType = typeof violationType === 'string' ? violationType.slice(0, 50) : 'GANGGUAN_LAYAR';
  const cleanDetail = typeof detail === 'string' ? detail.slice(0, 240) : 'Terdeteksi keluar dari layar ujian';
  const nowIso = new Date().toISOString();

  const tx = db.transaction(() => {
    const fresh = db
      .prepare('SELECT violation_count, status FROM student_sessions WHERE id = ?')
      .get(session.id) as { violation_count: number; status: StudentSessionRow['status'] };

    if (fresh.status === 'TERKUNCI' || fresh.status === 'SELESAI') {
      return { status: fresh.status, violationCount: fresh.violation_count };
    }

    const nextCount = fresh.violation_count + 1;
    const shouldLock = nextCount > exam.max_warnings;
    const nextStatus = shouldLock ? 'TERKUNCI' : 'MENGERJAKAN';

    db.prepare(`
      INSERT INTO violation_logs (session_id, violation_type, detail, created_at)
      VALUES (?, ?, ?, ?)
    `).run(session.id, cleanType, cleanDetail, nowIso);

    db.prepare(`
      UPDATE student_sessions
      SET violation_count = ?, status = ?, last_heartbeat_at = ?
      WHERE id = ?
    `).run(nextCount, nextStatus, nowIso, session.id);

    return { status: nextStatus, violationCount: nextCount };
  });

  const outcome = tx();
  res.json({
    ok: true,
    status: outcome.status,
    violation_count: outcome.violationCount,
    max_warnings: exam.max_warnings,
  });
});

// Final submit (or auto-submit on timer expiration)
studentRouter.post('/submit', (req, res) => {
  const { sessionId, answers } = req.body as {
    sessionId?: number;
    answers?: Record<string, string>;
  };
  const secret = req.headers['x-session-secret'] as string | undefined;
  const session = getAuthenticatedStudentSession(Number(sessionId), secret);

  if (!session) {
    res.status(401).json({ error: 'Sesi ujian tidak sah.' });
    return;
  }

  if (session.status === 'TERKUNCI') {
    const isExpired = session.ends_at && Date.now() > Date.parse(session.ends_at);
    if (!isExpired) {
      res.status(423).json({
        error: 'Sesi terkunci. Guru harus membuka kunci sebelum Anda dapat mengumpulkan ujian.',
      });
      return;
    }
  }

  // Persist any final buffered answers from localStorage before grading
  if (answers && typeof answers === 'object' && session.status !== 'SELESAI') {
    const validQuestions = new Set(
      (
        db.prepare('SELECT id FROM questions WHERE exam_id = ?').all(session.exam_id) as Array<{ id: number }>
      ).map((q) => q.id)
    );
    const nowIso = new Date().toISOString();
    const upsert = db.prepare(`
      INSERT INTO answers (session_id, question_id, selected_option, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(session_id, question_id) DO UPDATE SET
        selected_option = excluded.selected_option,
        updated_at = excluded.updated_at
    `);
    db.transaction(() => {
      for (const [qIdStr, opt] of Object.entries(answers)) {
        const qId = Number(qIdStr);
        if (!validQuestions.has(qId)) continue;
        if (opt !== 'A' && opt !== 'B' && opt !== 'C' && opt !== 'D') continue;
        upsert.run(session.id, qId, opt, nowIso);
      }
    })();
  }

  const finalized = finalizeSessionScore(session.id);

  res.json({
    ok: true,
    status: finalized.status,
    result: {
      student_name: finalized.student_name,
      nis: finalized.nis,
      student_class: finalized.student_class,
      correct_count: finalized.correct_count,
      wrong_count: finalized.wrong_count,
      unanswered_count: finalized.unanswered_count,
      score: finalized.score,
      max_score: finalized.max_score,
      final_grade: finalized.final_grade,
      violation_count: finalized.violation_count,
      submitted_at: finalized.submitted_at,
    },
  });
});
