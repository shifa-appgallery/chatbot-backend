import axios from "axios";
import { getAccessToken, PROJECT_ID } from "../config/firebase";

export const sendNotification = async (
  deviceToken: string,
  title: string,
  body: string,
  roomId: string,
  unreadCount?: number
) => {
  const accessToken = await getAccessToken();

  await axios.post(
    `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`,
    {
      message: {
        token: deviceToken,

        // notification: {
        //   title,
        //   body
        // },

        data: {
          title,
          body,
          roomId: roomId || "",
          type: "chat",
          unreadCount: String(unreadCount)
        },

        webpush: {
          fcmOptions: {
            link: `${process.env.FRONTEND_URL}?roomId=${roomId}`,
          },
        },

        android: {
          priority: "high",
          // notification: {
          //   tag: roomId || Date.now().toString(),
          // },

        },

        apns: {
          headers: {
            "apns-collapse-id": roomId || Date.now().toString(),
            "apns-priority": "10",
          },
          payload: {
            aps: {
              alert: {
                title,
                body,
              },
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
};