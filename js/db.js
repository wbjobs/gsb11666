(function () {
  'use strict';

  var DB_NAME = 'css-support-lab';
  var DB_VERSION = 1;
  var STORE = 'history';
  var LEGACY_KEY = 'css-support-lab-history';
  var MAX_RECORDS = 80;

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      if (!('indexedDB' in window) || typeof indexedDB.open !== 'function') {
        reject(new Error('IndexedDB unavailable'));
        return;
      }

      var request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };

      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('IndexedDB open failed')); };
    });
  }

  function withStore(mode, callback) {
    return openDatabase().then(function (db) {
      return new Promise(function (resolve, reject) {
        var transaction = db.transaction(STORE, mode);
        var store = transaction.objectStore(STORE);
        var request = callback(store);

        transaction.oncomplete = function () {
          db.close();
          resolve(request.result);
        };
        transaction.onerror = function () {
          db.close();
          reject(transaction.error || new Error('IndexedDB transaction failed'));
        };
        transaction.onabort = function () {
          db.close();
          reject(transaction.error || new Error('IndexedDB transaction aborted'));
        };
      });
    });
  }

  function readLegacy() {
    try {
      return JSON.parse(window.localStorage.getItem(LEGACY_KEY) || '[]');
    } catch (error) {
      return [];
    }
  }

  function writeLegacy(records) {
    try {
      localStorage.setItem(LEGACY_KEY, JSON.stringify(records.slice(0, MAX_RECORDS)));
    } catch (storageError) {
      return false;
    }
    return true;
  }

  async function addHistory(record) {
    try {
      var records = await withStore('readonly', function (store) {
        return store.getAll ? store.getAll() : null;
      });
      if (Array.isArray(records) && records.length >= MAX_RECORDS) {
        var oldest = records.sort(function (a, b) { return a.createdAt - b.createdAt; }).slice(0, records.length - MAX_RECORDS + 1);
        await withStore('readwrite', function (store) {
          oldest.forEach(function (item) { store.delete(item.id); });
          return store.add(record);
        });
        return null;
      }
      return await withStore('readwrite', function (store) { return store.add(record); });
    } catch (error) {
      var fallbackRecords = readLegacy();
      fallbackRecords.unshift(Object.assign({ fallbackStorage: true }, record));
      writeLegacy(fallbackRecords);
      return null;
    }
  }

  async function listHistory() {
    try {
      return await withStore('readonly', function (store) {
        return store.getAll ? store.getAll() : store.openCursor();
      }).then(function (result) {
        if (!Array.isArray(result)) {
          throw new Error('IndexedDB getAll unsupported');
        }
        return result.sort(function (a, b) { return b.createdAt - a.createdAt; });
      });
    } catch (error) {
      return readLegacy();
    }
  }

  async function clearHistory() {
    try {
      await withStore('readwrite', function (store) { return store.clear(); });
    } catch (error) {
      localStorage.removeItem(LEGACY_KEY);
    }
  }

  window.SupportHistory = {
    add: addHistory,
    list: listHistory,
    clear: clearHistory
  };
}());
