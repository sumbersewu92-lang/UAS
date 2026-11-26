import { X } from 'lucide-react';

interface GuideModalProps {
  open: boolean;
  onClose: () => void;
}

export function GuideModal({ open, onClose }: GuideModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="guide-modal-title"
    >
      <div className="w-full sm:max-w-2xl bg-white rounded-t-2xl sm:rounded-2xl border border-slate-200 max-h-[88vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <h2 id="guide-modal-title" className="text-base font-bold text-slate-900">
            Panduan Penggunaan &amp; Pengujian UjianKu
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label="Tutup panduan"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-6 text-sm text-slate-700 leading-relaxed">
          <section>
            <h3 className="text-sm font-bold text-slate-900 mb-2">
              1. Menguji Alur Siswa (HP / Browser / GitHub Pages)
            </h3>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                Buka tab <strong>Portal Siswa</strong>, lalu masukkan token{' '}
                <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-900">PASMTK26</code>{' '}
                beserta NIS peserta yang sudah terdaftar (contoh:{' '}
                <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-900">20260103</code> — Bagas
                Pratama), atau cukup klik <strong>Isi Data Contoh</strong> lalu tekan{' '}
                <strong>Mulai / Lanjutkan Ujian</strong>. Untuk paket{' '}
                <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-900">PASBIN26</code>,
                tambahkan/impor peserta terlebih dahulu di Dashboard Guru.
              </li>
              <li>
                <strong>Auto-Save Ganda (HP + Cloud):</strong> Setiap memilih jawaban, data langsung tersimpan ke{' '}
                <code className="font-mono text-xs">localStorage</code> HP dan disinkronkan ke Cloud Firestore. Jika
                jaringan terputus, indikator menampilkan <em>&ldquo;Tersimpan di HP (menunggu jaringan)&rdquo;</em> dan
                otomatis terkirim ulang begitu sinyal kembali.
              </li>
              <li>
                <strong>Anti-Curang Layar:</strong> Selama ujian aktif, teks soal tidak bisa disalin/blok, klik kanan
                dinonaktifkan, dan pindah tab / keluar layar penuh dicatat ke cloud. Pelanggaran ke-3 (melebihi batas
                toleransi 2 peringatan) otomatis mengunci layar siswa menjadi <strong>TERKUNCI</strong>.
              </li>
            </ul>
          </section>

          <section>
            <h3 className="text-sm font-bold text-slate-900 mb-2">
              2. Menguji Alur Guru &amp; Buka Kunci Real-Time
            </h3>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                Buka tab <strong>Dashboard Guru</strong> dan masuk menggunakan akun Google Guru yang terdaftar. Saat
                guru pertama kali masuk, dua paket ujian contoh dan daftar peserta uji coba otomatis disiapkan di
                database cloud.
              </li>
              <li>
                Pada tab <strong>Pantauan &amp; Rekap</strong>, sudah tersedia peserta contoh termasuk{' '}
                <strong>Nadia Putri Rahayu (NIS 20260102)</strong> yang berstatus <strong>Terkunci</strong> untuk
                menguji tombol <strong>Buka Kunci</strong> dan melihat log pelanggaran layar secara real-time.
              </li>
              <li>
                Gunakan tombol <strong>Ekspor Rekap CSV</strong> untuk mengunduh rekap nilai lengkap (NIS, Nama, Kelas,
                Benar/Salah, Nilai Akhir, dan Jumlah Pelanggaran Layar) yang siap dibuka di Excel.
              </li>
            </ul>
          </section>

          <section>
            <h3 className="text-sm font-bold text-slate-900 mb-2">
              3. Impor Massal, QR Code &amp; GitHub Pages
            </h3>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                Di tab <strong>Bank Soal</strong>, klik <strong>Impor Massal Soal</strong> untuk menempel banyak soal
                sekaligus (format blok teks atau CSV). Di tab <strong>Pantauan &amp; Rekap</strong>, gunakan{' '}
                <strong>Impor Peserta (Excel/CSV)</strong> untuk memuat daftar NIS, Nama, dan Kelas dari Excel.
              </li>
              <li>
                Di tab <strong>Paket Ujian</strong>, klik <strong>QR Portal</strong> untuk mencetak QR Code yang
                langsung mengisi token ujian di HP siswa.
              </li>
            </ul>
          </section>
        </div>

        <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg"
          >
            Mengerti
          </button>
        </div>
      </div>
    </div>
  );
}
