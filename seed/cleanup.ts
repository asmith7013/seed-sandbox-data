/**
 * Cleanup Functions
 *
 * Removes old sandbox data before re-seeding.
 * Handles foreign key constraints in correct order.
 */

import { sql } from "drizzle-orm";
import { db } from "./config";

/**
 * Clean up all existing sandbox data (events, assignments, questions, KCs, students).
 */
export async function cleanupSandboxData(
  groupIds: number[],
  _moduleId: number
): Promise<void> {
  console.log("Cleaning up existing sandbox data...");

  await cleanupEvents(groupIds);
  await cleanupSeedStudents(groupIds);
  await cleanupSeedAssignments();
  await cleanupOrphanedKCs();
  await cleanupAssessments();

  console.log();
}

/**
 * Delete progress events for specified groups.
 */
async function cleanupEvents(groupIds: number[]): Promise<void> {
  for (const groupId of groupIds) {
    const deletedEvents = await db.execute(
      sql`DELETE FROM events
          WHERE type IN ('LESSON_QUESTION_SHOWN', 'QUESTION_ANSWERED', 'LESSON_COMPLETED', 'ASSIGNMENT_COMPLETED')
          AND data->>'groupId' = ${String(groupId)}
          RETURNING id`
    );
    console.log(`   Deleted ${deletedEvents.length} events for group ${groupId}`);
  }
}

/**
 * Delete seed students (those with sandbox.*.test.local emails).
 */
async function cleanupSeedStudents(groupIds: number[]): Promise<void> {
  for (const groupId of groupIds) {
    // Get seed enrollments for this group
    const seedEnrollments = await db.execute(
      sql`SELECT e.id, e.student_profile_id
          FROM enrollments e
          JOIN student_profiles sp ON e.student_profile_id = sp.id
          WHERE e.group_id = ${groupId}
          AND sp.email LIKE 'sandbox.%@test.local'`
    );

    if (seedEnrollments.length === 0) continue;

    // Delete in correct order due to foreign keys
    for (const e of seedEnrollments) {
      const enrollment = e as { id: number; student_profile_id: string };

      // Get ALL enrollments for this student (they might be in multiple groups)
      const allEnrollments = await db.execute(
        sql`SELECT id FROM enrollments WHERE student_profile_id = ${enrollment.student_profile_id}`
      );

      // Delete assignment_question_responses and responses for ALL enrollments
      for (const enr of allEnrollments) {
        const enrId = (enr as { id: number }).id;
        await db.execute(
          sql`DELETE FROM assignment_question_responses
              WHERE response_id IN (SELECT id FROM responses WHERE enrollment_id = ${enrId})`
        );
        await db.execute(sql`DELETE FROM responses WHERE enrollment_id = ${enrId}`);
      }

      // Delete ALL enrollments for this student
      await db.execute(sql`DELETE FROM enrollments WHERE student_profile_id = ${enrollment.student_profile_id}`);

      // Delete student profile and auth user
      await db.execute(sql`DELETE FROM student_profiles WHERE id = ${enrollment.student_profile_id}`);
      await db.execute(sql`DELETE FROM auth.users WHERE id = ${enrollment.student_profile_id}::uuid`);
    }

    console.log(`   Deleted ${seedEnrollments.length} seed students for group ${groupId}`);
  }
}

/**
 * Delete old seed assignments (lessons and mastery checks).
 * Matches both old "Topic X" pattern and new "Lesson N: Title" pattern.
 */
async function cleanupSeedAssignments(): Promise<void> {
  const oldAssignments = await db.execute(
    sql`SELECT id FROM assignments
        WHERE title LIKE 'Unit % Lesson %: Topic %'
           OR title LIKE 'Lesson %: Topic %'
           OR title LIKE 'Lesson _:%'
           OR title LIKE 'Lesson __:%'
           OR title LIKE 'Ramp Up %:%'`
  );

  if (oldAssignments.length === 0) return;

  const assignmentIds = oldAssignments.map((a: any) => a.id);

  // Delete in correct order due to foreign keys
  for (const id of assignmentIds) {
    await db.execute(sql`DELETE FROM assignment_question_responses WHERE assigned_assignment_id IN (
      SELECT id FROM assigned_assignments WHERE assignment_id = ${id}
    )`);
  }
  for (const id of assignmentIds) {
    await db.execute(sql`DELETE FROM assigned_assignments WHERE assignment_id = ${id}`);
    await db.execute(sql`DELETE FROM assignment_prerequisites WHERE assignment_id = ${id} OR prereq_assignment_id = ${id}`);
    await db.execute(sql`DELETE FROM assignment_modules WHERE assignment_id = ${id}`);
    await db.execute(sql`DELETE FROM assignment_questions WHERE assignment_id = ${id}`);
  }
  for (const id of assignmentIds) {
    await db.execute(sql`DELETE FROM assignments WHERE id = ${id}`);
  }

  console.log(`   Deleted ${assignmentIds.length} old seed assignments`);
}

/**
 * Delete orphaned questions and KCs created by seed.
 * Must handle full dependency chain: responses -> questions -> KCs
 */
async function cleanupOrphanedKCs(): Promise<void> {
  const seedKCs = await db.execute(
    sql`SELECT id FROM knowledge_components
        WHERE name LIKE 'KC for Q% in Unit%'
           OR name LIKE 'KC for Q% in Lesson%'`
  );

  if (seedKCs.length === 0) return;

  for (const kc of seedKCs) {
    const kcId = (kc as { id: number }).id;

    // Get questions that reference this KC
    const questions = await db.execute(
      sql`SELECT id FROM questions WHERE knowledge_component_id = ${kcId}`
    );

    for (const q of questions) {
      const qId = (q as { id: number }).id;
      await db.execute(sql`DELETE FROM responses WHERE question_id = ${qId}`);
      await db.execute(sql`DELETE FROM assignment_questions WHERE question_id = ${qId}`);
    }

    await db.execute(sql`DELETE FROM questions WHERE knowledge_component_id = ${kcId}`);
  }

  const deletedKCs = await db.execute(
    sql`DELETE FROM knowledge_components
        WHERE name LIKE 'KC for Q% in Unit%'
           OR name LIKE 'KC for Q% in Lesson%'
        RETURNING id`
  );
  console.log(`   Deleted ${deletedKCs.length} orphaned KCs and their questions`);
}

/**
 * Delete old assessment assignments.
 */
async function cleanupAssessments(): Promise<void> {
  const oldAssessments = await db.execute(
    sql`SELECT id FROM assignments WHERE title LIKE 'Unit % Assessment'`
  );

  if (oldAssessments.length === 0) return;

  const assessmentIds = oldAssessments.map((a: any) => a.id);

  for (const id of assessmentIds) {
    await db.execute(sql`DELETE FROM assignment_question_responses WHERE assigned_assignment_id IN (
      SELECT id FROM assigned_assignments WHERE assignment_id = ${id}
    )`);
    await db.execute(sql`DELETE FROM assigned_assignments WHERE assignment_id = ${id}`);
    await db.execute(sql`DELETE FROM assignment_modules WHERE assignment_id = ${id}`);
    await db.execute(sql`DELETE FROM assignment_questions WHERE assignment_id = ${id}`);
    await db.execute(sql`DELETE FROM assignments WHERE id = ${id}`);
  }

  console.log(`   Deleted ${assessmentIds.length} old assessment assignments`);
}
