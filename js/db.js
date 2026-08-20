/**
 * db.js - IndexedDB Storage Manager for Stardust Post
 * Stores:
 * - settings: configuration, credentials, and project master cache
 * - outbox_queue: offline posts waiting to be sent
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.StardustDB = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DB_NAME = 'stardust_post_db';
  const DB_VERSION = 1;
  const STORE_SETTINGS = 'settings';
  const STORE_OUTBOX = 'outbox_queue';

  let dbInstance = null;

  function openDB() {
    if (dbInstance) {
      return Promise.resolve(dbInstance);
    }
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        return reject(new Error('IndexedDB is not supported in this environment'));
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
          db.createObjectStore(STORE_SETTINGS);
        }
        if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
          db.createObjectStore(STORE_OUTBOX, { keyPath: 'post_id' });
        }
      };

      request.onsuccess = (event) => {
        dbInstance = event.target.result;
        resolve(dbInstance);
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  function getSetting(key) {
    return openDB().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_SETTINGS, 'readonly');
        const store = tx.objectStore(STORE_SETTINGS);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result !== undefined ? req.result : null);
        req.onerror = () => reject(req.error);
      });
    });
  }

  function setSetting(key, value) {
    return openDB().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_SETTINGS, 'readwrite');
        const store = tx.objectStore(STORE_SETTINGS);
        const req = store.put(value, key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    });
  }

  function deleteSetting(key) {
    return openDB().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_SETTINGS, 'readwrite');
        const store = tx.objectStore(STORE_SETTINGS);
        const req = store.delete(key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    });
  }

  function getSecretToken() {
    return getSetting('secret_token');
  }

  function setSecretToken(token) {
    return setSetting('secret_token', token);
  }

  function clearSecretToken() {
    return deleteSetting('secret_token');
  }

  function getGasUrl() {
    return getSetting('gas_url');
  }

  function setGasUrl(url) {
    return setSetting('gas_url', url);
  }

  function getProjectsCache() {
    return getSetting('projects_cache');
  }

  function setProjectsCache(projects) {
    return setSetting('projects_cache', projects);
  }

  function enqueuePost(post) {
    return openDB().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_OUTBOX, 'readwrite');
        const store = tx.objectStore(STORE_OUTBOX);
        const req = store.put(post);
        req.onsuccess = () => resolve(post.post_id);
        req.onerror = () => reject(req.error);
      });
    });
  }

  function dequeuePost(postId) {
    return openDB().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_OUTBOX, 'readwrite');
        const store = tx.objectStore(STORE_OUTBOX);
        const req = store.delete(postId);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    });
  }

  function getQueue() {
    return openDB().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_OUTBOX, 'readonly');
        const store = tx.objectStore(STORE_OUTBOX);
        const req = store.getAll();
        req.onsuccess = () => {
          const items = req.result || [];
          items.sort((a, b) => a.post_id.localeCompare(b.post_id));
          resolve(items);
        };
        req.onerror = () => reject(req.error);
      });
    });
  }

  function getQueueCount() {
    return openDB().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_OUTBOX, 'readonly');
        const store = tx.objectStore(STORE_OUTBOX);
        const req = store.count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => reject(req.error);
      });
    });
  }

  return {
    openDB,
    getSetting,
    setSetting,
    deleteSetting,
    getSecretToken,
    setSecretToken,
    clearSecretToken,
    getGasUrl,
    setGasUrl,
    getProjectsCache,
    setProjectsCache,
    enqueuePost,
    dequeuePost,
    getQueue,
    getQueueCount
  };
}));
