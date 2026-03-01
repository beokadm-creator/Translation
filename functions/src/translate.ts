import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import { TranslationServiceClient } from "@google-cloud/translate";

// Hack to fix "Missing expected firebase config value databaseURL" during local analysis
try {
  const config = JSON.parse(process.env.FIREBASE_CONFIG || "{}");
  if (!config.databaseURL) {
    config.databaseURL = "https://translation-comm-default-rtdb.firebaseio.com";
    process.env.FIREBASE_CONFIG = JSON.stringify(config);
  }
} catch {
  // Ignore error if JSON parse fails, fallback to hard overwrite if needed or do nothing
  if (!process.env.FIREBASE_CONFIG) {
    process.env.FIREBASE_CONFIG = JSON.stringify({
      databaseURL: "https://translation-comm-default-rtdb.firebaseio.com",
      storageBucket: "translation-comm.firebasestorage.app",
      projectId: "translation-comm"
    });
  }
}

const translationClient = new TranslationServiceClient();

export const translateNewSegment = functions.database
  .ref("/sessions/{projectId}/stream/{pushId}")
  .onWrite(async (change: functions.Change<functions.database.DataSnapshot>, context: functions.EventContext) => {
    // Only trigger on create or update
    if (!change.after.exists()) return null;

    const val = change.after.val();
    const projectId = context.params.projectId;
    const pushId = context.params.pushId;

    // Avoid infinite loops: Only translate "original" or specific source lang
    if (val.lang !== "original") {
      return null;
    }

    if (!val.text) return null;

    try {
      // Fetch project settings to get target languages
      const projectDoc = await admin.firestore().collection("projects").doc(projectId).get();
      const settings = projectDoc.data()?.settings;
      const targetLangs = settings?.targetLangs || ["ko", "ja", "zh"];
      const glossaryId = settings?.glossaryId; 

      const gcpProjectId = process.env.GCLOUD_PROJECT || "translation-comm";
      const location = "us-central1";

      await Promise.all(
        targetLangs.map(async (targetLang: string) => {
          let translatedText = "";
          
          try {
            const request: Record<string, unknown> = {
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
          } catch (tErr) {
            console.error(`Translation failed for ${targetLang}:`, tErr);
            return; 
          }

          if (!translatedText) return;

          await admin.database()
            .ref(`/sessions/${projectId}/stream/${pushId}/${targetLang}`)
            .set({
              text: translatedText,
              timestamp: Date.now(),
              isFinal: val.isFinal
            });
        })
      );

      return true;
    } catch (error) {
      console.error("Translation Error:", error);
      return false;
    }
  });
