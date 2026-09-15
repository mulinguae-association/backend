import mongoose from "mongoose";

// Use a global variable to store the connection state across function calls
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectToDatabase() {
  // 1. If we already have a connection, return it immediately
  if (cached.conn) {
    return cached.conn;
  }

  // 2. Read MONGO_URI at call time (not module level) so dotenv.config()
  //    has a chance to run first — ES module imports are hoisted.
  const mongoUrl = process.env.MONGO_URI;
  if (!mongoUrl) {
    throw new Error("MONGO_URI is not defined in environment variables");
  }

  // 3. If we are in the middle of connecting, return that promise
  if (!cached.promise) {
    const opts = {
      bufferCommands: false, // CRITICAL: Stop the 10000ms buffering error
      serverSelectionTimeoutMS: 5000, // Fail faster so you know there's an issue
    };

    cached.promise = mongoose.connect(mongoUrl, opts).then((mongoose) => {
      console.log("Connected to MongoDB (New Instance)");
      return mongoose;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null; // Reset the promise if it fails
    throw e;
  }

  return cached.conn;
}

export { connectToDatabase };
