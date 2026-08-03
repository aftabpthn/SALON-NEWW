type EncryptedRecord = {
  id: string;
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
  updatedAt: number;
};

export class StaffOfflineStore {
  private readonly databaseName = "aura-staff-offline-v2";
  private readonly recordsStore = "records";
  private readonly keysStore = "keys";
  private databasePromise?: Promise<IDBDatabase>;
  private keyPromise?: Promise<CryptoKey>;

  async read<T>(id: string): Promise<T | null> {
    const database = await this.database();
    const record = await this.request<EncryptedRecord | undefined>(database.transaction(this.recordsStore).objectStore(this.recordsStore).get(id));
    if (!record) return null;
    const key = await this.key();
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: record.iv, additionalData: new TextEncoder().encode(id) },
      key,
      record.ciphertext
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  }

  async write(id: string, value: unknown): Promise<void> {
    const database = await this.database();
    const key = await this.key();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(id) },
      key,
      new TextEncoder().encode(JSON.stringify(value))
    );
    await this.transaction(database, this.recordsStore, "readwrite", (store) => store.put({ id, iv, ciphertext, updatedAt: Date.now() } satisfies EncryptedRecord));
  }

  async remove(id: string): Promise<void> {
    const database = await this.database();
    await this.transaction(database, this.recordsStore, "readwrite", (store) => store.delete(id));
  }

  async clear(): Promise<void> {
    const database = await this.database();
    await this.transaction(database, this.recordsStore, "readwrite", (store) => store.clear());
  }

  private database(): Promise<IDBDatabase> {
    if (!globalThis.indexedDB || !globalThis.crypto?.subtle) return Promise.reject(new Error("Encrypted offline storage is unavailable on this device."));
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(this.databaseName, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(this.recordsStore)) request.result.createObjectStore(this.recordsStore, { keyPath: "id" });
          if (!request.result.objectStoreNames.contains(this.keysStore)) request.result.createObjectStore(this.keysStore);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Unable to open encrypted offline storage."));
      });
    }
    return this.databasePromise;
  }

  private async key(): Promise<CryptoKey> {
    if (!this.keyPromise) {
      this.keyPromise = (async () => {
        const database = await this.database();
        const store = database.transaction(this.keysStore, "readonly").objectStore(this.keysStore);
        const existing = await this.request<CryptoKey | undefined>(store.get("device"));
        if (existing) return existing;
        const created = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
        await this.transaction(database, this.keysStore, "readwrite", (target) => target.put(created, "device"));
        return created;
      })();
    }
    return this.keyPromise;
  }

  private request<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Offline storage request failed."));
    });
  }

  private transaction(database: IDBDatabase, storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      action(transaction.objectStore(storeName));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Offline storage transaction failed."));
      transaction.onabort = () => reject(transaction.error || new Error("Offline storage transaction was aborted."));
    });
  }
}
