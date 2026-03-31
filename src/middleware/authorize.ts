// src/middleware/auth.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { User } from "../models/mysql/User";
import { Op } from "sequelize";

export interface AuthRequest extends Request {
  user?: {
    id: number;
    email: string;
    name: string;
    first_name: string;
    last_name: string;
    profile_picture: string
  };
}

export const authorize = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // ✅ Read token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: "Authorization header missing" });
    }

    const token = authHeader.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Token missing" });
    // ✅ Decode JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "") as { id?: number; email: string };

    // ✅ Get user either from decoded id or email
    let user: User | null = null;
    if (decoded.id) {
      user = await User.findOne({ where: { id: decoded.id } });
    }
    if (!user && decoded.email) {
      user = await User.findOne({ where: { email: decoded.email } });
    }

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    // ✅ Optional: if frontend sends email header, verify it matches
    const emailHeader = req.headers.email as string;
    if (emailHeader && emailHeader !== user.email) {
      return res.status(401).json({ error: "Email mismatch" });
    }

    // ✅ Attach user to request
    req.user = {
      id: user.id,
      email: user.email,
      name: `${user.first_name} ${user.last_name}`,
      first_name: user.first_name,
      last_name: user.last_name,
      profile_picture: user.profile_picture,
    };

    next();
  } catch (err) {
    console.error("Auth error:", err);
    return res.status(401).json({ error: "Invalid token" });
  }
};