import { google } from "googleapis";

const PROJECT_ID = "wefroth-3b0c9";

export const getAccessToken = async (): Promise<string> => {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!);
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');

  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
  });

  const client = await auth.getClient();
  const token = await client.getAccessToken();

  return token?.token as string;
};

export { PROJECT_ID };