---
name: seed-sandbox-data
description: Creates test data for the teacher sandbox dashboard. Use when the user needs sample data for testing lesson progress dashboards, pacing features, or sandbox development. Creates groups, students, enrollments, modules, assignments, questions, and simulated progress events in the LOCAL database only.
allowed-tools: Read, Bash, Grep, Glob
allowedCommands:
  - "~/.claude/skills/seed-sandbox-data/run.sh"
---

# Seed Sandbox Data

Creates realistic test data for the Teacher Sandbox dashboards in your **local Supabase database**.

## Usage

```bash
~/.claude/skills/seed-sandbox-data/run.sh
```

## What It Creates

| Entity | Count | Details |
|--------|-------|---------|
| Students | 12 per group | Realistic names, enrolled in specified group |
| Assignments | 5 | Sequential lessons with questions |
| Questions per lesson | 4 | Multiple choice with KCs |
| Assessments | 2 | With 3 questions each |
| Progress events | Varied | LESSON_QUESTION_SHOWN, QUESTION_ANSWERED, LESSON_COMPLETED |

### Events Created

- **LESSON_QUESTION_SHOWN** - Tracks which question each student is currently viewing
- **QUESTION_ANSWERED** - Tracks when each question was answered correctly (with timestamps)
- **LESSON_COMPLETED** - Tracks when a student completed a lesson

### Timestamp Distribution

Events are distributed across different time periods to test the time-based styling:
- **Today** (dark green) - ~25% of students
- **Yesterday** (light green) - ~25% of students
- **Earlier** (white with border) - ~50% of students

## Progress Distribution

Students are distributed to simulate realistic pacing:
- **~25%** not started
- **~25%** making progress (1 question)
- **~25%** good progress (2 questions)
- **~25%** excellent progress (completed lesson)

## Configuration

Edit the CONFIG object in the script:
- `TEACHER_EMAIL` - Your teacher email (default: alex.smith@teachinglab.org)
- `GROUP_ID` - Which group to populate (default: 1)
- `MODULE_ID` - Which module to use (default: 10)
- `STUDENTS_TO_CREATE` - Number of students (default: 12)

## After Running

- Visit `/teacher/sandbox/lessonProgress` to see the Lesson Progress dashboard
- Visit `/teacher/sandbox/assessmentData` to see Assessment Data
- Hover over completed question cells to see completion timestamps
