// Persistence: settings and profiles in localStorage; uploaded fonts and
// backgrounds in IndexedDB. When the browser blocks either one (private mode,
// strict file:// policies) data is kept in memory for this visit only.
(function () {
  'use strict';

  const KEYS = { state: 'cert-generator:v2', v1: 'cert-generator:v1', profiles: 'cert-generator:profiles' };
  const DB_NAME = 'cert-generator';
  const STORES = ['fonts', 'backgrounds'];

  const memory = new Map();
  let localOk = true;
  try {
    localStorage.setItem('cert-generator:probe', '1');
    localStorage.removeItem('cert-generator:probe');
  } catch (err) {
    console.warn('localStorage unavailable, settings will not persist', err);
    localOk = false;
  }

  const isQuota = (err) => err && (err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014);

  // Unparsable data comes back as the raw string so settings.sanitize can
  // report it as corrupt instead of silently dropping it.
  function readJson(key) {
    let raw = null;
    try {
      raw = localOk ? localStorage.getItem(key) : memory.get(key) ?? null;
    } catch (err) {
      console.warn('Could not read', key, err);
    }
    if (raw == null) return null;
    try {
      return JSON.parse(raw);
    } catch (err) {
      console.warn('Saved data is not valid JSON', key, err);
      return raw;
    }
  }

  // -> { ok } or { ok: false, reason: 'quota' | 'unavailable' }
  function writeJson(key, value) {
    const raw = JSON.stringify(value);
    memory.set(key, raw);
    if (!localOk) return { ok: false, reason: 'unavailable' };
    try {
      localStorage.setItem(key, raw);
      return { ok: true };
    } catch (err) {
      console.warn('Could not save', key, err);
      return { ok: false, reason: isQuota(err) ? 'quota' : 'unavailable' };
    }
  }

  // The v2 state, else the v1 data for settings.sanitize to migrate.
  const loadState = () => readJson(KEYS.state) ?? readJson(KEYS.v1);
  const saveState = (state) => writeJson(KEYS.state, state);

  // Profiles: { [name]: { savedAt, data } }
  function profiles() {
    const all = readJson(KEYS.profiles);
    return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
  }
  const listProfiles = () =>
    Object.entries(profiles())
      .map(([name, p]) => ({ name, savedAt: p.savedAt || '' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  const getProfile = (name) => (profiles()[name] || {}).data || null;
  const saveProfile = (name, data) => writeJson(KEYS.profiles, { ...profiles(), [name]: { savedAt: new Date().toISOString(), data } });
  function deleteProfile(name) {
    const { [name]: gone, ...rest } = profiles();
    return writeJson(KEYS.profiles, rest);
  }

  // ---- IndexedDB, with an in-memory stand-in ----
  const memStores = Object.fromEntries(STORES.map((s) => [s, new Map()]));
  let dbPromise = null;

  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) throw new Error('IndexedDB not supported');
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          STORES.forEach((s) => {
            if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: 'id' });
          });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }).catch((err) => {
        console.warn('IndexedDB unavailable, files will not persist', err);
        return null;
      });
    }
    return dbPromise;
  }

  function request(store, mode, run) {
    return openDb().then((db) => {
      if (!db) return run(null, memStores[store]);
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = run(tx.objectStore(store));
        tx.oncomplete = () => resolve(req && req.result);
        tx.onabort = tx.onerror = () => {
          const err = tx.error || (req && req.error);
          reject(isQuota(err) ? new Error('瀏覽器儲存空間不足，請刪除不用的字型或底圖後再試') : err);
        };
      });
    });
  }

  const put = (store, record) => request(store, 'readwrite', (os, mem) => (os ? os.put(record) : void mem.set(record.id, record)));
  const get = (store, id) => request(store, 'readonly', (os, mem) => (os ? os.get(id) : mem.get(id)));
  const all = (store) => request(store, 'readonly', (os, mem) => (os ? os.getAll() : [...mem.values()]));
  const remove = (store, id) => request(store, 'readwrite', (os, mem) => (os ? os.delete(id) : void mem.delete(id)));
  const filesPersist = () => openDb().then(Boolean);

  window.Cert = window.Cert || {};
  window.Cert.store = {
    localOk: () => localOk,
    loadState,
    saveState,
    listProfiles,
    getProfile,
    saveProfile,
    deleteProfile,
    files: { put, get, all, remove, persist: filesPersist },
  };
})();
