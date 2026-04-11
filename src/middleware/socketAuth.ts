import jwt from "jsonwebtoken";
import { User } from "../models/mysql/User";
import { AuthenticatedSocket } from "../types/AuthenticatedSocket";

interface DecodedToken {
  id?: number;
  email?: string;
  iat: number;
  exp: number;
}

export const socketAuth = async (
  socket: AuthenticatedSocket,
  next: (err?: Error) => void
) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("Authentication error: token missing"));
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET as string
    ) as DecodedToken;

    let user = null;

    if (decoded.id) {
      user = await User.findOne({ where: { id: decoded.id } });
    }

    if (!user && decoded.email) {
      user = await User.findOne({ where: { email: decoded.email } });
    }

    if (!user) {
      return next(new Error("User not found"));
    }

    socket.user = {
      _id: String(user.id),
      name: `${user.first_name} ${user.last_name}`
    };

    console.log("Socket authenticated user:", socket.user);

    next();
  } catch (err: any) {
    console.error("Socket auth error:", err?.message);

    if (err.name === "TokenExpiredError") {
      return next(new Error("Token expired"));
    }

    return next(new Error("Invalid token"));
  }
};