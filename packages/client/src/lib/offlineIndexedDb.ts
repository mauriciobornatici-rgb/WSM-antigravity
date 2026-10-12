import type { OfflineSalePayload } from "./offlineSalesQueue";

const DB_NAME = "wsm_pos_offline_db";
const DB_VERSION = 1;
const STORE_NAME = "offline_sales";

export function isIndexedDbAvailable(): boolean {
    return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

export function openOfflineDatabase(): Promise<IDBDatabase | null> {
    if (!isIndexedDbAvailable()) return Promise.resolve(null);
    return new Promise((resolve) => {
        try {
            const request = window.indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: "id" });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => {
                console.warn("No se pudo inicializar IndexedDB; operando con almacenamiento de contingencia estándar.");
                resolve(null);
            };
        } catch {
            resolve(null);
        }
    });
}

export async function saveSaleToIndexedDb(sale: OfflineSalePayload): Promise<boolean> {
    const db = await openOfflineDatabase();
    if (!db) return false;
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);
            store.put(sale);
            tx.oncomplete = () => {
                db.close();
                resolve(true);
            };
            tx.onerror = () => {
                db.close();
                resolve(false);
            };
        } catch {
            db.close();
            resolve(false);
        }
    });
}

export async function getAllSalesFromIndexedDb(): Promise<OfflineSalePayload[]> {
    const db = await openOfflineDatabase();
    if (!db) return [];
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_NAME, "readonly");
            const store = tx.objectStore(STORE_NAME);
            const request = store.getAll();
            request.onsuccess = () => {
                db.close();
                resolve((request.result as OfflineSalePayload[]) || []);
            };
            request.onerror = () => {
                db.close();
                resolve([]);
            };
        } catch {
            db.close();
            resolve([]);
        }
    });
}

export async function removeSaleFromIndexedDb(id: string): Promise<boolean> {
    const db = await openOfflineDatabase();
    if (!db) return false;
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);
            store.delete(id);
            tx.oncomplete = () => {
                db.close();
                resolve(true);
            };
            tx.onerror = () => {
                db.close();
                resolve(false);
            };
        } catch {
            db.close();
            resolve(false);
        }
    });
}

export async function clearSalesFromIndexedDb(): Promise<boolean> {
    const db = await openOfflineDatabase();
    if (!db) return false;
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);
            store.clear();
            tx.oncomplete = () => {
                db.close();
                resolve(true);
            };
            tx.onerror = () => {
                db.close();
                resolve(false);
            };
        } catch {
            db.close();
            resolve(false);
        }
    });
}
