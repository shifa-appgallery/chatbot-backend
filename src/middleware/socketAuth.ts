import { Socket } from "socket.io";
import jwt from "jsonwebtoken";

interface DecodedToken {
  id: string;
  name: string;
  email: string;
  iat: number;
  exp: number;
}

export const socketAuth = (socket: Socket, next: (err?: Error) => void) => {
  try {
    const token = socket.handshake.auth.token;

    if (!token) return next(new Error("Authentication error"));

    const decoded = jwt.verify(token, process.env.JWT_SECRET || "") as DecodedToken;
    (socket as any).user = decoded;
    next();

    console.log("decoded",decoded)
  } catch (err) {
    next(new Error("Invalid token"));
  }
};