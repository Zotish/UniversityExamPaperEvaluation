export type Role = "teacher" | "student";

export type Screen =
  | "login"
  | "teacher"
  | "courses"
  | "examinations"
  | "create"
  | "key"
  | "sheets"
  | "processing"
  | "evaluations"
  | "review"
  | "results"
  | "publish"
  | "teacherRechecks"
  | "reports"
  | "settings"
  | "student"
  | "studentCourses"
  | "studentResult"
  | "studentReview"
  | "mistakes"
  | "recheck"
  | "profile";

export type ExamStatus =
  | "Draft"
  | "Awaiting Answer Key"
  | "Ready for Upload"
  | "Processing"
  | "Needs Review"
  | "Ready to Publish"
  | "Published"
  | "Archived";

export type QuestionType = "MCQ" | "Short Answer" | "Descriptive" | "True/False" | "Numerical";

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  department: string;
  designation: string | null;
  student_id_number: string | null;
  teacher_id_number: string | null;
  avatar_initials: string;
}

export interface RegisterPayload {
  role: Role;
  name: string;
  email: string;
  password: string;
  department?: string;
  designation?: string;
  studentIdNumber?: string;
  teacherIdNumber?: string;
}

export interface OcrCapabilities {
  selectablePdfText: boolean;
  scannedImageOcr: boolean;
  handwritingOcr: boolean;
  providerName: string;
  configurationNote: string;
}

export interface AiCapabilities {
  deterministicGrading: boolean;
  aiSemanticGrading: boolean;
  providerName: string;
  configurationNote: string;
}

export interface Course {
  id: number;
  code: string;
  title: string;
  department: string;
  semester: string;
  teacher_id: number;
  teacher_name?: string;
  description: string;
  enrolled_count?: number;
  exam_count?: number;
  published_exam_count?: number;
}

export interface Examination {
  id: number;
  course_id: number;
  title: string;
  exam_date: string;
  total_marks: number;
  pass_threshold: number;
  total_questions: number;
  configured_questions?: number;
  status: ExamStatus;
  answer_key_verified: number;
  answer_key_file_id: number | null;
  answer_key_file_name?: string | null;
  answer_key_mime?: string | null;
  answer_key_pages?: number | null;
  published_at: string | null;
  course_code?: string;
  course_title?: string;
  semester?: string;
  department?: string;
  teacher_name?: string;
  submission_count?: number;
  approved_count?: number;
  pending_review_count?: number;
  // Student fields
  submission_id?: number | null;
  obtained_marks?: number | null;
  teacher_overall_feedback?: string | null;
}

export interface RubricCriterion {
  id?: number;
  question_id?: number;
  criterion_name: string;
  max_marks: number;
  sort_order?: number;
}

export interface Question {
  id?: number;
  exam_id?: number;
  question_number: number;
  question_text: string;
  question_type: QuestionType;
  max_marks: number;
  reference_answer: string;
  alternative_answers: string[];
  numerical_tolerance: number;
  topic: string;
  page_number: number;
  rubrics: RubricCriterion[];
}

export interface Submission {
  id: number;
  exam_id: number;
  student_id: number | null;
  document_id: number | null;
  detected_student_name: string;
  detected_student_id: string;
  student_name?: string;
  student_id_number?: string;
  avatar_initials?: string;
  file_name?: string;
  mime_type?: string;
  size_bytes?: number;
  page_count?: number;
  upload_status: string;
  processing_status: string;
  review_status: string;
  total_suggested_marks: number;
  total_approved_marks: number | null;
  teacher_overall_feedback: string;
  unapproved_questions?: number;
  flagged_questions?: number;
  exam_title?: string;
  exam_date?: string;
  exam_total_marks?: number;
  exam_status?: ExamStatus;
  published_at?: string | null;
  course_code?: string;
  course_title?: string;
  semester?: string;
  teacher_name?: string;
}

export interface QuestionEvaluation {
  question_id: number;
  evaluation_id: number | null;
  question_number: number;
  question_text: string;
  question_type: QuestionType;
  max_marks: number;
  reference_answer: string;
  topic: string;
  extracted_answer: string;
  page_reference: number;
  extraction_status: string;
  suggested_marks?: number;
  approved_marks: number | null;
  rubric_scores: { criterionName: string; maxMarks: number; awardedMarks: number }[];
  correct_concepts: string[];
  missing_concepts: string[];
  misconceptions: string[];
  ai_feedback?: string;
  teacher_feedback: string;
  evaluation_method?: string;
  review_status: string;
  flagged: boolean;
  updated_at?: string;
}

export interface RecheckRequest {
  id: number;
  submission_id: number;
  question_id: number;
  student_id: number;
  exam_id: number;
  reason: string;
  student_comment: string;
  status: "Submitted" | "Under Review" | "Resolved" | "Rejected";
  original_marks: number;
  adjusted_marks: number | null;
  teacher_response: string;
  reviewed_at: string | null;
  created_at: string;
  student_name?: string;
  student_id_number?: string;
  exam_title?: string;
  exam_total_marks?: number;
  course_code?: string;
  course_title?: string;
  question_number?: number;
  question_text?: string;
  question_max_marks?: number;
  reference_answer?: string;
  extracted_answer?: string;
  current_question_marks?: number;
  teacher_feedback?: string;
}

export interface NotificationItem {
  id: number;
  title: string;
  message: string;
  type: string;
  link_screen: Screen | null;
  link_entity_id: number | null;
  is_read: number;
  created_at: string;
}

export interface AuditEntry {
  id: number;
  entity_type: string;
  entity_id: number;
  action: string;
  actor_name: string;
  details_json: string;
  created_at: string;
}

export interface NavState {
  examId?: number;
  submissionId?: number;
  questionNumber?: number;
  courseId?: number;
}

