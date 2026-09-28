import User from "../db/models/User.js";

// The seed account comes from the environment, not from source. A hardcoded
// email and password in the repo is a production backdoor for anyone who can
// read it — and this file used to re-set that account's password on every boot,
// so even a password the owner changed was silently replaced.
async function createAdminUser() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.log("No ADMIN_EMAIL / ADMIN_PASSWORD set - skipping the predefined admin");
    return;
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const existingUser = await User.findOne({ email: normalizedEmail });

  // Never reset a live account's password or role on boot: a stale hardcoded
  // value would overwrite whatever the owner set. The seed only fills a gap.
  if (existingUser) {
    console.log(`Predefined admin exists (${normalizedEmail}) - left untouched`);
    return;
  }

  const role = process.env.ADMIN_ROLE || "admin";
  if (!["admin", "superadmin", "user"].includes(role)) {
    throw new Error("ADMIN_ROLE must be one of admin, superadmin, user");
  }

  await User.create({
    name: process.env.ADMIN_NAME || "Predefined admin",
    email: normalizedEmail,
    password,
    role,
  });
  console.log(`Predefined ${role} created (${normalizedEmail})`);
}

export default createAdminUser;