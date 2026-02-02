/**
 * Seed Assessment Data Script
 *
 * Creates an assessment assignment in the existing sandbox module with
 * varying student success rates.
 *
 * Usage: npx tsx ~/.claude/skills/seed-sandbox-data/seedAssessmentData.ts
 */

import { sql } from "drizzle-orm";
import { db } from "supabase/drizzle/db";
import { randomUUID } from "crypto";

// ============================================================================
// CONFIGURATION - Edit these values as needed
// ============================================================================
const CONFIG = {
  TEACHER_EMAIL: "alex.smith@teachinglab.org",
  GROUP_ID: 1, // Run checkData.ts to find valid group IDs
  MODULE_ID: 10, // Run checkData.ts to find valid module IDs
  QUESTIONS_IN_ASSESSMENT: 6,
  ASSESSMENT_TITLE: "Unit Assessment: Topics F-J", // Change this for each new assessment
};

console.log("✅ Using project database connection\n");

// ============================================================================
// MAIN SEEDING FUNCTION
// ============================================================================
async function seedAssessmentData() {
  console.log("🌱 Starting assessment data seed...\n");

  // 1. Verify teacher exists
  const teacherResult = await db.execute(
    sql`SELECT id, first_name, last_name FROM teacher_profiles WHERE email = ${CONFIG.TEACHER_EMAIL} LIMIT 1`
  );
  if (teacherResult.length === 0) {
    console.error(`❌ Teacher not found: ${CONFIG.TEACHER_EMAIL}`);
    process.exit(1);
  }
  const teacher = teacherResult[0] as {
    id: string;
    first_name: string;
    last_name: string;
  };
  console.log(`👩‍🏫 Using teacher: ${teacher.first_name} ${teacher.last_name}`);

  // 2. Verify group exists
  const groupResult = await db.execute(
    sql`SELECT id, group_name, group_code FROM groups WHERE id = ${CONFIG.GROUP_ID} LIMIT 1`
  );
  if (groupResult.length === 0) {
    console.error(`❌ Group not found: ID ${CONFIG.GROUP_ID}`);
    process.exit(1);
  }
  const group = groupResult[0] as {
    id: number;
    group_name: string;
    group_code: string;
  };
  console.log(`📚 Using group: ${group.group_name} (${group.group_code})`);

  // 3. Verify module exists and get max order
  const moduleResult = await db.execute(
    sql`SELECT id, name FROM modules WHERE id = ${CONFIG.MODULE_ID} LIMIT 1`
  );
  if (moduleResult.length === 0) {
    console.error(`❌ Module not found: ID ${CONFIG.MODULE_ID}`);
    process.exit(1);
  }
  const mod = moduleResult[0] as { id: number; name: string };
  console.log(`📦 Using module: ${mod.name}`);

  // Get max order in module
  const maxOrderResult = await db.execute(
    sql`SELECT COALESCE(MAX("order"), 0) as max_order FROM assignment_modules WHERE module_id = ${CONFIG.MODULE_ID}`
  );
  const maxOrder = (maxOrderResult[0] as { max_order: number }).max_order;

  // 4. Get all enrollments in the group
  const enrollmentsResult = await db.execute(
    sql`SELECT e.id, e.student_profile_id, sp.first_name, sp.last_name
        FROM enrollments e
        JOIN student_profiles sp ON e.student_profile_id = sp.id
        WHERE e.group_id = ${CONFIG.GROUP_ID} AND e.status = 'active'`
  );

  if (enrollmentsResult.length === 0) {
    console.error(`❌ No enrollments found for group ${CONFIG.GROUP_ID}`);
    console.error("   Run the main seedSandboxData.ts script first to create students.");
    process.exit(1);
  }

  const enrollments = enrollmentsResult as {
    id: number;
    student_profile_id: string;
    first_name: string;
    last_name: string;
  }[];
  console.log(`👥 Found ${enrollments.length} students enrolled`);

  // 5. Create assessment assignment
  console.log(`\n📝 Creating assessment assignment...`);
  const assessmentTitle = CONFIG.ASSESSMENT_TITLE;

  const assignmentResult = await db.execute(
    sql`INSERT INTO assignments (title, description, created_by, state, config)
        VALUES (${assessmentTitle}, ${"Comprehensive unit assessment covering all topics"}, ${teacher.id}, 'active',
                ${JSON.stringify({ mode: "assessment", isOptional: false })}::jsonb)
        RETURNING id`
  );
  const assignmentId = (assignmentResult[0] as { id: number }).id;
  console.log(`   ✓ Created: ${assessmentTitle} (ID: ${assignmentId})`);

  // Link to module
  await db.execute(
    sql`INSERT INTO assignment_modules (assignment_id, module_id, "order")
        VALUES (${assignmentId}, ${CONFIG.MODULE_ID}, ${maxOrder + 1})
        ON CONFLICT DO NOTHING`
  );
  console.log(`   ✓ Linked to module at order ${maxOrder + 1}`);

  // Assign to group
  const assignedResult = await db.execute(
    sql`INSERT INTO assigned_assignments (assignment_id, group_id, launch_date, due_date)
        VALUES (${assignmentId}, ${CONFIG.GROUP_ID}, NOW() - INTERVAL '7 days', NOW() + INTERVAL '7 days')
        RETURNING id`
  );
  const assignedAssignmentId = (assignedResult[0] as { id: number }).id;
  console.log(`   ✓ Assigned to group (assigned_assignment_id: ${assignedAssignmentId})`);

  // 6. Create questions with KCs
  console.log(`\n📋 Creating ${CONFIG.QUESTIONS_IN_ASSESSMENT} questions...`);
  const questions: { id: number; assignmentQuestionId: number; kcId: number; correctAnswerId: string }[] = [];

  const questionTopics = [
    "core concepts",
    "applications",
    "analysis skills",
    "problem solving",
    "critical thinking",
    "synthesis",
  ];

  for (let q = 0; q < CONFIG.QUESTIONS_IN_ASSESSMENT; q++) {
    const correctAnswerId = randomUUID();
    const questionContent = {
      type: "MULTIPLE_CHOICE",
      questionText: `Assessment Q${q + 1}: Which best demonstrates understanding of ${questionTopics[q % questionTopics.length]}?`,
      explanation: "This question tests understanding of key concepts from the unit.",
      answerChoices: [
        { id: correctAnswerId, answerText: "Correct answer", isCorrect: true },
        { id: randomUUID(), answerText: "Plausible distractor A", isCorrect: false },
        { id: randomUUID(), answerText: "Plausible distractor B", isCorrect: false },
        { id: randomUUID(), answerText: "Plausible distractor C", isCorrect: false },
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

    // Create knowledge component
    const kcResult = await db.execute(
      sql`INSERT INTO knowledge_components (name, original_question_id, active_in_personal_review)
          VALUES (${`Assessment KC: ${questionTopics[q % questionTopics.length]}`}, ${questionId}, true)
          RETURNING id`
    );
    const kcId = (kcResult[0] as { id: number }).id;

    // Link KC to question
    await db.execute(
      sql`UPDATE questions SET knowledge_component_id = ${kcId} WHERE id = ${questionId}`
    );

    // Link question to assignment
    const aqResult = await db.execute(
      sql`INSERT INTO assignment_questions (assignment_id, question_id, "order")
          VALUES (${assignmentId}, ${questionId}, ${q + 1})
          RETURNING id`
    );
    const assignmentQuestionId = (aqResult[0] as { id: number }).id;

    questions.push({ id: questionId, assignmentQuestionId, kcId, correctAnswerId });
    console.log(`   ✓ Q${q + 1}: ${questionTopics[q % questionTopics.length]}`);
  }

  // 7. Simulate student responses with varying success
  console.log(`\n📊 Simulating student responses with varying success...`);

  // Define success profiles: [correctPercentage, description]
  const successProfiles: [number, string][] = [
    [1.0, "excellent"],      // 100% correct
    [0.83, "very good"],     // 5/6 correct
    [0.67, "good"],          // 4/6 correct
    [0.5, "average"],        // 3/6 correct
    [0.33, "struggling"],    // 2/6 correct
    [0.17, "needs help"],    // 1/6 correct
  ];

  for (let i = 0; i < enrollments.length; i++) {
    const enrollment = enrollments[i];
    const profile = successProfiles[i % successProfiles.length];
    const [correctRatio, profileName] = profile;
    const numCorrect = Math.round(correctRatio * questions.length);

    // Shuffle questions to randomize which ones are correct
    const shuffledIndices = [...Array(questions.length).keys()].sort(() => Math.random() - 0.5);
    const correctIndices = new Set(shuffledIndices.slice(0, numCorrect));

    let actualCorrect = 0;
    for (let q = 0; q < questions.length; q++) {
      const question = questions[q];
      const isCorrect = correctIndices.has(q);
      if (isCorrect) actualCorrect++;

      // Create response content
      const selectedAnswerId = isCorrect
        ? question.correctAnswerId
        : randomUUID(); // Wrong answer

      const responseContent = {
        type: "MULTIPLE_CHOICE",
        selectedAnswer: {
          id: selectedAnswerId,
          answerText: isCorrect ? "Correct answer" : "Wrong answer",
        },
      };

      // Insert response
      const minutesAgo = Math.floor(Math.random() * 60);
      const responseResult = await db.execute(
        sql`INSERT INTO responses (enrollment_id, question_id, response_content, is_correct, first_attempt_of_session, created_at)
            VALUES (${enrollment.id}, ${question.id}, ${JSON.stringify(responseContent)}::jsonb, ${isCorrect}, true, NOW() - (${minutesAgo} || ' minutes')::interval)
            RETURNING id`
      );
      const responseId = (responseResult[0] as { id: number }).id;

      // Link to assignment_question_responses
      await db.execute(
        sql`INSERT INTO assignment_question_responses (assignment_question_id, response_id, assigned_assignment_id)
            VALUES (${question.assignmentQuestionId}, ${responseId}, ${assignedAssignmentId})`
      );
    }

    console.log(`   ${getEmoji(correctRatio)} ${enrollment.first_name} ${enrollment.last_name}: ${actualCorrect}/${questions.length} correct (${profileName})`);
  }

  console.log("\n✅ Assessment data seed complete!");
  console.log(`\n📍 Assessment: "${assessmentTitle}"`);
  console.log(`   Assignment ID: ${assignmentId}`);
  console.log(`   Questions: ${questions.length}`);
  console.log(`   Students completed: ${enrollments.length}`);
  console.log(`\n📍 View at: /teacher/sandbox/assessmentData`);
  console.log(`   Select group: ${group.group_name}`);
  console.log(`   Select module: ID ${CONFIG.MODULE_ID}\n`);

  process.exit(0);
}

function getEmoji(ratio: number): string {
  if (ratio >= 0.8) return "✅";
  if (ratio >= 0.5) return "➖";
  return "⚠️";
}

// Run
seedAssessmentData().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
