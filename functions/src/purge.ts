import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";

export const purgeSession = functions
  .runWith({ timeoutSeconds: 60, memory: "512MB" })
  .https.onRequest(async (req, res) => {
    // CORS Handling
    const origin = req.headers.origin as string;
    const allowedOrigin = process.env.ALLOWED_ORIGIN || (functions.config()?.app?.allowed_origin as string) || "*";

    if (allowedOrigin === "*" || allowedOrigin === origin) {
      res.set("Access-Control-Allow-Origin", allowedOrigin === "*" ? "*" : origin);
    } else if (origin && (origin.endsWith(".web.app") || origin.endsWith(".firebaseapp.com") || origin.includes("localhost"))) {
      res.set("Access-Control-Allow-Origin", origin);
    } else {
      res.set("Access-Control-Allow-Origin", allowedOrigin);
    }

    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") { res.status(204).send(""); return; }

    try {
      const auth = (req.headers.authorization || "").toString();
      if (!auth.startsWith("Bearer ")) { res.status(401).send("Unauthorized"); return; }
      await admin.auth().verifyIdToken(auth.split("Bearer ")[1]);

      const projectId = (req.query.projectId || req.body.projectId || "").toString();
      if (projectId) {
        await admin.database().ref(`projects/${projectId}/stream`).remove();
        await admin.database().ref(`projects/${projectId}/state`).update({
          bufferText: "",
          bufferIds: []
        });
      }
      res.status(200).json({ success: true, target: projectId || "none" });

    } catch (e: unknown) {
      res.status(500).json({ success: false, error: (e instanceof Error ? e.message : "Internal Error") || "Internal Error" });
    }
  });

