/**
 * Canvas AI Feedback Seeding
 *
 * Creates Canvas-type mastery check assignments with questions and simulates
 * student responses that include full LLMAnalysisResponse AI feedback.
 * This provides data for the AI Feedback Explorer sandbox page.
 */

import { sql } from "drizzle-orm";
import {
  db,
  CONFIG,
  ALWAYS_COMPLETE_INDICES,
  ZERO_START_INDICES,
  Teacher,
  Enrollment,
  getTimestampDaysAgo,
} from "./config";

// ============================================================================
// Types
// ============================================================================

interface CanvasAssignment {
  id: number;
  assignedId: number;
  title: string;
  questions: { id: number; assignmentQuestionId: number }[];
}

// ============================================================================
// Realistic feedback content pools
// ============================================================================

const OVERALL_FEEDBACK_CORRECT = [
  "- ✅ Your answer has the right idea!\n- Your work clearly shows each step of the solving process.\n- 🔍 One small suggestion: try labeling your variables more clearly next time.",
  "- ✅ Great job working through this problem!\n- You identified the correct strategy and applied it well.\n- Your explanation was thorough and easy to follow.",
  "- ✅ Excellent work!\n- You showed a strong understanding of the concept.\n- Your diagram clearly supports your answer.",
  "- ✅ Nice job!\n- You correctly set up the equation and solved it step by step.\n- Consider showing your check at the end to verify your answer.",
];

const OVERALL_FEEDBACK_INCORRECT = [
  "- 🔄 Not quite there yet.\n- You started with the right approach, but there's an error in your second step.\n- 🔍 Try re-reading the problem and checking your signs.",
  "- 🔄 Good effort, but let's look at this again.\n- Your setup is correct, but the solving process has a mistake.\n- Think about what happens when you divide both sides.",
  "- 🔄 Almost there!\n- You have the right idea but made a calculation error.\n- Try working through it again step by step.",
  "- 🔄 Let's revisit this.\n- Your diagram doesn't quite match the problem description.\n- Re-read the problem and try sketching it again.",
];

const THINKING_CORRECT = [
  "The student correctly identified the key concept and applied it systematically. Their work shows clear step-by-step reasoning. The final answer matches the expected solution.",
  "Student demonstrated strong understanding. Their explanation covers all required parts. The mathematical work is accurate and well-organized.",
  "The student's approach is valid and their execution is correct. They showed their work clearly and arrived at the right answer through logical steps.",
];

const THINKING_INCORRECT = [
  "The student attempted the problem but made a sign error in step 2. They correctly set up the initial equation but lost track when combining like terms. The final answer is incorrect due to this computational error.",
  "Student showed partial understanding but confused the operation needed. Their setup was reasonable but the approach diverged from the correct method midway through.",
  "The student's work shows they understand the general concept but made errors in execution. The diagram is partially correct but missing key information.",
];

const STUDENT_RUBRIC_CORRECT = [
  "✅ Part 1: You correctly identified the variables\n✅ Part 2: Your equation is set up properly\n✅ Part 3: Solution is correct",
  "✅ Part 1: Correct approach chosen\n✅ Part 2: Work shown clearly\n✅ Part 3: Final answer is accurate",
];

const STUDENT_RUBRIC_INCORRECT = [
  "✅ Part 1: You correctly identified the variables\n🔄 Part 2: Check your equation setup — the right side needs adjustment\n🔄 Part 3: Since Part 2 has an error, the solution needs to be recalculated",
  "✅ Part 1: Good start with the right approach\n🔄 Part 2: There's a sign error in your work\n🔄 Part 3: Try again after fixing Part 2",
];

const TEACHER_RUBRIC_CORRECT = [
  "Part 1 (Setup): Correct. Student identified variables and wrote the equation properly.\nPart 2 (Process): Correct. Clear step-by-step work shown.\nPart 3 (Answer): Correct. Final answer matches exemplar: x = 7.",
  "Part 1 (Identification): Correct. Student recognized the problem type.\nPart 2 (Strategy): Correct. Appropriate method selected and executed.\nPart 3 (Solution): Correct. Answer is accurate with units.",
];

const TEACHER_RUBRIC_INCORRECT = [
  "Part 1 (Setup): Correct. Student identified variables properly.\nPart 2 (Process): Incorrect. Sign error when moving terms. Expected: 3x + 5 = 26, Student wrote: 3x - 5 = 26.\nPart 3 (Answer): Incorrect due to Part 2 error. Expected: x = 7, Got: x = 10.33.",
  "Part 1 (Identification): Partially correct. Student recognized the general concept but missed a constraint.\nPart 2 (Strategy): Incorrect. Used addition instead of subtraction.\nPart 3 (Solution): Incorrect. Answer does not satisfy the original equation.",
];

const STUDENT_TEXT_RESPONSES = [
  "I started by identifying what x represents, then I set up the equation based on the problem. I combined like terms and solved for x by dividing both sides.",
  "First I drew a diagram to understand the problem. Then I wrote an equation and solved it step by step. I checked my answer by plugging it back in.",
  "I used the balance method to solve this. I subtracted 5 from both sides, then divided by 3 to get the answer.",
  "I set up a proportion based on the given information and cross-multiplied to find the unknown value.",
  "I graphed both equations and found where they intersect. The intersection point gives me the solution.",
];

const CANVAS_QUESTION_PROMPTS = [
  "Show your work and explain how you would solve the equation 3x + 5 = 26. Use the canvas to write out each step.",
  "Draw a diagram to represent the relationship described in the problem, then solve for the unknown. Explain your reasoning.",
  "Use the canvas to solve this system of equations. Show all your work and explain your strategy.",
  "Explain your approach to solving this word problem. Draw a model if it helps, and show your solution step by step.",
];

// ============================================================================
// Helper functions
// ============================================================================

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildAiAnalysis(isCorrect: boolean, useIS313: boolean) {
  const thinking = isCorrect ? pick(THINKING_CORRECT) : pick(THINKING_INCORRECT);
  const overallAIFeedback = isCorrect
    ? pick(OVERALL_FEEDBACK_CORRECT)
    : pick(OVERALL_FEEDBACK_INCORRECT);
  const studentRubric = isCorrect
    ? pick(STUDENT_RUBRIC_CORRECT)
    : pick(STUDENT_RUBRIC_INCORRECT);
  const teacherRubric = isCorrect
    ? pick(TEACHER_RUBRIC_CORRECT)
    : pick(TEACHER_RUBRIC_INCORRECT);

  const additionalFeedback = [
    { sectionTitle: "Student-Facing Rubric", content: studentRubric },
    { sectionTitle: "Teacher-Facing Rubric", content: teacherRubric },
  ];

  if (useIS313) {
    const explanationGradings = ["none", "partial", "full"] as const;
    const explanationGrading = isCorrect
      ? pick(["partial", "full"] as const)
      : pick(explanationGradings);
    return {
      thinking,
      additionalFeedback,
      overallAIFeedback,
      answersCorrect: isCorrect,
      explanationGrading,
      isCorrect: isCorrect && explanationGrading === "full",
    };
  }

  return {
    thinking,
    additionalFeedback,
    overallAIFeedback,
    isCorrect,
  };
}

function buildCanvasResponseContent(isCorrect: boolean, useIS313: boolean) {
  return {
    type: "canvas",
    canvasResponseData: {
      canvasStateHistory: [],
      finalCanvasState: {},
    },
    overallStudentTextResponse: pick(STUDENT_TEXT_RESPONSES),
    aiAnalysis: buildAiAnalysis(isCorrect, useIS313),
  };
}

// ============================================================================
// Main seeding functions
// ============================================================================

/**
 * Create a Canvas mastery check assignment with Canvas-type questions.
 */
async function createCanvasAssignment(
  groupId: number,
  moduleId: number,
  teacher: Teacher,
  lessonIndex: number,
  standaloneOffset: number,
  pairedLessonCount: number,
): Promise<CanvasAssignment> {
  const title = `Canvas Practice ${lessonIndex + 1}`;

  // Create assignment with sequential mode (mastery check)
  const assignmentResult = await db.execute(
    sql`INSERT INTO assignments (title, description, created_by, state, config)
        VALUES (${title}, ${"Canvas mastery check with AI feedback"}, ${teacher.id}, 'active',
                ${JSON.stringify({ mode: "sequential", isOptional: false })}::jsonb)
        RETURNING id`,
  );
  const assignmentId = (assignmentResult[0] as { id: number }).id;

  // Link to module (after standalone + paired lessons)
  const order = standaloneOffset + pairedLessonCount * 2 + lessonIndex + 1;
  await db.execute(
    sql`INSERT INTO assignment_modules (assignment_id, module_id, "order")
        VALUES (${assignmentId}, ${moduleId}, ${order})
        ON CONFLICT DO NOTHING`,
  );

  // Assign to group
  const launchDate = getTimestampDaysAgo(CONFIG.DAYS_TO_SEED);
  const assignedResult = await db.execute(
    sql`INSERT INTO assigned_assignments (assignment_id, group_id, launch_date, due_date)
        VALUES (${assignmentId}, ${groupId}, ${launchDate}::timestamptz, NOW() + INTERVAL '30 days')
        RETURNING id`,
  );
  const assignedId = (assignedResult[0] as { id: number }).id;

  // Create 2 Canvas questions
  const questions: { id: number; assignmentQuestionId: number }[] = [];
  for (let q = 0; q < 2; q++) {
    const questionContent = {
      type: "CANVAS",
      questionText: CANVAS_QUESTION_PROMPTS[(lessonIndex * 2 + q) % CANVAS_QUESTION_PROMPTS.length],
      acceptanceCriteria: "Student shows complete work with correct answer and clear explanation.",
      studentStartMode: "fresh_canvas",
      recording: "optional",
    };

    const questionResult = await db.execute(
      sql`INSERT INTO questions (question_content, created_by, state, config)
          VALUES (${JSON.stringify(questionContent)}::jsonb, ${teacher.id}, 'active',
                  ${JSON.stringify({ tutorMode: false })}::jsonb)
          RETURNING id`,
    );
    const questionId = (questionResult[0] as { id: number }).id;

    const aqResult = await db.execute(
      sql`INSERT INTO assignment_questions (assignment_id, question_id, "order")
          VALUES (${assignmentId}, ${questionId}, ${q + 1})
          RETURNING id`,
    );
    const assignmentQuestionId = (aqResult[0] as { id: number }).id;

    questions.push({ id: questionId, assignmentQuestionId });
  }

  return { id: assignmentId, assignedId, title, questions };
}

/**
 * Create Canvas assignments with AI feedback for a group and module.
 * Creates 1 Canvas mastery check per module with 2 questions each.
 */
export async function createCanvasAssignments(
  groupId: number,
  moduleId: number,
  teacher: Teacher,
): Promise<CanvasAssignment[]> {
  console.log(`\nCreating Canvas assignments for group ${groupId}, module ${moduleId}...`);

  const standaloneOffset = CONFIG.STANDALONE_LESSONS_TO_CREATE;
  const pairedLessonCount = CONFIG.LESSONS_TO_CREATE;

  const assignments: CanvasAssignment[] = [];
  // Create 2 canvas assignments per module for more data
  for (let i = 0; i < 2; i++) {
    const assignment = await createCanvasAssignment(
      groupId,
      moduleId,
      teacher,
      i,
      standaloneOffset,
      pairedLessonCount,
    );
    assignments.push(assignment);
    console.log(`   + ${assignment.title} (${assignment.questions.length} Canvas questions)`);
  }

  return assignments;
}

/**
 * Seed Canvas responses with AI feedback for students in a group.
 * ~75% of students get responses, with a mix of correct/incorrect and IS313/non-IS313.
 */
export async function seedCanvasResponses(
  groupId: number,
  canvasAssignments: CanvasAssignment[],
  moduleIndex: number,
): Promise<void> {
  if (canvasAssignments.length === 0) return;

  console.log(`\nSeeding Canvas AI feedback responses for group ${groupId}, module ${moduleIndex + 1}...`);

  const enrollments = await db.execute(
    sql`SELECT e.id, sp.first_name, sp.last_name
        FROM enrollments e
        JOIN student_profiles sp ON e.student_profile_id = sp.id
        WHERE e.group_id = ${groupId} AND e.status = 'active'
        LIMIT ${CONFIG.STUDENTS_TO_CREATE}`,
  );

  // Use IS313 format for the first module, non-IS313 for the second
  const useIS313 = moduleIndex === 0;

  for (let i = 0; i < enrollments.length; i++) {
    const enrollment = enrollments[i] as {
      id: number;
      first_name: string;
      last_name: string;
    };

    // Zero-start students never respond
    if (ZERO_START_INDICES.includes(i)) {
      console.log(`   - ${enrollment.first_name} ${enrollment.last_name}: Zero-start student`);
      continue;
    }

    // Always-complete students always respond (override the 25% skip logic)
    const skipForVariety = !ALWAYS_COMPLETE_INDICES.includes(i) && i % 4 === 0;
    if (skipForVariety) {
      console.log(`   - ${enrollment.first_name} ${enrollment.last_name}: No responses`);
      continue;
    }

    let responsesCreated = 0;

    for (let aIdx = 0; aIdx < canvasAssignments.length; aIdx++) {
      const assignment = canvasAssignments[aIdx];
      const baseDayOffset = Math.max(1, Math.floor(CONFIG.DAYS_TO_SEED * 0.3) - aIdx * 3);

      for (let qIdx = 0; qIdx < assignment.questions.length; qIdx++) {
        const question = assignment.questions[qIdx];
        // Vary correctness: ~60% correct
        const isCorrect = Math.random() > 0.4;
        const responseTimestamp = getTimestampDaysAgo(baseDayOffset, qIdx);

        const responseContent = buildCanvasResponseContent(isCorrect, useIS313);

        const responseResult = await db.execute(
          sql`INSERT INTO responses (enrollment_id, question_id, is_correct, response_content, created_at, updated_at)
              VALUES (
                ${enrollment.id},
                ${question.id},
                ${responseContent.aiAnalysis.isCorrect},
                ${JSON.stringify(responseContent)}::jsonb,
                ${responseTimestamp}::timestamptz,
                ${responseTimestamp}::timestamptz
              )
              RETURNING id`,
        );
        const responseId = (responseResult[0] as { id: number }).id;

        await db.execute(
          sql`INSERT INTO assignment_question_responses (response_id, assignment_question_id, assigned_assignment_id, created_at, updated_at)
              VALUES (${responseId}, ${question.assignmentQuestionId}, ${assignment.assignedId}, ${responseTimestamp}::timestamptz, ${responseTimestamp}::timestamptz)`,
        );

        responsesCreated++;
      }
    }
    console.log(`   + ${enrollment.first_name} ${enrollment.last_name}: ${responsesCreated} Canvas responses`);
  }
}
