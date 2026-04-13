import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";

export const archiveSession = functions.https.onRequest(async (req, res) => {
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
      lastFlushTime: Date.now()
    });

    // 4. Reset Active Session if it matches
    const activeSnap = await projectRef.child("activeSessionId").get();
    if (activeSnap.exists() && activeSnap.val() === sessionId) {
      await projectRef.child("activeSessionId").remove();
    }

    functions.logger.info(`Archived session ${sessionId} for project ${projectId}`);
    res.status(200).send({ success: true, message: "Archived and cleared." });

  } catch (error: unknown) {
    functions.logger.error("Archive Error", error);
    res.status(500).send({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});
