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
export { processAudio, onRefineRequest, verifyPipeline } from "./stt";
export { synthesizeSpeech } from "./tts";
export { diagnoseSystem } from "./diagnose"; // New Diagnostic Tool
export { archiveSession } from "./archive";
export { purgeSession } from "./purge";
