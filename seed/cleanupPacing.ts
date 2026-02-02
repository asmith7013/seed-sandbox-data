/**
 * Pacing Data Cleanup
 *
 * Clears pacing configuration from the AI Coaching Platform
 * for sandbox groups/modules before reseeding.
 *
 * This prevents stale assignment IDs from persisting after
 * assignments are deleted and recreated with new IDs.
 */

import { CONFIG } from "./config";

/**
 * Get the Solves Coaching API configuration.
 * Duplicated here to avoid importing from main podsie codebase.
 */
function getApiConfig() {
  return {
    url: process.env.SOLVES_COACHING_API_URL || "https://solvescoaching.com",
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
