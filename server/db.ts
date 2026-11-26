import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'ujianku.db');
export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS exams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    subject TEXT NOT NULL,
    class_level TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    max_warnings INTEGER NOT NULL DEFAULT 2,
    token TEXT NOT NULL UNIQUE,
    is_active INTEGER NOT NULL DEFAULT 1,
    shuffle_questions INTEGER NOT NULL DEFAULT 1,
    shuffle_options INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    option_a TEXT NOT NULL,
    option_b TEXT NOT NULL,
    option_c TEXT NOT NULL,
    option_d TEXT NOT NULL,
    correct_option TEXT NOT NULL CHECK(correct_option IN ('A', 'B', 'C', 'D')),
    points REAL NOT NULL DEFAULT 1,
    image_data TEXT,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS student_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    nis TEXT NOT NULL,
    student_name TEXT NOT NULL,
    student_class TEXT NOT NULL,
    device_id TEXT,
    session_secret TEXT,
    status TEXT NOT NULL CHECK(status IN ('BELUM_MULAI', 'MENGERJAKAN', 'TERKUNCI', 'SELESAI')) DEFAULT 'BELUM_MULAI',
    question_order_json TEXT NOT NULL DEFAULT '[]',
    option_order_json TEXT NOT NULL DEFAULT '{}',
    violation_count INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    ends_at TEXT,
    submitted_at TEXT,
    last_heartbeat_at TEXT,
    correct_count INTEGER NOT NULL DEFAULT 0,
    wrong_count INTEGER NOT NULL DEFAULT 0,
    unanswered_count INTEGER NOT NULL DEFAULT 0,
    score REAL NOT NULL DEFAULT 0,
    max_score REAL NOT NULL DEFAULT 0,
    final_grade REAL NOT NULL DEFAULT 0,
    UNIQUE(exam_id, nis)
  );

  CREATE TABLE IF NOT EXISTS answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES student_sessions(id) ON DELETE CASCADE,
    question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    selected_option TEXT NOT NULL CHECK(selected_option IN ('A', 'B', 'C', 'D')),
    updated_at TEXT NOT NULL,
    UNIQUE(session_id, question_id)
  );

  CREATE TABLE IF NOT EXISTS violation_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES student_sessions(id) ON DELETE CASCADE,
    violation_type TEXT NOT NULL,
    detail TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_questions_exam ON questions(exam_id, order_index);
  CREATE INDEX IF NOT EXISTS idx_sessions_exam ON student_sessions(exam_id, status);
  CREATE INDEX IF NOT EXISTS idx_answers_session ON answers(session_id);
  CREATE INDEX IF NOT EXISTS idx_violations_session ON violation_logs(session_id, created_at);
`);

export interface ExamRow {
  id: number;
  title: string;
  subject: string;
  class_level: string;
  duration_minutes: number;
  max_warnings: number;
  token: string;
  is_active: number;
  shuffle_questions: number;
  shuffle_options: number;
  created_at: string;
}

export interface QuestionRow {
  id: number;
  exam_id: number;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: 'A' | 'B' | 'C' | 'D';
  points: number;
  image_data: string | null;
  order_index: number;
  created_at: string;
}

export interface StudentSessionRow {
  id: number;
  exam_id: number;
  nis: string;
  student_name: string;
  student_class: string;
  device_id: string | null;
  session_secret: string | null;
  status: 'BELUM_MULAI' | 'MENGERJAKAN' | 'TERKUNCI' | 'SELESAI';
  question_order_json: string;
  option_order_json: string;
  violation_count: number;
  started_at: string | null;
  ends_at: string | null;
  submitted_at: string | null;
  last_heartbeat_at: string | null;
  correct_count: number;
  wrong_count: number;
  unanswered_count: number;
  score: number;
  max_score: number;
  final_grade: number;
}

export function shuffleArray<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function finalizeSessionScore(sessionId: number): StudentSessionRow {
  const runTx = db.transaction(() => {
    const session = db
      .prepare('SELECT * FROM student_sessions WHERE id = ?')
      .get(sessionId) as StudentSessionRow | undefined;

    if (!session) {
      throw new Error('Sesi siswa tidak ditemukan');
    }

    if (session.status === 'SELESAI') {
      return session;
    }

    const questions = db
      .prepare('SELECT id, correct_option, points FROM questions WHERE exam_id = ?')
      .all(session.exam_id) as Array<{ id: number; correct_option: string; points: number }>;

    const answers = db
      .prepare('SELECT question_id, selected_option FROM answers WHERE session_id = ?')
      .all(sessionId) as Array<{ question_id: number; selected_option: string }>;

    const answerMap = new Map<number, string>();
    for (const a of answers) {
      answerMap.set(a.question_id, a.selected_option);
    }

    let correctCount = 0;
    let wrongCount = 0;
    let unansweredCount = 0;
    let score = 0;
    let maxScore = 0;

    for (const q of questions) {
      const pts = Number(q.points) || 1;
      maxScore += pts;
      const chosen = answerMap.get(q.id);
      if (!chosen) {
        unansweredCount += 1;
      } else if (chosen === q.correct_option) {
        correctCount += 1;
        score += pts;
      } else {
        wrongCount += 1;
      }
    }

    const finalGrade = maxScore > 0 ? Math.round((score / maxScore) * 10000) / 100 : 0;
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE student_sessions
      SET status = 'SELESAI',
          submitted_at = COALESCE(submitted_at, ?),
          last_heartbeat_at = ?,
          correct_count = ?,
          wrong_count = ?,
          unanswered_count = ?,
          score = ?,
          max_score = ?,
          final_grade = ?
      WHERE id = ?
    `).run(now, now, correctCount, wrongCount, unansweredCount, score, maxScore, finalGrade, sessionId);

    return db
      .prepare('SELECT * FROM student_sessions WHERE id = ?')
      .get(sessionId) as StudentSessionRow;
  });

  return runTx();
}

export function autoFinalizeExpiredSessions(examId: number): void {
  const nowMs = Date.now();
  const activeSessions = db
    .prepare("SELECT id, ends_at FROM student_sessions WHERE exam_id = ? AND status = 'MENGERJAKAN' AND ends_at IS NOT NULL")
    .all(examId) as Array<{ id: number; ends_at: string }>;

  for (const s of activeSessions) {
    const endsMs = Date.parse(s.ends_at);
    if (!Number.isNaN(endsMs) && nowMs > endsMs + 15000) {
      finalizeSessionScore(s.id);
    }
  }
}

function seedDatabaseIfEmpty(): void {
  const countRow = db.prepare('SELECT COUNT(*) AS cnt FROM exams').get() as { cnt: number };
  if (countRow.cnt > 0) return;

  const now = new Date().toISOString();

  const insertExam = db.prepare(`
    INSERT INTO exams (title, subject, class_level, duration_minutes, max_warnings, token, is_active, shuffle_questions, shuffle_options, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertQuestion = db.prepare(`
    INSERT INTO questions (exam_id, question_text, option_a, option_b, option_c, option_d, correct_option, points, image_data, order_index, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `);

  const seedTx = db.transaction(() => {
    const exam1Res = insertExam.run(
      'Penilaian Akhir Semester (PAS) — Matematika Wajib',
      'Matematika Wajib',
      'XI IPA',
      45,
      2,
      'PASMTK26',
      1,
      1,
      1,
      now
    );
    const exam1Id = Number(exam1Res.lastInsertRowid);

    const mathQuestions: Array<[string, string, string, string, string, 'A' | 'B' | 'C' | 'D', number]> = [
      [
        'Diketahui barisan aritmetika dengan suku ke-3 adalah 11 dan suku ke-7 adalah 23. Suku ke-15 barisan tersebut adalah...',
        '44',
        '47',
        '50',
        '53',
        'B',
        10,
      ],
      [
        'Nilai dari lim (x -> 2) (x² - 4) / (x - 2) adalah...',
        '0',
        '2',
        '4',
        '8',
        'C',
        10,
      ],
      [
        'Turunan pertama dari fungsi f(x) = 3x⁴ - 2x² + 5x - 7 adalah...',
        '12x³ - 4x + 5',
        '12x³ - 2x + 5',
        '3x³ - 4x + 5',
        '12x⁴ - 4x² + 5',
        'A',
        15,
      ],
      [
        'Jika matriks A = [[2, 3], [1, 4]], maka determinan dari matriks A adalah...',
        '2',
        '5',
        '8',
        '11',
        'B',
        10,
      ],
      [
        'Dalam sebuah kotak terdapat 5 bola merah dan 3 bola biru. Jika diambil 1 bola secara acak, peluang terambilnya bola biru adalah...',
        '3/5',
        '5/8',
        '3/8',
        '1/3',
        'C',
        10,
      ],
      [
        'Rata-rata nilai ulangan 6 siswa adalah 75. Jika ditambah nilai 2 siswa baru, rata-ratanya menjadi 78. Rata-rata nilai 2 siswa baru tersebut adalah...',
        '84',
        '87',
        '89',
        '90',
        'B',
        15,
      ],
      [
        'Jumlah deret geometri tak hingga dengan suku pertama 12 dan rasio 1/3 adalah...',
        '15',
        '16',
        '18',
        '24',
        'C',
        15,
      ],
      [
        'Nilai dari sin 30° + cos 60° adalah...',
        '0',
        '1/2',
        '1',
        '√3',
        'C',
        15,
      ],
    ];

    const exam1QuestionIds: number[] = [];
    mathQuestions.forEach((q, idx) => {
      const res = insertQuestion.run(exam1Id, q[0], q[1], q[2], q[3], q[4], q[5], q[6], idx + 1, now);
      exam1QuestionIds.push(Number(res.lastInsertRowid));
    });

    const exam2Res = insertExam.run(
      'Penilaian Akhir Semester (PAS) — Bahasa Indonesia',
      'Bahasa Indonesia',
      'XI IPA / IPS',
      40,
      2,
      'PASBIN26',
      1,
      1,
      1,
      now
    );
    const exam2Id = Number(exam2Res.lastInsertRowid);

    const indoQuestions: Array<[string, string, string, string, string, 'A' | 'B' | 'C' | 'D', number]> = [
      [
        'Ciri utama teks prosedur yang membedakannya dengan teks eksposisi adalah...',
        'Berisi langkah-langkah sistematis untuk mencapai suatu tujuan',
        'Memaparkan argumen penulis berdasarkan opini pribadi',
        'Mengisahkan peristiwa masa lampau secara kronologis',
        'Menggambarkan objek secara rinci menggunakan pancaindra',
        'A',
        20,
      ],
      [
        'Kalimat berikut yang menggunakan kata baku sesuai kaidah EYD adalah...',
        'Para siswa dihimbau untuk mengantri dengan tertib di ruang ujian.',
        'Jadwal ujian semester telah disahkan oleh kepala sekolah.',
        'Atlit sekolah kami berhasil meraih medali emas tingkat provinsi.',
        'Apotik tersebut menyediakan obat-obatan yang cukup lengkap.',
        'B',
        20,
      ],
      [
        'Struktur teks eksplanasi yang tepat secara berurutan adalah...',
        'Pernyataan umum - Deretan penjelas - Interpretasi',
        'Orientasi - Komplikasi - Resolusi',
        'Abstraksi - Orientasi - Krisis - Reaksi',
        'Tesis - Argumentasi - Penegasan ulang',
        'A',
        20,
      ],
      [
        'Makna imbuhan "me-kan" pada kalimat "Ibu membacakan adik cerita rakyat" adalah...',
        'Melakukan pekerjaan untuk diri sendiri',
        'Menyebabkan sesuatu menjadi',
        'Melakukan pekerjaan untuk orang lain',
        'Menyerupai sesuatu yang disebut kata dasar',
        'C',
        20,
      ],
      [
        'Penulisan daftar pustaka yang benar untuk buku berjudul "Linguistik Umum" karya Abdul Chaer yang diterbitkan Rineka Cipta di Jakarta tahun 2014 adalah...',
        'Abdul Chaer. 2014. Linguistik Umum. Jakarta: Rineka Cipta.',
        'Chaer, Abdul. 2014. Linguistik Umum. Jakarta: Rineka Cipta.',
        'Chaer, Abdul. Linguistik Umum. 2014. Rineka Cipta: Jakarta.',
        'Chaer, Abdul, 2014, Linguistik Umum, Jakarta: Rineka Cipta.',
        'B',
        20,
      ],
    ];

    indoQuestions.forEach((q, idx) => {
      insertQuestion.run(exam2Id, q[0], q[1], q[2], q[3], q[4], q[5], q[6], idx + 1, now);
    });

    // Seed sample student sessions for Exam 1 covering all 4 statuses
    const optionMap: Record<number, string[]> = {};
    for (const qId of exam1QuestionIds) {
      optionMap[qId] = ['A', 'B', 'C', 'D'];
    }
    const orderJson = JSON.stringify(exam1QuestionIds);
    const optJson = JSON.stringify(optionMap);

    const insertSession = db.prepare(`
      INSERT INTO student_sessions (
        exam_id, nis, student_name, student_class, device_id, session_secret,
        status, question_order_json, option_order_json, violation_count,
        started_at, ends_at, submitted_at, last_heartbeat_at,
        correct_count, wrong_count, unanswered_count, score, max_score, final_grade
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertAnswer = db.prepare(`
      INSERT INTO answers (session_id, question_id, selected_option, updated_at)
      VALUES (?, ?, ?, ?)
    `);

    const insertViolation = db.prepare(`
      INSERT INTO violation_logs (session_id, violation_type, detail, created_at)
      VALUES (?, ?, ?, ?)
    `);

    const startedAgo35 = new Date(Date.now() - 35 * 60 * 1000).toISOString();
    const endedAgo5 = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const endsIn10 = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const startedAgo18 = new Date(Date.now() - 18 * 60 * 1000).toISOString();
    const endsIn27 = new Date(Date.now() + 27 * 60 * 1000).toISOString();

    // 1. SELESAI
    const s1 = insertSession.run(
      exam1Id, '20260101', 'Ahmad Fauzan', 'XI IPA 1', 'seed-device-1', 'seed-secret-1',
      'SELESAI', orderJson, optJson, 0,
      startedAgo35, endsIn10, endedAgo5, endedAgo5,
      7, 1, 0, 90, 100, 90
    );
    const s1Id = Number(s1.lastInsertRowid);
    mathQuestions.forEach((q, idx) => {
      const chosen = idx === 3 ? 'A' : q[5]; // 1 wrong on q4 (10 pts) => 90/100
      insertAnswer.run(s1Id, exam1QuestionIds[idx], chosen, endedAgo5);
    });

    // 2. TERKUNCI (3 violations - ready for teacher Unlock demo!)
    const s2 = insertSession.run(
      exam1Id, '20260102', 'Nadia Putri Rahayu', 'XI IPA 1', 'seed-device-2', 'seed-secret-2',
      'TERKUNCI', orderJson, optJson, 3,
      startedAgo18, endsIn27, null, startedAgo18,
      0, 0, 0, 0, 100, 0
    );
    const s2Id = Number(s2.lastInsertRowid);
    insertAnswer.run(s2Id, exam1QuestionIds[0], 'B', startedAgo18);
    insertAnswer.run(s2Id, exam1QuestionIds[1], 'C', startedAgo18);
    insertViolation.run(s2Id, 'PINDAH_TAB', 'Siswa berpindah tab atau meminimalkan browser (Peringatan 1/2)', new Date(Date.now() - 14 * 60 * 1000).toISOString());
    insertViolation.run(s2Id, 'KELUAR_FULLSCREEN', 'Siswa keluar dari mode layar penuh ujian (Peringatan 2/2)', new Date(Date.now() - 10 * 60 * 1000).toISOString());
    insertViolation.run(s2Id, 'HILANG_FOKUS', 'Jendela ujian kehilangan fokus layar — sesi otomatis dikunci (3/2)', new Date(Date.now() - 6 * 60 * 1000).toISOString());

    // 3. MENGERJAKAN (1 warning)
    const s3 = insertSession.run(
      exam1Id, '20260103', 'Rizky Ramadhan', 'XI IPA 2', 'seed-device-3', 'seed-secret-3',
      'MENGERJAKAN', orderJson, optJson, 1,
      startedAgo18, endsIn27, null, new Date().toISOString(),
      0, 0, 0, 0, 100, 0
    );
    const s3Id = Number(s3.lastInsertRowid);
    insertAnswer.run(s3Id, exam1QuestionIds[0], 'B', now);
    insertAnswer.run(s3Id, exam1QuestionIds[1], 'C', now);
    insertAnswer.run(s3Id, exam1QuestionIds[2], 'A', now);
    insertAnswer.run(s3Id, exam1QuestionIds[3], 'B', now);
    insertViolation.run(s3Id, 'HILANG_FOKUS', 'Jendela ujian sempat kehilangan fokus (Peringatan 1/2)', new Date(Date.now() - 7 * 60 * 1000).toISOString());

    // 4 & 5. BELUM_MULAI (ready to be claimed by student login!)
    insertSession.run(
      exam1Id, '20260104', 'Siti Aminah', 'XI IPA 1', null, null,
      'BELUM_MULAI', '[]', '{}', 0,
      null, null, null, null,
      0, 0, 0, 0, 100, 0
    );
    insertSession.run(
      exam1Id, '20260105', 'Dimas Pratama', 'XI IPA 2', null, null,
      'BELUM_MULAI', '[]', '{}', 0,
      null, null, null, null,
      0, 0, 0, 0, 100, 0
    );
  });

  seedTx();
}

seedDatabaseIfEmpty();
