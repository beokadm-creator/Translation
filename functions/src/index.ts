// Version: Quality Stable v1
import * as functions from "firebase-functions";
import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
// Initialize Firebase Admin
// Cloud Functions auto-initialize correctly. 
// For local emulators, no special config is needed if firebase-tools is logged in.
if (!admin.apps.length) {
  admin.initializeApp();
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
  functions.logger.info("Hello logs!", { structuredData: true });
  response.send("Hello from Firebase!");
});
