import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";

export const purgeSession = functions
  .runWith({ timeoutSeconds: 60, memory: "512MB" })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    try {
      const auth = (req.headers.authorization || "").toString();
      if (!auth.startsWith("Bearer ")) { res.status(401).send("Unauthorized"); return; }
      await admin.auth().verifyIdToken(auth.split("Bearer ")[1]);

      const projectId = (req.query.projectId || "").toString();
      if (projectId) {
        await admin.database().ref(`sessions/${projectId}`).remove();
      } else {
        await admin.database().ref(`sessions`).remove();
      }
      res.status(200).json({ success: true, target: projectId || "all" });
    } catch (e: unknown) {
      res.status(500).json({ success: false, error: (e instanceof Error ? e.message : "Internal Error") || "Internal Error" });
    }
  });

