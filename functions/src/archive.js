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
exports.archiveSession = void 0;
var functions = require("firebase-functions/v1");
var admin = require("firebase-admin");
exports.archiveSession = functions.https.onRequest(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var authHeader, token, projectId, sessionId, projectRef, streamRef, transcriptRef, snapshot, streamData, activeSnap, error_1;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                res.set("Access-Control-Allow-Origin", "*");
                res.set("Access-Control-Allow-Methods", "POST");
                res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
                if (req.method === "OPTIONS") {
                    res.status(204).send("");
                    return [2 /*return*/];
                }
                _a.label = 1;
            case 1:
                _a.trys.push([1, 10, , 11]);
                authHeader = req.headers.authorization;
                if (!authHeader || !authHeader.startsWith("Bearer ")) {
                    res.status(401).send("Unauthorized");
                    return [2 /*return*/];
                }
                token = authHeader.split("Bearer ")[1];
                return [4 /*yield*/, admin.auth().verifyIdToken(token)];
            case 2:
                _a.sent();
                projectId = req.body.projectId || req.query.projectId;
                sessionId = req.body.sessionId || req.query.sessionId;
                if (!projectId || !sessionId) {
                    res.status(400).send({ error: "Missing projectId or sessionId" });
                    return [2 /*return*/];
                }
                projectRef = admin.database().ref("projects/".concat(projectId));
                streamRef = projectRef.child("stream");
                transcriptRef = projectRef.child("sessions/".concat(sessionId, "/transcript"));
                return [4 /*yield*/, streamRef.get()];
            case 3:
                snapshot = _a.sent();
                if (!snapshot.exists()) {
                    res.status(200).send({ message: "No stream data to archive." });
                    return [2 /*return*/];
                }
                streamData = snapshot.val();
                // 2. Save to Session Transcript
                return [4 /*yield*/, transcriptRef.set(streamData)];
            case 4:
                // 2. Save to Session Transcript
                _a.sent();
                // 3. Clear Stream & State
                return [4 /*yield*/, streamRef.remove()];
            case 5:
                // 3. Clear Stream & State
                _a.sent();
                return [4 /*yield*/, projectRef.child("state").set({
                        bufferText: "",
                        bufferIds: [],
                        lastGeminiTime: Date.now()
                    })];
            case 6:
                _a.sent();
                return [4 /*yield*/, projectRef.child("activeSessionId").get()];
            case 7:
                activeSnap = _a.sent();
                if (!(activeSnap.exists() && activeSnap.val() === sessionId)) return [3 /*break*/, 9];
                return [4 /*yield*/, projectRef.child("activeSessionId").remove()];
            case 8:
                _a.sent();
                _a.label = 9;
            case 9:
                functions.logger.info("Archived session ".concat(sessionId, " for project ").concat(projectId));
                res.status(200).send({ success: true, message: "Archived and cleared." });
                return [3 /*break*/, 11];
            case 10:
                error_1 = _a.sent();
                functions.logger.error("Archive Error", error_1);
                res.status(500).send({ error: error_1 instanceof Error ? error_1.message : "Unknown error" });
                return [3 /*break*/, 11];
            case 11: return [2 /*return*/];
        }
    });
}); });
