// src/utils/sendPush.ts
import admin from "../config/firebase";

export const sendPushNotification = async (
  token: string,
  title: string,
  body: string,
  data: any = {}
) => {
  try {
    await admin.messaging().send({
      token,
      notification: { title, body },
      data
    });
  } catch (err: any) {
    console.error("Push error:", err?.code);

    // ❗ REMOVE invalid tokens
    if (
      err.code === "messaging/registration-token-not-registered" ||
      err.code === "messaging/invalid-registration-token"
    ) {
      const UserDevice = require("../models/UserDevice").default;

      await UserDevice.updateOne(
        { fcmToken: token },
        { isActive: false }
      );
    }
  }
};