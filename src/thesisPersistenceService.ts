import { db, auth } from './lib/firebase';
import { 
  collection, 
  addDoc, 
  getDocs, 
  query, 
  where, 
  serverTimestamp, 
  updateDoc, 
  doc, 
  deleteDoc,
  Timestamp,
  getDoc
} from 'firebase/firestore';

export interface ThesisData {
  id?: string;
  userId: string;
  title: string;
  config: any;
  structure: any;
  generatedThesis: any[];
  sources: any[];
  createdAt?: any;
  updatedAt?: any;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const COLLECTION_NAME = 'theses';

export const thesisPersistenceService = {
  async saveThesis(data: Omit<ThesisData, 'id' | 'userId' | 'createdAt' | 'updatedAt'>) {
    if (!auth.currentUser) throw new Error("Must be signed in to save");
    
    const path = COLLECTION_NAME;
    try {
      const docRef = await addDoc(collection(db, path), {
        ...data,
        userId: auth.currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return docRef.id;
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, path);
    }
  },

  async updateThesis(id: string, data: Partial<ThesisData>) {
    if (!auth.currentUser) throw new Error("Must be signed in to update");
    
    const path = `${COLLECTION_NAME}/${id}`;
    try {
      const docRef = doc(db, COLLECTION_NAME, id);
      await updateDoc(docRef, {
        ...data,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, path);
    }
  },

  async getUserTheses() {
    if (!auth.currentUser) return [];
    
    const path = COLLECTION_NAME;
    try {
      const q = query(collection(db, path), where("userId", "==", auth.currentUser.uid));
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ThesisData[];
    } catch (e) {
      handleFirestoreError(e, OperationType.LIST, path);
      return [];
    }
  },

  async deleteThesis(id: string) {
    if (!auth.currentUser) throw new Error("Must be signed in to delete");
    
    const path = `${COLLECTION_NAME}/${id}`;
    try {
      await deleteDoc(doc(db, COLLECTION_NAME, id));
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, path);
    }
  }
};
