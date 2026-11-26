import type { User } from 'firebase/auth';
import { AlertCircle, CheckCircle2, Clock, ShieldCheck, Sparkles } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { ensureStudentAuthSession } from '../firebase';
import type { ExamJoinResponse, ExamResultSummary } from '../types';
import {
  joinExamSession,
  lookupExamByToken,
  type LookupExamPreview,
} from '../utils/firestoreService';
import { getOrCreateDeviceId } from '../utils/storage';

interface StudentPortalProps {
  initialToken: string;
  authReady: boolean;
  authUser: User | null;
  onExamJoined: (data: ExamJoinResponse) => void;
  onOpenGuide: () => void;
}

function getAnonymousAuthErrorMessage(err: unknown): string | null {
  const code = (err as { code?: string })?.code || '';
  if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') {
    return 'Metode masuk "Anonymous" belum diaktifkan di Firebase Console (Authentication -> Sign-in method -> Anonymous). Aktifkan sekali agar siswa bisa masuk tanpa login Google.';
  }
  return null;
}

export function StudentPortal({
  initialToken,
  authReady,
  authUser,
  onExamJoined,
  onOpenGuide,
}: StudentPortalProps) {
  const [token, setToken] = useState(initialToken.toUpperCase());
  const [nis, setNis] = useState('');
  const [studentName, setStudentName] = useState('');
  const [studentClass, setStudentClass] = useState('');

  const [examPreview, setExamPreview] = useState<LookupExamPreview | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [isCheckingToken, setIsCheckingToken] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [completedSummary, setCompletedSummary] = useState<ExamResultSummary | null>(null);

  useEffect(() => {
    if (initialToken) {
      setToken(initialToken.toUpperCase());
    }
  }, [initialToken]);

  // Silently establish anonymous student auth in background
  useEffect(() => {
    if (!authReady || authUser) return;
    let active = true;
    void ensureStudentAuthSession().catch((err) => {
      if (!active) return;
      const hint = getAnonymousAuthErrorMessage(err);
      if (hint) setErrorMsg(hint);
    });
    return () => {
      active = false;
    };
  }, [authReady, authUser]);

  useEffect(() => {
    const clean = token.trim().toUpperCase();
    if (!authReady || clean.length < 4) {
      setExamPreview(null);
      setLookupError(null);
      return;
    }

    const timer = window.setTimeout(async () => {
      setIsCheckingToken(true);
      setLookupError(null);
      try {
        await ensureStudentAuthSession();
        const res = await lookupExamByToken(clean);
        if (!res.exam) {
          setExamPreview(null);
          setLookupError(res.error || 'Token tidak ditemukan.');
        } else {
          setExamPreview(res.exam);
          setLookupError(null);
        }
      } catch (err) {
        const hint = getAnonymousAuthErrorMessage(err);
        setLookupError(hint || 'Gagal memeriksa token. Periksa koneksi internet Anda.');
      } finally {
        setIsCheckingToken(false);
      }
    }, 320);

    return () => window.clearTimeout(timer);
  }, [token, authReady]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setCompletedSummary(null);

    // Attempt fullscreen gently right inside user gesture
    try {
      if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen().catch(() => undefined);
      }
    } catch {
      // Ignore fullscreen denial on iOS Safari
    }

    setSubmitting(true);
    try {
      await ensureStudentAuthSession();
      const deviceId = getOrCreateDeviceId();
      const result = await joinExamSession({
        nis: nis.trim(),
        studentName: studentName.trim(),
        studentClass: studentClass.trim(),
        token: token.trim().toUpperCase(),
        deviceId,
      });

      if (result.error || !result.data) {
        setErrorMsg(result.error || 'Gagal masuk ke ruang ujian.');
        if (result.completedSummary) {
          setCompletedSummary(result.completedSummary);
        }
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => undefined);
        }
        return;
      }

      onExamJoined(result.data);
    } catch (err) {
      const hint = getAnonymousAuthErrorMessage(err);
      setErrorMsg(
        hint || 'Gagal terhubung ke database cloud. Pastikan jaringan stabil dan coba tekan lagi.'
      );
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => undefined);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function fillSampleStudent() {
    setToken('PASMTK26');
    setNis('20260104');
    setStudentName((prev) => prev || 'Siti Aminah');
    setStudentClass('XI IPA 1');
    setErrorMsg(null);
    setCompletedSummary(null);
  }

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-5 sm:p-7 space-y-5">
          <div>
            <p className="text-xs font-semibold text-blue-700 mb-1">Portal Peserta Ujian</p>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              Masuk Ruang Ujian Semester
            </h1>
            <p className="text-sm text-slate-600 mt-1.5">
              Masukkan identitas sesuai kartu peserta dan token aktif dari guru pengawas.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="exam-token" className="block text-sm font-semibold text-slate-800">
                  Token Ujian
                </label>
                <button
                  type="button"
                  onClick={fillSampleStudent}
                  className="text-xs font-medium text-blue-700 hover:text-blue-800 underline underline-offset-2"
                >
                  Isi Data Contoh
                </button>
              </div>
              <input
                id="exam-token"
                type="text"
                required
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value.toUpperCase())}
                placeholder="Contoh: PASMTK26"
                className="w-full min-h-[46px] px-3.5 py-2.5 text-base font-mono uppercase tracking-wider bg-white border border-slate-300 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-blue-700"
              />

              {isCheckingToken && (
                <p className="mt-1.5 text-xs text-slate-500">Memeriksa token ujian ke database cloud...</p>
              )}

              {examPreview && (
                <div className="mt-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 leading-snug">
                        {examPreview.title}
                      </p>
                      <p className="text-xs text-slate-600 mt-0.5 tabular-nums">
                        {examPreview.class_level} · {examPreview.duration_minutes} Menit ·{' '}
                        {examPreview.question_count} Soal ·{' '}
                        {examPreview.is_active ? 'Token Aktif' : 'Token Nonaktif'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {lookupError && token.trim().length >= 4 && (
                <p className="mt-1.5 text-xs font-medium text-red-600">{lookupError}</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="student-nis" className="block text-sm font-semibold text-slate-800 mb-1.5">
                  Nomor Ujian / NIS
                </label>
                <input
                  id="student-nis"
                  type="text"
                  required
                  autoComplete="off"
                  value={nis}
                  onChange={(e) => setNis(e.target.value)}
                  placeholder="Contoh: 20260104"
                  className="w-full min-h-[46px] px-3.5 py-2.5 text-base font-mono bg-white border border-slate-300 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-blue-700"
                />
              </div>

              <div>
                <label htmlFor="student-class" className="block text-sm font-semibold text-slate-800 mb-1.5">
                  Kelas
                </label>
                <input
                  id="student-class"
                  type="text"
                  required
                  value={studentClass}
                  onChange={(e) => setStudentClass(e.target.value)}
                  placeholder="Contoh: XI IPA 1"
                  className="w-full min-h-[46px] px-3.5 py-2.5 text-base bg-white border border-slate-300 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-blue-700"
                />
              </div>
            </div>

            <div>
              <label htmlFor="student-name" className="block text-sm font-semibold text-slate-800 mb-1.5">
                Nama Lengkap Siswa
              </label>
              <input
                id="student-name"
                type="text"
                required
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                placeholder="Masukkan nama lengkap sesuai absensi"
                className="w-full min-h-[46px] px-3.5 py-2.5 text-base bg-white border border-slate-300 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-blue-700"
              />
            </div>

            {errorMsg && (
              <div
                className="p-3.5 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2.5"
                role="alert"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <p className="text-sm text-red-800">{errorMsg}</p>
              </div>
            )}

            {completedSummary && (
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <p className="text-sm font-bold text-slate-900">
                  Ringkasan Hasil Tersimpan — {completedSummary.student_name}
                </p>
                {completedSummary.graded ? (
                  <div className="grid grid-cols-3 gap-2 text-center pt-1">
                    <div className="p-2 bg-white rounded-lg border border-slate-200">
                      <div className="text-xs text-slate-500">Benar</div>
                      <div className="text-base font-bold font-mono text-emerald-700 tabular-nums">
                        {completedSummary.correct_count}
                      </div>
                    </div>
                    <div className="p-2 bg-white rounded-lg border border-slate-200">
                      <div className="text-xs text-slate-500">Salah</div>
                      <div className="text-base font-bold font-mono text-slate-800 tabular-nums">
                        {completedSummary.wrong_count}
                      </div>
                    </div>
                    <div className="p-2 bg-white rounded-lg border border-slate-200">
                      <div className="text-xs text-slate-500">Nilai Akhir</div>
                      <div className="text-base font-bold font-mono text-blue-700 tabular-nums">
                        {completedSummary.final_grade}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-600">
                    Jawaban sudah diterima cloud. Nilai akhir akan tampil setelah diproses oleh Dashboard Guru.
                  </p>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !authReady || (examPreview !== null && !examPreview.is_active)}
              className="w-full min-h-[48px] px-5 py-3 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:bg-slate-300 disabled:text-slate-500 rounded-xl transition-colors"
            >
              {submitting ? 'Mempersiapkan Soal Ujian...' : 'Mulai / Lanjutkan Ujian'}
            </button>
          </form>
        </section>

        <aside className="lg:col-span-5 space-y-5">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-4">
            <h2 className="text-base font-bold text-slate-900">Tata Tertib &amp; Ketentuan Teknis</h2>
            <ul className="space-y-3 text-sm text-slate-600">
              <li className="flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                <span>
                  <strong className="text-slate-900">Layar Penuh &amp; Anti-Pindah Tab:</strong> Tetap di halaman ujian.
                  Berpindah aplikasi, membuka tab baru, atau keluar dari layar penuh dicatat ke database cloud dan dapat
                  mengunci sesi Anda.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <Clock className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                <span>
                  <strong className="text-slate-900">Auto-Save Ganda (HP + Cloud):</strong> Setiap jawaban disimpan
                  di memori HP dan disinkronkan ke Firestore. Saat sinyal lemah, jawaban tetap aman di HP Anda.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <Sparkles className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                <span>
                  <strong className="text-slate-900">Satu Perangkat Aktif:</strong> Nomor Ujian/NIS yang sama tidak
                  dapat dibuka bersamaan di dua HP berbeda.
                </span>
              </li>
            </ul>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6">
            <h3 className="text-sm font-bold text-slate-900 mb-2">Token Uji Coba Tersedia</h3>
            <div className="space-y-2 text-xs text-slate-600">
              <div className="flex items-center justify-between py-2 border-b border-slate-100">
                <span>Matematika Wajib (8 soal · 45 menit)</span>
                <button
                  type="button"
                  onClick={() => setToken('PASMTK26')}
                  className="font-mono font-semibold text-blue-700 hover:underline"
                >
                  PASMTK26
                </button>
              </div>
              <div className="flex items-center justify-between py-2">
                <span>Bahasa Indonesia (5 soal · 40 menit)</span>
                <button
                  type="button"
                  onClick={() => setToken('PASBIN26')}
                  className="font-mono font-semibold text-blue-700 hover:underline"
                >
                  PASBIN26
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenGuide}
              className="mt-3 text-xs font-semibold text-slate-700 hover:text-slate-900 underline underline-offset-2 sm:hidden"
            >
              Baca Panduan Lengkap
            </button>
          </div>
        </aside>
      </div>
    </main>
  );
}
