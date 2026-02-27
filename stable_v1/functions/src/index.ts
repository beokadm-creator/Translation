import * as functions from "firebase-functions";
import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

// Initialize Firebase Admin
try {
  // Check if running in Cloud Functions environment where config is auto-populated
  if (process.env.FIREBASE_CONFIG) {
       admin.initializeApp();
       functions.logger.info("Initialized with FIREBASE_CONFIG");
  } else {
      // Local or fallback
      const serviceAccount = require("../service-account.json");
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        // If DB exists, it will be picked up. If not, this might be undefined or need manual set.
        // For now, let's NOT hardcode a broken URL.
        databaseURL: "https://translation-comm-default-rtdb.firebaseio.com" 
      });
      functions.logger.info("Initialized with service-account.json");
  }
} catch (error) {
  // Final Fallback: Just try default init (works in some emulators/cloud setups)
  try {
      admin.initializeApp();
      functions.logger.info("Initialized with default (empty) config");
  } catch(e) {
      console.error("Failed to initialize Admin SDK:", e);
  }
}

// Export functions
export { processAudio } from "./stt";
export { diagnoseSystem } from "./diagnose"; // New Diagnostic Tool
// export { translateNewSegment } from "./translate"; // DEPRECATED: Moved to inline processing in stt.ts
export { archiveSession } from "./archive";
export { purgeSession } from "./purge";

// Start writing functions
// https://firebase.google.com/docs/functions/typescript

export const helloWorld = onRequest((request, response) => {
  functions.logger.info("Hello logs!", {structuredData: true});
  response.send("Hello from Firebase!");
});
