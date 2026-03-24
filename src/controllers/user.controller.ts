import { Request, Response } from "express";
import User from "../models/User";
import jwt from "jsonwebtoken";


export const loginWithToken = async (req: Request, res: Response) => {
  try {
    const decoded = (req as any).user;

    let user = await User.findOne({ email: decoded.other });

    if (!user) {
      user = new User({
        name: req.body.name,
        email: decoded.other,
      });
      await user.save();
    }
    const token = jwt.sign(
      {
        id: user._id,       // ✅ Use Mongo _id here
        email: user.email,
      },
      process.env.JWT_SECRET || "secret", // replace with your secret
      { expiresIn: "7d" }                 // optional
    );

    return res.json({
      message: "Token verified and user saved",
      user,
      token
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
};