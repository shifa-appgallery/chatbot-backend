import axios from "axios";
import { getAccessToken, PROJECT_ID } from "../config/firebase";

export const sendNotification = async (
  deviceToken: string,
  title: string,
  body: string,
  roomId?: string
) => {
  const accessToken = await getAccessToken();

  await axios.post(
    `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`,
    {
      message: {
        token: deviceToken,

        notification: {
          title,
          body,
        },

        data: {
          roomId: roomId || "",
          type: "chat",
        },

        webpush: {
          fcmOptions: {
            link: `${process.env.FRONTEND_URL}?roomId=${roomId}`,
          },
        },

        android: {
          // notification: {
          //   tag: roomId || Date.now().toString(),
          // },
          data: {
            title: title,
            body: body,
            roomId: roomId || "",
            type: "chat"
          }
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