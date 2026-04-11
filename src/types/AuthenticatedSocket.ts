import { Socket } from "socket.io";

export interface AuthenticatedSocket extends Socket {
  user?: {
    _id: string;
    name: string;
  };
}