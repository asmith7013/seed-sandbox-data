/**
 * Lesson and Mastery Check Seeding
 *
 * Creates lesson assignments with questions/KCs and linked mastery check assignments.
 *
 * Structure:
 * - First 2 lessons are STANDALONE (no mastery check) - these are "ramp-up" lessons
 * - Remaining lessons have paired MASTERY CHECKS
 * - Each LESSON has 4 questions (Q1-Q4), each with a knowledge component
 * - Each MASTERY CHECK is linked to the module and has the lesson as prerequisite
 * - Dashboard shows both standalone lessons and mastery checks
 */

import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  db,
  CONFIG,
  Teacher,
  LessonData,
  LessonQuestion,
  StandaloneLessonData,
  ModuleLessonData,
  getTimestampDaysAgo,
} from "./config";

/**
 * Standalone lesson titles (ramp-up lessons without mastery checks).
 * These always appear at the beginning of each unit.
 */
const STANDALONE_TITLES_BY_MODULE: Record<number, string[]> = {
  // Module 10: Alg 1 Unit 8.4 - Solving Linear Equations
  10: [
    "Puzzle Problems",
    "Hanger Diagrams",
  ],
  // Module 11: Alg 1 Unit 8.5 - Systems of Equations
  11: [
    "Relationships Between Quantities",
    "Graphing Two Equations",
  ],
};

const DEFAULT_STANDALONE_TITLES = [
  "Unit Overview",
  "Warm-Up Problems",
];

/**
 * Paired lesson titles (lessons WITH mastery checks).
 * These appear after standalone lessons.
 */
const PAIRED_TITLES_BY_MODULE: Record<number, string[]> = {
  // Module 10: Alg 1 Unit 8.4 - Solving Linear Equations
  10: [
    "Keeping the Equation Balanced",
    "Balanced Moves",
    "More Balanced Moves",
    "Solving Any Linear Equation",
    "Strategic Solving",
    "All, Some, or No Solutions",
    "When Are They the Same?",
    "On or Off the Line?",
    "On Both of the Lines",
    "Systems of Equations",
  ],
  // Module 11: Alg 1 Unit 8.5 - Systems of Equations
  11: [
    "Introduction to Systems",
    "Graphing Systems of Equations",
    "Solving Systems by Substitution",
    "Solving Systems by Elimination",
    "Choosing a Strategy",
    "Systems with No Solution",
    "Systems with Many Solutions",
    "Modeling with Systems",
    "Applications of Systems",
    "Systems Review",
  ],
};

// Default lesson titles if module not found
const DEFAULT_PAIRED_TITLES = [
  "Introduction",
  "Core Concepts",
  "Practice Problems",
  "Advanced Topics",
  "Review and Assessment",
];

/**
 * Create all lessons for a module: standalone lessons first, then paired lessons with mastery checks.
 * Returns a ModuleLessonData object containing both types.
 */
export async function createAllLessonsForModule(
  groupId: number,
  moduleId: number,
  teacher: Teacher
): Promise<ModuleLessonData> {
  const standaloneCount = CONFIG.STANDALONE_LESSONS_TO_CREATE;
  const pairedCount = CONFIG.LESSONS_TO_CREATE;

  console.log(
    `\nCreating ${standaloneCount} standalone + ${pairedCount} paired lessons for group ${groupId}...`
  );

  // Create standalone lessons first (no mastery check)
  const standaloneLessons: StandaloneLessonData[] = [];
  for (let l = 0; l < standaloneCount; l++) {
    const lesson = await createStandaloneLesson(l, groupId, moduleId, teacher);
    standaloneLessons.push(lesson);
    console.log(`   + ${lesson.lessonTitle} (standalone)`);
    console.log(`     Lesson ID: ${lesson.lessonId}`);
  }

  // Create paired lessons (with mastery checks)
  const pairedLessons: LessonData[] = [];
  for (let l = 0; l < pairedCount; l++) {
    // Offset the lesson index to account for standalone lessons
    const lesson = await createLessonWithMasteryCheck(l, groupId, moduleId, teacher, standaloneCount);
    pairedLessons.push(lesson);
    console.log(`   + ${lesson.masteryCheckTitle}`);
    console.log(`     Lesson ID: ${lesson.lessonId}, Mastery Check ID: ${lesson.masteryCheckId}`);
  }

  return { standaloneLessons, pairedLessons };
}

/**
 * Create LESSON assignments with questions and linked MASTERY CHECK assignments.
 * @deprecated Use createAllLessonsForModule instead to include standalone lessons
 */
export async function createLessonsWithMasteryChecks(
  groupId: number,
  moduleId: number,
  teacher: Teacher
): Promise<LessonData[]> {
  console.log(
    `\nCreating ${CONFIG.LESSONS_TO_CREATE} lessons with mastery checks for group ${groupId}...`
  );

  const lessons: LessonData[] = [];

  for (let l = 0; l < CONFIG.LESSONS_TO_CREATE; l++) {
    const lesson = await createLessonWithMasteryCheck(l, groupId, moduleId, teacher, CONFIG.STANDALONE_LESSONS_TO_CREATE);
    lessons.push(lesson);
    console.log(`   + ${lesson.masteryCheckTitle}`);
    console.log(`     Lesson ID: ${lesson.lessonId}, Mastery Check ID: ${lesson.masteryCheckId}`);
  }

  return lessons;
}

/**
 * Create a standalone lesson (no mastery check).
 */
async function createStandaloneLesson(
  lessonIndex: number,
  groupId: number,
  moduleId: number,
  teacher: Teacher
): Promise<StandaloneLessonData> {
  const standaloneTitles = STANDALONE_TITLES_BY_MODULE[moduleId] || DEFAULT_STANDALONE_TITLES;
  const rampUpNum = lessonIndex + 1;
  const titleText = standaloneTitles[lessonIndex % standaloneTitles.length];
  const lessonTitle = `Ramp Up ${rampUpNum}: ${titleText}`;

  // Create LESSON assignment
  const lessonId = await createLessonAssignment(lessonTitle, teacher);

  // Assign lesson to group
  const launchDate = getTimestampDaysAgo(CONFIG.DAYS_TO_SEED);
  const assignedLessonId = await assignToGroup(lessonId, groupId, launchDate);

  // Create questions with KCs
  const questions = await createLessonQuestions(lessonId, lessonTitle, teacher);

  // Link lesson to module (standalone lessons come first)
  const lessonOrder = lessonIndex + 1;
  await db.execute(
    sql`INSERT INTO assignment_modules (assignment_id, module_id, "order")
        VALUES (${lessonId}, ${moduleId}, ${lessonOrder})
        ON CONFLICT DO NOTHING`
  );

  return {
    lessonId,
    lessonTitle,
    assignedLessonId,
    questions,
  };
}

/**
 * Create a single lesson with its mastery check.
 * @param standaloneOffset - Number of standalone lessons to offset the module order by
 */
async function createLessonWithMasteryCheck(
  lessonIndex: number,
  groupId: number,
  moduleId: number,
  teacher: Teacher,
  standaloneOffset: number = 0
): Promise<LessonData> {
  const lessonTitles = PAIRED_TITLES_BY_MODULE[moduleId] || DEFAULT_PAIRED_TITLES;
  // Paired lessons start at Lesson 1 (independent of standalone ramp-up count)
  const lessonNum = lessonIndex + 1;
  const titleText = lessonTitles[lessonIndex % lessonTitles.length];
  const lessonTitle = `Lesson ${lessonNum}: ${titleText}`;
  const masteryCheckTitle = `Lesson ${lessonNum}: ${titleText}`;

  // Create LESSON assignment
  const lessonId = await createLessonAssignment(lessonTitle, teacher);

  // Assign lesson to group
  const launchDate = getTimestampDaysAgo(CONFIG.DAYS_TO_SEED);
  const assignedLessonId = await assignToGroup(lessonId, groupId, launchDate);

  // Create questions with KCs
  const questions = await createLessonQuestions(lessonId, lessonTitle, teacher);

  // Link lesson to module (lesson comes first in order, after standalone lessons)
  // Standalone lessons take orders 1, 2, ... standaloneOffset
  // Paired lessons: lesson at standaloneOffset + lessonIndex*2 + 1, mastery at standaloneOffset + lessonIndex*2 + 2
  const lessonOrder = standaloneOffset + lessonIndex * 2 + 1;
  await db.execute(
    sql`INSERT INTO assignment_modules (assignment_id, module_id, "order")
        VALUES (${lessonId}, ${moduleId}, ${lessonOrder})
        ON CONFLICT DO NOTHING`
  );

  // Create MASTERY CHECK assignment
  const masteryCheckId = await createMasteryCheckAssignment(
    masteryCheckTitle,
    lessonTitle,
    teacher
  );

  // Link mastery check to module (mastery check comes after lesson)
  const masteryOrder = standaloneOffset + lessonIndex * 2 + 2;
  await db.execute(
    sql`INSERT INTO assignment_modules (assignment_id, module_id, "order")
        VALUES (${masteryCheckId}, ${moduleId}, ${masteryOrder})
        ON CONFLICT DO NOTHING`
  );

  // Assign mastery check to group
  const assignedMasteryId = await assignToGroup(masteryCheckId, groupId, launchDate);

  // Create prerequisite: mastery check requires the lesson
  await db.execute(
    sql`INSERT INTO assignment_prerequisites (assignment_id, type, prereq_assignment_id)
        VALUES (${masteryCheckId}, 'podsie_assignment', ${lessonId})
        ON CONFLICT DO NOTHING`
  );

  return {
    lessonId,
    lessonTitle,
    masteryCheckId,
    masteryCheckTitle,
    assignedLessonId,
    assignedMasteryId,
    questions,
  };
}

/**
 * Create a lesson assignment.
 */
async function createLessonAssignment(title: string, teacher: Teacher): Promise<number> {
  const result = await db.execute(
    sql`INSERT INTO assignments (title, description, created_by, state, config)
        VALUES (${title}, ${"Auto-generated sandbox lesson"}, ${teacher.id}, 'active',
                ${JSON.stringify({ mode: "lesson", isOptional: false })}::jsonb)
        RETURNING id`
  );
  return (result[0] as { id: number }).id;
}

/**
 * Assign an assignment to a group.
 */
async function assignToGroup(
  assignmentId: number,
  groupId: number,
  launchDate: string
): Promise<number> {
  const result = await db.execute(
    sql`INSERT INTO assigned_assignments (assignment_id, group_id, launch_date, due_date)
        VALUES (${assignmentId}, ${groupId}, ${launchDate}::timestamptz, NOW() + INTERVAL '30 days')
        RETURNING id`
  );
  return (result[0] as { id: number }).id;
}

/**
 * Create questions with knowledge components for a lesson.
 */
async function createLessonQuestions(
  lessonId: number,
  lessonTitle: string,
  teacher: Teacher
): Promise<LessonQuestion[]> {
  const questions: LessonQuestion[] = [];

  for (let q = 0; q < CONFIG.QUESTIONS_PER_LESSON; q++) {
    const questionContent = {
      type: "MULTIPLE_CHOICE",
      questionText: `Q${q + 1} for ${lessonTitle}: What is the correct answer?`,
      explanation: "This is the explanation for why this answer is correct.",
      answerChoices: [
        { id: randomUUID(), answerText: "Correct Answer", isCorrect: true },
        { id: randomUUID(), answerText: "Incorrect Option B", isCorrect: false },
        { id: randomUUID(), answerText: "Incorrect Option C", isCorrect: false },
        { id: randomUUID(), answerText: "Incorrect Option D", isCorrect: false },
      ],
    };

    // Create question
    const questionResult = await db.execute(
      sql`INSERT INTO questions (question_content, created_by, state, config)
          VALUES (${JSON.stringify(questionContent)}::jsonb, ${teacher.id}, 'active',
                  ${JSON.stringify({ tutorMode: false })}::jsonb)
          RETURNING id`
    );
    const questionId = (questionResult[0] as { id: number }).id;

    // Create knowledge component (KC tracks position in lesson)
    const kcResult = await db.execute(
      sql`INSERT INTO knowledge_components (name, original_question_id, active_in_personal_review)
          VALUES (${`KC for Q${q + 1} in ${lessonTitle}`}, ${questionId}, true)
          RETURNING id`
    );
    const kcId = (kcResult[0] as { id: number }).id;

    // Link KC to question
    await db.execute(
      sql`UPDATE questions SET knowledge_component_id = ${kcId} WHERE id = ${questionId}`
    );

    // Link question to lesson assignment
    const aqResult = await db.execute(
      sql`INSERT INTO assignment_questions (assignment_id, question_id, "order")
          VALUES (${lessonId}, ${questionId}, ${q + 1})
          RETURNING id`
    );
    const assignmentQuestionId = (aqResult[0] as { id: number }).id;

    questions.push({ id: questionId, kcId, assignmentQuestionId });
  }

  return questions;
}

/**
 * Create a mastery check assignment with a single question.
 */
async function createMasteryCheckAssignment(
  title: string,
  lessonTitle: string,
  teacher: Teacher
): Promise<number> {
  // Create mastery check assignment
  const masteryResult = await db.execute(
    sql`INSERT INTO assignments (title, description, created_by, state, config)
        VALUES (${title}, ${"Mastery check for lesson"}, ${teacher.id}, 'active',
                ${JSON.stringify({ mode: "sequential", isOptional: false })}::jsonb)
        RETURNING id`
  );
  const masteryCheckId = (masteryResult[0] as { id: number }).id;

  // Create mastery check question
  const masteryQuestionContent = {
    type: "MULTIPLE_CHOICE",
    questionText: `Mastery Check: Demonstrate your understanding of ${lessonTitle}`,
    explanation: "Complete this to show mastery of the lesson content.",
    answerChoices: [
      { id: randomUUID(), answerText: "I understand the concept", isCorrect: true },
      { id: randomUUID(), answerText: "I need more practice", isCorrect: false },
    ],
  };

  const masteryQuestionResult = await db.execute(
    sql`INSERT INTO questions (question_content, created_by, state, config)
        VALUES (${JSON.stringify(masteryQuestionContent)}::jsonb, ${teacher.id}, 'active',
                ${JSON.stringify({ tutorMode: false })}::jsonb)
        RETURNING id`
  );
  const masteryQuestionId = (masteryQuestionResult[0] as { id: number }).id;

  // Link mastery question to mastery check assignment
  await db.execute(
    sql`INSERT INTO assignment_questions (assignment_id, question_id, "order")
        VALUES (${masteryCheckId}, ${masteryQuestionId}, 1)`
  );

  return masteryCheckId;
}
