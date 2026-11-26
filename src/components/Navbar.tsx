import { LogOut } from 'lucide-react';

export type AppView = 'student' | 'teacher';

interface NavbarProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  onOpenGuide: () => void;
  isTeacherLoggedIn: boolean;
  onTeacherLogout: () => void;
  kioskMode?: boolean;
}

export function Navbar({
  activeView,
  onNavigate,
  onOpenGuide,
  isTeacherLoggedIn,
  onTeacherLogout,
  kioskMode = false,
}: NavbarProps) {
  if (kioskMode) {
    return (
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <span className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            UjianKu
          </span>
          <span className="text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-lg whitespace-nowrap">
            Portal Peserta Ujian
          </span>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4 sm:gap-8">
        <button
          type="button"
          onClick={() => onNavigate('student')}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-700 rounded"
        >
          UjianKu
        </button>

        <nav className="flex items-center gap-4 sm:gap-6 text-sm font-medium">
          <button
            type="button"
            onClick={() => onNavigate('student')}
            className={`py-1 whitespace-nowrap shrink-0 transition-colors border-b-2 ${
              activeView === 'student'
                ? 'text-blue-700 border-blue-700'
                : 'text-slate-600 border-transparent hover:text-slate-900'
            }`}
          >
            Portal Siswa
          </button>
          <button
            type="button"
            onClick={() => onNavigate('teacher')}
            className={`py-1 whitespace-nowrap shrink-0 transition-colors border-b-2 ${
              activeView === 'teacher'
                ? 'text-blue-700 border-blue-700'
                : 'text-slate-600 border-transparent hover:text-slate-900'
            }`}
          >
            Dashboard Guru
          </button>
          <button
            type="button"
            onClick={onOpenGuide}
            className="hidden sm:inline-block py-1 whitespace-nowrap shrink-0 text-slate-600 hover:text-slate-900 transition-colors"
          >
            Panduan
          </button>
        </nav>

        <div className="flex items-center shrink-0">
          {activeView === 'teacher' && isTeacherLoggedIn ? (
            <button
              type="button"
              onClick={onTeacherLogout}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Keluar</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate(activeView === 'student' ? 'teacher' : 'student')}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {activeView === 'student' ? 'Masuk Guru' : 'Portal Siswa'}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
