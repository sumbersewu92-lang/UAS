import { AlertCircle, CheckCircle2, Download, Upload, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PARTICIPANTS_CSV_TEMPLATE, parseParticipantsInput } from '../../utils/csvAndParser';
import { bulkImportParticipantsToExam } from '../../utils/firestoreService';

interface BulkParticipantsModalProps {
  open: boolean;
  examId: string;
  examTitle: string;
  onClose: () => void;
  onImported: (summary: { inserted: number; skipped: number }) => void;
}

export function BulkParticipantsModal({
  open,
  examId,
  examTitle,
  onClose,
  onImported,
}: BulkParticipantsModalProps) {
  const [rawText, setRawText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const parsed = useMemo(() => parseParticipantsInput(rawText), [rawText]);

  if (!open) return null;

  function downloadTemplate() {
    const blob = new Blob(['\uFEFF' + PARTICIPANTS_CSV_TEMPLATE], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template-peserta-ujian.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleFileUpload(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    setRawText(text);
    setServerError(null);
  }

  async function handleImport() {
    if (parsed.items.length === 0) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const summary = await bulkImportParticipantsToExam(examId, parsed.items);
      setRawText('');
      onImported(summary);
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Gagal mengimpor daftar peserta.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-participants-title"
    >
      <div className="w-full sm:max-w-2xl bg-white rounded-t-2xl sm:rounded-2xl border border-slate-200 max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 id="bulk-participants-title" className="text-base font-bold text-slate-900 truncate">
              Impor Daftar Peserta — {examTitle}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Salin-tempel langsung dari Excel/Google Sheets atau unggah file CSV (NIS, Nama, Kelas).
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setRawText(PARTICIPANTS_CSV_TEMPLATE);
                  setServerError(null);
                }}
                className="px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg"
              >
                Muat Contoh
              </button>
              <button
                type="button"
                onClick={downloadTemplate}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Template CSV</span>
              </button>
            </div>

            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              <span>Pilih File .CSV</span>
              <input
                type="file"
                accept=".csv,.txt,text/csv"
                className="hidden"
                onChange={(e) => void handleFileUpload(e.target.files?.[0])}
              />
            </label>
          </div>

          <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3">
            Urutan 3 kolom: <code className="font-mono">NIS / No. Ujian</code>,{' '}
            <code className="font-mono">Nama Lengkap</code>, <code className="font-mono">Kelas</code>. Mendukung
            salin-tempel langsung dari tabel Excel (pemisah Tab), koma (<code className="font-mono">,</code>), atau
            titik koma (<code className="font-mono">;</code>). Peserta dengan NIS yang sudah ada akan dilewati otomatis.
          </div>

          <textarea
            rows={7}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={`Tempel baris dari Excel atau CSV di sini...\nContoh:\n20260106,Budi Santoso,XI IPA 1\n20260107,Citra Dewi Lestari,XI IPA 1`}
            className="w-full p-3.5 text-sm font-mono bg-white border border-slate-300 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-blue-700"
          />

          {rawText.trim() && (
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span className="text-emerald-800 tabular-nums">
                  {parsed.items.length} peserta valid siap ditambahkan
                </span>
              </div>

              {parsed.items.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <th className="py-2 px-3">NIS</th>
                        <th className="py-2 px-3">Nama Siswa</th>
                        <th className="py-2 px-3">Kelas</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {parsed.items.slice(0, 6).map((row) => (
                        <tr key={row.nis}>
                          <td className="py-1.5 px-3 font-mono font-semibold text-slate-800">{row.nis}</td>
                          <td className="py-1.5 px-3 text-slate-900">{row.student_name}</td>
                          <td className="py-1.5 px-3 text-slate-600">{row.student_class}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {parsed.items.length > 6 && (
                    <div className="px-3 py-1.5 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500 tabular-nums">
                      ...dan {parsed.items.length - 6} peserta lainnya
                    </div>
                  )}
                </div>
              )}

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
            {submitting ? 'Mengimpor...' : `Impor ${parsed.items.length} Peserta`}
          </button>
        </div>
      </div>
    </div>
  );
}
