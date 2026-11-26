import { AlertCircle, CheckCircle2, Download, FileText, Upload, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { TeacherExam } from '../../types';
import {
  BLOCK_TEMPLATE,
  CSV_TEMPLATE,
  parseBlockQuestions,
  parseCsvQuestions,
} from '../../utils/csvAndParser';
import { bulkImportQuestionsToExam } from '../../utils/firestoreService';

interface BulkImportModalProps {
  open: boolean;
  exam: TeacherExam;
  onClose: () => void;
  onImported: () => void;
}

export function BulkImportModal({
  open,
  exam,
  onClose,
  onImported,
}: BulkImportModalProps) {
  const [mode, setMode] = useState<'block' | 'csv'>('block');
  const [rawText, setRawText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const parsed = useMemo(() => {
    if (!rawText.trim()) return { items: [], errors: [] };
    return mode === 'block' ? parseBlockQuestions(rawText) : parseCsvQuestions(rawText);
  }, [rawText, mode]);

  if (!open) return null;

  function downloadCsvTemplate() {
    const blob = new Blob(['\uFEFF' + CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template-impor-soal.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleFileUpload(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    setMode('csv');
    setRawText(text);
    setServerError(null);
  }

  async function handleImport() {
    if (parsed.items.length === 0) return;
    setSubmitting(true);
    setServerError(null);
    try {
      await bulkImportQuestionsToExam(exam, parsed.items);
      setRawText('');
      onImported();
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Gagal mengimpor soal ke database cloud.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-import-title"
    >
      <div className="w-full sm:max-w-3xl bg-white rounded-t-2xl sm:rounded-2xl border border-slate-200 max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 id="bulk-import-title" className="text-base font-bold text-slate-900 truncate">
              Impor Massal Soal — {exam.title}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Tempel banyak soal sekaligus tanpa menginput satu per satu.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => {
                  setMode('block');
                  setServerError(null);
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                  mode === 'block' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileText className="w-3.5 h-3.5 inline mr-1.5" />
                Copy-Paste Teks Soal
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('csv');
                  setServerError(null);
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                  mode === 'csv' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Upload className="w-3.5 h-3.5 inline mr-1.5" />
                Format CSV / Excel
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRawText(mode === 'block' ? BLOCK_TEMPLATE : CSV_TEMPLATE)}
                className="px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg"
              >
                Muat Contoh Format
              </button>
              {mode === 'csv' && (
                <>
                  <button
                    type="button"
                    onClick={downloadCsvTemplate}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Template CSV</span>
                  </button>
                  <label className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Pilih File .CSV</span>
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={(e) => void handleFileUpload(e.target.files?.[0])}
                    />
                  </label>
                </>
              )}
            </div>
          </div>

          <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3">
            {mode === 'block' ? (
              <p>
                Pisahkan antar soal dengan <strong>1 baris kosong</strong>. Format tiap soal: baris pertanyaan, lalu{' '}
                <code className="font-mono">A. ...</code> sampai <code className="font-mono">D. ...</code>,{' '}
                <code className="font-mono">Kunci: C</code>, dan opsional <code className="font-mono">Poin: 10</code>.
              </p>
            ) : (
              <p>
                Urutan kolom CSV:{' '}
                <code className="font-mono">pertanyaan,opsi_a,opsi_b,opsi_c,opsi_d,kunci,poin</code> (mendukung pemisah
                koma atau titik koma dari Excel).
              </p>
            )}
          </div>

          <textarea
            rows={8}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={
              mode === 'block'
                ? 'Tempel daftar soal pilihan ganda di sini...'
                : 'Tempel isi CSV atau pilih file .csv di atas...'
            }
            className="w-full p-3.5 text-sm font-mono bg-white border border-slate-300 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-blue-700"
          />

          {rawText.trim() && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span className="text-emerald-800 tabular-nums">
                  {parsed.items.length} soal valid siap diimpor
                </span>
              </div>
              {parsed.errors.length > 0 && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1">
                  {parsed.errors.slice(0, 5).map((err, i) => (
                    <div key={i}>{err}</div>
                  ))}
                  {parsed.errors.length > 5 && (
                    <div>...dan {parsed.errors.length - 5} baris bermasalah lainnya.</div>
                  )}
                </div>
              )}
            </div>
          )}

          {serverError && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2 text-xs text-red-800">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{serverError}</span>
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[42px] px-4 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            Batal
          </button>
          <button
            type="button"
            disabled={submitting || parsed.items.length === 0}
            onClick={handleImport}
            className="min-h-[42px] px-5 rounded-xl bg-blue-700 hover:bg-blue-800 disabled:bg-slate-300 text-sm font-semibold text-white"
          >
            {submitting ? 'Mengimpor...' : `Simpan ${parsed.items.length} Soal`}
          </button>
        </div>
      </div>
    </div>
  );
}
