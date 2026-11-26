# Security Specification — UjianKu Firestore

## 1. Data Invariants
1. Answer keys (`/exams/{examId}/answer_keys/{questionId}`) and student access PINs (`/exams/{examId}/participant_pins/{sessionId}`) are readable and writable **only** by verified teachers (`isTeacher()`). Students can never read correct answers or other students' PINs from Firestore.
2. Student sessions (`/exams/{examId}/sessions/{sessionId}`) are keyed by normalized `nis` and can only be created by verified teachers. Students may only claim (`BELUM_MULAI -> MENGERJAKAN`) or resume an existing session by providing a matching `submitted_pin` validated against `participant_pins`. Once claimed (`student_uid != null`), only that owning authenticated student (`request.auth.uid == student_uid`) or a teacher can read or mutate the session.
3. Terminal state locking: Once a session reaches `status == 'SELESAI'`, students cannot modify answers, reset status, or alter violation counts.
4. Anti-unlock bypass: When a session reaches `status == 'TERKUNCI'`, students cannot modify `answers`, `status`, or `violation_count`. Only a teacher can transition `TERKUNCI -> MENGERJAKAN` or reset a session.
5. Students cannot alter grade fields (`correct_count`, `wrong_count`, `unanswered_count`, `score`, `max_score`, `final_grade`, `graded`), registered `student_name`/`student_class`, or `exam_id`/`nis`/`created_at`.
6. All string fields enforce explicit `.size()` bounds; all IDs match `^[a-zA-Z0-9_\-]+$`; all timestamps enforce `request.time`.

## 2. Dirty Dozen Payloads (Must Return PERMISSION_DENIED)
1. Unauthenticated read on `/exams/exam1/questions/q1`.
2. Student reading `/exams/exam1/answer_keys/q1`.
3. Student listing `/exams` collection (enumeration of all school exams).
4. Student creating an exam under `/exams/fake_exam`.
5. Student updating `status` from `TERKUNCI` back to `MENGERJAKAN`.
6. Student updating `answers` after `status == 'SELESAI'`.
7. Student injecting shadow field `final_grade: 100` or `graded: true` during answer save.
8. Student claiming a session belonging to another `student_uid`.
9. Student forging `student_uid` to another user's UID on session creation.
10. Student decrementing `violation_count` (e.g., `violation_count: 0` when existing is `2`).
11. Unverified email user (`email_verified: false`) attempting to write a session or spoof teacher email.
12. Oversized 1MB `question_text` or invalid document ID `../../etc` passed to `/exams/{examId}`.
