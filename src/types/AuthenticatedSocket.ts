import { Socket } from "socket.io";

export interface AuthenticatedSocket extends Socket {
  user?: {
    _id: string;
    first_name: string;
    last_name: string;
    profile_picture?: string | null;
  };
}