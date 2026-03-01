"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.helloWorld = exports.purgeSession = exports.archiveSession = exports.diagnoseSystem = exports.triggerRemaster = exports.remasterSession = exports.onRefineRequest = exports.processAudio = void 0;
// Version: Quality Stable v1
var functions = require("firebase-functions");
var https_1 = require("firebase-functions/v2/https");
var admin = require("firebase-admin");
var service_account_json_1 = require("../service-account.json");
// Initialize Firebase Admin
try {
    // Check if running in Cloud Functions environment where config is auto-populated
    if (process.env.FIREBASE_CONFIG) {
        admin.initializeApp();
        functions.logger.info("Initialized with FIREBASE_CONFIG");
    }
    else {
        // Local or fallback - service account import must be at top level
        // This is handled by the top-level import below
        functions.logger.info("Using service account from file");
        admin.initializeApp({
            credential: admin.credential.cert(service_account_json_1.default),
            databaseURL: "https://translation-comm-default-rtdb.firebaseio.com"
        });
        functions.logger.info("Initialized with service-account.json");
    }
}
catch (_a) {
    // Final Fallback: Just try default init (works in some emulators/cloud setups)
    try {
        admin.initializeApp();
        functions.logger.info("Initialized with default (empty) config");
    }
    catch (e) {
        console.error("Failed to initialize Admin SDK:", e);
    }
}
// Export functions
var stt_1 = require("./stt");
Object.defineProperty(exports, "processAudio", { enumerable: true, get: function () { return stt_1.processAudio; } });
Object.defineProperty(exports, "onRefineRequest", { enumerable: true, get: function () { return stt_1.onRefineRequest; } });
Object.defineProperty(exports, "remasterSession", { enumerable: true, get: function () { return stt_1.remasterSession; } });
Object.defineProperty(exports, "triggerRemaster", { enumerable: true, get: function () { return stt_1.triggerRemaster; } });
var diagnose_1 = require("./diagnose"); // New Diagnostic Tool
Object.defineProperty(exports, "diagnoseSystem", { enumerable: true, get: function () { return diagnose_1.diagnoseSystem; } });
// export { translateNewSegment } from "./translate"; // DEPRECATED: Moved to inline processing in stt.ts
var archive_1 = require("./archive");
Object.defineProperty(exports, "archiveSession", { enumerable: true, get: function () { return archive_1.archiveSession; } });
var purge_1 = require("./purge");
Object.defineProperty(exports, "purgeSession", { enumerable: true, get: function () { return purge_1.purgeSession; } });
// Start writing functions
// https://firebase.google.com/docs/functions/typescript
exports.helloWorld = (0, https_1.onRequest)(function (request, response) {
    functions.logger.info("Hello logs!", { structuredData: true });
    response.send("Hello from Firebase!");
});
