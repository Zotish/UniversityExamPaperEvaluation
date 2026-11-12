export type Role = "teacher" | "student";

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

export type EvaluationReviewStatus =
  | "Ready for Review"
  | "Extraction Uncertain"
  | "Rubric Match Uncertain"
  | "Manual Review Required"
  | "Teacher Approved";

export type RecheckStatus = "Submitted" | "Under Review" | "Resolved" | "Rejected";

export interface UserRecord {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  role: Role;
  department: string;
  designation: string | null;
  student_id_number: string | null;
  teacher_id_number: string | null;
  avatar_initials: string;
  created_at: string;
}

export interface RubricCriterion {
  id?: number;
  question_id?: number;
  criterion_name: string;
  max_marks: number;
  sort_order: number;
}

export interface OcrCapabilityReport {
  selectablePdfText: boolean;
  scannedImageOcr: boolean;
  handwritingOcr: boolean;
  providerName: string;
  configurationNote: string;
}

export interface ExtractedQuestionChunk {
  questionNumber: number;
  text: string;
  pageNumber: number;
  uncertain: boolean;
}

export interface OcrExtractionResult {
  success: boolean;
  pageCount: number;
  fullText: string;
  chunks: ExtractedQuestionChunk[];
  uncertain: boolean;
  message: string;
  provider: string;
}

export interface AiCapabilityReport {
  deterministicGrading: boolean;
  aiSemanticGrading: boolean;
  providerName: string;
  configurationNote: string;
}

export interface QuestionEvaluationSuggestion {
  suggestedMarks: number;
  rubricScores: { criterionName: string; maxMarks: number; awardedMarks: number }[];
  correctConcepts: string[];
  missingConcepts: string[];
  misconceptions: string[];
  feedback: string;
  evaluationMethod: string;
  reviewStatus: EvaluationReviewStatus;
}

