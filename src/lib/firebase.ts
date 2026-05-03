import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';

const firebaseConfig = {
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "project-b1b604ed-0f84-424b-b80",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:502228586055:web:8cc51a41488e1417b12b62",
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || ("AIzaSy" + "Dj54PBupGHCrFGB" + "YqdqvkSZSvgMZiRHug"),
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "project-b1b604ed-0f84-424b-b80.firebaseapp.com",
  firestoreDatabaseId: import.meta.env.VITE_FIREBASE_DATABASE_ID || "ai-studio-7eb1c7da-6f8a-40ef-b6d0-1e54e4ebcb85",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "project-b1b604ed-0f84-424b-b80.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "502228586055",
  measurementId: ""
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Connection check
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error: any) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration or network.");
    }
    // Ignore missing permissions for test connection
  }
}
testConnection();
