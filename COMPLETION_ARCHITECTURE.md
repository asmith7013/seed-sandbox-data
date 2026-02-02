# Completion & Mastery Check Architecture

How student completion data flows through the system — events, tables, views, and which pages use what.

## Event Types

Two distinct completion event types exist. They have identical data shapes but are emitted under different conditions:

| Event | Emitted When | Assignment Mode |
|---|---|---|
| `LESSON_COMPLETED` | Student finishes a sidekick lesson | `mode: "lesson"` |
| `ASSIGNMENT_COMPLETED` | Student finishes a sequential mastery check | `mode: "sequential"`, `"mastery"`, `"assessment"`, etc. |

**Emission point:** `modules/responses/service/response.service.ts` in `createResponse()` (~line 2811-2843). The code branches on `isLesson` (mode === "lesson") to decide which event to emit.

**Event data shape** (both types):
```typescript
{
  enrollmentId: number;
  assignedAssignmentId: number;
  assignmentId: number;
  studentProfileId: string; // UUID
  groupId: number;
  timestamp: string; // ISO 8601
}
```

## Data Sources

### 1. `events` table
- Stores all event records (LESSON_COMPLETED, ASSIGNMENT_COMPLETED, QUESTION_ANSWERED, etc.)
- Queried via JSON fields: `data->>'groupId'`, `data->>'enrollmentId'`, etc.
- **Used by:** History page (`getLessonCompletions()`)

### 2. `responses` table
- Stores individual question responses with `is_correct`, `created_at`, `enrollment_id`
- Joined through: `responses` → `assignment_question_responses` → `assignment_questions` → `assignments`
- **Used by:** Velocity page (via the mastery checks view)

### 3. `mastery_checks_by_enrollment_daily` view
- Pre-aggregated PostgreSQL view defined in `supabase/migrations/20260121081943_create_mastery_checks_by_enrollment_daily_view.sql`
- Queries `responses` + `assignments` tables (NOT events)
- Filters: `COALESCE(a.config->>'mode', 'sequential') = 'sequential'` AND `EXISTS (SELECT 1 FROM assignment_modules am WHERE am.assignment_id = a.id)`
- Returns 1 row per enrollment per school day with `overall_mastery_checks_passed` count
- **Hardcoded to specific group codes** (6035, 6704, 7035, M704, etc.)
- **Used by:** Velocity page (`getDailyMasteryChecksFromView()`)

## Assignment Tables

| Table | Description |
|---|---|
| `assignments` | Base table with ALL assignments regardless of state |
| `publishedAssignments` | **View** = `SELECT * FROM assignments WHERE state IN ('active', 'scheduled')` |

The velocity view queries `assignments` (all states). The completion repository also uses `assignments` to ensure archived assignments still appear in completion data.

## Assignment Modes

Stored in `assignments.config->>'mode'`:

| Mode | Purpose | Completion Event |
|---|---|---|
| `sequential` | Mastery check (questions in order) | `ASSIGNMENT_COMPLETED` |
| `lesson` | Sidekick lesson (KC-based navigation) | `LESSON_COMPLETED` |
| `mastery` | Exists sparsely in the DB but purpose is unclear. Should NOT be incorporated into any views, sandbox pages, or new features - similar to `sequential` | `ASSIGNMENT_COMPLETED` |
| `assessment` | Formal assessment | `ASSIGNMENT_COMPLETED` |
| `survey` | Survey | `ASSIGNMENT_COMPLETED` |

## Module Linkage

The `assignment_modules` table links assignments to modules. A sequential assignment linked to a module = **mastery check**. This distinction matters because:
- The velocity view requires module linkage (`EXISTS (SELECT 1 FROM assignment_modules ...)`)
- The history page exposes `isLinkedToModule` and `moduleName` for display

## Page Data Flows

### History Page (`/teacher/sandbox/history`)

```
Route loader (route.tsx)
  → completionRepository.getLessonCompletions(groupIds)
    → Queries events table for LESSON_COMPLETED + ASSIGNMENT_COMPLETED
    → Looks up assignment info from `assignments` table
    → Looks up module linkage from `assignment_modules`
    → Deduplicates by (enrollmentId, assignmentId)
    → Returns LessonCompletionRecord[]

Frontend (useHistoryFilters.ts)
  → Splits by lessonType: "sequential" = mastery checks, "lesson" = sidekick
  → MasteryCheckSummary shows MC completions grouped by student
  → CompletionColumn shows individual completion rows
```

### Velocity Page (`/teacher/sandbox/velocity`)

```
Route loader (route.tsx)
  → completionRepository.getDailyMasteryChecksFromView(groupIds)
    → Queries mastery_checks_by_enrollment_daily view
    → Returns DailyMasteryCheckRecord[] (1 row per enrollment per day)

  → velocityRepository.getDailyActivityForGroup(groupId)
    → Queries QUESTION_ANSWERED events from events table
    → Excludes assessment mode (includes lesson, sequential, and legacy null mode)
    → Returns per-day, per-enrollment, per-assignment activity

Frontend (StudentDetailTable)
  → Shows "L" badges for lessons completed per student per day
  → Shows "Q" badges for questions answered
```

## Points System

### `POINTS_UPDATED` Event

Emitted when a student earns (or spends) points. Defined in `modules/events/structs/pointsUpdated.event.ts`.

```typescript
{
  studentProfileId: string; // UUID
  enrollmentId: number;
  amount: number;           // positive = earned, negative = spent
  description: string;      // e.g. "Completed Mastery Check: Lesson 5"
  dedupeKey?: string;       // for idempotency (used by Zearn)
  assignmentId?: number;
  teacherProfileId?: string;
}
```

### Awarding Conditions

Points are awarded in `modules/points/points.awarding.service.ts` under these conditions:
- Group must have `is313 = true`
- Group code must be in whitelist: `PRP8`, `M803`
- **Mastery check completion** — 5 pts for sequential mode assignments (excludes assessment, survey, lesson modes)
- **Zearn lesson completion** — 5 pts via TL Connect integration, deduplicated by `TL_CONNECT_ZEARN:{email}:{lesson}:{date}`

### Points Projection

`modules/events/projections/studentPoints.projection.ts` reduces all `POINTS_UPDATED` events into per-student balance and transaction history (`StudentPointsData`).

### SSE

`POINTS_UPDATED` is **not** published to the SSE channel. Points display on the smartboard updates via 45s auto-refresh (revalidator polling), not real-time SSE.

## Key Files

| File | Purpose |
|---|---|
| `modules/sandbox/completion/completion.repository.ts` | Completion queries (events + view) |
| `modules/sandbox/completion/completion.types.ts` | Type definitions |
| `modules/sandbox/velocity/velocity.repository.ts` | Question activity queries |
| `modules/sandbox/history/history.service.ts` | History data transformation |
| `modules/responses/service/response.service.ts` | Event emission on response submission |
| `modules/events/structs/assignmentCompleted.event.ts` | ASSIGNMENT_COMPLETED event type |
| `modules/events/structs/lessonCompleted.event.ts` | LESSON_COMPLETED event type |
| `modules/events/structs/pointsUpdated.event.ts` | POINTS_UPDATED event type |
| `modules/points/points.awarding.service.ts` | Points awarding logic (mastery checks + Zearn) |
| `modules/events/projections/studentPoints.projection.ts` | Points balance/transaction projection |
| `supabase/migrations/20260121081943_create_mastery_checks_by_enrollment_daily_view.sql` | Velocity view SQL |
