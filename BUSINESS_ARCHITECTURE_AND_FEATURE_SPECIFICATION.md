# EvalDesk Enterprise: AI-Assisted University Exam Evaluation & Academic Integrity Platform
## Comprehensive Product Architecture, Feature Specification & Business Roadmap

---

## 1. Executive Summary & Market Fit

### 1.1 The Industry Problem
Universities worldwide face critical bottlenecks in examination administration:
1. **Teacher Burnout & Grading Fatigue**: A typical university professor evaluates 150 to 500 multi-page handwritten scripts per semester. Fatigue causes **grading inconsistency**, where scripts evaluated early receive different scrutiny compared to scripts graded late at night.
2. **Subjective & Inconsistent Marking**: Different teaching assistants (TAs) or co-examiners apply varying standards despite having an official rubric.
3. **Undetected Student Collusion & Copying**: In large exam halls or take-home assessments, students frequently copy answers from peers (sharing identical phrasing, identical faulty logic, or identical diagrams). Manually detecting cross-student copying across 200 physical answer sheets is mathematically impossible for a human teacher.
4. **Slow Feedback Loop & Contentious Re-checks**: Results take weeks to publish. When results are disputed, institutions lack transparent step-by-step audit trails, leading to administrative friction.

### 1.2 The EvalDesk Solution & Business Value Proposition
**EvalDesk** is an enterprise-grade AI-powered evaluation and academic integrity SaaS engineered specifically for higher education. 
- **Vision-Driven Handwritten Script Evaluation**: Teachers upload their official question paper and ideal model answer key (rubrics, step checkpoints, alternate solutions). The system ingests scanned handwritten student answer sheets (PDFs), transcribes text/diagrams/equations via multi-modal AI models, and evaluates each question against the strict rubric with granular step-marking.
- **Cross-Student Collusion & Plagiarism Detection Engine**: Compares all student submissions within an exam cohort to identify semantic duplication, identical mathematical error fingerprints, and shared anomalous sentences.
- **Human-in-the-Loop Verification**: AI acts as a **super-evaluator and copilot**, not an unchecked black box. Teachers maintain 100% final authority via a side-by-side moderation cockpit.
- **OpenRouter Multi-Model Routing**: Leverages OpenRouter API to intelligently route between leading frontier models (Claude 3.5 Sonnet, GPT-4o, DeepSeek, and specialized vision models) ensuring highest accuracy at minimal cost per script.

---

## 2. Institutional Role-Based Access Control (RBAC)

The system operates under a hierarchical institutional structure:

| Role | Scope & Permissions | Key Use Cases |
| :--- | :--- | :--- |
| **Super Admin (Platform Owner)** | Global multi-tenant configuration, API key pool, billing, token quota monitoring. | Platform management, SaaS subscription provisioning. |
| **University / Campus Admin** | University-wide settings, department creation, SSO configuration (SAML/Google Workspace), academic session setup. | Department management, compliance auditing. |
| **Dean / Head of Department (HOD)** | Department overview, faculty assignments, official approval of published results, grade tampering audits. | Institutional oversight, accreditation (OBE) compliance. |
| **Course Coordinator / Lead Faculty** | Exam creation, rubric authoring, model key verification, evaluation assignment to TAs, grade curve moderation, publication. | Exam setup, model key upload, final mark sign-off. |
| **Co-Examiner / Teaching Assistant (TA)** | Reviewing AI-assigned step marks, providing student feedback, verifying low-confidence flags. | Daily script grading & moderation. |
| **Student** | Access to own graded scripts, question-by-question mark breakdowns, rubric comments, formal re-check / dispute submission. | Transparent feedback, targeted learning improvement. |

---

## 3. End-to-End System Feature Blueprint

```
+-------------------------------------------------------------------------------------------------------+
|                                           EVALDESK PIPELINE                                           |
+-------------------------------------------------------------------------------------------------------+
|  [1. Exam & Rubric Setup]   -->  [2. Model Key Ingestion]  -->  [3. Bulk Student Script Upload]       |
|  - Course metadata               - Text / Handwritten Key       - Multi-page PDF splitting            |
|  - Question mark allocation      - Step-by-step checkpoints     - Auto Roll / QR detection            |
|  - Optional question rules       - Acceptable alternatives      - Image cleanup & deskewing           |
+-------------------------------------------------------------------------------------------------------+
                                                   |
                                                   v
+-------------------------------------------------------------------------------------------------------+
|                               [4. OpenRouter AI Evaluation Pipeline]                                  |
|  - Turn 1: Vision OCR & Mathematical Formula Extraction (LaTeX format)                                |
|  - Turn 2: Question Segmentation (identifying Q1, Q2(a), Q2(b) across pages)                          |
|  - Turn 3: Semantic Alignment against Model Answer & Rubric Checkpoints                               |
|  - Turn 4: Step-Mark Deduction & Justification Generation + Confidence Scoring                        |
+-------------------------------------------------------------------------------------------------------+
                                                   |
                                                   v
+-------------------------------------------------------------------------------------------------------+
|                         [5. Cross-Student Peer Collusion & Copying Engine]                            |
|  - Pairwise Vector Embeddings & Cosine Similarity Matrix                                              |
|  - Common Error & Typo Fingerprinting (identical unique mistakes)                                     |
|  - Collusion Cluster Graph Network & Seating Plan Correlation                                         |
+-------------------------------------------------------------------------------------------------------+
                                                   |
                                                   v
+-------------------------------------------------------------------------------------------------------+
|                               [6. Faculty Moderation & Audit Cockpit]                                 |
|  - Side-by-side 3-pane reviewer (Raw Scan | AI Transcription & Score | Model Key)                     |
|  - Filter by: Low Confidence (<85%), High Plagiarism (>70%), Failing / Borderline                     |
|  - 1-click teacher override with tamper-proof audit trail                                             |
+-------------------------------------------------------------------------------------------------------+
                                                   |
                                                   v
+-------------------------------------------------------------------------------------------------------+
|                         [7. Result Publishing & Dispute Resolution (Recheck)]                         |
|  - Student self-service breakdown portal                                                              |
|  - Formal Re-check Ticketing Engine (Dispute justification + Blind 2nd Examiner)                      |
|  - LMS Sync (Canvas, Moodle, Blackboard) & Outcome-Based Education (OBE) Reports                       |
+-------------------------------------------------------------------------------------------------------+
```

---

## 4. Detailed Feature Breakdown

### Module 1: Examination & Complex Rubric Architecture

1. **Flexible Question Schemes**:
   - Supports mandatory questions and optional questions (e.g., *"Answer any 4 out of 6 questions"* or *"Question 1 is compulsory; select 3 from Section B"*).
   - Multi-tiered sub-questions: `Q1 -> (a), (b), (c) -> (i), (ii)`.
2. **Multi-Modal Model Answer Key Ingestion**:
   - Teachers can provide the model answer in any format:
     - **Digital PDF / Text**: Typed solutions with code snippets or formulas.
     - **Handwritten Teacher Solution**: High-resolution scan of the teacher’s handwritten master copy.
     - **Interactive Rubric Builder**: Explicitly assigning marks per checkpoint:
       - *Methodology / Formula*: 2 marks
       - *Calculation / Intermediate Steps*: 4 marks
       - *Final Answer & Units*: 2 marks
       - *Diagram / Labeling*: 2 marks
   - **Alternative Solution Paths**: Ability to define multiple valid ways to solve a problem (e.g., Solving via *Mesh Analysis* vs *Nodal Analysis*, or *QuickSort* vs *MergeSort*).

---

### Module 2: Bulk Handwritten Exam Processing & Preprocessing

1. **Intelligent PDF Ingestion**:
   - Bulk upload of entire class batches (e.g., 100-page merged PDF or individual student PDFs).
   - Automatic splitting of combined scanner feeds into distinct student script booklets.
2. **Automated Student Identification**:
   - **Hybrid Barcode / QR Code Scanner**: Recognizes university-printed cover sheet barcodes.
   - **Handwritten Roll / Registration Number OCR**: Bounding-box detection for student ID boxes with checksum verification against the enrolled university class roster.
   - **Anonymized Blind Grading Mode**: Automatically masks the student’s name and roll number during evaluation to guarantee zero teacher bias.
3. **Computer Vision Enhancement Pipeline**:
   - Adaptive binarization (removes ink bleed-through from the back of the paper).
   - Perspective correction, de-skewing, contrast normalization, and marginal shadow removal.
   - Question boundary segmentation (automatically tagging which handwritten sections belong to which question).

---

### Module 3: OpenRouter AI Multi-Model Evaluation Engine

#### Why OpenRouter?
- OpenRouter provides a single unified API to switch, fallback, and benchmark models with zero code rewrite.
- Eliminates vendor lock-in and protects institutional operations against single-provider rate limits or outages.

#### Dual-Pass Evaluation Architecture:
```
[Scanned Page Image] 
        |
        v (Pass 1: Vision Model via OpenRouter - e.g. Claude 3.5 Sonnet / GPT-4o)
[Transcribed Markdown + LaTeX Equations + Diagram Descriptions]
        |
        v (Pass 2: Reasoning Model via OpenRouter - e.g. Claude 3.5 Sonnet / DeepSeek-V3)
[Comparative Step-by-Step Rubric Alignment]
        |
        +---> Marks Awarded per Sub-Question
        +---> Deductions with Exact Explanations
        +---> Confidence Score (0.00 - 1.00)
```

1. **Step-Marking & Partial Credit Logic**:
   - Evaluates intermediate logic even if the final numerical result is wrong (propagated error tolerance).
   - Recognizes standard LaTeX mathematical syntax, Greek symbols, matrices, and circuit notations.
   - Evaluates handwritten programming code (syntax tolerance, logic, edge case handling).
2. **Calibrated Confidence Score**:
   - Every AI-awarded score is tagged with a confidence metric:
     - **High Confidence (>0.85)**: Handwriting is clear; student’s solution cleanly maps to rubric.
     - **Medium Confidence (0.70 - 0.85)**: Partially ambiguous handwriting or non-standard solution path.
     - **Low Confidence (<0.70)**: Illegible handwriting, missing pages, or highly ambiguous reasoning. Low confidence scripts are automatically routed to the Teacher Review Queue.

---

### Module 4: Cross-Student Collusion & Peer Plagiarism Engine

One of EvalDesk's most significant commercial competitive advantages is detecting cross-student copying in handwritten exam papers.

```
+---------------------------------------------------------------------------------------+
|                      PEER-TO-PEER PLAGIARISM & COLLUSION MATRIX                       |
+---------------------------------------------------------------------------------------+
|                                                                                       |
|   Student A Script               Student B Script               Student C Script      |
|   [Question 3 Answer]           [Question 3 Answer]            [Question 3 Answer]    |
|            \                             |                              /             |
|             \                            |                             /              |
|              v                           v                            v               |
|   +-------------------------------------------------------------------------------+   |
|   |                  Embedding Extraction & Vector Representation                 |   |
|   +-------------------------------------------------------------------------------+   |
|                                          |                                            |
|                                          v                                            |
|   +-------------------------------------------------------------------------------+   |
|   | Pairwise Cosine Similarity + N-Gram Overlap + Anomaly Fingerprinting Engine   |   |
|   +-------------------------------------------------------------------------------+   |
|                                          |                                            |
|       +----------------------------------+----------------------------------+         |
|       |                                  |                                  |         |
|       v                                  v                                  v         |
| [Semantic Copying Alert]      [Identical Flaw Fingerprint]      [Collusion Ring Graph]|
| "92% semantic overlap in      "Both students made the exact     "Student A, B, and D  |
| descriptive paragraph"        same obscure algebraic typo"      formed a copy cluster"|
+---------------------------------------------------------------------------------------+
```

#### Plagiarism Detection Methodology:
1. **Semantic Vector Similarity**:
   - Each student's answer per question is converted into dense semantic vector embeddings.
   - Pairwise cosine similarity is computed across all students for the same question.
   - Identifies paraphrased copying where students changed a few words but retained the exact structural argument.
2. **"Identical Flaw" Fingerprinting**:
   - If two students produce the exact correct answer, it may simply mean both studied well.
   - However, if two students make the **exact same bizarre mathematical error**, use the **exact same unusual variable name**, or replicate the **exact same grammatical error**, the system flags this as a **High-Probability Collusion Fingerprint**.
3. **Seating Plan Correlation (Optional Enterprise Add-on)**:
   - When the examination seating arrangement is uploaded, the collusion engine cross-references high similarity pairs with physical proximity (e.g., adjacent desks or same row).
4. **Collusion Cluster Graph Visualizer**:
   - Generates an interactive graph network showing copy chains: e.g., Student A (Source) -> Student B & Student C (Replicas).

---

### Module 5: Faculty Moderation & Audit Cockpit (Human-in-the-Loop)

1. **Triple-Pane Side-by-Side Review Screen**:
   - **Pane 1 (Left)**: Original scanned handwritten paper with zoom, pan, contrast, and inversion controls.
   - **Pane 2 (Center)**: AI transcription, OCR output, and interactive rubric cards showing awarded step marks.
   - **Pane 3 (Right)**: Model answer key and grading guidelines for immediate reference.
2. **One-Click Teacher Overrides**:
   - Teachers can adjust marks with one click, write custom comments, or approve the AI evaluation.
3. **Smart Moderation Queues**:
   - Instead of re-reading all 200 scripts, teachers prioritize:
     - *Queue 1: Low AI Confidence (<85%)*
     - *Queue 2: High Plagiarism Flag (>70% match)*
     - *Queue 3: Borderline Failures (e.g., marks between 38% and 41%)*
     - *Queue 4: Random Statistical Sample (e.g., 10% auto-audit)*
4. **Tamper-Proof Audit Trail**:
   - Records every change: `Teacher X modified Q2(b) marks from 3 to 4 at 14:32:01. Reason: "Alternative valid methodology accepted"`.

---

### Module 6: Student Portal, Grade Publishing & Transparent Dispute Resolution

1. **Student Transparency View**:
   - Students log in to view their evaluated script with inline annotations and step-by-step mark breakdown.
   - Eliminates student suspicion of unfair grading and fosters trust in faculty.
2. **Formal Re-Check & Dispute Ticketing System**:
   - Within an institutionally configured window (e.g., 72 hours post-publishing), students can click *"Request Re-evaluation"* on specific questions.
   - Student must provide a structured justification (e.g., *"Step 2 theorem was derived using Taylor Series, which was marked as missing"*).
   - **Anti-Spam Re-check Policy**: Institutions can optionally configure a refundable fee or token deduction if the recheck request is frivolous.
   - Routed to a **Second Blind Examiner** for fair resolution.

---

### Module 7: Academic Analytics & Outcome-Based Education (OBE)

1. **Course Learning Outcome (CLO) / Program Learning Outcome (PLO) Mapping**:
   - Automatically calculates CLO attainment percentages based on student performance per question.
   - Generates ready-to-submit accreditation reports for international standards (e.g., ABET, NBA, UGC).
2. **Psychometric Question Quality Analytics**:
   - **Difficulty Index ($P$)**: Percentage of students answering correctly.
   - **Discrimination Index ($D$)**: Ability of the question to distinguish top-performing students from struggling students.
   - Highlights flawed questions (e.g., questions with negative discrimination where top students failed due to ambiguous wording).

---

## 5. Technical Architecture & Database Design

### 5.1 Architecture Stack
- **Frontend**: React 19, Tailwind CSS, TypeScript, Vite, Canvas/PDF.js viewer with drawing annotations.
- **Backend**: Node.js / Python Fastify/Express microservices, `node:sqlite` or PostgreSQL for transactional consistency.
- **Vector Search Engine**: pgvector / Qdrant / SQLite-vec for pairwise student answer embedding similarity.
- **AI Gateway**: OpenRouter API with multi-model fallback routines.
- **Storage**: S3-compatible encrypted object storage for high-resolution exam scans.

### 5.2 Database Entity-Relationship Model

```
+----------------------------------------------------------------------------------------------------+
|                                    EVALDESK DATABASE SCHEMA                                        |
+----------------------------------------------------------------------------------------------------+

[institutions]
  - id (UUID, PK)
  - name, domain, subscription_tier, created_at

[users]
  - id (UUID, PK)
  - institution_id (FK)
  - role (super_admin, faculty, student, hod)
  - official_id (Teacher ID or Student Roll)
  - email, password_hash, full_name

[examinations]
  - id (UUID, PK)
  - institution_id (FK), course_code, course_name, semester, academic_year
  - total_marks, pass_threshold, exam_date, status (draft, grading, published)
  - created_by (FK -> users)

[questions]
  - id (UUID, PK)
  - examination_id (FK)
  - question_number (e.g., "1", "2.a")
  - max_marks, clo_mapping, optional_group_id

[rubric_checkpoints]
  - id (UUID, PK)
  - question_id (FK)
  - step_order, description, allocated_marks, deduction_rules

[model_answers]
  - id (UUID, PK)
  - examination_id (FK), question_id (FK)
  - model_text, latex_equations, diagram_features, alternative_solutions_json

[student_submissions]
  - id (UUID, PK)
  - examination_id (FK), student_id (FK -> users)
  - raw_pdf_url, total_awarded_marks, ai_confidence_avg
  - evaluation_status (pending, ai_evaluated, faculty_approved, published)

[answer_evaluations]
  - id (UUID, PK)
  - submission_id (FK), question_id (FK)
  - transcribed_text, latex_extracted
  - marks_awarded, max_marks
  - deduction_reasons_json, confidence_score
  - faculty_overridden (boolean), faculty_override_marks, faculty_feedback

[collusion_reports]
  - id (UUID, PK)
  - examination_id (FK), question_id (FK)
  - student_a_id (FK), student_b_id (FK)
  - similarity_score (0.00 - 1.00)
  - matched_phrases_json, identical_errors_json, status (flagged, dismissed, verified)

[recheck_tickets]
  - id (UUID, PK)
  - submission_id (FK), question_id (FK), student_id (FK)
  - student_justification, status (pending, in_review, adjusted, rejected)
  - resolution_notes, resolved_by (FK -> users)
+----------------------------------------------------------------------------------------------------+
```

---

## 6. OpenRouter AI Integration & Prompt Engineering Strategy

### 6.1 Multi-Model Routing Strategy

| Task | Primary OpenRouter Model | Fallback OpenRouter Model | Reasoning |
| :--- | :--- | :--- | :--- |
| **Handwritten OCR & Vision** | `anthropic/claude-3.5-sonnet` | `openai/gpt-4o` | Superior transcription of messy handwriting, diagrams, and equations. |
| **Rubric Alignment & Grading** | `anthropic/claude-3.5-sonnet` | `deepseek/deepseek-chat` | Flawless adherence to partial credit, zero hallucination of step-marks. |
| **Fast Plagiarism Screening** | `meta-llama/llama-3.3-70b-instruct` | `mistralai/mistral-large` | Cost-effective vector summarization & semantic overlap verification. |

### 6.2 Industry-Grade Grading Prompt Specification

```json
{
  "system": "You are a senior university examination evaluator and chief examiner. Your responsibility is to grade handwritten student exam scripts strictly against the provided rubric and model answer key. You must award partial credit objectively based on logical methodology, even if minor arithmetic slips occur. Do not hallucinate marks. Always provide step-by-step reasoning for deductions.",
  "inputs": {
    "question": "Question 3(b): Derive the Navier-Stokes equation for incompressible fluid flow and state all boundary assumptions. (8 Marks)",
    "rubric": [
      { "step": 1, "criteria": "Conservation of momentum formulation", "marks": 2.0 },
      { "step": 2, "criteria": "Substantial derivative expansion", "marks": 2.0 },
      { "step": 3, "criteria": "Stress tensor decomposition (pressure + viscous shear)", "marks": 2.5 },
      { "step": 4, "criteria": "Correct final vector form and boundary assumptions stated", "marks": 1.5 }
    ],
    "model_answer": "...",
    "student_transcription": "...",
    "student_diagram_ocr": "..."
  },
  "expected_output_schema": {
    "question_id": "string",
    "total_marks_awarded": "number",
    "confidence_score": "number between 0.00 and 1.00",
    "step_breakdown": [
      {
        "step_number": "integer",
        "marks_awarded": "number",
        "marks_possible": "number",
        "is_correct": "boolean",
        "justification": "string"
      }
    ],
    "deductions": [
      {
        "reason": "string",
        "marks_lost": "number"
      }
    ],
    "overall_feedback_for_student": "string",
    "flag_for_teacher_attention": "boolean",
    "attention_reason": "string or null"
  }
}
```

---

## 7. Commercial Business Model & SaaS Monetization Strategy

To make this software highly profitable and uniquely viable in the academic market, EvalDesk employs a hybrid B2B Institutional SaaS model.

### 7.1 Pricing Tiers

```
+---------------------------------------------------------------------------------------+
|                                EVALDESK PRICING TIERS                                 |
+---------------------------------------------------------------------------------------+
|  1. Pay-As-You-Go Faculty (Department Pilot)                                         |
|     - $1.50 per evaluated student script booklet                                     |
|     - Best for individual professors or departments running pilots                   |
|                                                                                       |
|  2. Annual Department Subscription                                                    |
|     - $4,500 / year / department (up to 4,000 scripts/year)                           |
|     - Includes AI Evaluation + Peer Plagiarism Engine + LMS Export                    |
|                                                                                       |
|  3. Enterprise University License                                                     |
|     - $25,000 to $80,000 / year / university campus                                   |
|     - Unlimited scripts, Dedicated OpenRouter throughput quota                       |
|     - On-premise / Private Cloud deployment option, Single Sign-On (SAML/LTI)        |
|     - Custom OBE Accreditation Module & SLA 99.9% uptime                              |
+---------------------------------------------------------------------------------------+
```

### 7.2 Unit Economics & Profit Margins

- **Average Script Size**: 8 pages per student.
- **Estimated OpenRouter API Cost**:
  - OCR Vision & Grading per script booklet: **$0.06 – $0.12 USD** (using optimized Claude 3.5 Sonnet / DeepSeek routing and prompt caching).
- **Selling Price per Script**: **$1.50 – $2.50 USD**.
- **Gross Profit Margin**: **88% – 95%**.
- **Customer Lifetime Value (LTV)**: Universities rarely churn once their grading infrastructure is integrated with their semester schedule, yielding high annual recurring revenue (ARR).

---

## 8. Step-by-Step Implementation Roadmap

```
+---------------------------------------------------------------------------------------------+
|                                    IMPLEMENTATION ROADMAP                                   |
+---------------------------------------------------------------------------------------------+
| PHASE 1: Core Foundation & OpenRouter Integration                                           |
|   - Multi-tenant auth with institutional Teacher ID registry                                |
|   - Exam metadata & Rubric authoring interface                                             |
|   - OpenRouter API client wrapper with fallback retries & rate-limiting                     |
|                                                                                             |
| PHASE 2: Vision OCR & Dual-Pass Grading Engine                                              |
|   - Multi-page handwritten PDF splitter & image deskew preprocessor                         |
|   - Dual-pass OpenRouter evaluation (OCR Transcription -> Rubric Matching)                  |
|   - Granular step-marking calculation with confidence scoring                               |
|                                                                                             |
| PHASE 3: Cross-Student Collusion & Plagiarism Detection Engine                              |
|   - Vector embedding extraction per student answer                                          |
|   - Pairwise cosine similarity matrix computation                                           |
|   - Identical error & typo fingerprinting algorithm                                         |
|   - Collusion graph visualization in Teacher Portal                                         |
|                                                                                             |
| PHASE 4: Human-in-the-Loop Moderation Cockpit & Student Portal                              |
|   - 3-Pane split-screen moderation interface for faculty                                    |
|   - 1-click teacher override with tamper-proof audit trail                                  |
|   - Student self-service result view & formal Re-Check dispute ticketing                    |
|                                                                                             |
| PHASE 5: Enterprise Hardening, OBE Analytics & Commercial Launch                            |
|   - Course Learning Outcome (CLO/PLO) automated attainment reporting                        |
|   - LMS LTI 1.3 integration (Canvas, Moodle, Blackboard)                                    |
|   - Usage billing, tenant quotas, and institutional pilot onboarding                        |
+---------------------------------------------------------------------------------------------+
```

---

## 9. Security, FERPA & Academic Data Privacy Compliance

1. **Student PII Masking**: Student names, contact emails, and personal identification are stripped before sending image slices to external AI models. Only anonymous hash tokens (`SUBMISSION_HASH_8F1A`) are processed.
2. **Zero Training Retention**: OpenRouter API calls enforce strict `"data_collection": "deny"` headers ensuring student exam responses are never stored for AI model training.
3. **Encrypted at Rest and in Transit**: All scanned scripts and transcripts are encrypted using AES-256 at rest and TLS 1.3 in transit.
4. **Data Sovereignty Options**: For universities with sovereign data laws, support for on-premise open-weights vision models (e.g., Qwen 2.5-VL / Llama 3.2 Vision hosted inside university private data centers) can be enabled via the same unified API.

---
*EvalDesk Platform Specification &copy; 2026. Confidential Architecture Blueprint.*
