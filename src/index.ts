import express from "express";
import http from "http";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

import { Server } from "socket.io";

import { connectDB } from "./config/db";
import apiRoutes from "./routes/index.route";
import { chatHandler } from "./sockets/chatHandler";
import { AuthenticatedSocket } from "./types/AuthenticatedSocket";
import { connectWithSSH } from "./config/mysql";
import { initUserModel } from "./models/mysql/User";
import { initTeamUsersModel } from "./models/mysql/TeamUsers"

const app = express();
const corsOptions = {
  origin: '*',
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"], // Allowed HTTP methods
  allowedHeaders: ["Content-Type", "Authorization"], // Allowed headers
  credentials: true, // Allow cookies to be sent
};

app.use(cors(corsOptions));
app.use(express.json());

app.use("/api", apiRoutes);

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    credentials: true
  },
  transports: ["websocket", "polling"],
  perMessageDeflate: false
});

io.engine.on("connection_error", (err) => {
  console.log("🚨 ENGINE ERROR:", err);
});

app.set("io", io);

import { User } from "./models/mysql/User";
import { initTeamModel } from "./models/mysql/Teams";

io.use((socket, next) => {
  console.log("🔍 HANDSHAKE DEBUG START");
  console.log("AUTH:", socket.handshake.auth);
  console.log("QUERY:", socket.handshake.query);
  console.log("HEADERS:", socket.handshake.headers);
  console.log("🔍 HANDSHAKE DEBUG END");
  next();
});

io.use(async (socket: AuthenticatedSocket, next) => {
  try {
    const userId =
      socket.handshake.auth?.userId ||
      socket.handshake.query.userId;

    if (!userId) return next(new Error("invalid user id"));

    const user = await User.findByPk(userId);

    if (!user) return next(new Error("user not found"));

    socket.user = {
      _id: String(user.id),
      first_name: user.first_name,
      last_name: user.last_name,
      profile_picture: user.profile_picture
    };

    next();
  } catch (err) {
    next(new Error("authentication error"));
  }
});

io.on("connection", (socket: AuthenticatedSocket) => {
  console.log("✅ User connected:", socket.user?._id, socket.id);

  socket.on("disconnect", (reason) => {
    console.log("❌ DISCONNECT REASON:", reason);
  });

  socket.on("error", (err) => {
    console.error("🚨 SOCKET ERROR:", err);
  });


  chatHandler(io, socket);
});

const PORT = process.env.PORT || 3000;

async function bootstrap() {
  try {
    await connectWithSSH();
    console.log(" DB ready");

    initUserModel();
    initTeamUsersModel();
    initTeamModel();

    await connectDB();
    console.log("MongoDB connected");

    server.listen(PORT, () => {
      console.log(` Server running on port ${PORT}`);
    });

  } catch (err) {
    console.error(" Startup failed:", err);
    process.exit(1);
  }
}

bootstrap();