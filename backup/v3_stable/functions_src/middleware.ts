import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

// Using Response from express since firebase-functions v2 wraps express types but sometimes has type issues
import { Response } from "express";

export const verifyAuth = async (req: functions.https.Request, res: Response, next: () => void) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).send("Unauthorized: No token provided");
    return;
  }

  const idToken = authHeader.split("Bearer ")[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    (req as any).user = decodedToken;
    next();
  } catch (error) {
    console.error("Error verifying auth token:", error);
    res.status(403).send("Unauthorized: Invalid token");
  }
};
