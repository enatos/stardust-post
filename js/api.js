/**
 * api.js - GAS Web API Client for Stardust Post
 *
 * Handles HTTP requests to the GAS Web App endpoint.
 * Always sends text/plain to avoid preflight CORS OPTIONS requests,
 * and enables redirect: 'follow' for Google 302 redirects.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.StardustAPI = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * 星屑を投函 (POST action=post)
   */
  async function sendPost(gasUrl, token, payload) {
    if (!gasUrl) {
      throw new Error('GAS Web App URLが設定されていません');
    }

    const requestBody = {
      action: 'post',
      token: token,
      post_id: payload.post_id,
      todo: payload.todo,
      project: payload.project || '',
      assigned_ai: payload.assigned_ai || '',
      memo: payload.memo || '',
      created_at: payload.created_at,
      source: payload.source || 'web_pwa'
    };

    const url = gasUrl.includes('?') ? `${gasUrl}&action=post` : `${gasUrl}?action=post`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(requestBody),
      redirect: 'follow'
    });

    if (!response.ok) {
      const errorText = await response.text();
      try {
        const json = JSON.parse(errorText);
        return json;
      } catch (_) {
        throw new Error(`HTTP Error ${response.status}: ${errorText}`);
      }
    }

    return await response.json();
  }

  /**
   * プロジェクト一覧の取得 (GET / POST action=projects)
   */
  async function fetchProjects(gasUrl, token) {
    if (!gasUrl || !token) {
      return { ok: false, error: 'url_or_token_missing', projects: [] };
    }

    const separator = gasUrl.includes('?') ? '&' : '?';
    const url = `${gasUrl}${separator}action=projects&token=${encodeURIComponent(token)}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow'
      });
      return await response.json();
    } catch (err) {
      // POST フォールバック
      try {
        const postUrl = `${gasUrl}${separator}action=projects`;
        const postResp = await fetch(postUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain;charset=utf-8'
          },
          body: JSON.stringify({
            action: 'projects',
            token: token
          }),
          redirect: 'follow'
        });
        return await postResp.json();
      } catch (postErr) {
        return { ok: false, error: 'network_error', projects: [] };
      }
    }
  }

  /**
   * シークレットの接続検証 (GET action=inbox&limit=1)
   */
  async function verifySecret(gasUrl, token) {
    if (!gasUrl || !token) {
      return { ok: false, error: 'url_or_token_missing' };
    }

    const separator = gasUrl.includes('?') ? '&' : '?';
    const verifyUrl = `${gasUrl}${separator}action=inbox&limit=1&token=${encodeURIComponent(token)}`;

    try {
      const response = await fetch(verifyUrl, {
        method: 'GET',
        redirect: 'follow'
      });
      return await response.json();
    } catch (err) {
      try {
        const fallbackUrl = `${gasUrl}${separator}action=inbox`;
        const postResp = await fetch(fallbackUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain;charset=utf-8'
          },
          body: JSON.stringify({
            action: 'inbox',
            token: token,
            limit: 1
          }),
          redirect: 'follow'
        });
        return await postResp.json();
      } catch (postErr) {
        return { ok: false, error: 'network_error', message: err.message };
      }
    }
  }

  /**
   * 受信箱の取得 (GET action=inbox)
   */
  async function fetchInbox(gasUrl, token, statusFilter, limit) {
    if (!gasUrl || !token) {
      throw new Error('GAS URLまたはシークレットが設定されていません');
    }

    const separator = gasUrl.includes('?') ? '&' : '?';
    let url = `${gasUrl}${separator}action=inbox&token=${encodeURIComponent(token)}`;
    if (statusFilter) {
      url += `&status=${encodeURIComponent(statusFilter)}`;
    }
    if (limit) {
      url += `&limit=${encodeURIComponent(limit)}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow'
    });

    return await response.json();
  }

  return {
    sendPost,
    fetchProjects,
    verifySecret,
    fetchInbox
  };
}));
