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
exports.diagnoseSystem = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
exports.diagnoseSystem = (0, https_1.onRequest)(async (req, res) => {
    // CORS
    res.set('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    const report = {
        timestamp: new Date().toISOString(),
        env: process.env.FUNCTIONS_EMULATOR ? 'emulator' : 'cloud',
        projectId: process.env.GCLOUD_PROJECT || 'unknown',
        admin: {
            initialized: !!admin.apps.length,
            databaseURL: admin.app().options.databaseURL || 'undefined',
            storageBucket: admin.app().options.storageBucket || 'undefined',
            projectId: admin.app().options.projectId || 'undefined'
        },
        tests: {}
    };
    try {
        // Test 1: RTDB Write
        const dbRef = admin.database().ref('_diagnostics/write_test');
        await dbRef.set({
            status: 'ok',
            time: Date.now()
        });
        report.tests.rtdbWrite = 'SUCCESS';
        // Test 2: RTDB Read
        const snap = await dbRef.once('value');
        const val = snap.val();
        report.tests.rtdbRead = val?.status === 'ok' ? 'SUCCESS' : 'FAILED_CONTENT_MISMATCH';
    }
    catch (e) {
        report.tests.rtdb = `FAILED: ${e instanceof Error ? e.message : 'Unknown error'}`;
    }
    try {
        // Test 3: Firestore Write (Optional, just to check permissions)
        await admin.firestore().collection('_diagnostics').doc('test').set({
            status: 'ok',
            time: Date.now()
        });
        report.tests.firestore = 'SUCCESS';
    }
    catch (e) {
        report.tests.firestore = `FAILED: ${e instanceof Error ? e.message : 'Unknown error'}`;
    }
    res.json(report);
});
