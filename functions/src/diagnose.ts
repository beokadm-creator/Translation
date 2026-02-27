import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

export const diagnoseSystem = onRequest(async (req, res) => {
    // CORS
    res.set('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }

    const report: any = {
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

    } catch (e: any) {
        report.tests.rtdb = `FAILED: ${e.message}`;
    }

    try {
        // Test 3: Firestore Write (Optional, just to check permissions)
        await admin.firestore().collection('_diagnostics').doc('test').set({
            status: 'ok',
            time: Date.now()
        });
        report.tests.firestore = 'SUCCESS';
    } catch (e: any) {
        report.tests.firestore = `FAILED: ${e.message}`;
    }

    res.json(report);
});
