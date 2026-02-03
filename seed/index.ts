/**
 * Seed Modules Index
 *
 * Re-exports all seed modules for easy importing.
 */

// Configuration and types
export {
  CONFIG,
  ALWAYS_COMPLETE_INDICES,
  ZERO_START_INDICES,
  type Teacher,
  type Group,
  type Enrollment,
  type LessonData,
  type StandaloneLessonData,
  type ModuleLessonData,
  type Assessment,
} from "./config";

// Verification
export { verifyTeacher, verifyGroups, verifyOrCreateModules } from "./verify";

// Cleanup
export { cleanupSandboxData } from "./cleanup";
export { cleanupPacingData, createPacingConfigs } from "./pacing";

// Students
export { seedStudentsForGroup } from "./students";

// Lessons
export { createAllLessonsForModule, createLessonsWithMasteryChecks } from "./lessons";

// Events
export {
  seedProgressEventsForGroup,
  seedStandaloneLessonEvents,
  seedDetailedProgressForFirstLesson,
  seedPointsEvents,
  seedAttendanceEvents,
} from "./events";

// Assessments
export {
  createAssessments,
  assignAssessmentsToGroup,
  seedAssessmentResponses,
  updateExistingResponses,
} from "./assessments";

// Canvas AI Feedback
export {
  createCanvasAssignments,
  seedCanvasResponses,
} from "./canvasFeedback";
