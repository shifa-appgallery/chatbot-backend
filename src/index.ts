import express from "express";
import http from "http";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config(); // Must be first

import { Server } from "socket.io";

import { connectDB } from "./config/db";
import apiRoutes from "./routes/index.route";
import { chatHandler } from "./sockets/chatHandler"
import { AuthenticatedSocket } from "./types/AuthenticatedSocket";
import { connectWithSSH } from "./config/mysql";
import { initUserModel } from "./models/mysql/User";


// ✅ Test MySQL connection
connectWithSSH()
  .then(() => {
    console.log("🚀 DB ready");

    // ✅ INIT MODELS HERE
    initUserModel();
  })
  .catch(err => console.error("❌ DB failed:", err));

const app = express();
app.use(cors());
app.use(express.json());

connectDB();

app.use("/api", apiRoutes);

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

// ✅ AUTH MIDDLEWARE
io.use((socket: AuthenticatedSocket, next) => {
  const userId = socket.handshake.auth.userId;

  console.log("Incoming userId:", userId);

  if (!userId) return next(new Error("invalid user id"));

  socket.user = { _id: userId };

  next();
});

// ✅ CONNECTION
io.on("connection", (socket:AuthenticatedSocket) => {
  console.log("User connected:", socket.user?._id);

  chatHandler(io, socket);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));