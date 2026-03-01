// Version: Quality Stable v1
import * as functions from "firebase-functions";
import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import serviceAccount from "../service-account.json";

// Initialize Firebase Admin
try {
  // Check if running in Cloud Functions environment where config is auto-populated
  if (process.env.FIREBASE_CONFIG) {
       admin.initializeApp();
       functions.logger.info("Initialized with FIREBASE_CONFIG");
  } else {
      // Local or fallback - service account import must be at top level
      // This is handled by the top-level import below
      functions.logger.info("Using service account from file");
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount as any),
        databaseURL: "https://translation-comm-default-rtdb.firebaseio.com"
      });
      functions.logger.info("Initialized with service-account.json");
  }
} catch {
  // Final Fallback: Just try default init (works in some emulators/cloud setups)
  try {
      admin.initializeApp();
      functions.logger.info("Initialized with default (empty) config");
  } catch(e) {
      console.error("Failed to initialize Admin SDK:", e);
  }
}

// Export functions
export { processAudio, onRefineRequest, remasterSession, triggerRemaster } from "./stt";
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
