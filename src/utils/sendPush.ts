import axios from "axios";
import { getAccessToken, PROJECT_ID } from "../config/firebase";

export const sendNotification = async (
  deviceToken: string,
  title: string,
  body: string,
  roomId: string,
  unreadCount?: number
) => {
  try {
    const accessToken = await getAccessToken();

    console.log(`${process.env.FRONTEND_URL}?roomId=${roomId}`);
    console.log("PROJECT_ID:", PROJECT_ID);
    console.log("Sending to token:", deviceToken);
    const response = await axios.post(
      `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`,
      {
        message: {
          token: deviceToken,

          notification: {
            title,
            body,
          },

          data: {
            title,
            body,
            roomId: roomId || "",
            type: "chat",
            unreadCount: String(unreadCount),
          },

          webpush: {
            fcmOptions: {
              link: `${process.env.FRONTEND_URL}?roomId=${roomId}`,
            },
          },

          android: {
            priority: "high",
            notification: {
              tag: `${roomId}_${Date.now()}`,
            },
          },

          apns: {
            headers: {
              "apns-collapse-id": `${roomId}_${Date.now()}`,
              "apns-priority": "10",
            },
            payload: {
              aps: {
                alert: {
                  title,
                  body,
                },
                badge: 1,
                sound: "default",
              },
            },
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("FCM Success:", response.data);
    return response.data;
  } catch (error: any) {

    const errorCode =
      error.response?.data?.error?.details?.[0]?.errorCode;

    if (errorCode === "UNREGISTERED") {
      console.log("FCM token is unregistered.");
      return;
    }

    console.error("========== FCM ERROR ==========");
    console.error("Status:", error.response?.status);
    console.error("Status Text:", error.response?.statusText);
    console.dir(error.response?.data, { depth: null });
    console.error("Message:", error.message);
    console.error("================================");

    throw error;
  }
}