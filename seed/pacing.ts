/**
 * Pacing Data Management
 *
 * Manages pacing configuration in the AI Coaching Platform
 * for sandbox groups/modules:
 * - cleanupPacingData: Clears old configs before reseeding
 * - createPacingConfigs: Creates new configs after seeding assignments
 */

import { CONFIG } from "./config";

/**
 * Get the Solves Coaching API configuration.
 * Duplicated here to avoid importing from main podsie codebase.
 */
/**
 * Get a start date for the module (45 days ago to match seed data range).
 */
function getModuleStartDate(): string {
  const date = new Date();
  date.setDate(date.getDate() - CONFIG.DAYS_TO_SEED);
  return date.toISOString().split("T")[0]; // YYYY-MM-DD format
}

function getApiConfig() {
  // Use SOLVES_COACHING_BASE_URL - fallback to production
  const baseUrl = process.env.SOLVES_COACHING_BASE_URL || "https://solvescoaching.com";
  // Remove trailing slash if present
  const url = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return {
    url,
    key: process.env.SOLVES_COACHING_API_KEY || "",
  };
}

/**
 * Delete pacing configuration for a specific group + module combination.
 */
async function deletePacingConfig(
  groupId: number,
  moduleId: number,
): Promise<boolean> {
  const { url, key } = getApiConfig();

  if (!key) {
    console.log(
      "   ⚠ No SOLVES_COACHING_API_KEY set, skipping pacing cleanup",
    );
    return false;
  }

  try {
    const response = await fetch(
      `${url}/api/podsie/lesson-progress?groupId=${groupId}&moduleId=${moduleId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${key}`,
        },
      },
    );

    if (response.ok) {
      return true;
    } else if (response.status === 404) {
      // No pacing config exists - that's fine
      return false;
    } else {
      const errorText = await response.text();
      console.log(
        `   ⚠ Failed to delete pacing for group ${groupId}, module ${moduleId}: ${errorText}`,
      );
      return false;
    }
  } catch (error) {
    console.log(
      `   ⚠ Error deleting pacing for group ${groupId}, module ${moduleId}:`,
      error,
    );
    return false;
  }
}

/**
 * Clean up pacing configuration for all sandbox groups and modules.
 * Call this during cleanup before reseeding assignments.
 */
export async function cleanupPacingData(): Promise<void> {
  const { key } = getApiConfig();

  if (!key) {
    console.log("   Skipping pacing cleanup (no API key configured)");
    return;
  }

  console.log("Cleaning up pacing configuration from AI Coaching Platform...");

  let deletedCount = 0;

  for (const groupId of CONFIG.GROUP_IDS) {
    for (const moduleId of CONFIG.MODULE_IDS) {
      const deleted = await deletePacingConfig(groupId, moduleId);
      if (deleted) {
        deletedCount++;
        console.log(
          `   Deleted pacing config for group ${groupId}, module ${moduleId}`,
        );
      }
    }
  }

  if (deletedCount === 0) {
    console.log("   No existing pacing configs found to delete");
  } else {
    console.log(`   Deleted ${deletedCount} pacing config(s)`);
  }
}

/**
 * Lesson data structure for pacing config creation.
 */
interface LessonForPacing {
  lessonId: number;
  lessonTitle: string;
  masteryCheckId?: number;
  masteryCheckTitle?: string;
}

/**
 * Create pacing configuration for a group + module after seeding.
 * Groups lessons with their mastery checks into sections.
 */
async function createPacingConfig(
  groupId: number,
  moduleId: number,
  lessons: LessonForPacing[],
): Promise<boolean> {
  const { url, key } = getApiConfig();

  if (!key) {
    return false;
  }

  // Build assignments array - each lesson + mastery check pair becomes a section
  const assignments = lessons.flatMap((lesson, idx) => {
    const entries: {
      podsieAssignmentId: number;
      groupNumber: number;
      groupLabel: string;
      orderIndex: number;
      assignmentTitle: string;
    }[] = [
      {
        podsieAssignmentId: lesson.lessonId,
        groupNumber: idx + 1,
        groupLabel: `Lesson ${idx + 1}`,
        orderIndex: 0,
        assignmentTitle: lesson.lessonTitle,
      },
    ];

    if (lesson.masteryCheckId) {
      entries.push({
        podsieAssignmentId: lesson.masteryCheckId,
        groupNumber: idx + 1,
        groupLabel: `Lesson ${idx + 1}`,
        orderIndex: 1,
        assignmentTitle: lesson.masteryCheckTitle || "Mastery Check",
      });
    }

    return entries;
  });

  try {
    const response = await fetch(`${url}/api/podsie/lesson-progress`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        podsieGroupId: groupId,
        podsieModuleId: moduleId,
        moduleStartDate: getModuleStartDate(),
        // Class reward goal
        pointsRewardGoal: 750,
        pointsRewardDescription: "Pizza party when we reach our goal!",
        // Individual student target
        studentPointsTarget: 100,
        assignments,
        completedSections: [],
      }),
    });

    if (response.ok) {
      return true;
    } else {
      const errorText = await response.text();
      console.log(
        `   ⚠ Failed to create pacing for group ${groupId}, module ${moduleId}: ${errorText}`,
      );
      return false;
    }
  } catch (error) {
    console.log(
      `   ⚠ Error creating pacing for group ${groupId}, module ${moduleId}:`,
      error,
    );
    return false;
  }
}

/**
 * Create pacing configuration for all sandbox groups after seeding assignments.
 * Call this after lesson creation to set up initial pacing in the AI Coaching Platform.
 */
export async function createPacingConfigs(
  groupIds: number[],
  moduleId: number,
  lessons: LessonForPacing[],
): Promise<void> {
  const { key } = getApiConfig();

  if (!key) {
    console.log("   Skipping pacing creation (no API key configured)");
    return;
  }

  console.log(
    `Creating pacing configuration for module ${moduleId} in AI Coaching Platform...`,
  );

  let createdCount = 0;

  for (const groupId of groupIds) {
    const created = await createPacingConfig(groupId, moduleId, lessons);
    if (created) {
      createdCount++;
      console.log(
        `   Created pacing config for group ${groupId}, module ${moduleId}`,
      );
    }
  }

  if (createdCount === 0) {
    console.log("   No pacing configs created");
  } else {
    console.log(`   Created ${createdCount} pacing config(s)`);
  }
}
