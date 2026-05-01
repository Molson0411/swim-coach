import { FirebaseOptions, initializeApp } from 'firebase/app';
import {
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  User
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  setDoc,
  serverTimestamp,
  getDocFromServer
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config';

type FirebaseAppConfig = FirebaseOptions & {
  firestoreDatabaseId?: string;
};

const fallbackFirebaseConfig = firebaseConfig as FirebaseAppConfig;

function getEnvValue(key: string, fallback?: string) {
  const value = import.meta.env[key];
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }
  return value.trim();
}

function getFirebaseApiKey() {
  const value = getEnvValue('VITE_FIREBASE_API_KEY');
  if (!value || value === 'GEMINI_API_KEY' || !value.startsWith('AIza')) {
    return fallbackFirebaseConfig.apiKey;
  }
  return value;
}

const resolvedFirebaseConfig: FirebaseAppConfig = {
  apiKey: getFirebaseApiKey(),
  authDomain: getEnvValue('VITE_FIREBASE_AUTH_DOMAIN', fallbackFirebaseConfig.authDomain),
  projectId: getEnvValue('VITE_FIREBASE_PROJECT_ID', fallbackFirebaseConfig.projectId),
  storageBucket: getEnvValue('VITE_FIREBASE_STORAGE_BUCKET', fallbackFirebaseConfig.storageBucket),
  messagingSenderId: getEnvValue('VITE_FIREBASE_MESSAGING_SENDER_ID', fallbackFirebaseConfig.messagingSenderId),
  appId: getEnvValue('VITE_FIREBASE_APP_ID', fallbackFirebaseConfig.appId),
  measurementId: getEnvValue('VITE_FIREBASE_MEASUREMENT_ID', fallbackFirebaseConfig.measurementId),
  firestoreDatabaseId: getEnvValue('VITE_FIREBASE_FIRESTORE_DATABASE_ID', fallbackFirebaseConfig.firestoreDatabaseId || '(default)')
};

const app = initializeApp(resolvedFirebaseConfig);
export const auth = getAuth(app);
auth.languageCode = 'zh-TW';
export const db = getFirestore(app, resolvedFirebaseConfig.firestoreDatabaseId);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

export const saveUserProfile = async (user: User) => {
  const userRef = doc(db, 'users', user.uid);
  const snapshot = await getDocFromServer(userRef);
  const profile = {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
    updatedAt: serverTimestamp()
  };

  if (!snapshot.exists()) {
    await setDoc(userRef, {
      ...profile,
      freeCredits: 5
    });
    return;
  }

  const existingCredits = snapshot.data().freeCredits;
  await setDoc(userRef, {
    ...profile,
    ...(typeof existingCredits === 'number' ? {} : { freeCredits: 5 })
  }, { merge: true });
};

function shouldFallbackToRedirect(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
  return [
    'auth/popup-blocked',
    'auth/popup-closed-by-user',
    'auth/cancelled-popup-request',
    'auth/operation-not-supported-in-this-environment'
  ].includes(code);
}

export const getAuthErrorMessage = (error: unknown) => {
  const code = typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
  const currentHost = typeof window !== 'undefined' ? window.location.hostname : '目前網域';

  switch (code) {
    case 'auth/unauthorized-domain':
      return `目前網域 ${currentHost} 尚未加入 Firebase Authentication 授權網域。請確認加入的是 Firebase 專案 ${resolvedFirebaseConfig.projectId}，授權網域需包含 ${currentHost}。`;
    case 'auth/popup-blocked':
      return '瀏覽器封鎖了登入視窗，請改用重新導向登入或允許彈出視窗。';
    case 'auth/popup-closed-by-user':
      return '登入視窗已關閉，請重新登入。';
    case 'auth/cancelled-popup-request':
      return '已有另一個登入流程正在進行，請稍後再試。';
    case 'auth/operation-not-supported-in-this-environment':
      return '目前瀏覽器環境不支援彈出視窗登入，請使用重新導向登入。';
    case 'auth/network-request-failed':
      return '登入連線失敗，請確認網路連線後再試。';
    default:
      return error instanceof Error ? error.message : '登入失敗，請稍後再試。';
  }
};

export const completeGoogleRedirectSignIn = async () => {
  const result = await getRedirectResult(auth);
  if (!result?.user) {
    return null;
  }
  await saveUserProfile(result.user);
  return result.user;
};

export const signInWithGoogle = async (options: { redirect?: boolean } = {}) => {
  if (options.redirect) {
    await signInWithRedirect(auth, googleProvider);
    return null;
  }

  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    await saveUserProfile(user);
    return user;
  } catch (error) {
    console.error('Error signing in with Google', error);
    if (shouldFallbackToRedirect(error)) {
      await signInWithRedirect(auth, googleProvider);
      return null;
    }
    throw error;
  }
};

export const logout = () => signOut(auth);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();
