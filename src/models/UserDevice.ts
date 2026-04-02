import mongoose from "mongoose";

const userDeviceSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },

  fcmToken: {
    type: String,
    required: true
  },

  deviceType: {
    type: String,
    enum: ["android", "ios", "web"],
    default: "web"
  },

  isActive: {
    type: Boolean,
    default: true
  }

}, { timestamps: true });

export default mongoose.model("UserDevice", userDeviceSchema);