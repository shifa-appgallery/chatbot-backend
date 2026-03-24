// src/scripts/createSampleData.ts

import mongoose from "mongoose";
import dotenv from "dotenv";

import User from "../models/User";
import Chat from "../models/ChatMessage";


dotenv.config();

async function createSampleData() {
  try {
    await mongoose.connect(process.env.MONGO_URI || "");

    // Create user
    const user = new User({ name: "Alice", email: "alice@example.com" });
    await user.save();
    console.log("User created:", user);

    // Create chat with this user as participant
    const chat = new Chat({ participants: [user._id], messages: [] });
    await chat.save();
    console.log("Chat created:", chat);

    await mongoose.disconnect();
  } catch (error) {
    console.error("Error creating sample data:", error);
    process.exit(1);
  }
}

createSampleData();