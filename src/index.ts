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
import {initTeamUsersModel} from "./models/mysql/TeamUsers"

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api", apiRoutes);

const server = http.createServer(app);

const io = new Server(server, {
  cors: { 
    origin: "*",
    credentials : true
   }
});

app.set("io", io); 

io.use((socket: AuthenticatedSocket, next) => {
  const userId = socket.handshake.auth.userId;

  console.log("Incoming userId:", userId);

  if (!userId) return next(new Error("invalid user id"));

  socket.user = { _id: userId };

  next();
});

io.on("connection", (socket: AuthenticatedSocket) => {
  console.log("User connected:", socket.user?._id);

  chatHandler(io, socket);
});

const PORT = process.env.PORT || 3000;

async function bootstrap() {
 try {
    await connectWithSSH();
    console.log(" DB ready");

    initUserModel();
    initTeamUsersModel();

    await connectDB();
    console.log("MongoDB connected");

    server.listen(PORT, () => {
      console.log(` Server running on port ${PORT}`);
    });

  }  catch (err) {
    console.error(" Startup failed:", err);
    process.exit(1);
  }
}

bootstrap();