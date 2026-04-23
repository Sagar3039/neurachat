import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyBcM_6PSvfIjygKjfzHMn_LsxzhFgFdaws",
  authDomain: "project3-bc774.firebaseapp.com",
  projectId: "project3-bc774",
  storageBucket: "project3-bc774.firebasestorage.app",
  messagingSenderId: "11756185829",
  appId: "1:11756185829:web:996815a285d1447ba40c0c",
  measurementId: "G-ECF23X8DM4"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({ prompt: 'select_account' });

export default app;
