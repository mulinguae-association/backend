import dotenv from "dotenv"; // Move dotenv import to the top
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import routes from "./routes/index.js";
import { connectToDatabase } from "./db/db.js";
import createAdminUser from "./utils/createAdminUser.js";
import cookieParser from "cookie-parser";
import compression from "compression";
dotenv.config(); // Load environment variables from .env

import http from "http";

import { Server } from "socket.io";
import {
  addOnlineUser,
  removeOnlineUserBySocket,
} from "./utils/onlineUsers.js";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  },
});

const PORT = process.env.PORT || 5000;
app.use(bodyParser.json());
app.use(
  cors({
    credentials: true,
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
  }),
);

app.use(express.json());
app.use(compression());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
//middleware

// Connect to MongoDB
connectToDatabase()
  .then(() => {
    console.log("Connected to MongoDB");
    createAdminUser()
      .then(() => console.log("Predefined user created successfully"))
      .catch((error) => {
        console.error("Error creating predefined user:", error);
      });
  })
  .catch((error) => {
    console.error("MongoDB connection error:", error);
    console.error("MongoDB connection error:", error);
  });

// Socket.IO connection handler
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  // Expect the client to emit an event with their userId after connecting
  socket.on("register", (userId) => {
    if (userId) {
      addOnlineUser(userId, socket.id);
      socket.userId = userId; // Attach for easy reference
    }
  });
  socket.on("disconnect", () => {
    removeOnlineUserBySocket(socket.id);
    console.log("User disconnected:", socket.id);
  });
});

export { io };

// Root route for backend status
app.get("/", (req, res) => {
  res.send("Mulingua Backend is running!");
});

app.use(async (req, res, next) => {
  if (req.originalUrl.startsWith("/api")) {
    try {
      // This ensures connection is ready before the route runs
      await connectToDatabase();
      next();
    } catch (error) {
      console.error("Database connection failed:", error);
      return res
        .status(503)
        .json({ error: "Service Unavailable: Database Connection Error" });
    }
  } else {
    next();
  }
});

app.use("/uploads", express.static("uploads"));
app.use("/api", routes);

if (!process.env.VERCEL) {
  server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
}

export default app;
