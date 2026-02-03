/**
 * Seed Sandbox Data - Main Entry Point
 *
 * Creates comprehensive test data for the Teacher Sandbox dashboards
 * (lesson progress, velocity, assessments, pacing).
 *
 * ONLY runs against local database (localhost/127.0.0.1).
 *
 * Usage: ~/.claude/skills/seed-sandbox-data/run.sh
 *
 * Structure:
 * - seed/config.ts    - Configuration, types, and date utilities
 * - seed/verify.ts    - Teacher, group, module verification
 * - seed/cleanup.ts   - Cleanup of old seed data
 * - seed/students.ts  - Student creation
 * - seed/lessons.ts   - Lesson and mastery check creation
 * - seed/events.ts    - Progress event generation
 * - seed/assessments.ts - Assessment creation and responses
 */

import {
  CONFIG,
  type LessonData,
  type ModuleLessonData,
  type Enrollment,
  verifyTeacher,
  verifyGroups,
  verifyOrCreateModules,
  cleanupSandboxData,
  cleanupPacingData,
  createPacingConfigs,
  seedStudentsForGroup,
  createAllLessonsForModule,
  seedProgressEventsForGroup,
  seedStandaloneLessonEvents,
  seedDetailedProgressForFirstLesson,
  seedPointsEvents,
  seedAttendanceEvents,
  createAssessments,
  assignAssessmentsToGroup,
  seedAssessmentResponses,
  updateExistingResponses,
  createCanvasAssignments,
  seedCanvasResponses,
} from "./seed";

console.log("Using project database connection\n");

async function seedSandboxData() {
  console.log("Starting comprehensive sandbox data seed...\n");

  // 1. Verify teacher and groups
  const teacher = await verifyTeacher();
  const groups = await verifyGroups();

  // 2. Verify or create modules
  const moduleIds = await verifyOrCreateModules(teacher);

  // 3. Clean up existing sandbox data (local DB + external pacing API)
  await cleanupSandboxData(CONFIG.GROUP_IDS, moduleIds[0]);
  await cleanupPacingData();

  // Store lessons by module and enrollments for each group
  const allLessonsByModule = new Map<number, ModuleLessonData[]>();
  const allEnrollments = new Map<number, Enrollment[]>();

  // 4. Process each group
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const group = groups[groupIndex];

    console.log(`\n${"=".repeat(60)}`);
    console.log(`Processing group: ${group.group_name} (ID: ${group.id})`);
    console.log("=".repeat(60));

    // Get/create students (pass groupIndex for unique names per group)
    const enrollments = await seedStudentsForGroup(group.id, group.group_name, groupIndex);
    allEnrollments.set(group.id, enrollments);

    // Create all lessons for each module (standalone + paired with mastery checks)
    const moduleLessonData: ModuleLessonData[] = [];
    for (const moduleId of moduleIds) {
      const lessonData = await createAllLessonsForModule(
        group.id,
        moduleId,
        teacher,
      );
      moduleLessonData.push(lessonData);
    }
    allLessonsByModule.set(group.id, moduleLessonData);

    // Seed completion events for standalone (ramp-up) lessons - all students complete these
    const standaloneLessonsByModule = moduleLessonData.map(m => m.standaloneLessons);
    await seedStandaloneLessonEvents(group.id, enrollments, standaloneLessonsByModule);

    // Create progress events spread across days (modules completed sequentially)
    const pairedLessonsByModule: LessonData[][] = moduleLessonData.map(m => m.pairedLessons);
    await seedProgressEventsForGroup(
      group.id,
      group.group_name,
      enrollments,
      pairedLessonsByModule,
    );

    // Add detailed progress with today/yesterday timestamps for dashboard variety
    // Use the LAST paired lesson from the LAST module (most recent work)
    const lastModulePairedLessons = pairedLessonsByModule[pairedLessonsByModule.length - 1];
    if (lastModulePairedLessons && lastModulePairedLessons.length > 0) {
      const lastLesson = lastModulePairedLessons[lastModulePairedLessons.length - 1];
      await seedDetailedProgressForFirstLesson(
        group.id,
        enrollments,
        lastLesson,
      );
    }

    // Seed points events for this group
    await seedPointsEvents(group.id, enrollments);

    // Seed attendance events (mark ~75% of students present for today)
    await seedAttendanceEvents(group.id, enrollments);
  }

  // 4b. Create pacing configs in AI Coaching Platform for each module
  // Use first group's lesson data as reference (all groups have same structure)
  const firstGroupLessons = allLessonsByModule.get(CONFIG.GROUP_IDS[0]);
  if (firstGroupLessons) {
    for (let moduleIndex = 0; moduleIndex < moduleIds.length; moduleIndex++) {
      const moduleId = moduleIds[moduleIndex];
      const moduleLessonData = firstGroupLessons[moduleIndex];

      // Combine standalone and paired lessons for pacing
      const lessonsForPacing = [
        ...moduleLessonData.standaloneLessons.map((l) => ({
          lessonId: l.lessonId,
          lessonTitle: l.lessonTitle,
        })),
        ...moduleLessonData.pairedLessons.map((l) => ({
          lessonId: l.lessonId,
          lessonTitle: l.lessonTitle,
          masteryCheckId: l.masteryCheckId,
          masteryCheckTitle: l.masteryCheckTitle,
        })),
      ];

      await createPacingConfigs(CONFIG.GROUP_IDS, moduleId, lessonsForPacing);
    }
  }

  // 5. Create assessments - ONE PER MODULE, in order
  // Assessments are completed sequentially: all module 1 assessments, then module 2, etc.
  const firstGroupId = CONFIG.GROUP_IDS[0];
  const allAssessments: { moduleIndex: number; assessments: Awaited<ReturnType<typeof createAssessments>> }[] = [];

  for (let moduleIndex = 0; moduleIndex < moduleIds.length; moduleIndex++) {
    const moduleId = moduleIds[moduleIndex];
    console.log(`\nCreating assessment for module ${moduleIndex + 1} (ID: ${moduleId})...`);
    const assessments = await createAssessments(
      firstGroupId,
      moduleId,
      teacher,
      moduleIndex, // Pass module index for sequential naming
    );
    allAssessments.push({ moduleIndex, assessments });
  }

  // 6. Simulate assessment responses for first group (sequentially by module)
  for (const { moduleIndex, assessments } of allAssessments) {
    await seedAssessmentResponses(firstGroupId, assessments, moduleIndex, moduleIds.length);
  }

  // 7. Assign same assessments to remaining groups and seed responses
  for (let i = 1; i < CONFIG.GROUP_IDS.length; i++) {
    const groupId = CONFIG.GROUP_IDS[i];
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Assigning assessments to group ID: ${groupId}`);
    console.log("=".repeat(60));

    for (const { moduleIndex, assessments } of allAssessments) {
      const groupAssessments = await assignAssessmentsToGroup(assessments, groupId);
      await seedAssessmentResponses(groupId, groupAssessments, moduleIndex, moduleIds.length);
    }
  }

  // 8. Create Canvas assignments with AI feedback for each group/module
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const group = groups[groupIndex];
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Creating Canvas AI feedback for group: ${group.group_name}`);
    console.log("=".repeat(60));

    for (let moduleIndex = 0; moduleIndex < moduleIds.length; moduleIndex++) {
      const moduleId = moduleIds[moduleIndex];
      const canvasAssignments = await createCanvasAssignments(
        group.id,
        moduleId,
        teacher,
      );
      await seedCanvasResponses(group.id, canvasAssignments, moduleIndex);
    }
  }

  // 9. Update existing responses
  await updateExistingResponses();

  // 10. Print summary
  console.log("\n" + "=".repeat(60));
  console.log("Sandbox data seed complete!");
  console.log("=".repeat(60));
  console.log(`\nView lessons at: /teacher/sandbox/lessonProgress`);
  console.log(
    `View velocity at: /teacher/sandbox/velocity?groupIds=${CONFIG.GROUP_IDS.join(",")}`,
  );
  console.log(`View assessments at: /teacher/sandbox/assessmentData`);
  console.log(`View AI feedback at: /teacher/sandbox/aiFeedback`);
  console.log(`\nGroups: ${groups.map((g) => g.group_name).join(", ")}`);
  console.log(`Module IDs: ${moduleIds.join(", ")}`);
  console.log(`Students per group: ${CONFIG.STUDENTS_TO_CREATE}`);
  console.log(
    `Standalone lessons per module: ${CONFIG.STANDALONE_LESSONS_TO_CREATE}`,
  );
  console.log(
    `Paired lessons per module: ${CONFIG.LESSONS_TO_CREATE} (each with mastery check)`,
  );
  console.log(`Questions per lesson: ${CONFIG.QUESTIONS_PER_LESSON}`);
  console.log(`Days of data: ${CONFIG.DAYS_TO_SEED}\n`);

  process.exit(0);
}

// Run
seedSandboxData().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
