# Seed Sandbox Data

A [Claude Code skill](https://docs.anthropic.com/en/docs/claude-code) that creates realistic test data for Teacher Sandbox dashboards in a local Supabase database.

## Prerequisites

- [Podsie](https://github.com/asmith7013/podsie) repo cloned at `~/Documents/GitHub/podsie`
- Local Supabase instance running
- Node.js and `tsx` available via the project's `node_modules`

## Installation

Clone this repo into your Claude Code skills directory:

```bash
git clone https://github.com/asmith7013/seed-sandbox-data.git ~/.claude/skills/seed-sandbox-data
```

## Usage

Run via the shell script:

```bash
~/.claude/skills/seed-sandbox-data/run.sh
```

Or ask Claude Code to seed sandbox data — it will invoke this skill automatically.

## What It Creates

| Entity | Count | Details |
|--------|-------|---------|
| Students | 12 per group | Realistic names, enrolled in specified group |
| Standalone lessons | Configurable | Ramp-up lessons all students complete |
| Paired lessons | Configurable | Each paired with a mastery check |
| Questions per lesson | 4 | Multiple choice with knowledge components |
| Assessments | 1 per module | With questions and simulated responses |
| Progress events | Varied | Distributed across multiple days |

### Event Types

- **LESSON_QUESTION_SHOWN** — Which question each student is currently viewing
- **QUESTION_ANSWERED** — When each question was answered (with timestamps)
- **LESSON_COMPLETED** — When a student completed a lesson
- **Points & attendance** — Class points and attendance events per group

### Timestamp Distribution

Events are spread across time periods for dashboard styling:

- **Today** (~25% of students)
- **Yesterday** (~25%)
- **Earlier** (~50%)

### Progress Distribution

- ~25% not started
- ~25% partial progress (1 question)
- ~25% good progress (2 questions)
- ~25% completed lesson

## Configuration

Set these environment variables to override defaults, or edit `seed/config.ts` directly:

| Env Variable | Default | Description |
|-----|---------|-------------|
| `SEED_TEACHER_EMAIL` | `teacher@example.com` | Teacher email to look up in the database |

Additional settings in `seed/config.ts`:

| Key | Default | Description |
|-----|---------|-------------|
| `GROUP_IDS` | `[1, 3]` | Groups to populate |
| `MODULE_IDS` | `[10, 11]` | Modules to seed lessons into |
| `STUDENTS_TO_CREATE` | `13` | Students per group |
| `DAYS_TO_SEED` | `45` | Days of historical data |

## After Running

- `/teacher/sandbox/lessonProgress` — Lesson Progress dashboard
- `/teacher/sandbox/velocity` — Velocity dashboard
- `/teacher/sandbox/assessmentData` — Assessment Data dashboard

## Safety

This skill **only runs against local databases** (localhost/127.0.0.1). It will not execute against production or remote databases.
