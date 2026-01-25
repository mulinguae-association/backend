import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();
const mongoUrl = process.env.MONGO_URI;
async function connectToDatabase() {
  try {
    await mongoose.connect(mongoUrl, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      autoReconnect: true,
      reconnectTries: Number.MAX_VALUE,
      reconnectInterval: 5000,
    });
    console.log("Connected to MongoDB");
  } catch (error) {
    console.error("MongoDB connection error:", error);
    throw error;
  }

  // Handle auto-reconnect for production
  mongoose.connection.on("disconnected", () => {
    console.error("MongoDB disconnected! Attempting to reconnect...");
    setTimeout(connectToDatabase, 5000);
  });
  mongoose.connection.on("error", (err) => {
    console.error("MongoDB connection error:", err);
  });
}

export { connectToDatabase };
