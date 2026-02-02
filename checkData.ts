/**
 * Check Existing Sandbox Data
 *
 * Shows what groups, modules, and enrollments exist in the local database.
 * Use this to determine the correct CONFIG values for seed scripts.
 *
 * ONLY runs against local database (localhost/127.0.0.1).
 *
 * Usage: npx tsx ~/.claude/skills/seed-sandbox-data/checkData.ts
 */

import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";

// Load environment from the project directory
config({ path: `${process.cwd()}/.env` });

// ============================================================================
// SAFETY CHECK - Only run against local database
// ============================================================================
const POSTGRES_URL = process.env.POSTGRES_URL;
if (!POSTGRES_URL) {
  console.error("❌ POSTGRES_URL not found in environment");
  process.exit(1);
}

if (
  !POSTGRES_URL.includes("localhost") &&
  !POSTGRES_URL.includes("127.0.0.1")
) {
  console.error("❌ SAFETY: This script only runs against LOCAL databases!");
  console.error("   POSTGRES_URL must contain 'localhost' or '127.0.0.1'");
  process.exit(1);
}

console.log("✅ Safety check passed - running against local database\n");

// ============================================================================
// DATABASE CONNECTION
// ============================================================================
const client = postgres(POSTGRES_URL, { prepare: false, max: 1 });
const db = drizzle(client);

// ============================================================================
// MAIN FUNCTION
// ============================================================================
async function checkData() {
  console.log("📊 Checking existing sandbox data...\n");

  // Check groups
  console.log("=== Groups ===");
  const groups = await db.execute(
    sql`SELECT id, group_name, group_code FROM groups ORDER BY id`
  );
  if (groups.length === 0) {
    console.log("   No groups found.");
  } else {
    for (const g of groups as { id: number; group_name: string; group_code: string }[]) {
      console.log(`   ID: ${g.id} | ${g.group_name} (${g.group_code})`);
    }
  }

  // Check modules
  console.log("\n=== Modules ===");
  const modules = await db.execute(
    sql`SELECT id, name FROM modules ORDER BY id`
  );
  if (modules.length === 0) {
    console.log("   No modules found.");
  } else {
    for (const m of modules as { id: number; name: string }[]) {
      console.log(`   ID: ${m.id} | ${m.name}`);
    }
  }

  // Check enrollments by group
  console.log("\n=== Enrollments by Group ===");
  const enrollments = await db.execute(
    sql`SELECT g.id as group_id, g.group_name, COUNT(e.id) as student_count
        FROM groups g
        LEFT JOIN enrollments e ON e.group_id = g.id AND e.status = 'active'
        GROUP BY g.id, g.group_name
        ORDER BY g.id`
  );
  for (const e of enrollments as { group_id: number; group_name: string; student_count: string }[]) {
    console.log(`   Group ${e.group_id} (${e.group_name}): ${e.student_count} students`);
  }

  // Check assignments by module
  console.log("\n=== Assignments by Module ===");
  const assignments = await db.execute(
    sql`SELECT m.id as module_id, m.name as module_name, a.id as assignment_id, a.title, a.config->>'mode' as mode
        FROM modules m
        JOIN assignment_modules am ON am.module_id = m.id
        JOIN assignments a ON a.id = am.assignment_id
        ORDER BY m.id, am."order"`
  );
  let currentModule = -1;
  for (const a of assignments as { module_id: number; module_name: string; assignment_id: number; title: string; mode: string }[]) {
    if (a.module_id !== currentModule) {
      console.log(`\n   Module ${a.module_id}: ${a.module_name}`);
      currentModule = a.module_id;
    }
    const modeLabel = a.mode === "assessment" ? " [ASSESSMENT]" : "";
    console.log(`      - ID ${a.assignment_id}: ${a.title}${modeLabel}`);
  }

  // Check teacher profiles
  console.log("\n\n=== Teacher Profiles ===");
  const teachers = await db.execute(
    sql`SELECT id, email, first_name, last_name FROM teacher_profiles ORDER BY id LIMIT 5`
  );
  for (const t of teachers as { id: string; email: string; first_name: string; last_name: string }[]) {
    console.log(`   ${t.email} (${t.first_name} ${t.last_name})`);
  }

  console.log("\n✅ Check complete!");
  console.log("\n💡 Use these IDs in your seed script CONFIG:");
  console.log("   GROUP_ID: <id from Groups above>");
  console.log("   MODULE_ID: <id from Modules above>");
  console.log("   TEACHER_EMAIL: <email from Teacher Profiles above>\n");

  await client.end();
  process.exit(0);
}

// Run
checkData().catch((err) => {
  console.error("❌ Check failed:", err);
  process.exit(1);
});
