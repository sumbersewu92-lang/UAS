import { Check, Copy, Printer, X } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import type { TeacherExam } from '../../types';

interface QrModalProps {
  exam: TeacherExam | null;
  onClose: () => void;
}

export function QrModal({ exam, onClose }: QrModalProps) {
  const [loading, setLoading] = useState(false);
  const [qrData, setQrData] = useState<{
    portalUrl: string;
    svg: string;
    token: string;
    title: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!exam) return;
    let active = true;
    setLoading(true);

    async function buildQr() {
      if (!exam) return;
      try {
        const cleanPath = window.location.pathname.replace(/\/index\.html$/, '');
        const base = `${window.location.origin}${cleanPath}`;
        const url = new URL(base);
        url.searchParams.set('token', exam.token);
        const portalUrl = url.toString();

        const svg = await QRCode.toString(portalUrl, {
          type: 'svg',
          margin: 1,
          width: 240,
          color: { dark: '#0f172a', light: '#ffffff' },
        });
        if (active) {
          setQrData({ portalUrl, svg, token: exam.token, title: exam.title });
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void buildQr();
    return () => {
      active = false;
    };
  }, [exam]);

  if (!exam) return null;

  async function copyLink() {
    if (!qrData) return;
    try {
      await navigator.clipboard.writeText(qrData.portalUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-modal-title"
    >
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-blue-700">Akses HP Siswa via QR Code</p>
            <h2 id="qr-modal-title" className="text-base font-bold text-slate-900 mt-0.5">
              {qrData?.title || exam.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading || !qrData ? (
          <div className="h-64 flex items-center justify-center text-sm text-slate-500">
            Menyiapkan QR Code...
          </div>
        ) : (
          <>
            <div className="flex flex-col items-center bg-slate-50 border border-slate-200 rounded-xl p-5">
              <img
                src={`data:image/svg+xml;utf8,${encodeURIComponent(qrData.svg)}`}
                alt={`QR Code untuk token ${qrData.token}`}
                className="w-56 h-56 bg-white p-2 rounded-xl border border-slate-200"
              />
              <p className="mt-3 text-xs text-slate-600 text-center">
                Token Ujian:{' '}
                <strong className="font-mono text-sm text-slate-900">{qrData.token}</strong>
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-700">Tautan Langsung Portal</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={qrData.portalUrl}
                  className="flex-1 min-w-0 px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
                />
                <button
                  type="button"
                  onClick={copyLink}
                  className="min-h-[38px] px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1 shrink-0"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Disalin' : 'Salin'}</span>
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1 print:hidden">
              <button
                type="button"
                onClick={() => window.print()}
                className="min-h-[42px] px-4 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5"
              >
                <Printer className="w-4 h-4" />
                <span>Cetak</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="min-h-[42px] px-5 rounded-xl bg-blue-700 hover:bg-blue-800 text-sm font-semibold text-white"
              >
                Tutup
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
