import axios from "axios";
import { getAccessToken, PROJECT_ID } from "../config/firebase";

export const sendNotification = async (
  deviceToken: string,
  title: string,
  body: string
) => {
  const accessToken = await getAccessToken();

  await axios.post(
    `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`,
    {
      message: {
        token: deviceToken,
        notification: { title, body },
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