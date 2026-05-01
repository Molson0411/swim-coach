import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  projectId: "swimcoach-e7ddf",
  appId: "1:833013843721:web:d7021aac45f8072f4e75d8",
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: "swimcoach-e7ddf.firebaseapp.com",
  firestoreDatabaseId: "(default)",
  storageBucket: "swimcoach-e7ddf.firebasestorage.app",
  messagingSenderId: "833013843721",
  measurementId: "G-SYHBXVMDFR"
};

// 初始化 Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export { app, db, auth };
