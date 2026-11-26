export type OptionKey = 'A' | 'B' | 'C' | 'D';

export type SessionStatus = 'BELUM_MULAI' | 'MENGERJAKAN' | 'TERKUNCI' | 'SELESAI';

export interface StudentQuestion {
  id: string;
  question_text: string;
  image_data: string | null;
  points: number;
  options: Array<{
    displayKey: OptionKey;
    originalKey: OptionKey;
    text: string;
  }>;
}

export interface StudentExamInfo {
  id: string;
  title: string;
  subject: string;
  class_level: string;
  duration_minutes: number;
  max_warnings: number;
}

export interface StudentSessionInfo {
  id: string;
  exam_id: string;
  nis: string;
  student_name: string;
  student_class: string;
  status: SessionStatus;
  violation_count: number;
  started_at: string;
  ends_at: string;
  server_now: string;
}

export interface ExamJoinResponse {
  session: StudentSessionInfo;
  exam: StudentExamInfo;
  questions: StudentQuestion[];
  savedAnswers: Record<string, OptionKey>;
}

export interface ExamResultSummary {
  student_name: string;
  nis: string;
  student_class?: string;
  correct_count: number;
  wrong_count: number;
  unanswered_count: number;
  score?: number;
  max_score?: number;
  final_grade: number;
  graded: boolean;
  violation_count?: number;
  answered_count?: number;
  total_questions?: number;
  submitted_at: string | null;
}

export interface TeacherExam {
  id: string;
  title: string;
  subject: string;
  class_level: string;
  duration_minutes: number;
  max_warnings: number;
  token: string;
  is_active: boolean;
  shuffle_questions: boolean;
  shuffle_options: boolean;
  created_at: string;
  question_count: number;
  session_stats: {
    total: number;
    active: number;
    locked: number;
    finished: number;
  };
}

export interface TeacherQuestion {
  id: string;
  exam_id: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: OptionKey;
  points: number;
  image_data: string | null;
  order_index: number;
  created_at: string;
}

export interface ViolationLogItem {
  id: string;
  session_id: string;
  violation_type: string;
  detail: string;
  created_at: string;
}

export interface MonitorParticipant {
  id: string;
  exam_id: string;
  nis: string;
  student_name: string;
  student_class: string;
  status: SessionStatus;
  violation_count: number;
  answered_count: number;
  total_questions: number;
  remaining_seconds: number | null;
  started_at: string | null;
  ends_at: string | null;
  submitted_at: string | null;
  last_heartbeat_at: string | null;
  correct_count: number;
  wrong_count: number;
  unanswered_count: number;
  score: number;
  max_score: number;
  final_grade: number;
  graded: boolean;
  violations: ViolationLogItem[];
}
