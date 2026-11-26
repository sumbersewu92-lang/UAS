import type { User } from 'firebase/auth';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Edit3,
  FileSpreadsheet,
  History,
  ImagePlus,
  Lock,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Smartphone,
  Trash2,
  Unlock,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type {
  MonitorParticipant,
  OptionKey,
  SessionStatus,
  TeacherExam,
  TeacherQuestion,
  ViolationLogItem,
} from '../types';
import { compressImageFile } from '../utils/csvAndParser';
import {
  addSingleParticipant,
  buildParticipantsCsv,
  deleteTeacherExam,
  deleteTeacherQuestion,
  generateRandomToken,
  listSessionViolations,
  listTeacherExams,
  listTeacherQuestions,
  resetStudentDevice,
  saveTeacherExam,
  saveTeacherQuestion,
  subscribeExamMonitor,
  unlockStudentSession,
} from '../utils/firestoreService';
import { BulkImportModal } from './teacher/BulkImportModal';
import { BulkParticipantsModal } from './teacher/BulkParticipantsModal';
import { QrModal } from './teacher/QrModal';

interface TeacherDashboardProps {
  authReady: boolean;
  authUser: User;
}

type TeacherTab = 'exams' | 'questions' | 'monitor';

function formatRemaining(seconds: number | null): string {
  if (seconds === null) return '-';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function renderStatusLabel(status: SessionStatus) {
  switch (status) {
    case 'TERKUNCI':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          <span>Terkunci</span>
        </span>
      );
    case 'MENGERJAKAN':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          <span>Mengerjakan</span>
        </span>
      );
    case 'SELESAI':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>Selesai</span>
        </span>
      );
    default:
      return <span className="text-xs font-medium text-slate-500">Belum Mulai</span>;
  }
}

export function TeacherDashboard({ authReady, authUser }: TeacherDashboardProps) {
  const [activeTab, setActiveTab] = useState<TeacherTab>('monitor');
  const [exams, setExams] = useState<TeacherExam[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<string | null>(null);
  const [loadingExams, setLoadingExams] = useState(true);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [bannerSuccess, setBannerSuccess] = useState<string | null>(null);

  // Exam create/edit modal state
  const [examModalOpen, setExamModalOpen] = useState(false);
  const [editingExam, setEditingExam] = useState<TeacherExam | null>(null);
  const [examForm, setExamForm] = useState({
    title: '',
    subject: '',
    class_level: '',
    duration_minutes: 45,
    max_warnings: 2,
    token: '',
    is_active: true,
    shuffle_questions: true,
    shuffle_options: true,
  });
  const [savingExam, setSavingExam] = useState(false);
  const [confirmDeleteExamId, setConfirmDeleteExamId] = useState<string | null>(null);
  const [qrExam, setQrExam] = useState<TeacherExam | null>(null);

  // Questions tab state
  const [questions, setQuestions] = useState<TeacherQuestion[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [questionFormOpen, setQuestionFormOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<TeacherQuestion | null>(null);
  const [qForm, setQForm] = useState({
    question_text: '',
    option_a: '',
    option_b: '',
    option_c: '',
    option_d: '',
    correct_option: 'A' as OptionKey,
    points: 10,
    image_data: null as string | null,
  });
  const [savingQuestion, setSavingQuestion] = useState(false);
  const [confirmDeleteQId, setConfirmDeleteQId] = useState<string | null>(null);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);

  // Monitor tab state
  const [participants, setParticipants] = useState<MonitorParticipant[]>([]);
  const [loadingMonitor, setLoadingMonitor] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | SessionStatus>('ALL');
  const [violationDrawerParticipant, setViolationDrawerParticipant] = useState<MonitorParticipant | null>(null);
  const [drawerViolations, setDrawerViolations] = useState<ViolationLogItem[]>([]);
  const [loadingViolations, setLoadingViolations] = useState(false);
  const [addParticipantOpen, setAddParticipantOpen] = useState(false);
  const [bulkParticipantsOpen, setBulkParticipantsOpen] = useState(false);
  const [newParticipant, setNewParticipant] = useState({ nis: '', student_name: '', student_class: '' });
  const [exportingCsv, setExportingCsv] = useState(false);

  const fetchExams = useCallback(async () => {
    setLoadingExams(true);
    try {
      const list = await listTeacherExams();
      setExams(list);
      setSelectedExamId((prev) => {
        if (prev && list.some((e) => e.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Gagal memuat daftar ujian.');
    } finally {
      setLoadingExams(false);
    }
  }, []);

  const fetchQuestions = useCallback(async (examId: string) => {
    setLoadingQuestions(true);
    try {
      const list = await listTeacherQuestions(examId);
      setQuestions(list);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Gagal memuat bank soal.');
    } finally {
      setLoadingQuestions(false);
    }
  }, []);

  useEffect(() => {
    if (!authReady || !authUser) return;
    void fetchExams();
  }, [authReady, authUser, fetchExams]);

  const selectedExam = useMemo(
    () => exams.find((e) => e.id === selectedExamId) ?? null,
    [exams, selectedExamId]
  );

  useEffect(() => {
    if (!authReady || !authUser || !selectedExam) return;
    if (activeTab === 'questions') {
      void fetchQuestions(selectedExam.id);
      return;
    }
    if (activeTab === 'monitor') {
      setLoadingMonitor(true);
      const unsub = subscribeExamMonitor(selectedExam.id, selectedExam.question_count, (rows) => {
        setParticipants(rows);
        setLoadingMonitor(false);
      });
      return () => unsub();
    }
  }, [authReady, authUser, selectedExam, activeTab, fetchQuestions]);

  const filteredParticipants = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return participants.filter((p) => {
      if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
      if (!q) return true;
      return (
        p.nis.toLowerCase().includes(q) ||
        p.student_name.toLowerCase().includes(q) ||
        p.student_class.toLowerCase().includes(q)
      );
    });
  }, [participants, searchQuery, statusFilter]);

  const monitorStats = useMemo(() => {
    let active = 0;
    let locked = 0;
    let finished = 0;
    for (const p of participants) {
      if (p.status === 'MENGERJAKAN') active += 1;
      else if (p.status === 'TERKUNCI') locked += 1;
      else if (p.status === 'SELESAI') finished += 1;
    }
    return { total: participants.length, active, locked, finished };
  }, [participants]);

  function openCreateExamModal() {
    setEditingExam(null);
    setExamForm({
      title: '',
      subject: '',
      class_level: '',
      duration_minutes: 45,
      max_warnings: 2,
      token: '',
      is_active: true,
      shuffle_questions: true,
      shuffle_options: true,
    });
    setExamModalOpen(true);
  }

  function openEditExamModal(exam: TeacherExam) {
    setEditingExam(exam);
    setExamForm({
      title: exam.title,
      subject: exam.subject,
      class_level: exam.class_level,
      duration_minutes: exam.duration_minutes,
      max_warnings: exam.max_warnings,
      token: exam.token,
      is_active: exam.is_active,
      shuffle_questions: exam.shuffle_questions,
      shuffle_options: exam.shuffle_options,
    });
    setExamModalOpen(true);
  }

  async function handleSaveExam(e: FormEvent) {
    e.preventDefault();
    setSavingExam(true);
    setBannerError(null);
    try {
      const savedId = await saveTeacherExam({
        editingExam,
        ...examForm,
      });
      setExamModalOpen(false);
      await fetchExams();
      setSelectedExamId(savedId);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Gagal menyimpan paket ujian.');
    } finally {
      setSavingExam(false);
    }
  }

  async function handleToggleActive(exam: TeacherExam) {
    try {
      await saveTeacherExam({
        editingExam: exam,
        title: exam.title,
        subject: exam.subject,
        class_level: exam.class_level,
        duration_minutes: exam.duration_minutes,
        max_warnings: exam.max_warnings,
        token: exam.token,
        is_active: !exam.is_active,
        shuffle_questions: exam.shuffle_questions,
        shuffle_options: exam.shuffle_options,
      });
      await fetchExams();
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Gagal mengubah status ujian.');
    }
  }

  async function handleRegenerateToken(exam: TeacherExam) {
    try {
      await saveTeacherExam({
        editingExam: exam,
        title: exam.title,
        subject: exam.subject,
        class_level: exam.class_level,
        duration_minutes: exam.duration_minutes,
        max_warnings: exam.max_warnings,
        token: generateRandomToken(6),
        is_active: exam.is_active,
        shuffle_questions: exam.shuffle_questions,
        shuffle_options: exam.shuffle_options,
      });
      await fetchExams();
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Gagal mengacak token baru.');
    }
  }

  async function handleDeleteExam(exam: TeacherExam) {
    try {
      await deleteTeacherExam(exam);
      setConfirmDeleteExamId(null);
      await fetchExams();
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Gagal menghapus paket ujian.');
    }
  }

  function openNewQuestionForm() {
    setEditingQuestion(null);
    setQForm({
      question_text: '',
      option_a: '',
      option_b: '',
      option_c: '',
      option_d: '',
      correct_option: 'A',
      points: 10,
      image_data: null,
    });
    setQuestionFormOpen(true);
  }

  function openEditQuestionForm(q: TeacherQuestion) {
    setEditingQuestion(q);
    setQForm({
      question_text: q.question_text,
      option_a: q.option_a,
      option_b: q.option_b,
      option_c: q.option_c,
      option_d: q.option_d,
      correct_option: q.correct_option,
      points: q.points,
      image_data: q.image_data,
    });
    setQuestionFormOpen(true);
  }

  async function handleSaveQuestion(e: FormEvent) {
    e.preventDefault();
    if (!selectedExam) return;
    setSavingQuestion(true);
    setBannerError(null);
    try {
      const nextOrder =
        questions.reduce((acc, q) => Math.max(acc, q.order_index), 0) + 1;
      await saveTeacherQuestion({
        exam: selectedExam,
        editingQuestion,
        ...qForm,
        nextOrderIndex: nextOrder,
      });
      setQuestionFormOpen(false);
      await fetchQuestions(selectedExam.id);
      await fetchExams();
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Gagal menyimpan soal.');
    } finally {
      setSavingQuestion(false);
    }
  }

  async function handleDeleteQuestion(qId: string) {
    if (!selectedExam) return;
    try {
      await deleteTeacherQuestion(selectedExam, qId);
      setConfirmDeleteQId(null);
      await fetchQuestions(selectedExam.id);
      await fetchExams();
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Gagal menghapus soal.');
    }
  }

  async function handleUnlockSession(sessionId: string) {
    if (!selectedExam) return;
    try {
      await unlockStudentSession(selectedExam.id, sessionId);
      await fetchExams();
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Gagal membuka kunci sesi.');
    }
  }

  async function handleResetDevice(sessionId: string) {
    if (!selectedExam) return;
    try {
      await resetStudentDevice(selectedExam.id, sessionId);
      setBannerSuccess('Perangkat siswa berhasil direset. Siswa dapat masuk ulang dari HP baru.');
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Gagal mereset perangkat siswa.');
    }
  }

  async function openViolationDrawer(p: MonitorParticipant) {
    if (!selectedExam) return;
    setViolationDrawerParticipant(p);
    setDrawerViolations([]);
    setLoadingViolations(true);
    try {
      const logs = await listSessionViolations(selectedExam.id, p.id);
      setDrawerViolations(logs);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Gagal memuat riwayat pelanggaran.');
    } finally {
      setLoadingViolations(false);
    }
  }

  async function handleAddParticipant(e: FormEvent) {
    e.preventDefault();
    if (!selectedExam) return;
    setBannerError(null);
    try {
      await addSingleParticipant(selectedExam.id, newParticipant);
      setNewParticipant({ nis: '', student_name: '', student_class: '' });
      setAddParticipantOpen(false);
      await fetchExams();
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Gagal menambah peserta.');
    }
  }

  function handleExportCsv() {
    if (!selectedExam) return;
    setExportingCsv(true);
    try {
      const csv = buildParticipantsCsv(participants);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rekap-nilai-${selectedExam.token}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExportingCsv(false);
    }
  }

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Workspace Header & Tab Switcher */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Dashboard Pengelola Ujian
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Sinkronisasi cloud aktif ({authUser.email}) · Pantauan peserta, bank soal, dan rekap nilai.
          </p>
        </div>

        <div className="inline-flex p-1 bg-slate-100 rounded-xl self-start md:self-auto overflow-x-auto max-w-full">
          <button
            type="button"
            onClick={() => setActiveTab('monitor')}
            className={`px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'monitor'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Pantauan &amp; Rekap
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('questions')}
            className={`px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'questions'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Bank Soal
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('exams')}
            className={`px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'exams'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Paket Ujian
          </button>
        </div>
      </div>

      {bannerError && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 flex items-center justify-between gap-3 text-sm text-red-800">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{bannerError}</span>
          </div>
          <button type="button" onClick={() => setBannerError(null)} className="text-red-700 hover:text-red-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {bannerSuccess && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-3 text-sm text-emerald-900">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{bannerSuccess}</span>
          </div>
          <button type="button" onClick={() => setBannerSuccess(null)} className="text-emerald-700 hover:text-emerald-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Active Exam Selector for Questions & Monitor Tabs */}
      {activeTab !== 'exams' && exams.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 flex-1 min-w-0">
            <label htmlFor="active-exam-select" className="text-xs font-semibold text-slate-600 whitespace-nowrap">
              Paket Ujian Aktif:
            </label>
            <select
              id="active-exam-select"
              value={selectedExamId ?? ''}
              onChange={(e) => setSelectedExamId(e.target.value)}
              className="w-full sm:max-w-md min-h-[42px] px-3 py-2 text-sm font-semibold bg-slate-50 border border-slate-300 rounded-xl text-slate-900"
            >
              {exams.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.title} (Token: {ex.token})
                </option>
              ))}
            </select>
          </div>

          {selectedExam && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 tabular-nums shrink-0">
              <span>{selectedExam.duration_minutes} menit</span>
              <span aria-hidden="true">·</span>
              <span>{selectedExam.question_count} soal</span>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => setQrExam(selectedExam)}
                className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline"
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>QR Portal</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* TAB 1: PAKET UJIAN */}
      {activeTab === 'exams' && (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-bold text-slate-900">Daftar Paket Ujian</h2>
            <button
              type="button"
              onClick={openCreateExamModal}
              className="min-h-[42px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-sm font-semibold text-white inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Buat Ujian Baru</span>
            </button>
          </div>

          {loadingExams ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">
              Memuat daftar paket ujian dari cloud...
            </div>
          ) : exams.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-3">
              <p className="text-sm text-slate-600">Belum ada paket ujian.</p>
              <button
                type="button"
                onClick={openCreateExamModal}
                className="px-4 py-2 rounded-xl bg-blue-700 text-sm font-semibold text-white"
              >
                Buat Ujian Pertama
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {exams.map((exam) => (
                <article
                  key={exam.id}
                  className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-bold text-slate-900">{exam.title}</h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-600 tabular-nums">
                      <span>{exam.subject}</span>
                      <span aria-hidden="true">·</span>
                      <span>Kelas {exam.class_level}</span>
                      <span aria-hidden="true">·</span>
                      <span>{exam.duration_minutes} menit</span>
                      <span aria-hidden="true">·</span>
                      <span>{exam.question_count} soal</span>
                      <span aria-hidden="true">·</span>
                      <span>Toleransi {exam.max_warnings} peringatan</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
                      <span className="text-slate-600">
                        Token:{' '}
                        <strong className="font-mono text-sm text-slate-900 select-all">{exam.token}</strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleRegenerateToken(exam)}
                        className="text-blue-700 hover:underline font-medium"
                      >
                        Acak Token Baru
                      </button>
                      <span aria-hidden="true" className="text-slate-300">|</span>
                      <button
                        type="button"
                        onClick={() => void handleToggleActive(exam)}
                        className={`font-semibold ${
                          exam.is_active ? 'text-emerald-700' : 'text-slate-500'
                        } hover:underline`}
                      >
                        {exam.is_active ? 'Status: Token Aktif (Klik Nonaktifkan)' : 'Status: Nonaktif (Klik Aktifkan)'}
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setQrExam(exam)}
                      className="min-h-[40px] px-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5"
                    >
                      <QrCode className="w-3.5 h-3.5" />
                      <span>QR Portal</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedExamId(exam.id);
                        setActiveTab('questions');
                      }}
                      className="min-h-[40px] px-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700"
                    >
                      Kelola Soal
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedExamId(exam.id);
                        setActiveTab('monitor');
                      }}
                      className="min-h-[40px] px-3 rounded-xl bg-blue-50 hover:bg-blue-100 text-xs font-semibold text-blue-800"
                    >
                      Pantau ({exam.session_stats.total})
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditExamModal(exam)}
                      className="min-h-[40px] px-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>
                    {confirmDeleteExamId === exam.id ? (
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void handleDeleteExam(exam)}
                          className="min-h-[40px] px-3 rounded-xl bg-red-600 text-xs font-semibold text-white"
                        >
                          Yakin Hapus
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteExamId(null)}
                          className="min-h-[40px] px-2.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-600"
                        >
                          Batal
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteExamId(exam.id)}
                        className="min-h-[40px] px-2.5 rounded-xl border border-slate-200 text-slate-500 hover:text-red-600 hover:border-red-200"
                        aria-label={`Hapus ${exam.title}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {/* TAB 2: BANK SOAL */}
      {activeTab === 'questions' && selectedExam && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Bank Soal — {selectedExam.subject}
              </h2>
              <p className="text-xs text-slate-500 tabular-nums">
                Total {questions.length} soal · Pengacakan soal:{' '}
                {selectedExam.shuffle_questions ? 'Aktif' : 'Nonaktif'} · Pengacakan opsi:{' '}
                {selectedExam.shuffle_options ? 'Aktif' : 'Nonaktif'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setBulkImportOpen(true)}
                className="min-h-[42px] px-3.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs sm:text-sm font-semibold text-slate-800 inline-flex items-center gap-1.5"
              >
                <Upload className="w-4 h-4" />
                <span>Impor Massal Soal</span>
              </button>
              <button
                type="button"
                onClick={openNewQuestionForm}
                className="min-h-[42px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-xs sm:text-sm font-semibold text-white inline-flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Tambah Soal</span>
              </button>
            </div>
          </div>

          {questionFormOpen && (
            <form
              onSubmit={handleSaveQuestion}
              className="bg-white border border-blue-200 rounded-2xl p-5 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900">
                  {editingQuestion ? 'Edit Soal Pilihan Ganda' : 'Tambah Soal Baru'}
                </h3>
                <button
                  type="button"
                  onClick={() => setQuestionFormOpen(false)}
                  className="text-slate-500 hover:text-slate-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Pertanyaan</label>
                <textarea
                  rows={3}
                  required
                  value={qForm.question_text}
                  onChange={(e) => setQForm((f) => ({ ...f, question_text: e.target.value }))}
                  placeholder="Tulis teks soal di sini..."
                  className="w-full p-3 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(['A', 'B', 'C', 'D'] as const).map((letter) => {
                  const field = `option_${letter.toLowerCase()}` as
                    | 'option_a'
                    | 'option_b'
                    | 'option_c'
                    | 'option_d';
                  return (
                    <div key={letter}>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Opsi {letter}
                      </label>
                      <input
                        type="text"
                        required
                        value={qForm[field]}
                        onChange={(e) => setQForm((f) => ({ ...f, [field]: e.target.value }))}
                        placeholder={`Jawaban ${letter}`}
                        className="w-full min-h-[42px] px-3 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-700"
                      />
                    </div>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Kunci Jawaban</label>
                  <select
                    value={qForm.correct_option}
                    onChange={(e) =>
                      setQForm((f) => ({ ...f, correct_option: e.target.value as OptionKey }))
                    }
                    className="w-full min-h-[42px] px-3 text-sm font-semibold border border-slate-300 rounded-xl bg-white"
                  >
                    <option value="A">Kunci: A</option>
                    <option value="B">Kunci: B</option>
                    <option value="C">Kunci: C</option>
                    <option value="D">Kunci: D</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Bobot Poin</label>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    required
                    value={qForm.points}
                    onChange={(e) => setQForm((f) => ({ ...f, points: Number(e.target.value) || 1 }))}
                    className="w-full min-h-[42px] px-3 text-sm font-mono border border-slate-300 rounded-xl"
                  />
                </div>

                <div>
                  <label className="inline-flex items-center gap-1.5 min-h-[42px] px-3.5 rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700 cursor-pointer w-full justify-center">
                    <ImagePlus className="w-4 h-4" />
                    <span>{qForm.image_data ? 'Ganti Gambar Soal' : 'Tambah Gambar (Opsional)'}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          const compressed = await compressImageFile(file);
                          setQForm((f) => ({ ...f, image_data: compressed }));
                        } catch (err) {
                          setBannerError(
                            err instanceof Error ? err.message : 'Gagal memproses gambar.'
                          );
                        }
                      }}
                    />
                  </label>
                </div>
              </div>

              {qForm.image_data && (
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <img
                    src={qForm.image_data}
                    alt="Pratinjau gambar soal"
                    className="h-16 w-auto rounded-lg border border-slate-200"
                  />
                  <div className="text-xs text-slate-600 flex-1">
                    Gambar otomatis dikompresi (~{Math.round((qForm.image_data.length * 0.75) / 1024)} KB) agar hemat
                    kuota HP siswa.
                  </div>
                  <button
                    type="button"
                    onClick={() => setQForm((f) => ({ ...f, image_data: null }))}
                    className="text-xs font-semibold text-red-600 hover:underline"
                  >
                    Hapus Gambar
                  </button>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setQuestionFormOpen(false)}
                  className="min-h-[42px] px-4 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingQuestion}
                  className="min-h-[42px] px-5 rounded-xl bg-blue-700 hover:bg-blue-800 text-sm font-semibold text-white"
                >
                  {savingQuestion ? 'Menyimpan...' : 'Simpan Soal'}
                </button>
              </div>
            </form>
          )}

          {loadingQuestions ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">
              Memuat bank soal...
            </div>
          ) : questions.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-3">
              <p className="text-sm text-slate-600">Belum ada soal di paket ujian ini.</p>
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={openNewQuestionForm}
                  className="px-4 py-2 rounded-xl bg-blue-700 text-sm font-semibold text-white"
                >
                  Tambah Soal Pertama
                </button>
                <button
                  type="button"
                  onClick={() => setBulkImportOpen(true)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700"
                >
                  Impor Massal
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {questions.map((q, idx) => (
                <article key={q.id} className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-xs font-semibold text-slate-500 tabular-nums">
                        Soal #{idx + 1} · Bobot {q.points} poin · Kunci{' '}
                        <span className="font-mono text-emerald-700">{q.correct_option}</span>
                      </div>
                      <p className="text-sm sm:text-base font-medium text-slate-900 whitespace-pre-line">
                        {q.question_text}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditQuestionForm(q)}
                        className="min-h-[36px] px-2.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Edit
                      </button>
                      {confirmDeleteQId === q.id ? (
                        <button
                          type="button"
                          onClick={() => void handleDeleteQuestion(q.id)}
                          className="min-h-[36px] px-2.5 rounded-lg bg-red-600 text-xs font-semibold text-white"
                        >
                          Hapus?
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteQId(q.id)}
                          className="min-h-[36px] px-2 rounded-lg border border-slate-200 text-slate-500 hover:text-red-600"
                          aria-label={`Hapus soal ${idx + 1}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {q.image_data && (
                    <img
                      src={q.image_data}
                      alt={`Gambar soal ${idx + 1}`}
                      className="max-h-40 rounded-lg border border-slate-200"
                    />
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs sm:text-sm">
                    {(['A', 'B', 'C', 'D'] as const).map((letter) => {
                      const val =
                        letter === 'A'
                          ? q.option_a
                          : letter === 'B'
                          ? q.option_b
                          : letter === 'C'
                          ? q.option_c
                          : q.option_d;
                      const isCorrect = q.correct_option === letter;
                      return (
                        <div
                          key={letter}
                          className={`px-3 py-2 rounded-lg border ${
                            isCorrect
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-950 font-medium'
                              : 'bg-slate-50 border-slate-200 text-slate-700'
                          }`}
                        >
                          <span className="font-mono font-bold mr-2">{letter}.</span>
                          <span>{val}</span>
                        </div>
                      );
                    })}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {/* TAB 3: PANTAUAN & REKAP NILAI */}
      {activeTab === 'monitor' && selectedExam && (
        <section className="space-y-4">
          {/* 4-Column KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white border border-slate-200 rounded-2xl p-4">
              <div className="text-xs font-medium text-slate-500">Total Peserta</div>
              <div className="text-2xl font-bold font-mono text-slate-900 tabular-nums mt-1">
                {monitorStats.total}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-4">
              <div className="text-xs font-medium text-slate-500">Sedang Mengerjakan</div>
              <div className="text-2xl font-bold font-mono text-blue-700 tabular-nums mt-1">
                {monitorStats.active}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-4">
              <div className="text-xs font-medium text-slate-500">Layar Terkunci</div>
              <div className="text-2xl font-bold font-mono text-red-600 tabular-nums mt-1">
                {monitorStats.locked}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-4">
              <div className="text-xs font-medium text-slate-500">Sudah Selesai</div>
              <div className="text-2xl font-bold font-mono text-emerald-700 tabular-nums mt-1">
                {monitorStats.finished}
              </div>
            </div>
          </div>

          {/* Toolbar: Search, Filter, Add Participant, Export */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari NIS, nama siswa, atau kelas..."
                  className="w-full min-h-[42px] pl-9 pr-3 text-sm bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void fetchExams()}
                  className="min-h-[40px] px-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Sinkron Real-Time</span>
                </button>

                <button
                  type="button"
                  onClick={() => setAddParticipantOpen((v) => !v)}
                  className="min-h-[40px] px-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Tambah Siswa</span>
                </button>

                <button
                  type="button"
                  onClick={() => setBulkParticipantsOpen(true)}
                  className="min-h-[40px] px-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Impor Peserta (Excel/CSV)</span>
                </button>

                <button
                  type="button"
                  disabled={exportingCsv}
                  onClick={handleExportCsv}
                  className="min-h-[40px] px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold text-white inline-flex items-center gap-1.5"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>{exportingCsv ? 'Menyiapkan...' : 'Ekspor Rekap CSV'}</span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {(
                [
                  ['ALL', 'Semua'],
                  ['TERKUNCI', 'Terkunci'],
                  ['MENGERJAKAN', 'Mengerjakan'],
                  ['BELUM_MULAI', 'Belum Mulai'],
                  ['SELESAI', 'Selesai'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStatusFilter(key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    statusFilter === key
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {addParticipantOpen && (
              <form
                onSubmit={handleAddParticipant}
                className="pt-3 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-4 gap-2.5"
              >
                <input
                  type="text"
                  required
                  placeholder="NIS / No. Ujian"
                  value={newParticipant.nis}
                  onChange={(e) => setNewParticipant((p) => ({ ...p, nis: e.target.value }))}
                  className="min-h-[40px] px-3 text-sm font-mono border border-slate-300 rounded-xl"
                />
                <input
                  type="text"
                  required
                  placeholder="Nama Lengkap"
                  value={newParticipant.student_name}
                  onChange={(e) => setNewParticipant((p) => ({ ...p, student_name: e.target.value }))}
                  className="min-h-[40px] px-3 text-sm border border-slate-300 rounded-xl"
                />
                <input
                  type="text"
                  required
                  placeholder="Kelas (mis: XI IPA 1)"
                  value={newParticipant.student_class}
                  onChange={(e) => setNewParticipant((p) => ({ ...p, student_class: e.target.value }))}
                  className="min-h-[40px] px-3 text-sm border border-slate-300 rounded-xl"
                />
                <button
                  type="submit"
                  className="min-h-[40px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-sm font-semibold text-white"
                >
                  Simpan Peserta
                </button>
              </form>
            )}
          </div>

          {/* Participant Table (Desktop) + Cards (Mobile) */}
          {loadingMonitor ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">
              Memuat data peserta dari cloud...
            </div>
          ) : filteredParticipants.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">
              Tidak ada data peserta yang sesuai filter.
            </div>
          ) : (
            <>
              <div className="hidden md:block bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                        <th className="py-3 px-4">NIS / No. Ujian</th>
                        <th className="py-3 px-4">Nama &amp; Kelas</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4 text-right">Progres</th>
                        <th className="py-3 px-4 text-right">Sisa Waktu</th>
                        <th className="py-3 px-4 text-right">Pelanggaran</th>
                        <th className="py-3 px-4 text-right">Nilai</th>
                        <th className="py-3 px-4 text-right">Aksi Pengawas</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {filteredParticipants.map((p) => (
                        <tr key={p.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-800 tabular-nums">
                            {p.nis}
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-semibold text-slate-900">{p.student_name}</div>
                            <div className="text-xs text-slate-500">{p.student_class}</div>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">{renderStatusLabel(p.status)}</td>
                          <td className="py-3 px-4 text-right font-mono text-xs text-slate-700 tabular-nums">
                            {p.answered_count}/{p.total_questions}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-xs text-slate-700 tabular-nums">
                            {p.status === 'SELESAI' ? 'Selesai' : formatRemaining(p.remaining_seconds)}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => void openViolationDrawer(p)}
                              className={`inline-flex items-center gap-1 font-mono text-xs font-semibold tabular-nums hover:underline ${
                                p.violation_count > 0 ? 'text-red-600' : 'text-slate-500'
                              }`}
                            >
                              <History className="w-3.5 h-3.5" />
                              <span>{p.violation_count}</span>
                            </button>
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 tabular-nums">
                            {p.status === 'SELESAI' ? (p.graded ? p.final_grade : '...') : '-'}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              {p.status === 'TERKUNCI' && (
                                <button
                                  type="button"
                                  onClick={() => void handleUnlockSession(p.id)}
                                  className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-xs font-semibold text-white inline-flex items-center gap-1"
                                >
                                  <Unlock className="w-3.5 h-3.5" />
                                  <span>Buka Kunci</span>
                                </button>
                              )}
                              {(p.status === 'MENGERJAKAN' || p.status === 'TERKUNCI') && (
                                <button
                                  type="button"
                                  onClick={() => void handleResetDevice(p.id)}
                                  title="Izinkan siswa lanjut dari HP lain jika HP sebelumnya mati"
                                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 inline-flex items-center gap-1"
                                >
                                  <Smartphone className="w-3.5 h-3.5" />
                                  <span>Reset HP</span>
                                </button>
                              )}
                              {p.status === 'SELESAI' && p.graded && (
                                <span className="text-xs text-slate-400 tabular-nums">
                                  {p.correct_count}B / {p.wrong_count}S
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mobile Friendly Monitor Cards */}
              <div className="md:hidden space-y-3">
                {filteredParticipants.map((p) => (
                  <article key={p.id} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-bold text-slate-900">{p.student_name}</div>
                        <div className="text-xs text-slate-500 font-mono tabular-nums">
                          {p.nis} · {p.student_class}
                        </div>
                      </div>
                      {renderStatusLabel(p.status)}
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-xs bg-slate-50 rounded-xl p-2.5 tabular-nums">
                      <div>
                        <div className="text-slate-500">Progres</div>
                        <div className="font-mono font-semibold text-slate-900">
                          {p.answered_count}/{p.total_questions}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Pelanggaran</div>
                        <button
                          type="button"
                          onClick={() => void openViolationDrawer(p)}
                          className={`font-mono font-semibold underline ${
                            p.violation_count > 0 ? 'text-red-600' : 'text-slate-800'
                          }`}
                        >
                          {p.violation_count} log
                        </button>
                      </div>
                      <div>
                        <div className="text-slate-500">Nilai</div>
                        <div className="font-mono font-bold text-blue-700">
                          {p.status === 'SELESAI'
                            ? p.graded
                              ? p.final_grade
                              : '...'
                            : formatRemaining(p.remaining_seconds)}
                        </div>
                      </div>
                    </div>

                    {(p.status === 'TERKUNCI' || p.status === 'MENGERJAKAN') && (
                      <div className="flex items-center gap-2">
                        {p.status === 'TERKUNCI' && (
                          <button
                            type="button"
                            onClick={() => void handleUnlockSession(p.id)}
                            className="flex-1 min-h-[42px] px-3 rounded-xl bg-red-600 text-xs font-semibold text-white inline-flex items-center justify-center gap-1.5"
                          >
                            <Unlock className="w-3.5 h-3.5" />
                            <span>Buka Kunci Sesi</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleResetDevice(p.id)}
                          className="min-h-[42px] px-3 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700"
                        >
                          Reset HP
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {/* Create / Edit Exam Modal */}
      {examModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl border border-slate-200 p-5 sm:p-6 max-h-[90vh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">
                {editingExam ? 'Edit Pengaturan Ujian' : 'Buat Paket Ujian Baru'}
              </h2>
              <button
                type="button"
                onClick={() => setExamModalOpen(false)}
                className="text-slate-500 hover:text-slate-900"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveExam} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Judul Ujian</label>
                <input
                  type="text"
                  required
                  value={examForm.title}
                  onChange={(e) => setExamForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Contoh: PAS Semester Ganjil — Fisika"
                  className="w-full min-h-[42px] px-3 text-sm border border-slate-300 rounded-xl"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Mata Pelajaran</label>
                  <input
                    type="text"
                    required
                    value={examForm.subject}
                    onChange={(e) => setExamForm((f) => ({ ...f, subject: e.target.value }))}
                    placeholder="Contoh: Fisika"
                    className="w-full min-h-[42px] px-3 text-sm border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Kelas</label>
                  <input
                    type="text"
                    required
                    value={examForm.class_level}
                    onChange={(e) => setExamForm((f) => ({ ...f, class_level: e.target.value }))}
                    placeholder="Contoh: XI IPA"
                    className="w-full min-h-[42px] px-3 text-sm border border-slate-300 rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Durasi (Menit)</label>
                  <input
                    type="number"
                    min={5}
                    max={300}
                    required
                    value={examForm.duration_minutes}
                    onChange={(e) =>
                      setExamForm((f) => ({ ...f, duration_minutes: Number(e.target.value) || 45 }))
                    }
                    className="w-full min-h-[42px] px-3 text-sm font-mono border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Toleransi Peringatan</label>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    required
                    value={examForm.max_warnings}
                    onChange={(e) =>
                      setExamForm((f) => ({ ...f, max_warnings: Number(e.target.value) }))
                    }
                    className="w-full min-h-[42px] px-3 text-sm font-mono border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Token Ujian</label>
                  <input
                    type="text"
                    value={examForm.token}
                    onChange={(e) =>
                      setExamForm((f) => ({ ...f, token: e.target.value.toUpperCase() }))
                    }
                    placeholder="Otomatis"
                    className="w-full min-h-[42px] px-3 text-sm font-mono uppercase border border-slate-300 rounded-xl"
                  />
                </div>
              </div>

              <div className="space-y-2 pt-1 text-sm text-slate-700">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={examForm.shuffle_questions}
                    onChange={(e) => setExamForm((f) => ({ ...f, shuffle_questions: e.target.checked }))}
                    className="w-4 h-4 rounded accent-blue-700"
                  />
                  <span>Acak urutan soal per siswa</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={examForm.shuffle_options}
                    onChange={(e) => setExamForm((f) => ({ ...f, shuffle_options: e.target.checked }))}
                    className="w-4 h-4 rounded accent-blue-700"
                  />
                  <span>Acak urutan opsi A/B/C/D per siswa</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={examForm.is_active}
                    onChange={(e) => setExamForm((f) => ({ ...f, is_active: e.target.checked }))}
                    className="w-4 h-4 rounded accent-blue-700"
                  />
                  <span>Aktifkan token ujian sekarang</span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setExamModalOpen(false)}
                  className="min-h-[42px] px-4 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingExam}
                  className="min-h-[42px] px-5 rounded-xl bg-blue-700 hover:bg-blue-800 text-sm font-semibold text-white"
                >
                  {savingExam ? 'Menyimpan...' : 'Simpan Ujian'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Violation Log Drawer / Modal */}
      {violationDrawerParticipant && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl border border-slate-200 max-h-[82vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Log Pelanggaran Layar — {violationDrawerParticipant.student_name}
                </h2>
                <p className="text-xs text-slate-500 font-mono">
                  NIS {violationDrawerParticipant.nis} · {violationDrawerParticipant.student_class}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViolationDrawerParticipant(null)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-2.5">
              {loadingViolations ? (
                <p className="text-sm text-slate-500 text-center py-6">Memuat log pelanggaran...</p>
              ) : drawerViolations.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-6">
                  Belum ada catatan pelanggaran layar untuk siswa ini.
                </p>
              ) : (
                drawerViolations.map((v) => (
                  <div key={v.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
                    <div className="flex items-center justify-between font-semibold">
                      <span
                        className={
                          v.violation_type === 'BUKA_KUNCI' ? 'text-emerald-700' : 'text-red-700'
                        }
                      >
                        {v.violation_type}
                      </span>
                      <span className="font-mono text-slate-500 tabular-nums">
                        {new Date(v.created_at).toLocaleTimeString('id-ID', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="text-slate-700">{v.detail}</p>
                  </div>
                ))
              )}
            </div>

            <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
              {violationDrawerParticipant.status === 'TERKUNCI' ? (
                <button
                  type="button"
                  onClick={async () => {
                    await handleUnlockSession(violationDrawerParticipant.id);
                    setViolationDrawerParticipant(null);
                  }}
                  className="min-h-[40px] px-4 rounded-xl bg-red-600 hover:bg-red-700 text-xs font-semibold text-white inline-flex items-center gap-1.5"
                >
                  <Unlock className="w-3.5 h-3.5" />
                  <span>Buka Kunci Sesi Ini</span>
                </button>
              ) : (
                <span className="text-xs text-slate-500">
                  Total pelanggaran: {violationDrawerParticipant.violation_count}
                </span>
              )}
              <button
                type="button"
                onClick={() => setViolationDrawerParticipant(null)}
                className="min-h-[40px] px-4 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedExam && (
        <>
          <BulkImportModal
            open={bulkImportOpen}
            exam={selectedExam}
            onClose={() => setBulkImportOpen(false)}
            onImported={() => {
              void fetchQuestions(selectedExam.id);
              void fetchExams();
            }}
          />
          <BulkParticipantsModal
            open={bulkParticipantsOpen}
            examId={selectedExam.id}
            examTitle={selectedExam.title}
            onClose={() => setBulkParticipantsOpen(false)}
            onImported={({ inserted, skipped }) => {
              setBannerSuccess(
                `Impor selesai: ${inserted} peserta ditambahkan${skipped > 0 ? `, ${skipped} dilewati karena NIS sudah terdaftar` : ''}.`
              );
              void fetchExams();
            }}
          />
        </>
      )}

      <QrModal exam={qrExam} onClose={() => setQrExam(null)} />
    </main>
  );
}
