import type { User } from 'firebase/auth';
import { AlertCircle, LogOut, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { signInWithGoogle, signOutGoogle } from '../firebase';

interface TeacherAuthProps {
  authReady: boolean;
  checkingRole: boolean;
  authUser: User | null;
  isTeacherUser: boolean;
}

export function TeacherAuth({
  authReady,
  checkingRole,
  authUser,
  isTeacherUser,
}: TeacherAuthProps) {
  const [signingIn, setSigningIn] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleGoogleLogin() {
    setErrorMsg(null);
    setSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/popup-closed-by-user') {
        setErrorMsg('Jendela login Google ditutup sebelum selesai.');
      } else if (code === 'auth/unauthorized-domain') {
        setErrorMsg(
          'Domain ini belum terdaftar pada Authorized Domains di Firebase Console (Authentication -> Settings).'
        );
      } else {
        setErrorMsg('Gagal masuk menggunakan akun Google. Pastikan pop-up diizinkan dan coba lagi.');
      }
    } finally {
      setSigningIn(false);
    }
  }

  if (!authReady || checkingRole) {
    return (
      <main className="max-w-md mx-auto px-4 py-12">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center text-sm text-slate-500">
          Memeriksa akses Dashboard Guru...
        </div>
      </main>
    );
  }

  const wrongAccount = Boolean(authUser && !authUser.isAnonymous && !isTeacherUser);
  const signedInNonAnon = Boolean(authUser && !authUser.isAnonymous);

  return (
    <main className="max-w-md mx-auto px-4 py-10 sm:py-14">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-7 space-y-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-semibold text-blue-700">Akses Guru &amp; Pengawas</p>
            <h1 className="text-lg font-bold text-slate-900 mt-0.5">Masuk Dashboard Guru</h1>
          </div>
        </div>

        <p className="text-sm text-slate-600 leading-relaxed">
          Masuk dengan akun Google Guru yang terdaftar untuk mengelola paket ujian, bank soal, memantau
          peserta secara langsung, membuka kunci layar, dan mengunduh rekap nilai.
        </p>

        {wrongAccount && authUser && (
          <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 space-y-2 text-sm text-amber-900">
            <p className="font-semibold">Akun ini tidak memiliki izin akses Guru</p>
            <p className="text-xs text-amber-800 leading-relaxed">
              Anda sedang masuk sebagai <strong className="font-mono">{authUser.email}</strong>. Silakan keluar
              dan pilih akun Google Guru yang berwenang.
            </p>
          </div>
        )}

        {errorMsg && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2 text-sm text-red-800">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="space-y-2.5">
          <button
            type="button"
            disabled={signingIn}
            onClick={() => void handleGoogleLogin()}
            className="w-full min-h-[46px] px-4 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:bg-slate-300 rounded-xl transition-colors"
          >
            {signingIn ? 'Membuka Login Google...' : wrongAccount ? 'Pilih Akun Google Lain' : 'Masuk dengan Akun Google'}
          </button>

          {signedInNonAnon && authUser && (
            <button
              type="button"
              onClick={() => void signOutGoogle()}
              className="w-full min-h-[44px] px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl inline-flex items-center justify-center gap-1.5"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Keluar dari {authUser.email}</span>
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
