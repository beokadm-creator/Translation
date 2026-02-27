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
exports.translateNewSegment = void 0;
const functions = __importStar(require("firebase-functions/v1"));
const admin = __importStar(require("firebase-admin"));
const translate_1 = require("@google-cloud/translate");
// Hack to fix "Missing expected firebase config value databaseURL" during local analysis
try {
    const config = JSON.parse(process.env.FIREBASE_CONFIG || "{}");
    if (!config.databaseURL) {
        config.databaseURL = "https://translation-comm-default-rtdb.firebaseio.com";
        process.env.FIREBASE_CONFIG = JSON.stringify(config);
    }
}
catch (e) {
    // Ignore error if JSON parse fails, fallback to hard overwrite if needed or do nothing
    if (!process.env.FIREBASE_CONFIG) {
        process.env.FIREBASE_CONFIG = JSON.stringify({
            databaseURL: "https://translation-comm-default-rtdb.firebaseio.com",
            storageBucket: "translation-comm.firebasestorage.app",
            projectId: "translation-comm"
        });
    }
}
const translationClient = new translate_1.TranslationServiceClient();
exports.translateNewSegment = functions.database
    .ref("/sessions/{projectId}/stream/{pushId}")
    .onWrite(async (change, context) => {
    var _a;
    // Only trigger on create or update
    if (!change.after.exists())
        return null;
    const val = change.after.val();
    const projectId = context.params.projectId;
    const pushId = context.params.pushId;
    // Avoid infinite loops: Only translate "original" or specific source lang
    if (val.lang !== "original") {
        return null;
    }
    if (!val.text)
        return null;
    try {
        // Fetch project settings to get target languages
        const projectDoc = await admin.firestore().collection("projects").doc(projectId).get();
        const settings = (_a = projectDoc.data()) === null || _a === void 0 ? void 0 : _a.settings;
        const targetLangs = (settings === null || settings === void 0 ? void 0 : settings.targetLangs) || ["ko", "ja", "zh"];
        const glossaryId = settings === null || settings === void 0 ? void 0 : settings.glossaryId;
        const gcpProjectId = process.env.GCLOUD_PROJECT || "translation-comm";
        const location = "us-central1";
        await Promise.all(targetLangs.map(async (targetLang) => {
            let translatedText = "";
            try {
                const request = {
                    parent: `projects/${gcpProjectId}/locations/${location}`,
                    contents: [val.text],
                    mimeType: "text/plain",
                    sourceLanguageCode: "en-US",
                    targetLanguageCode: targetLang,
                };
                if (glossaryId) {
                    request.glossaryConfig = {
                        glossary: `projects/${gcpProjectId}/locations/${location}/glossaries/${glossaryId}`,
                    };
                }
                const [response] = await translationClient.translateText(request);
                if (response.translations && response.translations.length > 0) {
                    translatedText = response.translations[0].translatedText || "";
                }
            }
            catch (tErr) {
                console.error(`Translation failed for ${targetLang}:`, tErr);
                return;
            }
            if (!translatedText)
                return;
            await admin.database()
                .ref(`/sessions/${projectId}/stream/${pushId}/${targetLang}`)
                .set({
                text: translatedText,
                timestamp: Date.now(),
                isFinal: val.isFinal
            });
        }));
        return true;
    }
    catch (error) {
        console.error("Translation Error:", error);
        return false;
    }
});
