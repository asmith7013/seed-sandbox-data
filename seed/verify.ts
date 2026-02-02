/**
 * Verification Functions
 *
 * Verifies that required entities (teacher, groups, module) exist in the database.
 */

import { sql } from "drizzle-orm";
import { db, CONFIG, Teacher, Group } from "./config";

/**
 * Verify teacher exists and return teacher data.
 */
export async function verifyTeacher(): Promise<Teacher> {
  const teacherResult = await db.execute(
    sql`SELECT id, first_name, last_name FROM teacher_profiles WHERE email = ${CONFIG.TEACHER_EMAIL} LIMIT 1`
  );

  if (teacherResult.length === 0) {
    console.error(`Teacher not found: ${CONFIG.TEACHER_EMAIL}`);
    process.exit(1);
  }

  const teacher = teacherResult[0] as Teacher;
  console.log(`Using teacher: ${teacher.first_name} ${teacher.last_name}`);
  return teacher;
}

/**
 * Verify all groups exist and update group_code if needed.
 */
export async function verifyGroups(): Promise<Group[]> {
  const groups: Group[] = [];

  for (const groupId of CONFIG.GROUP_IDS) {
    const groupResult = await db.execute(
      sql`SELECT id, group_name, group_code FROM groups WHERE id = ${groupId} LIMIT 1`
    );

    if (groupResult.length === 0) {
      console.error(`Group not found: ID ${groupId}`);
      process.exit(1);
    }

    const group = groupResult[0] as Group;

    // Update group_code if needed for the mastery_checks_by_enrollment_daily view
    const targetCode = CONFIG.GROUP_CODES[groupId];
    if (targetCode && group.group_code !== targetCode) {
      await db.execute(
        sql`UPDATE groups SET group_code = ${targetCode} WHERE id = ${groupId}`
      );
      console.log(`Updated group: ${group.group_name} (${group.group_code} -> ${targetCode})`);
      group.group_code = targetCode;
    } else {
      console.log(`Using group: ${group.group_name} (${group.group_code})`);
    }

    groups.push(group);
  }

  return groups;
}

/**
 * Verify modules exist or create new ones.
 */
export async function verifyOrCreateModules(teacher: Teacher): Promise<number[]> {
  const moduleIds: number[] = [];

  for (let i = 0; i < CONFIG.MODULE_IDS.length; i++) {
    const moduleId = CONFIG.MODULE_IDS[i];
    // Generate module name following "Alg 1 Unit 8.X" pattern
    const unitNumber = 3 + i; // Start at 8.3, then 8.4, 8.5, etc.
    const moduleName = `Alg 1 Unit 8.${unitNumber}`;

    if (moduleId) {
      const moduleResult = await db.execute(
        sql`SELECT id, name FROM modules WHERE id = ${moduleId} LIMIT 1`
      );

      if (moduleResult.length === 0) {
        console.error(`Module not found: ID ${moduleId}`);
        process.exit(1);
      }

      const mod = moduleResult[0] as { id: number; name: string };

      // Update module name to match expected convention
      if (mod.name !== moduleName) {
        await db.execute(sql`UPDATE modules SET name = ${moduleName} WHERE id = ${moduleId}`);
        console.log(`Updated module: ${mod.name} -> ${moduleName}`);
      } else {
        console.log(`Using module: ${mod.name}`);
      }
      moduleIds.push(moduleId);
    } else {
      // Create a new module
      const newModule = await db.execute(
        sql`INSERT INTO modules (name, description, created_by)
            VALUES (${moduleName}, 'Auto-generated for sandbox testing', ${teacher.id})
            RETURNING id, name`
      );
      const newModuleId = (newModule[0] as { id: number }).id;
      console.log(`Created module: ${moduleName} (ID: ${newModuleId})`);
      moduleIds.push(newModuleId);
    }
  }

  return moduleIds;
}
