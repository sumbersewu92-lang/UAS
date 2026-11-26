import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import {
  BOOTSTRAP_ADMIN_EMAIL,
  OperationType,
  auth,
  db,
  ensureStudentAuthSession,
  handleFirestoreError,
} from '../firebase';
import type {
  ExamJoinResponse,
  ExamResultSummary,
  MonitorParticipant,
  OptionKey,
  SessionStatus,
  StudentQuestion,
  TeacherExam,
  TeacherQuestion,
  ViolationLogItem,
} from '../types';
import type { ParsedBulkQuestion } from './csvAndParser';

export interface LookupExamPreview {
  id: string;
  title: string;
  subject: string;
  class_level: string;
  duration_minutes: number;
  max_warnings: number;
  is_active: boolean;
  question_count: number;
}

function clampStr(val: string, maxLen: number): string {
  return val.trim().slice(0, maxLen);
}

export function normalizeToken(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
}

export function normalizeNis(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-')
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 40);
}

export function makeDocId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export function generateRandomToken(length = 6): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function timestampToIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof value === 'string') return value;
  return null;
}

function timestampToMs(value: unknown): number | null {
  const iso = timestampToIso(value);
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

async function getAccurateNowMs(): Promise<number> {
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 1500);
    const res = await fetch(window.location.href, { method: 'HEAD', cache: 'no-store', signal: controller.signal });
    window.clearTimeout(timer);
    const dateHdr = res.headers.get('date');
    if (dateHdr) {
      const parsed = Date.parse(dateHdr);
      if (!Number.isNaN(parsed)) return parsed;
    }
  } catch {
    // Fallback to device clock
  }
  return Date.now();
}

function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export async function checkIsTeacher(user: User | null): Promise<boolean> {
  if (!user || !user.emailVerified) return false;
  if (user.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL) return true;

  const path = `teachers/${user.uid}`;
  try {
    const snap = await getDoc(doc(db, 'teachers', user.uid));
    return snap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function ensureSeedDataIfEmpty(teacherUid: string): Promise<void> {
  const examsPath = 'exams';
  let existingExams;
  try {
    existingExams = await getDocs(collection(db, examsPath));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, examsPath);
  }

  if (!existingExams.empty) return;

  const mathQ: Array<[string, string, string, string, string, OptionKey, number]> = [
    ['Diketahui barisan aritmetika dengan suku ke-3 adalah 11 dan suku ke-7 adalah 23. Suku ke-15 barisan tersebut adalah...', '44', '47', '50', '53', 'B', 10],
    ['Nilai dari lim (x -> 2) (x² - 4) / (x - 2) adalah...', '0', '2', '4', '8', 'C', 10],
    ['Turunan pertama dari fungsi f(x) = 3x⁴ - 2x² + 5x - 7 adalah...', '12x³ - 4x + 5', '12x³ - 2x + 5', '3x³ - 4x + 5', '12x⁴ - 4x² + 5', 'A', 15],
    ['Jika matriks A = [[2, 3], [1, 4]], maka determinan dari matriks A adalah...', '2', '5', '8', '11', 'B', 10],
    ['Dalam sebuah kotak terdapat 5 bola merah dan 3 bola biru. Jika diambil 1 bola secara acak, peluang terambilnya bola biru adalah...', '3/5', '5/8', '3/8', '1/3', 'C', 10],
    ['Rata-rata nilai ulangan 6 siswa adalah 75. Jika ditambah nilai 2 siswa baru, rata-ratanya menjadi 78. Rata-rata nilai 2 siswa baru tersebut adalah...', '84', '87', '89', '90', 'B', 15],
    ['Jumlah deret geometri tak hingga dengan suku pertama 12 dan rasio 1/3 adalah...', '15', '16', '18', '24', 'C', 15],
    ['Nilai dari sin 30° + cos 60° adalah...', '0', '1/2', '1', '√3', 'C', 15],
  ];

  const indoQ: Array<[string, string, string, string, string, OptionKey, number]> = [
    ['Ciri utama teks prosedur yang membedakannya dengan teks eksposisi adalah...', 'Berisi langkah-langkah sistematis untuk mencapai suatu tujuan', 'Memaparkan argumen penulis berdasarkan opini pribadi', 'Mengisahkan peristiwa masa lampau secara kronologis', 'Menggambarkan objek secara rinci menggunakan pancaindra', 'A', 20],
    ['Kalimat berikut yang menggunakan kata baku sesuai kaidah EYD adalah...', 'Para siswa dihimbau untuk mengantri dengan tertib di ruang ujian.', 'Jadwal ujian semester telah disahkan oleh kepala sekolah.', 'Atlit sekolah kami berhasil meraih medali emas tingkat provinsi.', 'Apotik tersebut menyediakan obat-obatan yang cukup lengkap.', 'B', 20],
    ['Struktur teks eksplanasi yang tepat secara berurutan adalah...', 'Pernyataan umum - Deretan penjelas - Interpretasi', 'Orientasi - Komplikasi - Resolusi', 'Abstraksi - Orientasi - Krisis - Reaksi', 'Tesis - Argumentasi - Penegasan ulang', 'A', 20],
    ['Makna imbuhan "me-kan" pada kalimat "Ibu membacakan adik cerita rakyat" adalah...', 'Melakukan pekerjaan untuk diri sendiri', 'Menyebabkan sesuatu menjadi', 'Melakukan pekerjaan untuk orang lain', 'Menyerupai sesuatu yang disebut kata dasar', 'C', 20],
    ['Penulisan daftar pustaka yang benar untuk buku berjudul "Linguistik Umum" karya Abdul Chaer yang diterbitkan Rineka Cipta di Jakarta tahun 2014 adalah...', 'Abdul Chaer. 2014. Linguistik Umum. Jakarta: Rineka Cipta.', 'Chaer, Abdul. 2014. Linguistik Umum. Jakarta: Rineka Cipta.', 'Chaer, Abdul. Linguistik Umum. 2014. Rineka Cipta: Jakarta.', 'Chaer, Abdul, 2014, Linguistik Umum, Jakarta: Rineka Cipta.', 'B', 20],
  ];

  const exam1Id = 'exam_mtk_pas26';
  const exam2Id = 'exam_bin_pas26';

  try {
    const batch1 = writeBatch(db);

    batch1.set(doc(db, 'exams', exam1Id), {
      title: 'Penilaian Akhir Semester (PAS) — Matematika Wajib',
      subject: 'Matematika Wajib',
      class_level: 'XI IPA',
      duration_minutes: 45,
      max_warnings: 2,
      token: 'PASMTK26',
      is_active: true,
      shuffle_questions: true,
      shuffle_options: true,
      question_count: mathQ.length,
      owner_uid: teacherUid,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
    batch1.set(doc(db, 'exam_tokens', 'PASMTK26'), {
      exam_id: exam1Id,
      title: 'Penilaian Akhir Semester (PAS) — Matematika Wajib',
      subject: 'Matematika Wajib',
      class_level: 'XI IPA',
      duration_minutes: 45,
      max_warnings: 2,
      is_active: true,
      question_count: mathQ.length,
      owner_uid: teacherUid,
      updated_at: serverTimestamp(),
    });

    batch1.set(doc(db, 'exams', exam2Id), {
      title: 'Penilaian Akhir Semester (PAS) — Bahasa Indonesia',
      subject: 'Bahasa Indonesia',
      class_level: 'XI IPA / IPS',
      duration_minutes: 40,
      max_warnings: 2,
      token: 'PASBIN26',
      is_active: true,
      shuffle_questions: true,
      shuffle_options: true,
      question_count: indoQ.length,
      owner_uid: teacherUid,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
    batch1.set(doc(db, 'exam_tokens', 'PASBIN26'), {
      exam_id: exam2Id,
      title: 'Penilaian Akhir Semester (PAS) — Bahasa Indonesia',
      subject: 'Bahasa Indonesia',
      class_level: 'XI IPA / IPS',
      duration_minutes: 40,
      max_warnings: 2,
      is_active: true,
      question_count: indoQ.length,
      owner_uid: teacherUid,
      updated_at: serverTimestamp(),
    });

    await batch1.commit();

    const batch2 = writeBatch(db);
    const q1Ids: string[] = [];
    const optMap1: Record<string, OptionKey[]> = {};

    mathQ.forEach((q, idx) => {
      const qId = `q_mtk_${idx + 1}`;
      q1Ids.push(qId);
      optMap1[qId] = ['A', 'B', 'C', 'D'];
      batch2.set(doc(db, 'exams', exam1Id, 'questions', qId), {
        exam_id: exam1Id,
        exam_active: true,
        question_text: q[0],
        option_a: q[1],
        option_b: q[2],
        option_c: q[3],
        option_d: q[4],
        points: q[6],
        image_data: null,
        order_index: idx + 1,
        created_at: serverTimestamp(),
      });
      batch2.set(doc(db, 'exams', exam1Id, 'answer_keys', qId), {
        correct_option: q[5],
        points: q[6],
        updated_at: serverTimestamp(),
      });
    });

    indoQ.forEach((q, idx) => {
      const qId = `q_bin_${idx + 1}`;
      batch2.set(doc(db, 'exams', exam2Id, 'questions', qId), {
        exam_id: exam2Id,
        exam_active: true,
        question_text: q[0],
        option_a: q[1],
        option_b: q[2],
        option_c: q[3],
        option_d: q[4],
        points: q[6],
        image_data: null,
        order_index: idx + 1,
        created_at: serverTimestamp(),
      });
      batch2.set(doc(db, 'exams', exam2Id, 'answer_keys', qId), {
        correct_option: q[5],
        points: q[6],
        updated_at: serverTimestamp(),
      });
    });

    await batch2.commit();

    // Sample sessions on Matematika Wajib
    const batch3 = writeBatch(db);
    const nowMs = Date.now();
    const startedAgo35 = Timestamp.fromMillis(nowMs - 35 * 60_000);
    const endedAgo5 = Timestamp.fromMillis(nowMs - 5 * 60_000);
    const endsIn10 = Timestamp.fromMillis(nowMs + 10 * 60_000);
    const startedAgo18 = Timestamp.fromMillis(nowMs - 18 * 60_000);
    const endsIn27 = Timestamp.fromMillis(nowMs + 27 * 60_000);

    batch3.set(doc(db, 'exams', exam1Id, 'sessions', '20260101'), {
      exam_id: exam1Id,
      nis: '20260101',
      student_name: 'Ahmad Fauzan',
      student_class: 'XI IPA 1',
      student_uid: 'seed_uid_20260101',
      device_id: 'seed-dev-1',
      status: 'SELESAI',
      question_order: q1Ids,
      option_order: optMap1,
      answers: {
        q_mtk_1: 'B',
        q_mtk_2: 'C',
        q_mtk_3: 'A',
        q_mtk_4: 'A',
        q_mtk_5: 'C',
        q_mtk_6: 'B',
        q_mtk_7: 'C',
        q_mtk_8: 'C',
      },
      violation_count: 0,
      started_at: startedAgo35,
      ends_at: endsIn10,
      submitted_at: endedAgo5,
      last_heartbeat_at: endedAgo5,
      correct_count: 7,
      wrong_count: 1,
      unanswered_count: 0,
      score: 90,
      max_score: 100,
      final_grade: 90,
      graded: true,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });

    batch3.set(doc(db, 'exams', exam1Id, 'sessions', '20260102'), {
      exam_id: exam1Id,
      nis: '20260102',
      student_name: 'Nadia Putri Rahayu',
      student_class: 'XI IPA 1',
      student_uid: 'seed_uid_20260102',
      device_id: 'seed-dev-2',
      status: 'TERKUNCI',
      question_order: q1Ids,
      option_order: optMap1,
      answers: {
        q_mtk_1: 'B',
        q_mtk_2: 'C',
      },
      violation_count: 3,
      started_at: startedAgo18,
      ends_at: endsIn27,
      submitted_at: null,
      last_heartbeat_at: startedAgo18,
      correct_count: 0,
      wrong_count: 0,
      unanswered_count: 0,
      score: 0,
      max_score: 100,
      final_grade: 0,
      graded: false,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });

    batch3.set(doc(db, 'exams', exam1Id, 'sessions', '20260103'), {
      exam_id: exam1Id,
      nis: '20260103',
      student_name: 'Bagas Pratama',
      student_class: 'XI IPA 1',
      student_uid: null,
      device_id: null,
      status: 'BELUM_MULAI',
      question_order: [],
      option_order: {},
      answers: {},
      violation_count: 0,
      started_at: null,
      ends_at: null,
      submitted_at: null,
      last_heartbeat_at: null,
      correct_count: 0,
      wrong_count: 0,
      unanswered_count: 0,
      score: 0,
      max_score: 100,
      final_grade: 0,
      graded: false,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });

    await batch3.commit();

    const batch4 = writeBatch(db);
    const seedViolations = [
      { id: 'vio_seed_1', type: 'PINDAH_TAB', detail: 'Siswa berpindah tab atau meminimalkan browser (Peringatan 1/2)' },
      { id: 'vio_seed_2', type: 'KELUAR_FULLSCREEN', detail: 'Siswa keluar dari mode layar penuh ujian (Peringatan 2/2)' },
      { id: 'vio_seed_3', type: 'HILANG_FOKUS', detail: 'Layar ujian kehilangan fokus — sesi dikunci otomatis (Ke-3)' },
    ];
    seedViolations.forEach((v) => {
      batch4.set(doc(db, 'exams', exam1Id, 'sessions', '20260102', 'violations', v.id), {
        session_id: '20260102',
        student_uid: 'seed_uid_20260102',
        violation_type: v.type,
        detail: v.detail,
        created_at: serverTimestamp(),
      });
    });
    await batch4.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'exams');
  }
}

export async function lookupExamByToken(rawToken: string): Promise<{ exam: LookupExamPreview | null; error?: string }> {
  const token = normalizeToken(rawToken);
  if (token.length < 4) return { exam: null, error: 'Token minimal 4 karakter.' };
  const path = `exam_tokens/${token}`;
  try {
    await ensureStudentAuthSession();
    const snap = await getDoc(doc(db, 'exam_tokens', token));
    if (!snap.exists()) {
      return {
        exam: null,
        error: 'Token ujian tidak ditemukan. Pastikan huruf & angka token sesuai (atau Guru perlu masuk sekali untuk inisialisasi paket contoh).',
      };
    }
    const d = snap.data();
    return {
      exam: {
        id: String(d.exam_id),
        title: String(d.title),
        subject: String(d.subject),
        class_level: String(d.class_level),
        duration_minutes: Number(d.duration_minutes),
        max_warnings: Number(d.max_warnings),
        is_active: Boolean(d.is_active),
        question_count: Number(d.question_count ?? 0),
      },
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function joinExamSession(params: {
  nis: string;
  studentName: string;
  studentClass: string;
  token: string;
  deviceId: string;
}): Promise<{ data?: ExamJoinResponse; error?: string; completedSummary?: ExamResultSummary }> {
  const user = auth.currentUser ?? (await ensureStudentAuthSession());

  const token = normalizeToken(params.token);
  const nis = normalizeNis(params.nis);
  const studentName = clampStr(params.studentName, 100);
  const studentClass = clampStr(params.studentClass, 40);
  const deviceId = clampStr(params.deviceId, 128);

  if (!token || !nis || !studentName || !studentClass) {
    return { error: 'Lengkapi Token Ujian, NIS, Nama Lengkap, dan Kelas terlebih dahulu.' };
  }

  let tokenData: Record<string, unknown>;
  try {
    const tokenSnap = await getDoc(doc(db, 'exam_tokens', token));
    if (!tokenSnap.exists()) {
      return { error: 'Token ujian tidak valid atau belum terdaftar.' };
    }
    tokenData = tokenSnap.data();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `exam_tokens/${token}`);
  }

  if (!tokenData.is_active) {
    return { error: 'Token ujian sedang dinonaktifkan oleh guru/pengawas.' };
  }

  const examId = String(tokenData.exam_id);
  let examData: Record<string, unknown>;
  try {
    const examSnap = await getDoc(doc(db, 'exams', examId));
    if (!examSnap.exists()) {
      return { error: 'Paket ujian tidak ditemukan.' };
    }
    examData = examSnap.data();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `exams/${examId}`);
  }

  if (!examData.is_active) {
    return { error: 'Paket ujian saat ini sedang tidak aktif.' };
  }

  // Fetch student-safe questions (must satisfy `where('exam_active', '==', true)` per security rules)
  interface RawQ {
    id: string;
    question_text: string;
    option_a: string;
    option_b: string;
    option_c: string;
    option_d: string;
    points: number;
    image_data: string | null;
    order_index: number;
  }
  let rawQuestions: RawQ[] = [];
  try {
    const qSnap = await getDocs(
      query(collection(db, 'exams', examId, 'questions'), where('exam_active', '==', true))
    );
    rawQuestions = qSnap.docs
      .map((d) => {
        const data = d.data();
        return {
          id: d.id,
          question_text: String(data.question_text),
          option_a: String(data.option_a),
          option_b: String(data.option_b),
          option_c: String(data.option_c),
          option_d: String(data.option_d),
          points: Number(data.points),
          image_data: typeof data.image_data === 'string' ? data.image_data : null,
          order_index: Number(data.order_index ?? 0),
        };
      })
      .sort((a, b) => a.order_index - b.order_index);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, `exams/${examId}/questions`);
  }

  if (rawQuestions.length === 0) {
    return { error: 'Belum ada soal di dalam paket ujian ini. Hubungi guru Anda.' };
  }

  const sessionPath = `exams/${examId}/sessions/${nis}`;
  const sessionRef = doc(db, 'exams', examId, 'sessions', nis);

  let existingSnap;
  try {
    existingSnap = await getDoc(sessionRef);
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === 'permission-denied') {
      return {
        error:
          'Nomor Ujian / NIS ini sedang aktif di perangkat atau browser lain. Jika Anda berganti HP, minta pengawas menekan tombol Reset HP.',
      };
    }
    handleFirestoreError(error, OperationType.GET, sessionPath);
  }

  const qMap = new Map(rawQuestions.map((q) => [q.id, q]));
  const durationMinutes = Number(examData.duration_minutes);
  const maxWarnings = Number(examData.max_warnings);
  const shuffleQuestions = Boolean(examData.shuffle_questions);
  const shuffleOptions = Boolean(examData.shuffle_options);

  const buildOrderAndOptions = () => {
    const ids = rawQuestions.map((q) => q.id);
    const questionOrder = shuffleQuestions ? shuffleArray(ids) : ids;
    const optionOrder: Record<string, OptionKey[]> = {};
    for (const id of questionOrder) {
      optionOrder[id] = shuffleOptions ? shuffleArray<OptionKey>(['A', 'B', 'C', 'D']) : ['A', 'B', 'C', 'D'];
    }
    return { questionOrder, optionOrder };
  };

  let finalSessionData: Record<string, unknown>;
  const serverNowMs = await getAccurateNowMs();

  if (!existingSnap.exists()) {
    const { questionOrder, optionOrder } = buildOrderAndOptions();
    const endsAtTs = Timestamp.fromMillis(serverNowMs + durationMinutes * 60_000);
    try {
      await setDoc(sessionRef, {
        exam_id: examId,
        nis,
        student_name: studentName,
        student_class: studentClass,
        student_uid: user.uid,
        device_id: deviceId,
        status: 'MENGERJAKAN',
        question_order: questionOrder,
        option_order: optionOrder,
        answers: {},
        violation_count: 0,
        started_at: serverTimestamp(),
        ends_at: endsAtTs,
        submitted_at: null,
        last_heartbeat_at: serverTimestamp(),
        correct_count: 0,
        wrong_count: 0,
        unanswered_count: 0,
        score: 0,
        max_score: 0,
        final_grade: 0,
        graded: false,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
      const readBack = await getDoc(sessionRef);
      finalSessionData = readBack.data() || {};
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, sessionPath);
    }
  } else {
    const cur = existingSnap.data();
    const curStatus = cur.status as SessionStatus;

    if (curStatus === 'SELESAI') {
      const answeredCount = Object.keys((cur.answers as Record<string, OptionKey>) || {}).length;
      return {
        error: `Nomor Ujian / NIS ${nis} sudah mengumpulkan ujian ini.`,
        completedSummary: {
          student_name: String(cur.student_name),
          nis: String(cur.nis),
          student_class: String(cur.student_class),
          correct_count: Number(cur.correct_count ?? 0),
          wrong_count: Number(cur.wrong_count ?? 0),
          unanswered_count: Number(cur.unanswered_count ?? 0),
          score: Number(cur.score ?? 0),
          max_score: Number(cur.max_score ?? 0),
          final_grade: Number(cur.final_grade ?? 0),
          graded: Boolean(cur.graded),
          violation_count: Number(cur.violation_count ?? 0),
          answered_count: answeredCount,
          total_questions: rawQuestions.length,
          submitted_at: timestampToIso(cur.submitted_at),
        },
      };
    }

    if (curStatus === 'BELUM_MULAI') {
      const { questionOrder, optionOrder } = buildOrderAndOptions();
      const endsAtTs = Timestamp.fromMillis(serverNowMs + durationMinutes * 60_000);
      try {
        await updateDoc(sessionRef, {
          student_name: studentName,
          student_class: studentClass,
          student_uid: user.uid,
          device_id: deviceId,
          status: 'MENGERJAKAN',
          question_order: questionOrder,
          option_order: optionOrder,
          started_at: serverTimestamp(),
          ends_at: endsAtTs,
          last_heartbeat_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        });
        const readBack = await getDoc(sessionRef);
        finalSessionData = readBack.data() || {};
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, sessionPath);
      }
    } else {
      // MENGERJAKAN or TERKUNCI
      if (cur.device_id && cur.device_id !== deviceId) {
        return {
          error:
            'Nomor Ujian / NIS ini sedang aktif di HP/browser lain. Minta guru/pengawas menekan tombol Reset HP jika Anda perlu pindah perangkat.',
        };
      }
      try {
        await updateDoc(sessionRef, {
          student_uid: user.uid,
          device_id: deviceId,
          last_heartbeat_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        });
        const readBack = await getDoc(sessionRef);
        finalSessionData = readBack.data() || cur;
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, sessionPath);
      }
    }
  }

  const orderIds = Array.isArray(finalSessionData.question_order) && finalSessionData.question_order.length > 0
    ? (finalSessionData.question_order as string[]).filter((id) => qMap.has(id))
    : rawQuestions.map((q) => q.id);

  // Append any newly added questions not in stored order
  for (const q of rawQuestions) {
    if (!orderIds.includes(q.id)) orderIds.push(q.id);
  }

  const storedOptOrder = (finalSessionData.option_order as Record<string, OptionKey[]>) || {};
  const displayLabels: OptionKey[] = ['A', 'B', 'C', 'D'];

  const questions: StudentQuestion[] = orderIds
    .map((id) => qMap.get(id))
    .filter((q): q is RawQ => Boolean(q))
    .map((q) => {
      const origOrder = storedOptOrder[q.id] && storedOptOrder[q.id].length === 4 ? storedOptOrder[q.id] : displayLabels;
      const optionTexts: Record<OptionKey, string> = {
        A: q.option_a,
        B: q.option_b,
        C: q.option_c,
        D: q.option_d,
      };
      return {
        id: q.id,
        question_text: q.question_text,
        image_data: q.image_data,
        points: q.points,
        options: origOrder.map((origKey, idx) => ({
          displayKey: displayLabels[idx],
          originalKey: origKey,
          text: optionTexts[origKey],
        })),
      };
    });

  const savedAnswers: Record<string, OptionKey> = {};
  const rawAnswers = (finalSessionData.answers as Record<string, unknown>) || {};
  for (const [k, v] of Object.entries(rawAnswers)) {
    if (v === 'A' || v === 'B' || v === 'C' || v === 'D') {
      savedAnswers[k] = v;
    }
  }

  const startedAtIso = timestampToIso(finalSessionData.started_at) || new Date(serverNowMs).toISOString();
  const endsAtIso =
    timestampToIso(finalSessionData.ends_at) ||
    new Date(serverNowMs + durationMinutes * 60_000).toISOString();

  return {
    data: {
      session: {
        id: nis,
        exam_id: examId,
        nis,
        student_name: String(finalSessionData.student_name ?? studentName),
        student_class: String(finalSessionData.student_class ?? studentClass),
        status: (finalSessionData.status as SessionStatus) || 'MENGERJAKAN',
        violation_count: Number(finalSessionData.violation_count ?? 0),
        started_at: startedAtIso,
        ends_at: endsAtIso,
        server_now: new Date(serverNowMs).toISOString(),
      },
      exam: {
        id: examId,
        title: String(examData.title),
        subject: String(examData.subject),
        class_level: String(examData.class_level),
        duration_minutes: durationMinutes,
        max_warnings: maxWarnings,
      },
      questions,
      savedAnswers,
    },
  };
}

export function subscribeStudentSession(
  examId: string,
  nis: string,
  totalQuestions: number,
  onChange: (update: {
    status: SessionStatus;
    violation_count: number;
    ends_at: string | null;
    result: ExamResultSummary | null;
  }) => void
): Unsubscribe {
  const path = `exams/${examId}/sessions/${nis}`;
  return onSnapshot(
    doc(db, 'exams', examId, 'sessions', nis),
    (snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      const status = d.status as SessionStatus;
      const answeredCount = Object.keys((d.answers as Record<string, OptionKey>) || {}).length;
      const result: ExamResultSummary | null =
        status === 'SELESAI'
          ? {
              student_name: String(d.student_name),
              nis: String(d.nis),
              student_class: String(d.student_class),
              correct_count: Number(d.correct_count ?? 0),
              wrong_count: Number(d.wrong_count ?? 0),
              unanswered_count: Number(d.unanswered_count ?? 0),
              score: Number(d.score ?? 0),
              max_score: Number(d.max_score ?? 0),
              final_grade: Number(d.final_grade ?? 0),
              graded: Boolean(d.graded),
              violation_count: Number(d.violation_count ?? 0),
              answered_count: answeredCount,
              total_questions: totalQuestions,
              submitted_at: timestampToIso(d.submitted_at),
            }
          : null;
      onChange({
        status,
        violation_count: Number(d.violation_count ?? 0),
        ends_at: timestampToIso(d.ends_at),
        result,
      });
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    }
  );
}

export async function syncStudentAnswers(
  examId: string,
  nis: string,
  allAnswers: Record<string, OptionKey>
): Promise<{ status: SessionStatus; locked?: boolean }> {
  const path = `exams/${examId}/sessions/${nis}`;
  const cleanAnswers: Record<string, OptionKey> = {};
  for (const [k, v] of Object.entries(allAnswers)) {
    if (v === 'A' || v === 'B' || v === 'C' || v === 'D') {
      cleanAnswers[k] = v;
    }
  }

  try {
    await updateDoc(doc(db, 'exams', examId, 'sessions', nis), {
      answers: cleanAnswers,
      last_heartbeat_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
    return { status: 'MENGERJAKAN' };
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === 'permission-denied') {
      const snap = await getDoc(doc(db, 'exams', examId, 'sessions', nis));
      const curStatus = snap.data()?.status as SessionStatus | undefined;
      if (curStatus === 'TERKUNCI') return { status: 'TERKUNCI', locked: true };
      if (curStatus === 'SELESAI') return { status: 'SELESAI' };
    }
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function recordStudentViolation(params: {
  examId: string;
  nis: string;
  violationType: string;
  detail: string;
  maxWarnings: number;
}): Promise<{ status: SessionStatus; violation_count: number }> {
  const user = auth.currentUser;
  if (!user) throw new Error('Pengguna tidak terautentikasi.');

  const sessionRef = doc(db, 'exams', params.examId, 'sessions', params.nis);
  const sessionPath = `exams/${params.examId}/sessions/${params.nis}`;

  let currentSnap;
  try {
    currentSnap = await getDoc(sessionRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, sessionPath);
  }

  if (!currentSnap.exists()) {
    throw new Error('Sesi ujian tidak ditemukan.');
  }

  const cur = currentSnap.data();
  const curStatus = cur.status as SessionStatus;
  const curCount = Number(cur.violation_count ?? 0);

  if (curStatus !== 'MENGERJAKAN') {
    return { status: curStatus, violation_count: curCount };
  }

  const nextCount = curCount + 1;
  const nextStatus: SessionStatus = nextCount > params.maxWarnings ? 'TERKUNCI' : 'MENGERJAKAN';
  const violationId = makeDocId('vio');

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'exams', params.examId, 'sessions', params.nis, 'violations', violationId), {
      session_id: params.nis,
      student_uid: user.uid,
      violation_type: clampStr(params.violationType, 50),
      detail: clampStr(params.detail, 240),
      created_at: serverTimestamp(),
    });
    batch.update(sessionRef, {
      violation_count: nextCount,
      status: nextStatus,
      last_heartbeat_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
    await batch.commit();
    return { status: nextStatus, violation_count: nextCount };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, sessionPath);
  }
}

export async function submitStudentExam(params: {
  examId: string;
  nis: string;
  studentName: string;
  studentClass: string;
  totalQuestions: number;
  violationCount: number;
  answers: Record<string, OptionKey>;
}): Promise<ExamResultSummary> {
  const path = `exams/${params.examId}/sessions/${params.nis}`;
  const cleanAnswers: Record<string, OptionKey> = {};
  for (const [k, v] of Object.entries(params.answers)) {
    if (v === 'A' || v === 'B' || v === 'C' || v === 'D') {
      cleanAnswers[k] = v;
    }
  }

  try {
    await updateDoc(doc(db, 'exams', params.examId, 'sessions', params.nis), {
      answers: cleanAnswers,
      status: 'SELESAI',
      submitted_at: serverTimestamp(),
      last_heartbeat_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === 'permission-denied') {
      const snap = await getDoc(doc(db, 'exams', params.examId, 'sessions', params.nis));
      if (snap.exists() && snap.data().status === 'SELESAI') {
        const d = snap.data();
        return {
          student_name: String(d.student_name),
          nis: String(d.nis),
          student_class: String(d.student_class),
          correct_count: Number(d.correct_count ?? 0),
          wrong_count: Number(d.wrong_count ?? 0),
          unanswered_count: Number(d.unanswered_count ?? 0),
          score: Number(d.score ?? 0),
          max_score: Number(d.max_score ?? 0),
          final_grade: Number(d.final_grade ?? 0),
          graded: Boolean(d.graded),
          violation_count: Number(d.violation_count ?? params.violationCount),
          answered_count: Object.keys((d.answers as Record<string, OptionKey>) || {}).length,
          total_questions: params.totalQuestions,
          submitted_at: timestampToIso(d.submitted_at),
        };
      }
    }
    handleFirestoreError(error, OperationType.UPDATE, path);
  }

  return {
    student_name: params.studentName,
    nis: params.nis,
    student_class: params.studentClass,
    correct_count: 0,
    wrong_count: 0,
    unanswered_count: 0,
    score: 0,
    max_score: 0,
    final_grade: 0,
    graded: false,
    violation_count: params.violationCount,
    answered_count: Object.keys(cleanAnswers).length,
    total_questions: params.totalQuestions,
    submitted_at: new Date().toISOString(),
  };
}

// ==================== TEACHER OPERATIONS ====================

export async function listTeacherExams(): Promise<TeacherExam[]> {
  try {
    const snap = await getDocs(collection(db, 'exams'));
    const exams: TeacherExam[] = [];

    for (const examDoc of snap.docs) {
      const d = examDoc.data();
      let sessionsSnap;
      try {
        sessionsSnap = await getDocs(collection(db, 'exams', examDoc.id, 'sessions'));
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, `exams/${examDoc.id}/sessions`);
      }

      let active = 0;
      let locked = 0;
      let finished = 0;
      sessionsSnap.docs.forEach((s) => {
        const st = s.data().status as SessionStatus;
        if (st === 'MENGERJAKAN') active += 1;
        else if (st === 'TERKUNCI') locked += 1;
        else if (st === 'SELESAI') finished += 1;
      });

      exams.push({
        id: examDoc.id,
        title: String(d.title),
        subject: String(d.subject),
        class_level: String(d.class_level),
        duration_minutes: Number(d.duration_minutes),
        max_warnings: Number(d.max_warnings),
        token: String(d.token),
        is_active: Boolean(d.is_active),
        shuffle_questions: Boolean(d.shuffle_questions),
        shuffle_options: Boolean(d.shuffle_options),
        created_at: timestampToIso(d.created_at) || new Date().toISOString(),
        question_count: Number(d.question_count ?? 0),
        session_stats: {
          total: sessionsSnap.size,
          active,
          locked,
          finished,
        },
      });
    }

    return exams.sort((a, b) => b.created_at.localeCompare(a.created_at));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'exams');
  }
}

export async function saveTeacherExam(params: {
  editingExam: TeacherExam | null;
  title: string;
  subject: string;
  class_level: string;
  duration_minutes: number;
  max_warnings: number;
  token: string;
  is_active: boolean;
  shuffle_questions: boolean;
  shuffle_options: boolean;
}): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sesi guru tidak valid.');

  const title = clampStr(params.title, 160);
  const subject = clampStr(params.subject, 100);
  const classLevel = clampStr(params.class_level, 60);
  const durationMinutes = Math.min(300, Math.max(5, Math.round(params.duration_minutes)));
  const maxWarnings = Math.min(10, Math.max(0, Math.round(params.max_warnings)));
  const cleanToken = normalizeToken(params.token) || generateRandomToken(6);

  if (title.length < 2 || subject.length < 2 || classLevel.length < 1) {
    throw new Error('Judul, mata pelajaran, dan kelas wajib diisi.');
  }

  // Check token uniqueness
  const existingTokenSnap = await getDoc(doc(db, 'exam_tokens', cleanToken));
  if (
    existingTokenSnap.exists() &&
    existingTokenSnap.data().exam_id !== params.editingExam?.id
  ) {
    throw new Error(`Token "${cleanToken}" sudah dipakai oleh paket ujian lain.`);
  }

  const examId = params.editingExam ? params.editingExam.id : makeDocId('exam');
  const examRef = doc(db, 'exams', examId);
  const tokenRef = doc(db, 'exam_tokens', cleanToken);

  try {
    const batch = writeBatch(db);
    const questionCount = params.editingExam ? params.editingExam.question_count : 0;

    if (!params.editingExam) {
      batch.set(examRef, {
        title,
        subject,
        class_level: classLevel,
        duration_minutes: durationMinutes,
        max_warnings: maxWarnings,
        token: cleanToken,
        is_active: params.is_active,
        shuffle_questions: params.shuffle_questions,
        shuffle_options: params.shuffle_options,
        question_count: 0,
        owner_uid: user.uid,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
      batch.set(tokenRef, {
        exam_id: examId,
        title,
        subject,
        class_level: classLevel,
        duration_minutes: durationMinutes,
        max_warnings: maxWarnings,
        is_active: params.is_active,
        question_count: 0,
        owner_uid: user.uid,
        updated_at: serverTimestamp(),
      });
      await batch.commit();
    } else {
      const oldToken = params.editingExam.token;
      batch.update(examRef, {
        title,
        subject,
        class_level: classLevel,
        duration_minutes: durationMinutes,
        max_warnings: maxWarnings,
        token: cleanToken,
        is_active: params.is_active,
        shuffle_questions: params.shuffle_questions,
        shuffle_options: params.shuffle_options,
        updated_at: serverTimestamp(),
      });

      if (oldToken !== cleanToken) {
        batch.delete(doc(db, 'exam_tokens', oldToken));
        batch.set(tokenRef, {
          exam_id: examId,
          title,
          subject,
          class_level: classLevel,
          duration_minutes: durationMinutes,
          max_warnings: maxWarnings,
          is_active: params.is_active,
          question_count: questionCount,
          owner_uid: user.uid,
          updated_at: serverTimestamp(),
        });
      } else {
        batch.update(tokenRef, {
          title,
          subject,
          class_level: classLevel,
          duration_minutes: durationMinutes,
          max_warnings: maxWarnings,
          is_active: params.is_active,
          question_count: questionCount,
          updated_at: serverTimestamp(),
        });
      }

      await batch.commit();

      if (params.editingExam.is_active !== params.is_active) {
        const qSnap = await getDocs(collection(db, 'exams', examId, 'questions'));
        for (let i = 0; i < qSnap.docs.length; i += 200) {
          const qBatch = writeBatch(db);
          qSnap.docs.slice(i, i + 200).forEach((qDoc) => {
            qBatch.update(qDoc.ref, { exam_active: params.is_active });
          });
          await qBatch.commit();
        }
      }
    }

    return examId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `exams/${examId}`);
  }
}

export async function deleteTeacherExam(exam: TeacherExam): Promise<void> {
  const examId = exam.id;
  try {
    const [qSnap, kSnap, sSnap] = await Promise.all([
      getDocs(collection(db, 'exams', examId, 'questions')),
      getDocs(collection(db, 'exams', examId, 'answer_keys')),
      getDocs(collection(db, 'exams', examId, 'sessions')),
    ]);

    for (const sDoc of sSnap.docs) {
      const vSnap = await getDocs(collection(db, 'exams', examId, 'sessions', sDoc.id, 'violations'));
      for (let i = 0; i < vSnap.docs.length; i += 200) {
        const b = writeBatch(db);
        vSnap.docs.slice(i, i + 200).forEach((v) => b.delete(v.ref));
        await b.commit();
      }
    }

    const refsToDelete = [
      ...qSnap.docs.map((d) => d.ref),
      ...kSnap.docs.map((d) => d.ref),
      ...sSnap.docs.map((d) => d.ref),
      doc(db, 'exam_tokens', exam.token),
      doc(db, 'exams', examId),
    ];

    for (let i = 0; i < refsToDelete.length; i += 200) {
      const b = writeBatch(db);
      refsToDelete.slice(i, i + 200).forEach((r) => b.delete(r));
      await b.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `exams/${examId}`);
  }
}

export async function listTeacherQuestions(examId: string): Promise<TeacherQuestion[]> {
  try {
    const [qSnap, kSnap] = await Promise.all([
      getDocs(collection(db, 'exams', examId, 'questions')),
      getDocs(collection(db, 'exams', examId, 'answer_keys')),
    ]);

    const keyMap = new Map<string, { correct_option: OptionKey; points: number }>();
    kSnap.docs.forEach((d) => {
      const data = d.data();
      keyMap.set(d.id, {
        correct_option: (data.correct_option as OptionKey) || 'A',
        points: Number(data.points ?? 10),
      });
    });

    return qSnap.docs
      .map((d) => {
        const data = d.data();
        const keyInfo = keyMap.get(d.id);
        return {
          id: d.id,
          exam_id: examId,
          question_text: String(data.question_text),
          option_a: String(data.option_a),
          option_b: String(data.option_b),
          option_c: String(data.option_c),
          option_d: String(data.option_d),
          correct_option: keyInfo?.correct_option || 'A',
          points: keyInfo?.points ?? Number(data.points ?? 10),
          image_data: typeof data.image_data === 'string' ? data.image_data : null,
          order_index: Number(data.order_index ?? 0),
          created_at: timestampToIso(data.created_at) || new Date().toISOString(),
        };
      })
      .sort((a, b) => a.order_index - b.order_index);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, `exams/${examId}/questions`);
  }
}

export async function saveTeacherQuestion(params: {
  exam: TeacherExam;
  editingQuestion: TeacherQuestion | null;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: OptionKey;
  points: number;
  image_data: string | null;
  nextOrderIndex: number;
}): Promise<void> {
  const examId = params.exam.id;
  const qId = params.editingQuestion ? params.editingQuestion.id : makeDocId('q');
  const points = Math.min(1000, Math.max(1, Number(params.points) || 1));

  const qPayload = {
    question_text: clampStr(params.question_text, 4000),
    option_a: clampStr(params.option_a, 1000),
    option_b: clampStr(params.option_b, 1000),
    option_c: clampStr(params.option_c, 1000),
    option_d: clampStr(params.option_d, 1000),
    points,
    image_data: params.image_data ? params.image_data.slice(0, 350000) : null,
  };

  try {
    const batch = writeBatch(db);
    const qRef = doc(db, 'exams', examId, 'questions', qId);
    const kRef = doc(db, 'exams', examId, 'answer_keys', qId);

    if (params.editingQuestion) {
      batch.update(qRef, qPayload);
      batch.set(kRef, {
        correct_option: params.correct_option,
        points,
        updated_at: serverTimestamp(),
      });
    } else {
      batch.set(qRef, {
        ...qPayload,
        exam_id: examId,
        exam_active: params.exam.is_active,
        order_index: params.nextOrderIndex,
        created_at: serverTimestamp(),
      });
      batch.set(kRef, {
        correct_option: params.correct_option,
        points,
        updated_at: serverTimestamp(),
      });

      const newCount = params.exam.question_count + 1;
      batch.update(doc(db, 'exams', examId), {
        question_count: newCount,
        updated_at: serverTimestamp(),
      });
      batch.update(doc(db, 'exam_tokens', params.exam.token), {
        question_count: newCount,
        updated_at: serverTimestamp(),
      });
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `exams/${examId}/questions/${qId}`);
  }
}

export async function deleteTeacherQuestion(exam: TeacherExam, questionId: string): Promise<void> {
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'exams', exam.id, 'questions', questionId));
    batch.delete(doc(db, 'exams', exam.id, 'answer_keys', questionId));
    const newCount = Math.max(0, exam.question_count - 1);
    batch.update(doc(db, 'exams', exam.id), {
      question_count: newCount,
      updated_at: serverTimestamp(),
    });
    batch.update(doc(db, 'exam_tokens', exam.token), {
      question_count: newCount,
      updated_at: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `exams/${exam.id}/questions/${questionId}`);
  }
}

export async function bulkImportQuestionsToExam(
  exam: TeacherExam,
  items: ParsedBulkQuestion[]
): Promise<number> {
  if (items.length === 0) return 0;

  let startIndex = exam.question_count + 1;
  try {
    const qSnap = await getDocs(collection(db, 'exams', exam.id, 'questions'));
    const maxOrder = qSnap.docs.reduce((acc, d) => Math.max(acc, Number(d.data().order_index ?? 0)), 0);
    startIndex = maxOrder + 1;

    for (let i = 0; i < items.length; i += 150) {
      const slice = items.slice(i, i + 150);
      const batch = writeBatch(db);
      slice.forEach((item, idx) => {
        const qId = makeDocId('q');
        const points = Math.min(1000, Math.max(1, Number(item.points) || 10));
        batch.set(doc(db, 'exams', exam.id, 'questions', qId), {
          exam_id: exam.id,
          exam_active: exam.is_active,
          question_text: clampStr(item.question_text, 4000),
          option_a: clampStr(item.option_a, 1000),
          option_b: clampStr(item.option_b, 1000),
          option_c: clampStr(item.option_c, 1000),
          option_d: clampStr(item.option_d, 1000),
          points,
          image_data: null,
          order_index: startIndex + i + idx,
          created_at: serverTimestamp(),
        });
        batch.set(doc(db, 'exams', exam.id, 'answer_keys', qId), {
          correct_option: item.correct_option,
          points,
          updated_at: serverTimestamp(),
        });
      });
      await batch.commit();
    }

    const totalCount = qSnap.size + items.length;
    const updateBatch = writeBatch(db);
    updateBatch.update(doc(db, 'exams', exam.id), {
      question_count: totalCount,
      updated_at: serverTimestamp(),
    });
    updateBatch.update(doc(db, 'exam_tokens', exam.token), {
      question_count: totalCount,
      updated_at: serverTimestamp(),
    });
    await updateBatch.commit();

    return items.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `exams/${exam.id}/questions`);
  }
}

export async function gradePendingSessionsForExam(examId: string): Promise<void> {
  try {
    const [kSnap, sSnap] = await Promise.all([
      getDocs(collection(db, 'exams', examId, 'answer_keys')),
      getDocs(collection(db, 'exams', examId, 'sessions')),
    ]);

    const keys = kSnap.docs.map((d) => ({
      id: d.id,
      correct_option: d.data().correct_option as OptionKey,
      points: Number(d.data().points ?? 10),
    }));

    if (keys.length === 0) return;

    const nowMs = Date.now();
    const toGrade = sSnap.docs.filter((d) => {
      const data = d.data();
      if (data.status === 'SELESAI' && !data.graded) return true;
      if (data.status === 'MENGERJAKAN') {
        const endsMs = timestampToMs(data.ends_at);
        if (endsMs !== null && nowMs > endsMs + 10_000) return true;
      }
      return false;
    });

    if (toGrade.length === 0) return;

    for (let i = 0; i < toGrade.length; i += 150) {
      const batch = writeBatch(db);
      toGrade.slice(i, i + 150).forEach((sDoc) => {
        const data = sDoc.data();
        const ans = (data.answers as Record<string, OptionKey>) || {};
        let correctCount = 0;
        let wrongCount = 0;
        let unansweredCount = 0;
        let score = 0;
        let maxScore = 0;

        for (const k of keys) {
          maxScore += k.points;
          const picked = ans[k.id];
          if (!picked) {
            unansweredCount += 1;
          } else if (picked === k.correct_option) {
            correctCount += 1;
            score += k.points;
          } else {
            wrongCount += 1;
          }
        }

        const finalGrade = maxScore > 0 ? Math.min(100, Math.round((score / maxScore) * 1000) / 10) : 0;

        batch.update(sDoc.ref, {
          status: 'SELESAI',
          submitted_at: data.submitted_at || serverTimestamp(),
          correct_count: correctCount,
          wrong_count: wrongCount,
          unanswered_count: unansweredCount,
          score,
          max_score: maxScore,
          final_grade: finalGrade,
          graded: true,
          updated_at: serverTimestamp(),
        });
      });
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `exams/${examId}/sessions`);
  }
}

export function subscribeExamMonitor(
  examId: string,
  totalQuestions: number,
  onUpdate: (participants: MonitorParticipant[]) => void
): Unsubscribe {
  const path = `exams/${examId}/sessions`;
  return onSnapshot(
    collection(db, 'exams', examId, 'sessions'),
    (snap) => {
      const nowMs = Date.now();
      const rows: MonitorParticipant[] = snap.docs.map((d) => {
        const data = d.data();
        const status = data.status as SessionStatus;
        const endsMs = timestampToMs(data.ends_at);
        const remainingSeconds =
          status === 'MENGERJAKAN' || status === 'TERKUNCI'
            ? endsMs !== null
              ? Math.max(0, Math.floor((endsMs - nowMs) / 1000))
              : null
            : null;
        const answersObj = (data.answers as Record<string, OptionKey>) || {};
        const qOrder = Array.isArray(data.question_order) ? data.question_order : [];
        return {
          id: d.id,
          exam_id: examId,
          nis: String(data.nis),
          student_name: String(data.student_name),
          student_class: String(data.student_class),
          status,
          violation_count: Number(data.violation_count ?? 0),
          answered_count: Object.keys(answersObj).length,
          total_questions: qOrder.length || totalQuestions,
          remaining_seconds: remainingSeconds,
          started_at: timestampToIso(data.started_at),
          ends_at: timestampToIso(data.ends_at),
          submitted_at: timestampToIso(data.submitted_at),
          last_heartbeat_at: timestampToIso(data.last_heartbeat_at),
          correct_count: Number(data.correct_count ?? 0),
          wrong_count: Number(data.wrong_count ?? 0),
          unanswered_count: Number(data.unanswered_count ?? 0),
          score: Number(data.score ?? 0),
          max_score: Number(data.max_score ?? 0),
          final_grade: Number(data.final_grade ?? 0),
          graded: Boolean(data.graded),
          violations: [],
        };
      });

      rows.sort((a, b) => {
        if (a.status === 'TERKUNCI' && b.status !== 'TERKUNCI') return -1;
        if (b.status === 'TERKUNCI' && a.status !== 'TERKUNCI') return 1;
        return a.nis.localeCompare(b.nis);
      });

      // Trigger background grading for ungraded finished / expired sessions
      const needsGrading = snap.docs.some((d) => {
        const data = d.data();
        if (data.status === 'SELESAI' && !data.graded) return true;
        if (data.status === 'MENGERJAKAN') {
          const endsMs = timestampToMs(data.ends_at);
          return endsMs !== null && nowMs > endsMs + 10_000;
        }
        return false;
      });
      if (needsGrading) {
        void gradePendingSessionsForExam(examId);
      }

      onUpdate(rows);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function listSessionViolations(examId: string, sessionId: string): Promise<ViolationLogItem[]> {
  const path = `exams/${examId}/sessions/${sessionId}/violations`;
  try {
    const snap = await getDocs(collection(db, 'exams', examId, 'sessions', sessionId, 'violations'));
    return snap.docs
      .map((d) => {
        const data = d.data();
        return {
          id: d.id,
          session_id: sessionId,
          violation_type: String(data.violation_type),
          detail: String(data.detail),
          created_at: timestampToIso(data.created_at) || new Date().toISOString(),
        };
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function unlockStudentSession(examId: string, sessionId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sesi guru tidak valid.');

  const path = `exams/${examId}/sessions/${sessionId}`;
  try {
    const sessionRef = doc(db, 'exams', examId, 'sessions', sessionId);
    const snap = await getDoc(sessionRef);
    const existingUid = snap.data()?.student_uid;

    const batch = writeBatch(db);
    batch.update(sessionRef, {
      status: 'MENGERJAKAN',
      updated_at: serverTimestamp(),
    });
    batch.set(doc(db, 'exams', examId, 'sessions', sessionId, 'violations', makeDocId('unlock')), {
      session_id: sessionId,
      student_uid: typeof existingUid === 'string' && existingUid.length > 0 ? existingUid : user.uid,
      violation_type: 'BUKA_KUNCI',
      detail: 'Pengawas membuka kunci sesi siswa agar dapat melanjutkan ujian.',
      created_at: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function resetStudentDevice(examId: string, sessionId: string): Promise<void> {
  const path = `exams/${examId}/sessions/${sessionId}`;
  try {
    await updateDoc(doc(db, 'exams', examId, 'sessions', sessionId), {
      device_id: null,
      student_uid: null,
      updated_at: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function addSingleParticipant(
  examId: string,
  participant: { nis: string; student_name: string; student_class: string }
): Promise<void> {
  const nis = normalizeNis(participant.nis);
  const studentName = clampStr(participant.student_name, 100);
  const studentClass = clampStr(participant.student_class, 40);

  if (!nis || !studentName || !studentClass) {
    throw new Error('NIS, Nama, dan Kelas wajib diisi.');
  }

  const ref = doc(db, 'exams', examId, 'sessions', nis);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    throw new Error(`Peserta dengan NIS ${nis} sudah terdaftar di ujian ini.`);
  }

  try {
    await setDoc(ref, {
      exam_id: examId,
      nis,
      student_name: studentName,
      student_class: studentClass,
      student_uid: null,
      device_id: null,
      status: 'BELUM_MULAI',
      question_order: [],
      option_order: {},
      answers: {},
      violation_count: 0,
      started_at: null,
      ends_at: null,
      submitted_at: null,
      last_heartbeat_at: null,
      correct_count: 0,
      wrong_count: 0,
      unanswered_count: 0,
      score: 0,
      max_score: 0,
      final_grade: 0,
      graded: false,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `exams/${examId}/sessions/${nis}`);
  }
}

export async function bulkImportParticipantsToExam(
  examId: string,
  items: Array<{ nis: string; student_name: string; student_class: string }>
): Promise<{ inserted: number; skipped: number }> {
  if (items.length === 0) return { inserted: 0, skipped: 0 };

  try {
    const existingSnap = await getDocs(collection(db, 'exams', examId, 'sessions'));
    const existingSet = new Set(existingSnap.docs.map((d) => d.id.toUpperCase()));

    const uniqueNew: Array<{ nis: string; student_name: string; student_class: string }> = [];
    let skipped = 0;

    for (const item of items) {
      const nis = normalizeNis(item.nis);
      const name = clampStr(item.student_name, 100);
      const cls = clampStr(item.student_class, 40);
      if (!nis || !name || !cls) continue;
      if (existingSet.has(nis)) {
        skipped += 1;
        continue;
      }
      existingSet.add(nis);
      uniqueNew.push({ nis, student_name: name, student_class: cls });
    }

    for (let i = 0; i < uniqueNew.length; i += 200) {
      const batch = writeBatch(db);
      uniqueNew.slice(i, i + 200).forEach((p) => {
        batch.set(doc(db, 'exams', examId, 'sessions', p.nis), {
          exam_id: examId,
          nis: p.nis,
          student_name: p.student_name,
          student_class: p.student_class,
          student_uid: null,
          device_id: null,
          status: 'BELUM_MULAI',
          question_order: [],
          option_order: {},
          answers: {},
          violation_count: 0,
          started_at: null,
          ends_at: null,
          submitted_at: null,
          last_heartbeat_at: null,
          correct_count: 0,
          wrong_count: 0,
          unanswered_count: 0,
          score: 0,
          max_score: 0,
          final_grade: 0,
          graded: false,
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        });
      });
      await batch.commit();
    }

    return { inserted: uniqueNew.length, skipped };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `exams/${examId}/sessions`);
  }
}

export function buildParticipantsCsv(participants: MonitorParticipant[]): string {
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const header = [
    'NIS / Nomor Ujian',
    'Nama Siswa',
    'Kelas',
    'Status',
    'Benar',
    'Salah',
    'Kosong',
    'Skor Poin',
    'Skor Maks',
    'Nilai Akhir',
    'Pelanggaran Layar',
    'Waktu Selesai',
  ].join(',');

  const lines = participants.map((p) =>
    [
      esc(p.nis),
      esc(p.student_name),
      esc(p.student_class),
      esc(p.status),
      esc(p.correct_count),
      esc(p.wrong_count),
      esc(p.unanswered_count),
      esc(p.score),
      esc(p.max_score),
      esc(p.final_grade),
      esc(p.violation_count),
      esc(p.submitted_at ? new Date(p.submitted_at).toLocaleString('id-ID') : '-'),
    ].join(',')
  );

  return '\uFEFF' + [header, ...lines].join('\r\n');
}
