// src/config/firebase.ts
import admin from "firebase-admin";

admin.initializeApp({
  credential: admin.credential.cert(
    require("../../firebase-service-account.json")
  )
});

export default admin;