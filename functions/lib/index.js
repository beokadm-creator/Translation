"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.helloWorld = exports.purgeSession = exports.archiveSession = exports.diagnoseSystem = exports.triggerRemaster = exports.remasterSession = exports.onRefineRequest = exports.processAudio = void 0;
// Version: Quality Stable v1
const functions = __importStar(require("firebase-functions"));
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
// Initialize Firebase Admin
try {
    // Check if running in Cloud Functions environment where config is auto-populated
    if (process.env.FIREBASE_CONFIG) {
        admin.initializeApp();
        functions.logger.info("Initialized with FIREBASE_CONFIG");
    }
    else {
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
}
catch (error) {
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
exports.helloWorld = (0, https_1.onRequest)((request, response) => {
    functions.logger.info("Hello logs!", { structuredData: true });
    response.send("Hello from Firebase!");
});
