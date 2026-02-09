import bcrypt from "bcrypt";
import User from "../db/models/User.js";

async function createAdminUser() {
  try {
    const existingUser = await User.findOne({
      email: "goparlen1157@gmail.com",
    });

    if (existingUser) {
      // Predefined user already exists, update the password if needed
      const newPassword = "5555";
      const passwordMatch = await bcrypt.compare(
        newPassword,
        existingUser.password,
      );

      await existingUser.save(); // Save any role changes
      if (!passwordMatch) {
        existingUser.password = await bcrypt.hash("5555", 10);
        await existingUser.save();
      }
    } else {
      // Predefined user doesn't exist, create a new one
      const predefinedUser = new User({
        name: "Goparl",
        email: "goparlen1157@gmail.com",
        password: await bcrypt.hash("5555", 10),
        role: "superadmin",
      });
      await predefinedUser.save();
    }

    console.log("Predefined user created successfully");
  } catch (error) {
    throw new Error("Error creating predefined user");
  }
}

// Call the function to create the admin user
export default createAdminUser;
