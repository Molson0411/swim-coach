import { initializeApp } from 'firebase/app';
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
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

export const saveUserProfile = async (user: User) => {
  await setDoc(doc(db, 'users', user.uid), {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
    updatedAt: serverTimestamp()
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

  switch (code) {
    case 'auth/unauthorized-domain':
      return '目前網域尚未加入 Firebase Authentication 授權網域，請在 Firebase Console 加入 localhost 與 127.0.0.1。';
    case 'auth/popup-blocked':
      return '瀏覽器封鎖了登入彈窗，系統會改用重新導向登入。';
    case 'auth/popup-closed-by-user':
      return '登入視窗已關閉，請再試一次。';
    case 'auth/cancelled-popup-request':
      return '已有另一個登入視窗正在處理，請稍候再試。';
    case 'auth/operation-not-supported-in-this-environment':
      return '目前瀏覽器環境不支援彈窗登入，系統會改用重新導向登入。';
    case 'auth/network-request-failed':
      return '登入連線失敗，請確認網路後再試一次。';
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

export const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    await saveUserProfile(user);
    return user;
  } catch (error) {
    console.error("Error signing in with Google", error);
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
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Test connection
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. ");
    }
  }
}
testConnection();
