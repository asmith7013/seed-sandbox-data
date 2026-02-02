/**
 * Seed Configuration and Types
 *
 * Central configuration for sandbox data seeding.
 * Edit these values to customize what gets created.
 */

import { db } from "supabase/drizzle/db";

// Re-export db for use by other modules
export { db };

// =============================================================================
// CONFIGURATION
// =============================================================================

export const CONFIG = {
  // Teacher to use (must exist in database)
  TEACHER_EMAIL: process.env.SEED_TEACHER_EMAIL || "teacher@example.com",

  // Groups to populate with data
  GROUP_IDS: [1, 3],

  // Group codes required by mastery_checks_by_enrollment_daily view
  GROUP_CODES: {
    1: "6035",
    3: "6704",
  } as Record<number, string>,

  // Modules to populate with lessons (set to null to create new)
  MODULE_IDS: [10, 11],

  // Data volume settings
  STUDENTS_TO_CREATE: 13,
  STANDALONE_LESSONS_TO_CREATE: 2, // Lessons without paired mastery checks (at start of unit)
  LESSONS_TO_CREATE: 5, // Lessons WITH paired mastery checks
  QUESTIONS_PER_LESSON: 4, // Q1, Q2, Q3, Q4
  ASSESSMENTS_TO_CREATE: 2,
  QUESTIONS_PER_ASSESSMENT: 3,

  // Time range for seeded data
  DAYS_TO_SEED: 45,
};

// =============================================================================
// TYPES
// =============================================================================

export interface Teacher {
  id: string;
  first_name: string;
  last_name: string;
}

export interface Group {
  id: number;
  group_name: string;
  group_code: string;
}

export interface Enrollment {
  id: number;
  studentProfileId: string;
  name: string;
}

export interface LessonQuestion {
  id: number;
  kcId: number;
  assignmentQuestionId: number;
}

export interface LessonData {
  lessonId: number;
  lessonTitle: string;
  masteryCheckId: number;
  masteryCheckTitle: string;
  assignedLessonId: number;
  assignedMasteryId: number;
  questions: LessonQuestion[];
}

/** Standalone lesson without a paired mastery check */
export interface StandaloneLessonData {
  lessonId: number;
  lessonTitle: string;
  assignedLessonId: number;
  questions: LessonQuestion[];
}

/** All lesson data for a module (standalone + paired) */
export interface ModuleLessonData {
  standaloneLessons: StandaloneLessonData[];
  pairedLessons: LessonData[];
}

export interface AssessmentQuestion {
  id: number;
  assignmentQuestionId: number;
  correctChoiceId: string;
}

export interface Assessment {
  id: number;
  assignedId: number;
  title: string;
  questions: AssessmentQuestion[];
}

// =============================================================================
// CONSTANTS
// =============================================================================

// Student names organized by group - each group gets unique names
export const STUDENT_NAMES_BY_GROUP: { first: string | null; last: string | null }[][] = [
  // Group 0 (first group)
  [
    { first: "Alex", last: "Smith" },
    { first: "Emma", last: "Rodriguez" },
    { first: "Liam", last: "Chen" },
    { first: "Olivia", last: "Patel" },
    { first: "Noah", last: "Williams" },
    { first: "Ava", last: "Kim" },
    { first: "Ethan", last: "Garcia" },
    { first: "Sophia", last: "Nguyen" },
    { first: "Mason", last: "Brown" },
    { first: "Isabella", last: "Martinez" },
    { first: "James", last: "Lee" },
    { first: null, last: null }, // No name - exercises email fallback
    { first: null, last: null }, // No name - exercises email fallback
  ],
  // Group 1 (second group)
  [
    { first: "Charlotte", last: "Thomas" },
    { first: "Benjamin", last: "Jackson" },
    { first: "Amelia", last: "White" },
    { first: "Henry", last: "Harris" },
    { first: "Harper", last: "Clark" },
    { first: "Sebastian", last: "Lewis" },
    { first: "Evelyn", last: "Robinson" },
    { first: "Jack", last: "Walker" },
    { first: "Luna", last: "Young" },
    { first: "Owen", last: "Allen" },
    { first: "Chloe", last: "King" },
    { first: null, last: null }, // No name - exercises email fallback
    { first: null, last: null }, // No name - exercises email fallback
  ],
  // Group 2 (third group, if needed)
  [
    { first: "Michael", last: "Green" },
    { first: "Aria", last: "Baker" },
    { first: "William", last: "Adams" },
    { first: "Scarlett", last: "Nelson" },
    { first: "Alexander", last: "Hill" },
    { first: "Grace", last: "Ramirez" },
    { first: "Matthew", last: "Campbell" },
    { first: "Zoey", last: "Mitchell" },
    { first: "David", last: "Roberts" },
    { first: "Lily", last: "Carter" },
    { first: "Joseph", last: "Phillips" },
    { first: null, last: null }, // No name - exercises email fallback
    { first: null, last: null }, // No name - exercises email fallback
  ],
];

// Legacy export for backwards compatibility
export const STUDENT_NAMES = STUDENT_NAMES_BY_GROUP[0];

// =============================================================================
// DATE UTILITIES
// =============================================================================

/**
 * Get today's date at midnight (start of day).
 */
export function getToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

/**
 * Generate timestamp for a specific number of days ago.
 */
export function getTimestampDaysAgo(daysAgo: number, hoursOffset: number = 0): string {
  const date = getToday();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(10 + hoursOffset, 0, 0, 0);
  return date.toISOString();
}

/**
 * Get timestamp for different time periods (for varied distribution).
 */
export function getTimestamp(period: "today" | "yesterday" | "earlier"): Date {
  const now = new Date();
  switch (period) {
    case "today":
      return new Date(now.getTime() - Math.random() * 8 * 60 * 60 * 1000);
    case "yesterday":
      return new Date(
        now.getTime() - 24 * 60 * 60 * 1000 - Math.random() * 8 * 60 * 60 * 1000
      );
    case "earlier":
      return new Date(
        now.getTime() - (2 + Math.floor(Math.random() * 5)) * 24 * 60 * 60 * 1000
      );
  }
}
