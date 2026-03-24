import express from "express";
import http from "http";
import cors from "cors";
import dotenv from "dotenv";
import { Server } from "socket.io";

import { connectDB } from "./config/db";
import apiRoutes from "./routes/index.route";
import { chatHandler } from "./sockets/chatHandler";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

connectDB();

app.use("/api", apiRoutes);

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5500", "http://127.0.0.1:5500"],
    methods: ["GET", "POST"],
  },
});

// Auth middleware
io.use((socket, next) => {
  const userId = socket.handshake.auth.userId;

   console.log("Incoming userId:", userId);
  if (!userId) return next(new Error("invalid user id"));
  (socket as any).user = { id: userId };
  next();
});

// Socket connection
io.on("connection", (socket) => {
  chatHandler(io, socket);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));