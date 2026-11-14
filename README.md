# UniversityExamPaperEvaluation

**EvalDesk** — University Answer Sheet Evaluation & Student Feedback System.

## Tech Stack
- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4
- **Backend:** Node.js HTTP API, built-in `node:sqlite` (`data/evaldesk.db`)

## Quick Start
```bash
npm install
npm run dev      # Dev server with /api middleware on port 8443
```

## Production Build & Server
```bash
npm run build
npm run server   # Serves dist/ and /api on port 3001
```

## Run Checks & Tests
```bash
npm run typecheck
npm test
```

