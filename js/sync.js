/**
 * sync.js - Offline Queue & Auto Sync Manager for Stardust Post
 *
 * Manages background flushing of offline queued posts.
 * Supports structured posts: { todo, project, assigned_ai, memo }
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.StardustSync = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  let isSyncing = false;
  let onStatusChangeCallback = null;
  let onUnauthorizedCallback = null;

  function init(options) {
    onStatusChangeCallback = options && options.onStatusChange;
    onUnauthorizedCallback = options && options.onUnauthorized;

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        notifyStatus();
        flushQueue();
      });
      window.addEventListener('offline', () => {
        notifyStatus();
      });
    }

    notifyStatus();
    flushQueue();
  }

  function isNetworkOnline() {
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      return navigator.onLine;
    }
    return true;
  }

  function nowIsoTokyo(now) {
    const instant = now instanceof Date ? now : new Date();
    const shifted = new Date(instant.getTime() + 9 * 60 * 60 * 1000);
    return `${shifted.toISOString().slice(0, 23)}+09:00`;
  }

  async function notifyStatus() {
    if (!onStatusChangeCallback) return;
    try {
      const count = await StardustDB.getQueueCount();
      const isOnline = isNetworkOnline();
      onStatusChangeCallback({
        isOnline: isOnline,
        queueCount: count,
        isSyncing: isSyncing
      });
    } catch (err) {
      console.error('Error notifying sync status:', err);
    }
  }

  /**
   * 星屑を投函（オンライン時は直接送信、オフライン・失敗時はキュー保存）
   * @param {Object|string} postData - { todo, project, assigned_ai, memo } または 文字列
   */
  async function submitPost(postData, source) {
    const postId = ULID.generate();
    const nowIso = nowIsoTokyo();

    let postItem = {};
    if (typeof postData === 'string') {
      postItem = {
        post_id: postId,
        todo: postData,
        project: '',
        assigned_ai: '',
        memo: '',
        created_at: nowIso,
        source: source || (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches ? 'web_pwa' : 'mac_web')
      };
    } else {
      postItem = {
        post_id: postId,
        todo: postData.todo || '',
        project: postData.project || '',
        assigned_ai: postData.assigned_ai || '',
        memo: postData.memo || '',
        created_at: nowIso,
        source: source || (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches ? 'web_pwa' : 'mac_web')
      };
    }

    const token = await StardustDB.getSecretToken();
    const gasUrl = await StardustDB.getGasUrl();

    // シークレット未設定の場合はキューに退避してセットアップへ
    if (!token || !gasUrl) {
      await StardustDB.enqueuePost(postItem);
      await notifyStatus();
      return {
        status: 'queued',
        reason: 'no_credentials',
        item: postItem
      };
    }

    // オンラインでない場合はキューに退避
    if (!isNetworkOnline()) {
      await StardustDB.enqueuePost(postItem);
      await notifyStatus();
      return {
        status: 'queued',
        reason: 'offline',
        item: postItem
      };
    }

    // オンライン送信を試行
    try {
      const res = await StardustAPI.sendPost(gasUrl, token, postItem);
      if (res && res.ok) {
        return {
          status: 'sent',
          item: postItem,
          response: res
        };
      } else if (res && res.error === 'unauthorized') {
        await StardustDB.enqueuePost(postItem);
        await notifyStatus();
        if (onUnauthorizedCallback) onUnauthorizedCallback();
        return {
          status: 'queued',
          reason: 'unauthorized',
          item: postItem
        };
      } else {
        await StardustDB.enqueuePost(postItem);
        await notifyStatus();
        return {
          status: 'queued',
          reason: res ? res.error : 'send_failed',
          item: postItem
        };
      }
    } catch (err) {
      await StardustDB.enqueuePost(postItem);
      await notifyStatus();
      return {
        status: 'queued',
        reason: 'network_error',
        item: postItem
      };
    }
  }

  /**
   * オフラインキューの順次再送
   */
  async function flushQueue() {
    if (isSyncing) return;
    if (!isNetworkOnline()) return;

    const token = await StardustDB.getSecretToken();
    const gasUrl = await StardustDB.getGasUrl();
    if (!token || !gasUrl) return;

    isSyncing = true;
    await notifyStatus();

    try {
      const queue = await StardustDB.getQueue();
      if (queue.length === 0) {
        isSyncing = false;
        await notifyStatus();
        return;
      }

      for (const item of queue) {
        try {
          const res = await StardustAPI.sendPost(gasUrl, token, item);
          if (res && res.ok) {
            await StardustDB.dequeuePost(item.post_id);
            await notifyStatus();
          } else if (res && res.error === 'unauthorized') {
            if (onUnauthorizedCallback) onUnauthorizedCallback();
            break;
          } else {
            break;
          }
        } catch (err) {
          break;
        }
      }
    } finally {
      isSyncing = false;
      await notifyStatus();
    }
  }

  return {
    init,
    submitPost,
    flushQueue,
    notifyStatus,
    nowIsoTokyo
  };
}));
