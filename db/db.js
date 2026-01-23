import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();
const mongoUrl = process.env.MONGO_URI;
async function connectToDatabase() {
  try {
    await mongoose.connect(mongoUrl, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("Connected to MongoDB");
  } catch (error) {
    console.error("MongoDB connection error:", error);
    throw error;
  }
}
// async function connectToDatabase() {
//   return mongoose.connect(`mongodb://127.0.0.1:27017/mulingua`, {
//     useNewUrlParser: true,
//   });
// }

export { connectToDatabase };
