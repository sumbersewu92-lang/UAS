import { Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

function formatFriendlyError(rawMessage: string): string {
  try {
    const parsed = JSON.parse(rawMessage) as { error?: string; operationType?: string; path?: string };
    if (parsed && parsed.error) {
      if (parsed.error.toLowerCase().includes('permission') || parsed.error.toLowerCase().includes('insufficient')) {
        return 'Akses ke database cloud ditolak. Pastikan Anda sudah masuk menggunakan akun Google yang sesuai.';
      }
      if (parsed.error.toLowerCase().includes('quota')) {
        return 'Kuota harian database cloud tercapai. Kuota akan otomatis pulih keesokan harinya.';
      }
      return parsed.error;
    }
  } catch {
    // Plain error string
  }
  return rawMessage || 'Terjadi kesalahan pada aplikasi.';
}

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: formatFriendlyError(error.message || 'Terjadi kesalahan pada aplikasi.'),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UjianKu render error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 space-y-3 text-center">
            <h1 className="text-lg font-bold text-slate-900">Halaman Mengalami Kendala</h1>
            <p className="text-sm text-slate-600">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-xl bg-blue-700 text-sm font-semibold text-white"
            >
              Muat Ulang Halaman
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);
