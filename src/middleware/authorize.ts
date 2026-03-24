import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export const authorize = (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ error: "Authorization header missing" });
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
      return res.status(401).json({ error: "Token missing" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || "");

    // attach user to request
    (req as any).user = decoded;

    next(); // ✅ move to controller
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
};