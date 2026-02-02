/**
 * Assessment Seeding
 *
 * Creates assessment assignments with questions and simulates student responses.
 */

import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  db,
  CONFIG,
  Teacher,
  Assessment,
  AssessmentQuestion,
  getTimestampDaysAgo,
} from "./config";

/**
 * Create assessment assignments with questions.
 * @param moduleIndex - Index of the module (0-based) for sequential naming
 */
export async function createAssessments(
  groupId: number,
  moduleId: number,
  teacher: Teacher,
  moduleIndex: number = 0
): Promise<Assessment[]> {
  // Create one assessment per module, named by unit number (Unit 3, Unit 4, etc.)
  const unitNumber = moduleIndex + 3; // Start from Unit 3
  const title = `Unit ${unitNumber} Assessment`;

  console.log(`\nCreating assessment: ${title}...`);
  const assessment = await createAssessment(0, title, groupId, moduleId, teacher);
  console.log(`   + ${title} (${assessment.questions.length} questions)`);

  return [assessment];
}

/**
 * Create a single assessment with questions.
 */
async function createAssessment(
  index: number,
  title: string,
  groupId: number,
  moduleId: number,
  teacher: Teacher
): Promise<Assessment> {
  // Create assessment assignment
  const assessmentResult = await db.execute(
    sql`INSERT INTO assignments (title, description, created_by, state, config)
        VALUES (${title}, ${"Auto-generated assessment"}, ${teacher.id}, 'active',
                ${JSON.stringify({ mode: "assessment", isOptional: false, maxAnswerAttempts: 1 })}::jsonb)
        RETURNING id`
  );
  const assessmentId = (assessmentResult[0] as { id: number }).id;

  // Link to module
  await db.execute(
    sql`INSERT INTO assignment_modules (assignment_id, module_id, "order")
        VALUES (${assessmentId}, ${moduleId}, ${CONFIG.LESSONS_TO_CREATE + index + 1})
        ON CONFLICT DO NOTHING`
  );

  // Assign to group
  const launchDate = getTimestampDaysAgo(CONFIG.DAYS_TO_SEED);
  const assignedResult = await db.execute(
    sql`INSERT INTO assigned_assignments (assignment_id, group_id, launch_date, due_date)
        VALUES (${assessmentId}, ${groupId}, ${launchDate}::timestamptz, NOW() + INTERVAL '30 days')
        RETURNING id`
  );
  const assignedAssignmentId = (assignedResult[0] as { id: number }).id;

  // Create questions
  const questions = await createAssessmentQuestions(assessmentId, index, teacher);

  return {
    id: assessmentId,
    assignedId: assignedAssignmentId,
    title,
    questions,
  };
}

/**
 * Create questions for an assessment.
 */
async function createAssessmentQuestions(
  assessmentId: number,
  assessmentIndex: number,
  teacher: Teacher
): Promise<AssessmentQuestion[]> {
  const questions: AssessmentQuestion[] = [];

  for (let q = 0; q < CONFIG.QUESTIONS_PER_ASSESSMENT; q++) {
    const correctChoiceId = randomUUID();
    const questionContent = {
      type: "MULTIPLE_CHOICE",
      questionText: `Assessment ${assessmentIndex + 1}, Question ${q + 1}: Solve this problem.`,
      explanation: "This is the explanation for the correct answer.",
      answerChoices: [
        { id: correctChoiceId, answerText: "Correct Answer", isCorrect: true },
        { id: randomUUID(), answerText: "Wrong Answer A", isCorrect: false },
        { id: randomUUID(), answerText: "Wrong Answer B", isCorrect: false },
        { id: randomUUID(), answerText: "Wrong Answer C", isCorrect: false },
      ],
    };

    const questionResult = await db.execute(
      sql`INSERT INTO questions (question_content, created_by, state, config)
          VALUES (${JSON.stringify(questionContent)}::jsonb, ${teacher.id}, 'active',
                  ${JSON.stringify({ tutorMode: false })}::jsonb)
          RETURNING id`
    );
    const questionId = (questionResult[0] as { id: number }).id;

    const aqResult = await db.execute(
      sql`INSERT INTO assignment_questions (assignment_id, question_id, "order")
          VALUES (${assessmentId}, ${questionId}, ${q + 1})
          RETURNING id`
    );
    const assignmentQuestionId = (aqResult[0] as { id: number }).id;

    questions.push({ id: questionId, assignmentQuestionId, correctChoiceId });
  }

  return questions;
}

/**
 * Simulate assessment responses for students with timestamps spread across days.
 * Assessments are completed sequentially by module (all Unit 3 assessments, then Unit 4, etc.)
 * @param moduleIndex - Which module this assessment belongs to (0-based)
 * @param totalModules - Total number of modules for calculating time windows
 */
export async function seedAssessmentResponses(
  groupId: number,
  assessments: Assessment[],
  moduleIndex: number = 0,
  totalModules: number = 1
): Promise<void> {
  if (assessments.length === 0) return;

  console.log(`\nSimulating assessment responses for module ${moduleIndex + 1}...`);
  const explanationGradings = ["none", "partial", "full"] as const;

  const enrollments = await db.execute(
    sql`SELECT e.id, e.student_profile_id, sp.first_name, sp.last_name
        FROM enrollments e
        JOIN student_profiles sp ON e.student_profile_id = sp.id
        WHERE e.group_id = ${groupId} AND e.status = 'active'
        LIMIT ${CONFIG.STUDENTS_TO_CREATE}`
  );

  // Calculate time window for this module's assessments
  // Assessments happen AFTER lessons, so use the latter portion of each module's time window
  const daysPerModule = Math.floor(CONFIG.DAYS_TO_SEED / totalModules);
  const moduleStartDay = CONFIG.DAYS_TO_SEED - (moduleIndex + 1) * daysPerModule;
  // Assessments happen in the last 1-2 days of each module's window
  const assessmentDayOffset = moduleStartDay + Math.floor(daysPerModule * 0.8);

  for (let i = 0; i < enrollments.length; i++) {
    const enrollment = enrollments[i] as {
      id: number;
      student_profile_id: string;
      first_name: string;
      last_name: string;
    };
    const responseRate = (i % 4) / 3; // 0%, 33%, 66%, 100%

    if (responseRate === 0) {
      console.log(`   - ${enrollment.first_name} ${enrollment.last_name}: No responses`);
      continue;
    }

    let responsesCreated = 0;
    for (let aIdx = 0; aIdx < assessments.length; aIdx++) {
      const assessment = assessments[aIdx];
      // Spread assessments within the assessment window (last ~20% of module time)
      const baseDayOffset = Math.max(0, assessmentDayOffset - aIdx);

      for (let qIdx = 0; qIdx < assessment.questions.length; qIdx++) {
        const question = assessment.questions[qIdx];
        if (Math.random() > responseRate) continue;

        const isCorrect = Math.random() > 0.4;
        const explanationGrading = explanationGradings[Math.floor(Math.random() * 3)];
        const selectedChoiceId = isCorrect ? question.correctChoiceId : randomUUID();
        const responseTimestamp = getTimestampDaysAgo(baseDayOffset, qIdx);

        const responseResult = await db.execute(
          sql`INSERT INTO responses (enrollment_id, question_id, is_correct, response_content, created_at, updated_at)
              VALUES (
                ${enrollment.id},
                ${question.id},
                ${isCorrect},
                ${JSON.stringify({
                  type: "multiple_choice",
                  selectedChoiceIds: [selectedChoiceId],
                  aiAnalysis: {
                    explanationGrading,
                    feedback: `Your explanation was ${explanationGrading}.`,
                  },
                })}::jsonb,
                ${responseTimestamp}::timestamptz,
                ${responseTimestamp}::timestamptz
              )
              RETURNING id`
        );
        const responseId = (responseResult[0] as { id: number }).id;

        await db.execute(
          sql`INSERT INTO assignment_question_responses (response_id, assignment_question_id, assigned_assignment_id, created_at, updated_at)
              VALUES (${responseId}, ${question.assignmentQuestionId}, ${assessment.assignedId}, ${responseTimestamp}::timestamptz, ${responseTimestamp}::timestamptz)`
        );

        responsesCreated++;
      }
    }
    console.log(`   + ${enrollment.first_name} ${enrollment.last_name}: ${responsesCreated} responses`);
  }
}

/**
 * Assign existing assessments to an additional group.
 * Creates assigned_assignments entries for the group and returns updated Assessment objects.
 */
export async function assignAssessmentsToGroup(
  assessments: Assessment[],
  groupId: number
): Promise<Assessment[]> {
  console.log(`\nAssigning ${assessments.length} assessments to group ${groupId}...`);
  const updatedAssessments: Assessment[] = [];

  for (const assessment of assessments) {
    const launchDate = getTimestampDaysAgo(CONFIG.DAYS_TO_SEED);
    const assignedResult = await db.execute(
      sql`INSERT INTO assigned_assignments (assignment_id, group_id, launch_date, due_date)
          VALUES (${assessment.id}, ${groupId}, ${launchDate}::timestamptz, NOW() + INTERVAL '30 days')
          RETURNING id`
    );
    const assignedAssignmentId = (assignedResult[0] as { id: number }).id;

    updatedAssessments.push({
      ...assessment,
      assignedId: assignedAssignmentId,
    });
    console.log(`   + ${assessment.title} assigned (assigned_id: ${assignedAssignmentId})`);
  }

  return updatedAssessments;
}

/**
 * Update existing responses that lack explanation grading.
 */
export async function updateExistingResponses(): Promise<void> {
  console.log(`\nUpdating existing responses with explanation grading...`);
  const explanationGradings = ["none", "partial", "full"] as const;

  const existingResponses = await db.execute(
    sql`SELECT id FROM responses
        WHERE response_content->'aiAnalysis'->>'explanationGrading' IS NULL
        LIMIT 100`
  );

  let updatedCount = 0;
  for (const resp of existingResponses) {
    const responseId = (resp as { id: number }).id;
    const explanationGrading = explanationGradings[Math.floor(Math.random() * 3)];

    await db.execute(
      sql`UPDATE responses
          SET response_content = response_content || ${JSON.stringify({
            aiAnalysis: {
              explanationGrading,
              feedback: `Your explanation was ${explanationGrading}.`,
            },
          })}::jsonb
          WHERE id = ${responseId}`
    );
    updatedCount++;
  }
  console.log(`   Updated ${updatedCount} existing responses`);
}
