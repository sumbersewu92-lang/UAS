import { onAuthStateChanged, type User } from 'firebase/auth';
import { useEffect, useState } from 'react';
import { ExamRoom } from './components/ExamRoom';
import { GuideModal } from './components/GuideModal';
import { Navbar, type AppView } from './components/Navbar';
import { StudentPortal } from './components/StudentPortal';
import { TeacherAuth } from './components/TeacherAuth';
import { TeacherDashboard } from './components/TeacherDashboard';
import { auth, signOutGoogle } from './firebase';
import type { ExamJoinResponse } from './types';
import { checkIsTeacher, ensureSeedDataIfEmpty } from './utils/firestoreService';

export default function App() {
  const [initialUrlParams] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenParam = params.get('token')?.trim().toUpperCase() || '';
    const modeParam = params.get('mode')?.trim().toLowerCase() || '';
    const isKiosk = Boolean(tokenParam) || modeParam === 'peserta' || modeParam === 'siswa';
    return { tokenParam, isKiosk };
  });

  const [activeView, setActiveView] = useState<AppView>('student');
  const [initialToken] = useState<string>(initialUrlParams.tokenParam);
  const [studentKioskMode] = useState<boolean>(initialUrlParams.isKiosk);
  const [activeExamSession, setActiveExamSession] = useState<ExamJoinResponse | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [isTeacherUser, setIsTeacherUser] = useState(false);
  const [checkingRole, setCheckingRole] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setAuthUser(user);
      if (!user) {
        setIsTeacherUser(false);
        setCheckingRole(false);
        setAuthReady(true);
        return;
      }

      setCheckingRole(true);
      try {
        const teacherOk = await checkIsTeacher(user);
        setIsTeacherUser(teacherOk);
        if (teacherOk) {
          await ensureSeedDataIfEmpty(user.uid);
        }
      } catch (err) {
        console.error('Role verification failed:', err);
        setIsTeacherUser(false);
      } finally {
        setCheckingRole(false);
        setAuthReady(true);
      }
    });

    return () => unsubscribe();
  }, []);

  if (activeExamSession) {
    return (
      <ExamRoom
        initialData={activeExamSession}
        onExitToPortal={() => {
          setActiveExamSession(null);
          setActiveView('student');
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <Navbar
        activeView={activeView}
        onNavigate={(view) => {
          if (studentKioskMode) return;
          setActiveView(view);
        }}
        onOpenGuide={() => setGuideOpen(true)}
        isTeacherLoggedIn={Boolean(authUser && isTeacherUser)}
        onTeacherLogout={() => void signOutGoogle()}
        kioskMode={studentKioskMode}
      />

      <div className="flex-1">
        {studentKioskMode || activeView === 'student' ? (
          <StudentPortal
            initialToken={initialToken}
            kioskMode={studentKioskMode}
            authReady={authReady}
            authUser={authUser}
            onExamJoined={(data) => setActiveExamSession(data)}
          />
        ) : authReady && authUser && isTeacherUser ? (
          <TeacherDashboard authReady={authReady} authUser={authUser} />
        ) : (
          <TeacherAuth
            authReady={authReady}
            checkingRole={checkingRole}
            authUser={authUser}
            isTeacherUser={isTeacherUser}
          />
        )}
      </div>

      <footer className="border-t border-slate-200 bg-white py-4 px-4 text-center text-xs text-slate-500">
        UjianKu · Portal Ujian Semester Berbasis Web &amp; Cloud Database Sekolah
      </footer>

      <GuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
  );
}
