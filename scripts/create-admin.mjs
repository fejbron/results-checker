// Create (or update) a lecturer/admin account in Supabase Auth.
//
// Usage (Node 20+ loads .env.local for you):
//   node --env-file=.env.local scripts/create-admin.mjs <email> <password>
//
// Or via npm:
//   npm run create-admin -- <email> <password>
//
// Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to be set
// (they live in .env.local — see .env.example).

import { createClient } from "@supabase/supabase-js";

const [, , email, password] = process.argv;

if (!email || !password) {
  console.error("Usage: node --env-file=.env.local scripts/create-admin.mjs <email> <password>");
  process.exit(1);
}

if (password.length < 6) {
  console.error("Password must be at least 6 characters.");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Copy .env.example to .env.local and fill in your Supabase keys first.",
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Create the user with a confirmed email so they can sign in immediately.
const { data, error } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});

if (error) {
  // If the account already exists, update its password instead.
  if (/already been registered|already exists/i.test(error.message)) {
    const { data: list, error: listErr } = await supabase.auth.admin.listUsers();
    const existing = list?.users?.find((u) => u.email === email);
    if (listErr || !existing) {
      console.error("Account exists but could not be updated:", (listErr ?? error).message);
      process.exit(1);
    }
    const { error: updErr } = await supabase.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
    });
    if (updErr) {
      console.error("Failed to update existing account:", updErr.message);
      process.exit(1);
    }
    console.log(`✓ Updated password for existing admin: ${email}`);
    process.exit(0);
  }
  console.error("Failed to create admin:", error.message);
  process.exit(1);
}

console.log(`✓ Created admin account: ${data.user?.email}`);
console.log("  Sign in at /admin");
