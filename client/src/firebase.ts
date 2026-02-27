import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyAc52CFyXU3BxI-yrORBb5asxsH5EEFnnU",
  authDomain: "translation-comm.firebaseapp.com",
  projectId: "translation-comm",
  storageBucket: "translation-comm.firebasestorage.app",
  messagingSenderId: "485369200558",
  appId: "1:485369200558:web:1950dea22543d266b2923f",
  measurementId: "G-BJS1NMLHC4",
  databaseURL: "https://translation-comm-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const rtdb = getDatabase(app);
export const auth = getAuth(app);
export const functions = getFunctions(app);
export const storage = getStorage(app);

export default app;
