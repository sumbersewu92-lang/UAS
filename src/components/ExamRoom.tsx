import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  Grid,
  Lock,
  Maximize2,
  RefreshCw,
  Send,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { auth } from '../firebase';
import type { ExamJoinResponse, ExamResultSummary, OptionKey, SessionStatus } from '../types';
import {
  recordStudentViolation,
  submitStudentExam,
  subscribeStudentSession,
  syncStudentAnswers,
} from '../utils/firestoreService';
import {
  clearExamDraft,
  loadExamDraft,
  saveExamDraft,
  type PendingViolation,
} from '../utils/storage';

interface ExamRoomProps {
  initialData: ExamJoinResponse;
  onExitToPortal: () => void;
}

type SyncState = 'synced' | 'syncing' | 'offline';

function formatTimer(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

export function ExamRoom({ initialData, onExitToPortal }: ExamRoomProps) {
  const { exam, questions } = initialData;
  const [session, setSession] = useState(initialData.session);
  const [status, setStatus] = useState<SessionStatus>(initialData.session.status);
  const [violationCount, setViolationCount] = useState<number>(initialData.session.violation_count);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Merge cloud saved answers with any un-synced localStorage draft
  const initialDraft = useMemo(
    () => loadExamDraft(exam.id, initialData.session.nis),
    [exam.id, initialData.session.nis]
  );

  const [answers, setAnswers] = useState<Record<string, OptionKey>>(() => ({
    ...initialData.savedAnswers,
    ...(initialDraft?.sessionId === initialData.session.id ? initialDraft.answers : {}),
  }));

  const pendingSyncRef = useRef<Record<string, OptionKey>>(
    initialDraft?.sessionId === initialData.session.id ? { ...initialDraft.pendingSync } : {}
  );
  const pendingViolationsRef = useRef<PendingViolation[]>(
    initialDraft?.sessionId === initialData.session.id ? [...(initialDraft.pendingViolations || [])] : []
  );
  const answersRef = useRef(answers);
  answersRef.current = answers;

  const [syncState, setSyncState] = useState<SyncState>(() =>
    Object.keys(pendingSyncRef.current).length > 0 ? 'offline' : 'synced'
  );
  const serverOffsetMs = useMemo(
    () => Date.parse(initialData.session.server_now) - Date.now(),
    [initialData.session.server_now]
  );
  const [remainingSeconds, setRemainingSeconds] = useState<number>(() => {
    const offset = Date.parse(initialData.session.server_now) - Date.now();
    return Math.max(0, Math.floor((Date.parse(initialData.session.ends_at) - (Date.now() + offset)) / 1000));
  });

  const [warningModal, setWarningModal] = useState<{ count: number; message: string } | null>(null);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [navSheetOpen, setNavSheetOpen] = useState(false);
  const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [timeoutPendingSync, setTimeoutPendingSync] = useState(false);
  const [finalResult, setFinalResult] = useState<ExamResultSummary | null>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => Boolean(document.fullscreenElement));

  const wasFullscreenRef = useRef<boolean>(Boolean(document.fullscreenElement));
  const lastViolationTsRef = useRef<number>(0);
  const fullscreenGraceUntilRef = useRef<number>(Date.now() + 800);
  const isSubmittingRef = useRef<boolean>(false);

  const persistDraft = useCallback(() => {
    saveExamDraft({
      sessionId: session.id,
      examId: exam.id,
      nis: session.nis,
      answers: answersRef.current,
      pendingSync: pendingSyncRef.current,
      pendingViolations: pendingViolationsRef.current,
      updatedAt: new Date().toISOString(),
    });
  }, [session.id, exam.id, session.nis]);

  const flushAnswersToServer = useCallback(async (): Promise<boolean> => {
    const toSyncKeys = Object.keys(pendingSyncRef.current);
    if (toSyncKeys.length === 0) {
      setSyncState('synced');
      return true;
    }
    if (!navigator.onLine) {
      setSyncState('offline');
      return false;
    }

    setSyncState('syncing');
    const snapshotPending = { ...pendingSyncRef.current };

    try {
      const res = await syncStudentAnswers(exam.id, session.nis, answersRef.current);
      if (res.status === 'TERKUNCI') {
        setStatus('TERKUNCI');
        setSyncState('offline');
        return false;
      }
      if (res.status === 'SELESAI') {
        setStatus('SELESAI');
        clearExamDraft(exam.id, session.nis);
        setSyncState('synced');
        return true;
      }

      for (const k of toSyncKeys) {
        if (pendingSyncRef.current[k] === snapshotPending[k]) {
          delete pendingSyncRef.current[k];
        }
      }
      persistDraft();
      setSyncState(Object.keys(pendingSyncRef.current).length > 0 ? 'syncing' : 'synced');
      return Object.keys(pendingSyncRef.current).length === 0;
    } catch {
      setSyncState('offline');
      return false;
    }
  }, [exam.id, session.nis, persistDraft]);

  const flushViolationsToServer = useCallback(async () => {
    if (pendingViolationsRef.current.length === 0 || !navigator.onLine) return;
    const queue = [...pendingViolationsRef.current];
    const remaining: PendingViolation[] = [];

    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      try {
        const res = await recordStudentViolation({
          examId: exam.id,
          nis: session.nis,
          violationType: item.violationType,
          detail: item.detail,
          maxWarnings: exam.max_warnings,
        });
        setViolationCount(res.violation_count);
        setStatus(res.status);
      } catch {
        remaining.push(...queue.slice(i));
        break;
      }
    }

    pendingViolationsRef.current = remaining;
    persistDraft();
  }, [exam.id, exam.max_warnings, session.nis, persistDraft]);

  // Initial sync if local draft had pending items
  useEffect(() => {
    if (Object.keys(pendingSyncRef.current).length > 0) {
      void flushAnswersToServer();
    }
    if (pendingViolationsRef.current.length > 0) {
      void flushViolationsToServer();
    }
  }, [flushAnswersToServer, flushViolationsToServer]);

  // Network recovery & periodic retry
  useEffect(() => {
    function handleOnline() {
      void flushAnswersToServer();
      void flushViolationsToServer();
    }
    window.addEventListener('online', handleOnline);
    const interval = window.setInterval(() => {
      if (Object.keys(pendingSyncRef.current).length > 0) {
        void flushAnswersToServer();
      }
      if (pendingViolationsRef.current.length > 0) {
        void flushViolationsToServer();
      }
    }, 10000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.clearInterval(interval);
    };
  }, [flushAnswersToServer, flushViolationsToServer]);

  // Real-time Firestore listener for teacher unlock & live grade updates
  useEffect(() => {
    if (!auth.currentUser) return;
    if (status === 'SELESAI' && finalResult?.graded) return;

    const unsub = subscribeStudentSession(exam.id, session.nis, questions.length, (update) => {
      setViolationCount(update.violation_count);
      if (update.ends_at) {
        setSession((prev) => ({ ...prev, ends_at: update.ends_at! }));
      }
      if (update.status === 'SELESAI' && update.result) {
        clearExamDraft(exam.id, session.nis);
        setStatus('SELESAI');
        setFinalResult(update.result);
        return;
      }
      if (update.status === 'MENGERJAKAN') {
        setStatus((prev) => {
          if (prev === 'TERKUNCI') setWarningModal(null);
          return 'MENGERJAKAN';
        });
      } else if (update.status === 'TERKUNCI') {
        setStatus('TERKUNCI');
      }
    });

    return () => unsub();
  }, [exam.id, session.nis, questions.length, status, finalResult?.graded]);

  const submitExam = useCallback(
    async (isAutoTimeout = false) => {
      if (isSubmittingRef.current) return;
      isSubmittingRef.current = true;
      setSubmitting(true);

      try {
        const result = await submitStudentExam({
          examId: exam.id,
          nis: session.nis,
          studentName: session.student_name,
          studentClass: session.student_class,
          totalQuestions: questions.length,
          violationCount,
          answers: answersRef.current,
        });

        clearExamDraft(exam.id, session.nis);
        setStatus('SELESAI');
        setFinalResult(result);
        setConfirmSubmitOpen(false);
        setTimeoutPendingSync(false);
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => undefined);
        }
      } catch {
        if (isAutoTimeout) {
          setTimeoutPendingSync(true);
        } else {
          setCopyToast('Koneksi terputus saat mengumpulkan. Jawaban tetap tersimpan di HP, silakan coba lagi.');
        }
        isSubmittingRef.current = false;
      } finally {
        setSubmitting(false);
      }
    },
    [exam.id, session.nis, session.student_name, session.student_class, questions.length, violationCount]
  );

  // Countdown tick synced to server clock offset
  useEffect(() => {
    if (status === 'SELESAI') return;

    const timer = window.setInterval(() => {
      const serverNow = Date.now() + serverOffsetMs;
      const rem = Math.max(0, Math.floor((Date.parse(session.ends_at) - serverNow) / 1000));
      setRemainingSeconds(rem);
      if (rem <= 0 && status === 'MENGERJAKAN' && !isSubmittingRef.current) {
        void submitExam(true);
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [session.ends_at, serverOffsetMs, status, submitExam]);

  // Auto retry submission if timer expired while offline
  useEffect(() => {
    if (!timeoutPendingSync || status === 'SELESAI') return;
    const retry = window.setInterval(() => {
      void submitExam(true);
    }, 4000);
    return () => window.clearInterval(retry);
  }, [timeoutPendingSync, status, submitExam]);

  // Screen violation recorder
  const recordViolation = useCallback(
    async (violationType: string, detail: string) => {
      if (status !== 'MENGERJAKAN' || isSubmittingRef.current) return;
      const now = Date.now();
      if (now < fullscreenGraceUntilRef.current) return;
      if (now - lastViolationTsRef.current < 1600) return;
      lastViolationTsRef.current = now;

      const optimisticCount = violationCount + 1;
      setViolationCount(optimisticCount);

      if (optimisticCount > exam.max_warnings) {
        setStatus('TERKUNCI');
        setWarningModal(null);
      } else {
        setWarningModal({
          count: optimisticCount,
          message: `${detail}. Peringatan ${optimisticCount} dari ${exam.max_warnings}. Pelanggaran berikutnya dapat mengunci sesi ujian.`,
        });
      }

      try {
        if (!navigator.onLine) throw new Error('offline');
        const res = await recordStudentViolation({
          examId: exam.id,
          nis: session.nis,
          violationType,
          detail: `${detail} (Ke-${optimisticCount})`,
          maxWarnings: exam.max_warnings,
        });
        setViolationCount(res.violation_count);
        if (res.status === 'TERKUNCI') {
          setStatus('TERKUNCI');
          setWarningModal(null);
        }
      } catch {
        pendingViolationsRef.current.push({
          violationType,
          detail: `${detail} (Ke-${optimisticCount})`,
          createdAt: new Date().toISOString(),
        });
        persistDraft();
      }
    },
    [status, violationCount, exam.max_warnings, exam.id, session.nis, persistDraft]
  );

  // Attach anti-cheat event listeners during MENGERJAKAN
  useEffect(() => {
    if (status !== 'MENGERJAKAN') return;

    function onVisibilityChange() {
      if (document.hidden) {
        void recordViolation('PINDAH_TAB', 'Terdeteksi berpindah tab atau meminimalkan halaman ujian');
      }
    }

    function onWindowBlur() {
      void recordViolation('HILANG_FOKUS', 'Layar ujian kehilangan fokus');
    }

    function onFullscreenChange() {
      const active = Boolean(document.fullscreenElement);
      setIsFullscreen(active);
      if (wasFullscreenRef.current && !active) {
        void recordViolation('KELUAR_FULLSCREEN', 'Siswa keluar dari mode layar penuh ujian');
      }
      wasFullscreenRef.current = active;
    }

    function onKeyDown(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;
      const blockedKey =
        (ctrl && ['c', 'x', 'a', 'u', 's', 'p'].includes(e.key.toLowerCase())) ||
        e.key === 'F12' ||
        e.key === 'PrintScreen';
      if (blockedKey) {
        e.preventDefault();
        setCopyToast('Penyalinan atau pintasan layar dinonaktifkan selama ujian.');
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onWindowBlur);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onWindowBlur);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [status, recordViolation]);

  useEffect(() => {
    if (!copyToast) return;
    const t = window.setTimeout(() => setCopyToast(null), 2600);
    return () => window.clearTimeout(t);
  }, [copyToast]);

  async function requestFullscreenSafe() {
    fullscreenGraceUntilRef.current = Date.now() + 900;
    try {
      if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        wasFullscreenRef.current = true;
        setIsFullscreen(true);
      }
    } catch {
      // Some iOS mobile browsers do not support Fullscreen API
    }
  }

  function handleSelectAnswer(questionId: string, originalKey: OptionKey) {
    if (status !== 'MENGERJAKAN') return;
    const updated = { ...answersRef.current, [questionId]: originalKey };
    answersRef.current = updated;
    setAnswers(updated);
    pendingSyncRef.current[questionId] = originalKey;
    persistDraft();
    void flushAnswersToServer();
  }

  // Completed summary view
  if (status === 'SELESAI' && finalResult) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-7 h-7 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-emerald-700">Ujian Telah Dikumpulkan</p>
              <h1 className="text-xl font-bold text-slate-900 mt-0.5">{exam.title}</h1>
              <p className="text-sm text-slate-600 mt-1">
                {finalResult.student_name} · NIS {finalResult.nis}
                {finalResult.student_class ? ` · ${finalResult.student_class}` : ''}
              </p>
            </div>
          </div>

          {finalResult.graded ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div className="text-xs text-slate-500">Nilai Akhir</div>
                <div className="text-2xl font-bold font-mono text-blue-700 tabular-nums mt-0.5">
                  {finalResult.final_grade}
                </div>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div className="text-xs text-slate-500">Benar</div>
                <div className="text-xl font-bold font-mono text-emerald-700 tabular-nums mt-1">
                  {finalResult.correct_count}
                </div>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div className="text-xs text-slate-500">Salah</div>
                <div className="text-xl font-bold font-mono text-slate-800 tabular-nums mt-1">
                  {finalResult.wrong_count}
                </div>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div className="text-xs text-slate-500">Kosong</div>
                <div className="text-xl font-bold font-mono text-slate-500 tabular-nums mt-1">
                  {finalResult.unanswered_count}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
              <p className="text-sm font-semibold text-slate-900">
                Jawaban Tersimpan di Database Cloud ({finalResult.answered_count ?? Object.keys(answers).length}/
                {questions.length} soal)
              </p>
              <p className="text-xs text-slate-600 leading-relaxed">
                Nilai akhir sedang dihitung otomatis oleh Dashboard Guru dan akan langsung tampil di layar ini begitu
                selesai diproses. Anda juga dapat langsung kembali ke portal utama.
              </p>
            </div>
          )}

          <div className="text-xs text-slate-500 border-t border-slate-100 pt-4 flex flex-wrap items-center justify-between gap-2">
            <span>
              Pelanggaran layar tercatat:{' '}
              <strong className="font-mono text-slate-800">{finalResult.violation_count ?? violationCount}</strong>
            </span>
            {finalResult.submitted_at && (
              <span>
                Selesai:{' '}
                {new Date(finalResult.submitted_at).toLocaleTimeString('id-ID', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={onExitToPortal}
            className="w-full min-h-[46px] px-4 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-xl transition-colors"
          >
            Kembali ke Portal Utama
          </button>
        </div>
      </main>
    );
  }

  // Locked screen view
  if (status === 'TERKUNCI') {
    return (
      <main className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-slate-800 border border-slate-700 rounded-2xl p-6 space-y-5">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-red-500/20 flex items-center justify-center shrink-0">
              <Lock className="w-6 h-6 text-red-400" />
            </div>
            <div>
              <p className="text-xs font-semibold text-red-400">Status Sesi: TERKUNCI</p>
              <h1 className="text-lg font-bold text-white mt-0.5">Layar Ujian Dikunci Otomatis</h1>
            </div>
          </div>

          <p className="text-sm text-slate-300 leading-relaxed">
            Sistem mendeteksi Anda keluar dari layar ujian sebanyak{' '}
            <strong className="font-mono text-white">{violationCount}</strong> kali (melebihi batas toleransi{' '}
            <strong className="font-mono text-white">{exam.max_warnings}</strong> peringatan).
          </p>

          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-700 text-xs text-slate-300 space-y-1">
            <div>
              Peserta: <strong className="text-white">{session.student_name}</strong> ({session.nis})
            </div>
            <div>
              Ujian: <strong className="text-white">{exam.subject}</strong>
            </div>
            <div>Jawaban Anda sebelumnya tetap aman tersimpan di database cloud.</div>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            Angkat tangan atau lapor kepada guru/pengawas untuk membuka kunci dari Dashboard Guru. Layar ini
            tersinkronisasi real-time dan otomatis terbuka begitu guru menekan tombol <strong>Buka Kunci</strong>.
          </p>
        </div>
      </main>
    );
  }

  const currentQuestion = questions[currentIndex];
  const answeredCount = Object.keys(answers).length;
  const isTimeCritical = remainingSeconds <= 60;
  const isTimeWarning = remainingSeconds > 60 && remainingSeconds <= 300;

  return (
    <div
      className="min-h-screen bg-slate-50 flex flex-col exam-protected"
      onContextMenu={(e) => {
        e.preventDefault();
        setCopyToast('Menu tekan lama / klik kanan dinonaktifkan saat ujian.');
      }}
      onCopy={(e) => {
        e.preventDefault();
        setCopyToast('Menyalin teks soal tidak diizinkan.');
      }}
      onCut={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
    >
      {/* Compact Sticky Top Bar (<56px for mobile budget) */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 h-14 px-3 sm:px-6 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs sm:text-sm font-bold text-slate-900 truncate">{exam.subject}</div>
          <div className="text-[11px] text-slate-500 truncate">
            {session.student_name} · {session.nis}
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {!isFullscreen && document.fullscreenEnabled && (
            <button
              type="button"
              onClick={requestFullscreenSafe}
              className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
              title="Masuk mode layar penuh"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>Layar Penuh</span>
            </button>
          )}

          <div
            className={`px-2.5 py-1 rounded-lg border font-mono text-sm sm:text-base font-bold tabular-nums ${
              isTimeCritical
                ? 'bg-red-50 border-red-200 text-red-700'
                : isTimeWarning
                ? 'bg-amber-50 border-amber-200 text-amber-800'
                : 'bg-slate-100 border-slate-200 text-slate-900'
            }`}
          >
            {formatTimer(remainingSeconds)}
          </div>
        </div>
      </header>

      {/* Thin Sub-status Strip: Auto-Save Indicator & Violation Counter */}
      <div className="bg-white border-b border-slate-200 px-3 sm:px-6 py-2">
        <div className="max-w-3xl mx-auto flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5">
            {syncState === 'synced' && (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span className="text-emerald-700 font-medium">Tersimpan ke database</span>
              </>
            )}
            {syncState === 'syncing' && (
              <>
                <RefreshCw className="w-3.5 h-3.5 text-blue-700 animate-spin shrink-0" />
                <span className="text-blue-700 font-medium">Menyinkronkan ulang...</span>
              </>
            )}
            {syncState === 'offline' && (
              <>
                <CloudOff className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                <span className="text-amber-800 font-medium">Tersimpan di HP (menunggu jaringan)</span>
                <button
                  type="button"
                  onClick={() => void flushAnswersToServer()}
                  className="ml-1 underline font-semibold text-blue-700"
                >
                  Kirim Ulang
                </button>
              </>
            )}
          </div>

          <div className="text-slate-600 tabular-nums">
            Peringatan layar:{' '}
            <span className={`font-mono font-semibold ${violationCount > 0 ? 'text-amber-700' : 'text-slate-800'}`}>
              {violationCount}/{exam.max_warnings}
            </span>
          </div>
        </div>
      </div>

      {timeoutPendingSync && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-center text-xs font-medium text-amber-900">
          Waktu ujian habis — menyinkronkan jawaban terakhir ke database cloud secara otomatis...
        </div>
      )}

      {/* Main Question Area */}
      <main className="flex-1 w-full max-w-3xl mx-auto px-3 sm:px-6 py-5 pb-24">
        {currentQuestion ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-7 space-y-5">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <span className="text-sm font-bold text-slate-900 tabular-nums">
                Soal {currentIndex + 1} dari {questions.length}
              </span>
              <span className="text-xs font-medium text-slate-500 tabular-nums">
                Bobot {currentQuestion.points} poin
              </span>
            </div>

            {currentQuestion.image_data && (
              <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
                <img
                  src={currentQuestion.image_data}
                  alt={`Ilustrasi soal nomor ${currentIndex + 1}`}
                  referrerPolicy="no-referrer"
                  className="max-h-72 w-auto mx-auto object-contain"
                />
              </div>
            )}

            <p className="text-base sm:text-[17px] text-slate-900 leading-relaxed whitespace-pre-line">
              {currentQuestion.question_text}
            </p>

            <div className="space-y-2.5 pt-1" role="radiogroup" aria-label={`Pilihan jawaban soal ${currentIndex + 1}`}>
              {currentQuestion.options.map((opt) => {
                const isSelected = answers[currentQuestion.id] === opt.originalKey;
                return (
                  <button
                    key={opt.displayKey}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => handleSelectAnswer(currentQuestion.id, opt.originalKey)}
                    className={`w-full min-h-[52px] text-left px-3.5 py-3 rounded-xl border transition-colors flex items-start gap-3 ${
                      isSelected
                        ? 'bg-blue-50 border-blue-700 text-slate-900'
                        : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-800'
                    }`}
                  >
                    <span
                      className={`w-7 h-7 rounded-lg font-mono text-sm font-bold flex items-center justify-center shrink-0 mt-0.5 ${
                        isSelected
                          ? 'bg-blue-700 text-white'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {opt.displayKey}
                    </span>
                    <span className="text-sm sm:text-base leading-snug pt-0.5">{opt.text}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </main>

      {/* Copy/Action Guard Toast */}
      {copyToast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-medium shadow-lg max-w-[90vw] text-center">
          {copyToast}
        </div>
      )}

      {/* Thumb-Zone Bottom Navigation Bar */}
      <footer className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-slate-200 h-16 px-3 sm:px-6">
        <div className="max-w-3xl mx-auto h-full flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={currentIndex === 0}
            onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
            className="min-h-[44px] px-3 sm:px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 text-sm font-semibold text-slate-800 flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Sebelumnya</span>
          </button>

          <button
            type="button"
            onClick={() => setNavSheetOpen(true)}
            className="min-h-[44px] px-3 sm:px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs sm:text-sm font-semibold text-slate-800 flex items-center gap-1.5 tabular-nums whitespace-nowrap shrink-0"
          >
            <Grid className="w-4 h-4 text-slate-600" />
            <span>
              {answeredCount}/{questions.length} Terjawab
            </span>
          </button>

          {currentIndex < questions.length - 1 ? (
            <button
              type="button"
              onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))}
              className="min-h-[44px] px-3.5 sm:px-5 rounded-xl bg-blue-700 hover:bg-blue-800 text-sm font-semibold text-white flex items-center gap-1 whitespace-nowrap shrink-0"
            >
              <span>Berikutnya</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmSubmitOpen(true)}
              className="min-h-[44px] px-3.5 sm:px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-sm font-semibold text-white flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Send className="w-4 h-4" />
              <span>Kumpulkan</span>
            </button>
          )}
        </div>
      </footer>

      {/* Question Navigator Bottom Sheet */}
      {navSheetOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-end sm:items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-label="Daftar Nomor Soal"
        >
          <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl border border-slate-200 p-5 max-h-[82vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">Daftar Nomor Soal</h2>
                <p className="text-xs text-slate-500 tabular-nums">
                  {answeredCount} terjawab · {questions.length - answeredCount} belum dijawab
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNavSheetOpen(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-5 gap-2.5 overflow-y-auto py-1">
              {questions.map((q, idx) => {
                const isDone = Boolean(answers[q.id]);
                const isCurr = idx === currentIndex;
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => {
                      setCurrentIndex(idx);
                      setNavSheetOpen(false);
                    }}
                    className={`min-h-[44px] rounded-xl font-mono text-sm font-bold tabular-nums border transition-colors ${
                      isCurr
                        ? 'border-blue-700 ring-2 ring-blue-700/30 bg-blue-50 text-blue-800'
                        : isDone
                        ? 'bg-emerald-600 border-emerald-600 text-white'
                        : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>

            <div className="mt-5 pt-4 border-t border-slate-200 flex items-center gap-3">
              {!isFullscreen && document.fullscreenEnabled && (
                <button
                  type="button"
                  onClick={() => {
                    void requestFullscreenSafe();
                    setNavSheetOpen(false);
                  }}
                  className="min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Layar Penuh
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setNavSheetOpen(false);
                  setConfirmSubmitOpen(true);
                }}
                className="flex-1 min-h-[44px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-sm font-semibold text-white"
              >
                Kumpulkan Ujian
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Submit Confirmation Modal */}
      {confirmSubmitOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-submit-title"
        >
          <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
            <h2 id="confirm-submit-title" className="text-base font-bold text-slate-900">
              Konfirmasi Pengumpulan Ujian
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Anda telah menjawab{' '}
              <strong className="font-mono text-slate-900">{answeredCount}</strong> dari{' '}
              <strong className="font-mono text-slate-900">{questions.length}</strong> soal.
            </p>
            {answeredCount < questions.length && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2 text-xs text-amber-900">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <span>Masih ada {questions.length - answeredCount} soal yang belum dijawab.</span>
              </div>
            )}
            <div className="flex items-center gap-2.5 pt-1">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setConfirmSubmitOpen(false)}
                className="flex-1 min-h-[44px] px-4 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Periksa Lagi
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void submitExam(false)}
                className="flex-1 min-h-[44px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-sm font-semibold text-white"
              >
                {submitting ? 'Mengirim...' : 'Ya, Kumpulkan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Screen Violation Warning Modal */}
      {warningModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/70 flex items-center justify-center p-4"
          role="alertdialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm bg-white rounded-2xl border border-amber-300 p-5 space-y-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-amber-700">
                  Peringatan Pelanggaran ({warningModal.count}/{exam.max_warnings})
                </p>
                <h2 className="text-base font-bold text-slate-900 mt-0.5">Tetap di Halaman Ujian</h2>
              </div>
            </div>
            <p className="text-sm text-slate-700 leading-relaxed">{warningModal.message}</p>
            <button
              type="button"
              onClick={async () => {
                setWarningModal(null);
                await requestFullscreenSafe();
              }}
              className="w-full min-h-[46px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-sm font-semibold text-white"
            >
              Kembali ke Layar Penuh &amp; Lanjutkan
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
