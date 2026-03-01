"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.translateNewSegment = void 0;
var functions = require("firebase-functions/v1");
var admin = require("firebase-admin");
var translate_1 = require("@google-cloud/translate");
// Hack to fix "Missing expected firebase config value databaseURL" during local analysis
try {
    var config = JSON.parse(process.env.FIREBASE_CONFIG || "{}");
    if (!config.databaseURL) {
        config.databaseURL = "https://translation-comm-default-rtdb.firebaseio.com";
        process.env.FIREBASE_CONFIG = JSON.stringify(config);
    }
}
catch (_a) {
    // Ignore error if JSON parse fails, fallback to hard overwrite if needed or do nothing
    if (!process.env.FIREBASE_CONFIG) {
        process.env.FIREBASE_CONFIG = JSON.stringify({
            databaseURL: "https://translation-comm-default-rtdb.firebaseio.com",
            storageBucket: "translation-comm.firebasestorage.app",
            projectId: "translation-comm"
        });
    }
}
var translationClient = new translate_1.TranslationServiceClient();
exports.translateNewSegment = functions.database
    .ref("/sessions/{projectId}/stream/{pushId}")
    .onWrite(function (change, context) { return __awaiter(void 0, void 0, void 0, function () {
    var val, projectId, pushId, projectDoc, settings, targetLangs, glossaryId_1, gcpProjectId_1, location_1, error_1;
    var _a;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                // Only trigger on create or update
                if (!change.after.exists())
                    return [2 /*return*/, null];
                val = change.after.val();
                projectId = context.params.projectId;
                pushId = context.params.pushId;
                // Avoid infinite loops: Only translate "original" or specific source lang
                if (val.lang !== "original") {
                    return [2 /*return*/, null];
                }
                if (!val.text)
                    return [2 /*return*/, null];
                _b.label = 1;
            case 1:
                _b.trys.push([1, 4, , 5]);
                return [4 /*yield*/, admin.firestore().collection("projects").doc(projectId).get()];
            case 2:
                projectDoc = _b.sent();
                settings = (_a = projectDoc.data()) === null || _a === void 0 ? void 0 : _a.settings;
                targetLangs = (settings === null || settings === void 0 ? void 0 : settings.targetLangs) || ["ko", "ja", "zh"];
                glossaryId_1 = settings === null || settings === void 0 ? void 0 : settings.glossaryId;
                gcpProjectId_1 = process.env.GCLOUD_PROJECT || "translation-comm";
                location_1 = "us-central1";
                return [4 /*yield*/, Promise.all(targetLangs.map(function (targetLang) { return __awaiter(void 0, void 0, void 0, function () {
                        var translatedText, request, response, tErr_1;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    translatedText = "";
                                    _a.label = 1;
                                case 1:
                                    _a.trys.push([1, 3, , 4]);
                                    request = {
                                        parent: "projects/".concat(gcpProjectId_1, "/locations/").concat(location_1),
                                        contents: [val.text],
                                        mimeType: "text/plain",
                                        sourceLanguageCode: "en-US",
                                        targetLanguageCode: targetLang,
                                    };
                                    if (glossaryId_1) {
                                        request.glossaryConfig = {
                                            glossary: "projects/".concat(gcpProjectId_1, "/locations/").concat(location_1, "/glossaries/").concat(glossaryId_1),
                                        };
                                    }
                                    return [4 /*yield*/, translationClient.translateText(request)];
                                case 2:
                                    response = (_a.sent())[0];
                                    if (response.translations && response.translations.length > 0) {
                                        translatedText = response.translations[0].translatedText || "";
                                    }
                                    return [3 /*break*/, 4];
                                case 3:
                                    tErr_1 = _a.sent();
                                    console.error("Translation failed for ".concat(targetLang, ":"), tErr_1);
                                    return [2 /*return*/];
                                case 4:
                                    if (!translatedText)
                                        return [2 /*return*/];
                                    return [4 /*yield*/, admin.database()
                                            .ref("/sessions/".concat(projectId, "/stream/").concat(pushId, "/").concat(targetLang))
                                            .set({
                                            text: translatedText,
                                            timestamp: Date.now(),
                                            isFinal: val.isFinal
                                        })];
                                case 5:
                                    _a.sent();
                                    return [2 /*return*/];
                            }
                        });
                    }); }))];
            case 3:
                _b.sent();
                return [2 /*return*/, true];
            case 4:
                error_1 = _b.sent();
                console.error("Translation Error:", error_1);
                return [2 /*return*/, false];
            case 5: return [2 /*return*/];
        }
    });
}); });
