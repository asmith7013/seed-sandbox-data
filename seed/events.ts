/**
 * Progress Event Seeding
 *
 * Creates LESSON_QUESTION_SHOWN, QUESTION_ANSWERED, and LESSON_COMPLETED events
 * spread across the configured date range.
 *
 * Distribution strategy:
 * - Students progress through lessons at different rates (fast, medium, slow)
 * - Activity is spread evenly with slight increase toward recent days
 * - Weekends are skipped for realistic data
 */

import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  db,
  CONFIG,
  Enrollment,
  LessonData,
  StandaloneLessonData,
  getTimestampDaysAgo,
  getTimestamp,
} from "./config";

// Note: Module resolution errors in IDE are expected - script runs from project directory via run.sh

/**
 * Create progress events spread across 45 days showing growth over time.
 *
 * Key strategy for realistic pacing:
 * - Students complete modules SEQUENTIALLY (all of module 1 before starting module 2)
 * - Each student gets assigned specific lessons to complete during the time window
 * - Fast learners: complete all lessons
 * - Medium learners: complete 60-80% of lessons
 * - Slow learners: complete 20-40% of lessons
 * - ~40% of mastery checks are delayed to the next working day after lesson completion
 * - ~30% of lessons are split across multiple days (partial completion)
 *
 * @param lessonsByModule - Array of lesson arrays, one per module, in order
 */
export async function seedProgressEventsForGroup(
  groupId: number,
  groupName: string,
  enrollments: Enrollment[],
  lessonsByModule: LessonData[][]
): Promise<void> {
  const totalLessons = lessonsByModule.reduce((sum, m) => sum + m.length, 0);
  console.log(`\nCreating progress events for ${groupName} across ${CONFIG.DAYS_TO_SEED} days...`);
  console.log(`   Using ${lessonsByModule.length} modules with ${totalLessons} total lessons and ${enrollments.length} students`);

  const daysToSeed = CONFIG.DAYS_TO_SEED;

  // Calculate working days (exclude weekends)
  const workingDays: number[] = [];
  for (let dayOffset = daysToSeed; dayOffset >= 1; dayOffset--) {
    const timestamp = getTimestampDaysAgo(dayOffset);
    const dayOfWeek = new Date(timestamp).getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      workingDays.push(dayOffset);
    }
  }

  console.log(`   ${workingDays.length} working days available`);

  // Split working days between modules (proportional to lesson count)
  const moduleWorkingDays: number[][] = [];
  let dayIndex = 0;
  for (let m = 0; m < lessonsByModule.length; m++) {
    const moduleLessonCount = lessonsByModule[m].length;
    const moduleDayCount = Math.ceil((moduleLessonCount / totalLessons) * workingDays.length);
    const endIndex = Math.min(dayIndex + moduleDayCount, workingDays.length);
    moduleWorkingDays.push(workingDays.slice(dayIndex, endIndex));
    dayIndex = endIndex;
  }
  // Ensure last module gets remaining days
  if (dayIndex < workingDays.length) {
    moduleWorkingDays[moduleWorkingDays.length - 1].push(...workingDays.slice(dayIndex));
  }

  // Track daily stats
  const dailyStats = new Map<string, { completions: number; questions: number; masteryChecks: number; module: number }>();

  // Track pending mastery checks (lesson completed but mastery check delayed)
  interface PendingMasteryCheck {
    enrollment: Enrollment;
    lesson: LessonData;
    scheduledDayOffset: number;
    moduleIndex: number;
  }
  const pendingMasteryChecks: PendingMasteryCheck[] = [];

  // Track partial lesson progress (lesson started but not completed, to be continued next day)
  interface PartialLessonProgress {
    enrollment: Enrollment;
    lesson: LessonData;
    questionsCompleted: number;
    scheduledDayOffset: number;
    moduleIndex: number;
    lessonIndex: number;
  }
  const partialLessonProgress: PartialLessonProgress[] = [];

  // Helper to get next working day within module's time window
  const getNextWorkingDay = (currentDayOffset: number, moduleDays: number[]): number => {
    const currentIndex = moduleDays.indexOf(currentDayOffset);
    if (currentIndex === -1 || currentIndex === moduleDays.length - 1) {
      return Math.max(1, currentDayOffset - 1);
    }
    return moduleDays[currentIndex + 1];
  };

  // Process each student
  for (let i = 0; i < enrollments.length; i++) {
    const enrollment = enrollments[i];

    // Determine learner type (how many total lessons they'll complete)
    const learnerType = i % 5;
    let completionRate: number;
    switch (learnerType) {
      case 0: completionRate = 1.0; break;    // Complete all
      case 1: completionRate = 0.8; break;    // 80%
      case 2: completionRate = 0.6; break;    // 60%
      case 3: completionRate = 0.4; break;    // 40%
      case 4: completionRate = 0.2; break;    // 20%
      default: completionRate = 0.5;
    }

    // Process each module sequentially
    for (let moduleIndex = 0; moduleIndex < lessonsByModule.length; moduleIndex++) {
      const moduleLessons = lessonsByModule[moduleIndex];
      const moduleDays = moduleWorkingDays[moduleIndex];

      if (moduleDays.length === 0) continue;

      // How many lessons in THIS module will this student complete?
      const lessonsToCompleteInModule = Math.ceil(moduleLessons.length * completionRate);

      if (lessonsToCompleteInModule === 0) continue;

      // Calculate pacing within this module's time window
      const startDayIndex = Math.floor((i / enrollments.length) * (moduleDays.length * 0.3));
      const availableDays = moduleDays.slice(startDayIndex);

      if (availableDays.length === 0) continue;

      // Calculate how many days to use per lesson (may be split across multiple days)
      const daysPerLesson = Math.max(1, Math.floor(availableDays.length / lessonsToCompleteInModule));

      let dayIdxOffset = 0;

      for (let lessonIdx = 0; lessonIdx < lessonsToCompleteInModule; lessonIdx++) {
        const lesson = moduleLessons[lessonIdx];
        const totalQuestions = lesson.questions.length;

        // ~30% of lessons split across 2 days (deterministic based on student + lesson index)
        const splitLesson = (i + lessonIdx + moduleIndex) % 10 < 3 && totalQuestions >= 2;
        const questionsDay1 = splitLesson ? Math.floor(totalQuestions / 2) : totalQuestions;
        const questionsDay2 = splitLesson ? totalQuestions - questionsDay1 : 0;

        // Day 1: Complete first batch of questions (or all if not splitting)
        const day1Idx = Math.min(dayIdxOffset, availableDays.length - 1);
        const day1Offset = availableDays[day1Idx];
        const day1DateStr = getTimestampDaysAgo(day1Offset).split("T")[0];

        if (!dailyStats.has(day1DateStr)) {
          dailyStats.set(day1DateStr, { completions: 0, questions: 0, masteryChecks: 0, module: moduleIndex + 1 });
        }
        const day1Stats = dailyStats.get(day1DateStr)!;

        // Answer questions for day 1
        for (let q = 0; q < questionsDay1; q++) {
          const question = lesson.questions[q];
          const questionTimestamp = getTimestampDaysAgo(day1Offset, q);

          await createQuestionShownEvent(enrollment, lesson, question, groupId, questionTimestamp);
          await createQuestionAnsweredEvent(
            enrollment,
            lesson,
            question,
            q,
            groupId,
            questionTimestamp
          );
          day1Stats.questions++;
        }

        // If splitting, track partial progress for day 2
        if (splitLesson && questionsDay2 > 0) {
          const nextWorkingDay = getNextWorkingDay(day1Offset, availableDays);
          partialLessonProgress.push({
            enrollment,
            lesson,
            questionsCompleted: questionsDay1,
            scheduledDayOffset: nextWorkingDay,
            moduleIndex,
            lessonIndex: lessonIdx,
          });
          dayIdxOffset += 2; // Skip an extra day since lesson spans 2 days
        } else {
          // Complete lesson today
          const completedTimestamp = getTimestampDaysAgo(day1Offset, questionsDay1);
          await createLessonCompletedEvent(enrollment, lesson, groupId, completedTimestamp);
          day1Stats.completions++;

          // ~40% delay mastery check to next working day
          const delayMasteryCheck = (i + lessonIdx + moduleIndex) % 5 < 2;

          if (delayMasteryCheck && day1Offset > 1) {
            const nextWorkingDay = getNextWorkingDay(day1Offset, moduleDays);
            pendingMasteryChecks.push({
              enrollment,
              lesson,
              scheduledDayOffset: nextWorkingDay,
              moduleIndex,
            });
          } else {
            await createMasteryCheckResponse(enrollment, lesson, completedTimestamp);
            await createMasteryCheckCompletedEvent(enrollment, lesson, groupId, completedTimestamp);
            day1Stats.masteryChecks++;
          }

          dayIdxOffset += daysPerLesson;
        }
      }
    }
  }

  // Process partial lesson completions (day 2 of split lessons)
  for (const partial of partialLessonProgress) {
    const { enrollment, lesson, questionsCompleted, scheduledDayOffset, moduleIndex } = partial;
    const moduleDays = moduleWorkingDays[moduleIndex];
    const day2DateStr = getTimestampDaysAgo(scheduledDayOffset).split("T")[0];

    if (!dailyStats.has(day2DateStr)) {
      dailyStats.set(day2DateStr, { completions: 0, questions: 0, masteryChecks: 0, module: moduleIndex + 1 });
    }
    const day2Stats = dailyStats.get(day2DateStr)!;

    // Complete remaining questions
    for (let q = questionsCompleted; q < lesson.questions.length; q++) {
      const question = lesson.questions[q];
      const questionTimestamp = getTimestampDaysAgo(scheduledDayOffset, q - questionsCompleted);

      await createQuestionShownEvent(enrollment, lesson, question, groupId, questionTimestamp);
      await createQuestionAnsweredEvent(
        enrollment,
        lesson,
        question,
        q,
        groupId,
        questionTimestamp
      );
      day2Stats.questions++;
    }

    // Complete the lesson
    const completedTimestamp = getTimestampDaysAgo(scheduledDayOffset, lesson.questions.length - questionsCompleted);
    await createLessonCompletedEvent(enrollment, lesson, groupId, completedTimestamp);
    day2Stats.completions++;

    // ~40% delay mastery check to next working day
    const delayMasteryCheck = (partial.lessonIndex + moduleIndex) % 5 < 2;

    if (delayMasteryCheck && scheduledDayOffset > 1) {
      const nextWorkingDay = getNextWorkingDay(scheduledDayOffset, moduleDays);
      pendingMasteryChecks.push({
        enrollment,
        lesson,
        scheduledDayOffset: nextWorkingDay,
        moduleIndex,
      });
    } else {
      await createMasteryCheckResponse(enrollment, lesson, completedTimestamp);
      await createMasteryCheckCompletedEvent(enrollment, lesson, groupId, completedTimestamp);
      day2Stats.masteryChecks++;
    }
  }

  // Process pending mastery checks (those delayed to next day)
  for (const pending of pendingMasteryChecks) {
    const masteryTimestamp = getTimestampDaysAgo(pending.scheduledDayOffset, 2);
    const dateStr = masteryTimestamp.split("T")[0];

    if (!dailyStats.has(dateStr)) {
      dailyStats.set(dateStr, { completions: 0, questions: 0, masteryChecks: 0, module: pending.moduleIndex + 1 });
    }
    const stats = dailyStats.get(dateStr)!;

    await createMasteryCheckResponse(pending.enrollment, pending.lesson, masteryTimestamp);
    await createMasteryCheckCompletedEvent(pending.enrollment, pending.lesson, groupId, masteryTimestamp);
    stats.masteryChecks++;
  }

  // Log daily stats grouped by module transition
  const sortedDates = Array.from(dailyStats.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  let lastModule = 0;
  for (const [dateStr, stats] of sortedDates) {
    if (stats.completions > 0 || stats.questions > 0 || stats.masteryChecks > 0) {
      if (stats.module !== lastModule) {
        console.log(`   --- Module ${stats.module} ---`);
        lastModule = stats.module;
      }
      console.log(`   ${dateStr}: ${stats.completions} lessons, ${stats.masteryChecks} mastery checks, ${stats.questions} questions`);
    }
  }
}

/**
 * Create detailed progress for the first lesson with varied distribution.
 * Shows Today/Yesterday/Earlier distinctions on the dashboard.
 * Includes students who completed lesson but haven't done mastery check yet.
 */
export async function seedDetailedProgressForFirstLesson(
  groupId: number,
  enrollments: Enrollment[],
  firstLesson: LessonData
): Promise<void> {
  console.log(`\nCreating detailed progress for first lesson (varied time distribution)...`);

  for (let i = 0; i < enrollments.length; i++) {
    const enrollment = enrollments[i];
    const progressIndex = i % 7; // 7 types for more variety

    let questionsCompleted: number = 0;
    let lessonCompleted = false;
    let masteryCheckCompleted = false;
    let timestampPeriod: "today" | "yesterday" | "earlier" = "today";

    switch (progressIndex) {
      case 0:
        // Not started
        console.log(`   - ${enrollment.name}: Not started`);
        continue;
      case 1:
        // In progress - Q1 done today
        questionsCompleted = 1;
        timestampPeriod = "today";
        console.log(`   > ${enrollment.name}: In progress (Q1 done)`);
        break;
      case 2:
        // In progress - Q2 or Q3 done earlier
        questionsCompleted = 2 + (i % 2);
        timestampPeriod = "earlier";
        console.log(`   > ${enrollment.name}: In progress (Q${questionsCompleted} done)`);
        break;
      case 3:
        // Lesson completed yesterday, mastery check PENDING (will do today)
        questionsCompleted = 4;
        lessonCompleted = true;
        masteryCheckCompleted = false;
        timestampPeriod = "yesterday";
        console.log(`   ~ ${enrollment.name}: Lesson done (yesterday), mastery check pending`);
        break;
      case 4:
        // Lesson completed yesterday, mastery check done today
        questionsCompleted = 4;
        lessonCompleted = true;
        masteryCheckCompleted = true;
        timestampPeriod = "yesterday";
        console.log(`   + ${enrollment.name}: Lesson (yesterday) + mastery check (today)`);
        break;
      case 5:
        // Both completed yesterday
        questionsCompleted = 4;
        lessonCompleted = true;
        masteryCheckCompleted = true;
        timestampPeriod = "yesterday";
        console.log(`   + ${enrollment.name}: Both completed (yesterday)`);
        break;
      case 6:
        // Both completed today
        questionsCompleted = 4;
        lessonCompleted = true;
        masteryCheckCompleted = true;
        timestampPeriod = "today";
        console.log(`   + ${enrollment.name}: Both completed (today)`);
        break;
      default:
        questionsCompleted = 0;
    }

    // Generate BASE timestamp once for this student, then add sequential offsets
    // This ensures Q1 < Q2 < Q3 < Q4 < lesson completion < mastery check in time order
    const baseTimestamp = getTimestamp(timestampPeriod);

    for (let q = 0; q < questionsCompleted; q++) {
      const question = firstLesson.questions[q];
      if (!question) continue;

      // Add 15 minutes per question to ensure sequential order
      const questionTime = new Date(baseTimestamp.getTime() + q * 15 * 60 * 1000);
      const ts = questionTime.toISOString();

      await createQuestionShownEvent(enrollment, firstLesson, question, groupId, ts);
      await createQuestionAnsweredEventWithTimestamp(
        enrollment,
        firstLesson,
        question,
        q,
        groupId,
        ts
      );
    }

    if (lessonCompleted) {
      // Lesson completion happens after all questions (add offset for all questions + 5 min)
      const lessonCompletionTime = new Date(baseTimestamp.getTime() + questionsCompleted * 15 * 60 * 1000 + 5 * 60 * 1000);
      const lessonTs = lessonCompletionTime.toISOString();
      await createLessonCompletedEvent(enrollment, firstLesson, groupId, lessonTs);

      if (masteryCheckCompleted) {
        // Determine when mastery check was completed
        let masteryTs: string;
        if (progressIndex === 4) {
          // Lesson yesterday, mastery check today - use today's timestamp
          const todayTimestamp = getTimestamp("today");
          masteryTs = todayTimestamp.toISOString();
        } else {
          // Same day as lesson (add 5 min after lesson)
          const masteryCompletionTime = new Date(lessonCompletionTime.getTime() + 5 * 60 * 1000);
          masteryTs = masteryCompletionTime.toISOString();
        }
        await createMasteryCheckResponse(enrollment, firstLesson, masteryTs);
        await createMasteryCheckCompletedEvent(enrollment, firstLesson, groupId, masteryTs);
      }
      // If masteryCheckCompleted is false (progressIndex === 3), lesson is done but mastery check is pending
    }
  }
}

// =============================================================================
// Event Creation Helpers
// =============================================================================

async function createQuestionShownEvent(
  enrollment: Enrollment,
  lesson: LessonData,
  question: { id: number; kcId: number },
  groupId: number,
  timestamp: string
): Promise<void> {
  if (!question.kcId) return;

  await db.execute(
    sql`INSERT INTO events (id, type, data, created_at, updated_at)
        VALUES (
          ${randomUUID()},
          'LESSON_QUESTION_SHOWN',
          ${JSON.stringify({
            enrollmentId: enrollment.id,
            studentProfileId: enrollment.studentProfileId,
            assignmentId: lesson.lessonId,
            groupId: groupId,
            questionId: question.id,
            knowledgeComponentId: question.kcId,
            action: "next",
          })}::jsonb,
          ${timestamp}::timestamptz,
          ${timestamp}::timestamptz
        )`
  );
}

async function createQuestionAnsweredEvent(
  enrollment: Enrollment,
  lesson: LessonData,
  question: { id: number; assignmentQuestionId: number },
  questionIndex: number,
  groupId: number,
  timestamp: string
): Promise<void> {
  await db.execute(
    sql`INSERT INTO events (id, type, data, created_at, updated_at)
        VALUES (
          ${randomUUID()},
          'QUESTION_ANSWERED',
          ${JSON.stringify({
            questionAttemptId: randomUUID(),
            questionId: question.id,
            studentProfileId: enrollment.studentProfileId,
            groupId: groupId,
            responseId: 0,
            isCorrect: true,
            answer: ["Correct Answer"],
            answerText: ["Correct Answer"],
            questionText: `Q${questionIndex + 1}`,
            correctAnswers: ["Correct Answer"],
            timestamp: timestamp,
            enrollmentId: enrollment.id,
            assignmentId: lesson.lessonId,
            assignmentQuestionId: question.assignmentQuestionId,
            mode: "lesson",
          })}::jsonb,
          ${timestamp}::timestamptz,
          ${timestamp}::timestamptz
        )`
  );
}

async function createQuestionAnsweredEventWithTimestamp(
  enrollment: Enrollment,
  lesson: LessonData,
  question: { id: number; assignmentQuestionId: number },
  questionIndex: number,
  groupId: number,
  timestamp: string
): Promise<void> {
  await createQuestionAnsweredEvent(
    enrollment,
    lesson,
    question,
    questionIndex,
    groupId,
    timestamp
  );
}

async function createLessonCompletedEvent(
  enrollment: Enrollment,
  lesson: LessonData,
  groupId: number,
  timestamp: string
): Promise<void> {
  await db.execute(
    sql`INSERT INTO events (id, type, data, created_at, updated_at)
        VALUES (
          ${randomUUID()},
          'LESSON_COMPLETED',
          ${JSON.stringify({
            enrollmentId: enrollment.id,
            assignedAssignmentId: lesson.assignedLessonId,
            assignmentId: lesson.lessonId,
            studentProfileId: enrollment.studentProfileId,
            groupId: groupId,
            timestamp: timestamp,
          })}::jsonb,
          ${timestamp}::timestamptz,
          ${timestamp}::timestamptz
        )`
  );
}

/**
 * Create ASSIGNMENT_COMPLETED event for the mastery check assignment.
 * Sequential mastery checks emit ASSIGNMENT_COMPLETED (not LESSON_COMPLETED).
 * LESSON_COMPLETED is only for sidekick lessons (mode: "lesson").
 */
async function createMasteryCheckCompletedEvent(
  enrollment: Enrollment,
  lesson: LessonData,
  groupId: number,
  timestamp: string
): Promise<void> {
  await db.execute(
    sql`INSERT INTO events (id, type, data, created_at, updated_at)
        VALUES (
          ${randomUUID()},
          'ASSIGNMENT_COMPLETED',
          ${JSON.stringify({
            enrollmentId: enrollment.id,
            assignedAssignmentId: lesson.assignedMasteryId,
            assignmentId: lesson.masteryCheckId,
            studentProfileId: enrollment.studentProfileId,
            groupId: groupId,
            timestamp: timestamp,
          })}::jsonb,
          ${timestamp}::timestamptz,
          ${timestamp}::timestamptz
        )`
  );
}

/**
 * Create mastery check response for a student who completed the lesson.
 * The timestamp is required for the velocity view which uses DATE(created_at).
 */
export async function createMasteryCheckResponse(
  enrollment: Enrollment,
  lesson: LessonData,
  timestamp?: string
): Promise<void> {
  const masteryQuestionResult = await db.execute(
    sql`SELECT aq.id, aq.question_id FROM assignment_questions aq
        WHERE aq.assignment_id = ${lesson.masteryCheckId} LIMIT 1`
  );

  if (masteryQuestionResult.length === 0) return;

  const masteryAQ = masteryQuestionResult[0] as { id: number; question_id: number };

  // Use provided timestamp or default to now
  const ts = timestamp || new Date().toISOString();

  const responseResult = await db.execute(
    sql`INSERT INTO responses (enrollment_id, question_id, is_correct, response_content, created_at, updated_at)
        VALUES (
          ${enrollment.id},
          ${masteryAQ.question_id},
          true,
          ${JSON.stringify({
            type: "multiple_choice",
            selectedChoiceIds: [randomUUID()],
          })}::jsonb,
          ${ts}::timestamptz,
          ${ts}::timestamptz
        )
        RETURNING id`
  );
  const responseId = (responseResult[0] as { id: number }).id;

  await db.execute(
    sql`INSERT INTO assignment_question_responses (response_id, assignment_question_id, assigned_assignment_id, created_at, updated_at)
        VALUES (${responseId}, ${masteryAQ.id}, ${lesson.assignedMasteryId}, ${ts}::timestamptz, ${ts}::timestamptz)
        ON CONFLICT DO NOTHING`
  );
}

/**
 * Seed completion events for standalone (ramp-up) lessons.
 * All students complete all ramp-up lessons early in the time window since
 * these are introductory lessons that precede the main paired lessons.
 */
export async function seedStandaloneLessonEvents(
  groupId: number,
  enrollments: Enrollment[],
  standaloneLessonsByModule: StandaloneLessonData[][],
): Promise<void> {
  const totalStandalone = standaloneLessonsByModule.reduce((sum, m) => sum + m.length, 0);
  console.log(`\nSeeding completion events for ${totalStandalone} ramp-up lessons...`);

  const daysToSeed = CONFIG.DAYS_TO_SEED;

  for (let moduleIndex = 0; moduleIndex < standaloneLessonsByModule.length; moduleIndex++) {
    const standaloneLessons = standaloneLessonsByModule[moduleIndex];

    for (let lessonIdx = 0; lessonIdx < standaloneLessons.length; lessonIdx++) {
      const lesson = standaloneLessons[lessonIdx];
      // Place ramp-up completions early in the time window, offset by module
      const baseDayOffset = daysToSeed - (moduleIndex * Math.floor(daysToSeed / 2)) - lessonIdx;

      for (let i = 0; i < enrollments.length; i++) {
        const enrollment = enrollments[i];
        // Stagger students slightly: fast learners complete earlier
        const studentDayOffset = Math.max(1, baseDayOffset - Math.floor(i / 4));

        // Question shown + answered events
        for (let q = 0; q < lesson.questions.length; q++) {
          const question = lesson.questions[q];
          const qTs = getTimestampDaysAgo(studentDayOffset, (i % 4) + q);

          await createStandaloneQuestionShownEvent(enrollment, lesson, question, groupId, qTs);
          await createStandaloneQuestionAnsweredEvent(enrollment, lesson, question, q, groupId, qTs);
        }

        // Lesson completed event
        const completedTs = getTimestampDaysAgo(studentDayOffset, (i % 4) + lesson.questions.length);
        await createStandaloneLessonCompletedEvent(enrollment, lesson, groupId, completedTs);
      }

      console.log(`   + ${lesson.lessonTitle}: all ${enrollments.length} students completed`);
    }
  }
}

async function createStandaloneQuestionShownEvent(
  enrollment: Enrollment,
  lesson: StandaloneLessonData,
  question: { id: number; kcId: number },
  groupId: number,
  timestamp: string,
): Promise<void> {
  if (!question.kcId) return;

  await db.execute(
    sql`INSERT INTO events (id, type, data, created_at, updated_at)
        VALUES (
          ${randomUUID()},
          'LESSON_QUESTION_SHOWN',
          ${JSON.stringify({
            enrollmentId: enrollment.id,
            studentProfileId: enrollment.studentProfileId,
            assignmentId: lesson.lessonId,
            groupId: groupId,
            questionId: question.id,
            knowledgeComponentId: question.kcId,
            action: "next",
          })}::jsonb,
          ${timestamp}::timestamptz,
          ${timestamp}::timestamptz
        )`
  );
}

async function createStandaloneQuestionAnsweredEvent(
  enrollment: Enrollment,
  lesson: StandaloneLessonData,
  question: { id: number; assignmentQuestionId: number },
  questionIndex: number,
  groupId: number,
  timestamp: string,
): Promise<void> {
  await db.execute(
    sql`INSERT INTO events (id, type, data, created_at, updated_at)
        VALUES (
          ${randomUUID()},
          'QUESTION_ANSWERED',
          ${JSON.stringify({
            questionAttemptId: randomUUID(),
            questionId: question.id,
            studentProfileId: enrollment.studentProfileId,
            groupId: groupId,
            responseId: 0,
            isCorrect: true,
            answer: ["Correct Answer"],
            answerText: ["Correct Answer"],
            questionText: `Q${questionIndex + 1}`,
            correctAnswers: ["Correct Answer"],
            timestamp: timestamp,
            enrollmentId: enrollment.id,
            assignmentId: lesson.lessonId,
            assignmentQuestionId: question.assignmentQuestionId,
            mode: "lesson",
          })}::jsonb,
          ${timestamp}::timestamptz,
          ${timestamp}::timestamptz
        )`
  );
}

// =============================================================================
// Points Event Seeding
// =============================================================================

const POINT_DESCRIPTIONS = [
  "Completed Assignment",
  "Streak Bonus",
  "Teacher Award",
  "Perfect Score",
  "Daily Login Bonus",
];

/**
 * Seed POINTS_UPDATED events for students in a group.
 * Higher-performing students earn more points (mirrors learner type distribution).
 */
export async function seedPointsEvents(
  groupId: number,
  enrollments: Enrollment[],
): Promise<void> {
  console.log(`\nCreating points events for ${enrollments.length} students...`);

  let totalEvents = 0;

  for (let i = 0; i < enrollments.length; i++) {
    const enrollment = enrollments[i];

    // More transactions for higher-performing students
    const learnerType = i % 5;
    const transactionCount = [8, 6, 5, 4, 3][learnerType];
    const maxAmount = [50, 40, 30, 25, 15][learnerType];

    for (let t = 0; t < transactionCount; t++) {
      // Spread transactions across the seed time window
      const daysAgo = Math.floor((t / transactionCount) * CONFIG.DAYS_TO_SEED) + 1;
      const timestamp = getTimestampDaysAgo(daysAgo, t % 6);
      const amount = 5 + Math.floor(((i + t) * 7) % (maxAmount - 5 + 1));
      const description = POINT_DESCRIPTIONS[(i + t) % POINT_DESCRIPTIONS.length];

      await db.execute(
        sql`INSERT INTO events (id, type, data, created_at, updated_at)
            VALUES (
              ${randomUUID()},
              'POINTS_UPDATED',
              ${JSON.stringify({
                studentProfileId: enrollment.studentProfileId,
                enrollmentId: enrollment.id,
                amount,
                description,
              })}::jsonb,
              ${timestamp}::timestamptz,
              ${timestamp}::timestamptz
            )`
      );
      totalEvents++;
    }
  }

  console.log(`   Created ${totalEvents} point transactions`);
}

// =============================================================================
// Attendance Event Seeding
// =============================================================================

/**
 * Seed STUDENT_MARKED_PRESENT events for today.
 * ~75% of students are marked present (every 4th student is absent).
 * Uses source: "podsie" with sourceDetail: "question-viewed" to mimic
 * the auto-mark that fires when a student views a question.
 */
export async function seedAttendanceEvents(
  groupId: number,
  enrollments: Enrollment[],
): Promise<void> {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  let presentCount = 0;

  for (let i = 0; i < enrollments.length; i++) {
    // ~75% present: every 4th student is absent
    if (i % 4 === 3) continue;

    const enrollment = enrollments[i];
    const timestamp = new Date().toISOString();

    await db.execute(
      sql`INSERT INTO events (id, type, data, created_at, updated_at)
          VALUES (
            ${randomUUID()},
            'STUDENT_MARKED_PRESENT',
            ${JSON.stringify({
              groupId,
              enrollmentId: enrollment.id,
              studentProfileId: enrollment.studentProfileId,
              date: today,
              source: "podsie",
              sourceDetail: "question-viewed",
            })}::jsonb,
            ${timestamp}::timestamptz,
            ${timestamp}::timestamptz
          )`
    );
    presentCount++;
  }

  console.log(`   Marked ${presentCount}/${enrollments.length} students present for today`);
}

async function createStandaloneLessonCompletedEvent(
  enrollment: Enrollment,
  lesson: StandaloneLessonData,
  groupId: number,
  timestamp: string,
): Promise<void> {
  await db.execute(
    sql`INSERT INTO events (id, type, data, created_at, updated_at)
        VALUES (
          ${randomUUID()},
          'LESSON_COMPLETED',
          ${JSON.stringify({
            enrollmentId: enrollment.id,
            assignedAssignmentId: lesson.assignedLessonId,
            assignmentId: lesson.lessonId,
            studentProfileId: enrollment.studentProfileId,
            groupId: groupId,
            timestamp: timestamp,
          })}::jsonb,
          ${timestamp}::timestamptz,
          ${timestamp}::timestamptz
        )`
  );
}
