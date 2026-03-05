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
exports.archiveSession = void 0;
const functions = __importStar(require("firebase-functions/v1"));
const admin = __importStar(require("firebase-admin"));
exports.archiveSession = functions.https.onRequest(async (req, res) => {
    var _a, _b;
    // CORS Handling
    const origin = req.headers.origin;
    const allowedOrigin = process.env.ALLOWED_ORIGIN || ((_b = (_a = functions.config()) === null || _a === void 0 ? void 0 : _a.app) === null || _b === void 0 ? void 0 : _b.allowed_origin) || "*";
    if (allowedOrigin === "*" || allowedOrigin === origin) {
        res.set("Access-Control-Allow-Origin", allowedOrigin === "*" ? "*" : origin);
    }
    else if (origin && (origin.endsWith(".web.app") || origin.endsWith(".firebaseapp.com") || origin.includes("localhost"))) {
        res.set("Access-Control-Allow-Origin", origin);
    }
    else {
        res.set("Access-Control-Allow-Origin", allowedOrigin);
    }
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            res.status(401).send("Unauthorized");
            return;
        }
        const token = authHeader.split("Bearer ")[1];
        await admin.auth().verifyIdToken(token);
        const projectId = req.body.projectId || req.query.projectId;
        const sessionId = req.body.sessionId || req.query.sessionId;
        if (!projectId || !sessionId) {
            res.status(400).send({ error: "Missing projectId or sessionId" });
            return;
        }
        const projectRef = admin.database().ref(`projects/${projectId}`);
        const streamRef = projectRef.child("stream");
        const transcriptRef = projectRef.child(`sessions/${sessionId}/transcript`);
        // 1. Get Stream Data
        const snapshot = await streamRef.get();
        if (!snapshot.exists()) {
            res.status(200).send({ message: "No stream data to archive." });
            return;
        }
        const streamData = snapshot.val();
        // 2. Save to Session Transcript
        await transcriptRef.set(streamData);
        // 3. Clear Stream & State
        await streamRef.remove();
        await projectRef.child("state").set({
            bufferText: "",
            bufferIds: [],
            lastGeminiTime: Date.now()
        });
        // 4. Reset Active Session if it matches
        const activeSnap = await projectRef.child("activeSessionId").get();
        if (activeSnap.exists() && activeSnap.val() === sessionId) {
            await projectRef.child("activeSessionId").remove();
        }
        functions.logger.info(`Archived session ${sessionId} for project ${projectId}`);
        res.status(200).send({ success: true, message: "Archived and cleared." });
    }
    catch (error) {
        functions.logger.error("Archive Error", error);
        res.status(500).send({ error: error instanceof Error ? error.message : "Unknown error" });
    }
});
