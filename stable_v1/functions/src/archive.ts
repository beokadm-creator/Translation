import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import { verifyAuth } from "./middleware";
import cors from "cors";

const corsHandler = cors({ origin: true });

export const archiveSession = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    // 1. Auth Check
    await verifyAuth(req, res, async () => {
      const projectId = req.query.projectId as string;
      if (!projectId) {
        res.status(400).send("Missing projectId");
        return;
      }

      try {
        // 2. Fetch Data from RTDB
        const rtdbRef = admin.database().ref(`sessions/${projectId}/stream`);
        const snapshot = await rtdbRef.once('value');
        const data = snapshot.val();

        if (!data) {
          res.status(404).send("No session data found to archive.");
          return;
        }

        // 3. Transform Data for Firestore
        // We can store it as a single large document (if size < 1MB) or subcollection.
        // For transcripts, a subcollection is safer for scalability, but a single JSON blob 
        // is easier for simple "Export" if it's not huge.
        // Let's store as a subcollection 'segments' in Firestore.
        
        const firestoreBatch = admin.firestore().batch();
        const transcriptRef = admin.firestore().collection('transcripts').doc(projectId);
        
        // Set metadata
        firestoreBatch.set(transcriptRef, {
          archivedAt: admin.firestore.FieldValue.serverTimestamp(),
          projectId: projectId,
          sessionCount: Object.keys(data).length
        });

        // Add segments
        // Note: Firestore batch limit is 500 ops. If > 500 segments, need multiple batches.
        // For MVP, assuming < 500 segments or we just store the whole JSON blob in a Storage bucket?
        // Actually, storing the raw JSON in Firestore as a 'fullTranscript' field might be easier for small events.
        // Or better: Store the processed array in Firestore if it fits.
        // Let's try the subcollection approach with chunking.
        
        const segments = Object.entries(data).map(([key, val]: [string, any]) => ({
          id: key,
          ...val
        }));

        // Chunking for batch
        const chunkSize = 450; 
        for (let i = 0; i < segments.length; i += chunkSize) {
          const chunk = segments.slice(i, i + chunkSize);
          const batch = admin.firestore().batch();
          
          chunk.forEach((seg) => {
            const segRef = transcriptRef.collection('segments').doc(seg.id);
            batch.set(segRef, seg);
          });
          
          await batch.commit();
        }

        // 4. Update Project Status
        await admin.firestore().collection('projects').doc(projectId).update({
          status: 'ended'
        });

        // 5. (Optional) Cleanup RTDB? 
        // Maybe keep it for a while or delete it to save space.
        // await rtdbRef.remove(); 

        res.status(200).send({ success: true, message: "Session archived successfully" });

      } catch (error) {
        console.error("Archive Error:", error);
        res.status(500).send("Internal Server Error");
      }
    });
  });
});
