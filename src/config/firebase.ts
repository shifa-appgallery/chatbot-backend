import { google } from "googleapis";

const KEY_FILE_PATH = "src/config/firebase.json";
const PROJECT_ID = "wefroth-3b0c9";

export const getAccessToken = async (): Promise<string> => {
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_FILE_PATH,
    scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
  });

  const client = await auth.getClient();
  const token = await client.getAccessToken();

  return token.token as string;
};

export { PROJECT_ID };