/**
 * Student Seeding
 *
 * Creates or retrieves students and enrollments for a group.
 */

import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, CONFIG, STUDENT_NAMES_BY_GROUP, Enrollment } from "./config";

/**
 * Get existing enrollments or create new students for a group.
 * @param groupIndex - The index of this group in CONFIG.GROUP_IDS (used to select unique names)
 */
export async function seedStudentsForGroup(
  groupId: number,
  groupName: string,
  groupIndex: number
): Promise<Enrollment[]> {
  console.log(`\nGetting/creating students for ${groupName}...`);
  const enrollments: Enrollment[] = [];

  // Get names for this specific group (fall back to first group's names if index out of range)
  const studentNames = STUDENT_NAMES_BY_GROUP[groupIndex] ?? STUDENT_NAMES_BY_GROUP[0];

  // Check for existing enrollments
  const existingEnrollments = await db.execute(
    sql`SELECT e.id, e.student_profile_id, sp.first_name, sp.last_name
        FROM enrollments e
        JOIN student_profiles sp ON e.student_profile_id = sp.id
        WHERE e.group_id = ${groupId} AND e.status = 'active'
        LIMIT ${CONFIG.STUDENTS_TO_CREATE}`
  );

  if (existingEnrollments.length > 0) {
    console.log(`   Found ${existingEnrollments.length} existing students`);
    for (const e of existingEnrollments) {
      const enrollment = e as {
        id: number;
        student_profile_id: string;
        first_name: string;
        last_name: string;
      };
      enrollments.push({
        id: enrollment.id,
        studentProfileId: enrollment.student_profile_id,
        name: `${enrollment.first_name} ${enrollment.last_name}`,
      });
      console.log(`   + ${enrollment.first_name} ${enrollment.last_name} (existing)`);
    }
  }

  // Create more students if needed
  const studentsToCreate = CONFIG.STUDENTS_TO_CREATE - enrollments.length;
  if (studentsToCreate > 0) {
    console.log(`   Creating ${studentsToCreate} new students...`);
    for (let i = enrollments.length; i < CONFIG.STUDENTS_TO_CREATE; i++) {
      const name = studentNames[i % studentNames.length];
      const userId = randomUUID();
      const hasName = name.first !== null && name.last !== null;
      const email = hasName
        ? `sandbox.${name.first!.toLowerCase()}.${name.last!.toLowerCase()}.${Date.now()}.${groupId}.${i}@test.local`
        : `sandbox.student.${Date.now()}.${groupId}.${i}@test.local`;
      const displayName = hasName ? `${name.first} ${name.last}` : email;

      // Create auth user
      await db.execute(
        sql`INSERT INTO auth.users (id, email, raw_user_meta_data)
            VALUES (${userId}, ${email}, ${JSON.stringify({ name: hasName ? displayName : undefined })}::jsonb)
            ON CONFLICT (id) DO NOTHING`
      );

      // Create student profile (null first/last name for nameless students to exercise email fallback)
      if (hasName) {
        await db.execute(
          sql`INSERT INTO student_profiles (id, first_name, last_name, email)
              VALUES (${userId}, ${name.first}, ${name.last}, ${email})
              ON CONFLICT (id) DO NOTHING`
        );
      } else {
        await db.execute(
          sql`INSERT INTO student_profiles (id, email)
              VALUES (${userId}, ${email})
              ON CONFLICT (id) DO NOTHING`
        );
      }

      // Create enrollment
      const enrollmentResult = await db.execute(
        sql`INSERT INTO enrollments (student_profile_id, group_id)
            VALUES (${userId}, ${groupId})
            ON CONFLICT DO NOTHING
            RETURNING id, student_profile_id`
      );

      if (enrollmentResult.length > 0) {
        enrollments.push({
          id: (enrollmentResult[0] as { id: number }).id,
          studentProfileId: userId,
          name: displayName,
        });
        console.log(`   + ${displayName} (new${hasName ? "" : ", no name"})`);
      }
    }
  }

  return enrollments;
}
