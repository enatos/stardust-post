/**
 * app.js - Main Application Logic for Stardust Post (v1.2)
 */

(function () {
  'use strict';

  // DOM Elements
  const stardustTodo = document.getElementById('stardust-todo');
  const charCounterTodo = document.getElementById('char-counter-todo');
  const selectProject = document.getElementById('select-project');
  const selectAi = document.getElementById('select-ai');
  const stardustMemo = document.getElementById('stardust-memo');
  const charCounterMemo = document.getElementById('char-counter-memo');

  const btnLaunch = document.getElementById('btn-launch');
  const btnLaunchText = document.getElementById('btn-launch-text');
  const statusDot = document.getElementById('status-dot');
  const statusNetwork = document.getElementById('status-network');
  const statusQueue = document.getElementById('status-queue');
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toast-message');

  // Modals
  const modalSetup = document.getElementById('modal-setup');
  const setupGasUrl = document.getElementById('setup-gas-url');
  const setupSecret = document.getElementById('setup-secret');
  const setupError = document.getElementById('setup-error');
  const btnSetupSave = document.getElementById('btn-setup-save');

  const btnOpenSettings = document.getElementById('btn-open-settings');
  const modalSettings = document.getElementById('modal-settings');
  const settingsGasUrl = document.getElementById('settings-gas-url');
  const settingsSecret = document.getElementById('settings-secret');
  const settingsError = document.getElementById('settings-error');
  const btnSettingsSave = document.getElementById('btn-settings-save');
  const btnSettingsClose = document.getElementById('btn-settings-close');
  const btnSettingsClear = document.getElementById('btn-settings-clear');

  const MAX_TODO = 150;
  const WARN_TODO = 120;
  const MAX_MEMO = 500;
  const WARN_MEMO = 450;

  let isSubmitting = false;

  // Initialize
  window.addEventListener('DOMContentLoaded', async () => {
    initServiceWorker();
    await initApp();
    bindEvents();
  });

  async function initApp() {
    try {
      await StardustDB.openDB();

      // Check credentials
      const token = await StardustDB.getSecretToken();
      const gasUrl = await StardustDB.getGasUrl();

      if (!token || !gasUrl) {
        showSetupModal();
      } else {
        hideSetupModal();
        focusInput();
      }

      // Initialize Sync Manager
      StardustSync.init({
        onStatusChange: handleStatusChange,
        onUnauthorized: () => {
          showToast('認証エラー: シークレットを再設定してください');
          showSetupModal('共有シークレットが変更または無効化されています。再入力してください。');
        }
      });

      // Load Projects (Cache + Dynamic Fetch)
      await loadProjects(gasUrl, token);

      updateCharCounts();
    } catch (err) {
      console.error('Initialization error:', err);
    }
  }

  function bindEvents() {
    // Inputs & Character Counters
    stardustTodo.addEventListener('input', handleTodoInput);
    stardustMemo.addEventListener('input', handleMemoInput);

    // Keyboard Shortcuts (Cmd+Enter or Ctrl+Enter)
    const handleShortcut = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!btnLaunch.disabled && !isSubmitting) {
          handleSubmit();
        }
      }
    };
    stardustTodo.addEventListener('keydown', handleShortcut);
    stardustMemo.addEventListener('keydown', handleShortcut);

    // Launch Button
    btnLaunch.addEventListener('click', handleSubmit);

    // Setup Modal Actions
    btnSetupSave.addEventListener('click', handleSetupSave);

    // Settings Modal Actions
    btnOpenSettings.addEventListener('click', openSettingsModal);
    btnSettingsClose.addEventListener('click', closeSettingsModal);
    btnSettingsSave.addEventListener('click', handleSettingsSave);
    btnSettingsClear.addEventListener('click', handleSettingsClear);
  }

  /**
   * プロジェクト候補の読み込み（キャッシュ優先表示 + 最新取得）
   */
  async function loadProjects(gasUrl, token) {
    try {
      // 1. キャッシュから即時表示
      const cached = await StardustDB.getProjectsCache();
      if (Array.isArray(cached) && cached.length > 0) {
        renderProjectOptions(cached);
      }

      // 2. オンラインかつ接続設定がある場合は最新をフェッチ
      if (gasUrl && token && typeof navigator !== 'undefined' && navigator.onLine) {
        StardustAPI.fetchProjects(gasUrl, token).then(async (res) => {
          if (res && res.ok && Array.isArray(res.projects)) {
            await StardustDB.setProjectsCache(res.projects);
            renderProjectOptions(res.projects);
          }
        }).catch(err => {
          console.warn('Could not refresh projects from master:', err);
        });
      }
    } catch (err) {
      console.warn('Error loading projects:', err);
    }
  }

  function renderProjectOptions(projects) {
    const currentVal = selectProject.value;
    selectProject.innerHTML = '<option value="">未設定</option>';

    for (const p of projects) {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      selectProject.appendChild(opt);
    }

    if (currentVal && projects.includes(currentVal)) {
      selectProject.value = currentVal;
    }
  }

  function handleTodoInput() {
    if (stardustTodo.value.length > MAX_TODO) {
      stardustTodo.value = stardustTodo.value.slice(0, MAX_TODO);
    }
    updateCharCounts();
  }

  function handleMemoInput() {
    if (stardustMemo.value.length > MAX_MEMO) {
      stardustMemo.value = stardustMemo.value.slice(0, MAX_MEMO);
    }
    updateCharCounts();
  }

  function updateCharCounts() {
    // Todo counter
    const todoLen = stardustTodo.value.length;
    const todoTrimmed = stardustTodo.value.trim();

    btnLaunch.disabled = (todoTrimmed.length === 0) || isSubmitting;

    if (todoLen >= MAX_TODO) {
      charCounterTodo.textContent = '残り 0文字';
      charCounterTodo.className = 'char-counter limit';
    } else if (todoLen >= WARN_TODO) {
      charCounterTodo.textContent = `残り ${MAX_TODO - todoLen}文字`;
      charCounterTodo.className = 'char-counter warning';
    } else {
      charCounterTodo.textContent = '';
      charCounterTodo.className = 'char-counter';
    }

    // Memo counter
    const memoLen = stardustMemo.value.length;
    if (memoLen >= MAX_MEMO) {
      charCounterMemo.textContent = '残り 0文字';
      charCounterMemo.className = 'char-counter limit';
    } else if (memoLen >= WARN_MEMO) {
      charCounterMemo.textContent = `残り ${MAX_MEMO - memoLen}文字`;
      charCounterMemo.className = 'char-counter warning';
    } else {
      charCounterMemo.textContent = '';
      charCounterMemo.className = 'char-counter';
    }
  }

  async function handleSubmit() {
    const todo = stardustTodo.value.trim();
    if (!todo || isSubmitting) return;

    const project = selectProject.value;
    const assignedAi = selectAi.value;
    const memo = stardustMemo.value.trim();

    isSubmitting = true;
    btnLaunch.disabled = true;
    btnLaunchText.textContent = '投函中…';

    try {
      triggerStardustAnimation();

      const postData = {
        todo: todo,
        project: project,
        assigned_ai: assignedAi,
        memo: memo
      };

      const result = await StardustSync.submitPost(postData);

      // 入力欄をクリア
      stardustTodo.value = '';
      stardustMemo.value = '';
      selectProject.value = '';
      selectAi.value = '';
      updateCharCounts();

      if (result.status === 'sent') {
        showToast('✦ 星屑を夜空へ放ちました');
      } else if (result.status === 'queued') {
        if (result.reason === 'offline') {
          showToast('✦ 端末内に保存しました（オンライン時に送信）');
        } else if (result.reason === 'no_credentials') {
          showToast('シークレットが未設定です。設定画面を開きます。');
          showSetupModal();
        } else {
          showToast('✦ 端末内に一時保存しました');
        }
      }
    } catch (err) {
      console.error('Submit error:', err);
      showToast('エラーが発生しました。端末内に保持します。');
    } finally {
      isSubmitting = false;
      btnLaunchText.textContent = '夜空へ放つ';
      updateCharCounts();
      focusInput();
    }
  }

  function triggerStardustAnimation() {
    const card = document.querySelector('.post-card');
    if (!card) return;

    for (let i = 0; i < 5; i++) {
      const star = document.createElement('div');
      star.className = 'stardust-flight';
      const startX = 30 + Math.random() * 40;
      const startY = 40 + Math.random() * 20;
      star.style.left = `${startX}%`;
      star.style.top = `${startY}%`;
      star.style.animationDelay = `${i * 0.08}s`;
      card.appendChild(star);

      setTimeout(() => {
        if (star.parentNode) star.parentNode.removeChild(star);
      }, 1200);
    }
  }

  function handleStatusChange(status) {
    if (status.isOnline) {
      statusDot.className = 'status-dot';
      statusNetwork.textContent = 'オンライン';
    } else {
      statusDot.className = 'status-dot offline';
      statusNetwork.textContent = 'オフライン (端末内保存)';
    }

    if (status.isSyncing) {
      statusDot.className = 'status-dot syncing';
      statusNetwork.textContent = '送信中…';
    }

    statusQueue.textContent = `未送信: ${status.queueCount}件`;
  }

  let toastTimer = null;
  function showToast(msg) {
    toastMessage.textContent = msg;
    toast.classList.add('show');

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2800);
  }

  function focusInput() {
    if (window.innerWidth > 768 || document.activeElement === document.body) {
      stardustTodo.focus();
    }
  }

  // --- Setup Modal Handlers ---

  function showSetupModal(customMsg) {
    modalSetup.classList.add('active');
    setupError.textContent = customMsg || '';
  }

  function hideSetupModal() {
    modalSetup.classList.remove('active');
    setupError.textContent = '';
  }

  async function handleSetupSave() {
    const url = setupGasUrl.value.trim();
    const secret = setupSecret.value.trim();

    if (!url) {
      setupError.textContent = 'GAS Web App URLを入力してください';
      return;
    }
    if (!secret) {
      setupError.textContent = '共有シークレットを入力してください';
      return;
    }

    setupError.textContent = '接続確認中…';
    btnSetupSave.disabled = true;

    try {
      const res = await StardustAPI.verifySecret(url, secret);
      if (res && res.ok) {
        await StardustDB.setGasUrl(url);
        await StardustDB.setSecretToken(secret);
        hideSetupModal();
        showToast('✦ 接続に成功しました');
        // Fetch projects on initial setup
        loadProjects(url, secret);
        StardustSync.flushQueue();
        focusInput();
      } else if (res && res.error === 'unauthorized') {
        setupError.textContent = 'シークレットが違います';
      } else {
        setupError.textContent = 'GASへ接続できませんでした。URLをご確認ください。';
      }
    } catch (err) {
      setupError.textContent = `接続エラー: ${err.message}`;
    } finally {
      btnSetupSave.disabled = false;
    }
  }

  // --- Settings Modal Handlers ---

  async function openSettingsModal() {
    const url = await StardustDB.getGasUrl();
    settingsGasUrl.value = url || '';
    settingsSecret.value = '';
    settingsError.textContent = '';
    modalSettings.classList.add('active');
  }

  function closeSettingsModal() {
    modalSettings.classList.remove('active');
    focusInput();
  }

  async function handleSettingsSave() {
    const url = settingsGasUrl.value.trim();
    const newSecret = settingsSecret.value.trim();

    if (!url) {
      settingsError.textContent = 'GAS Web App URLを入力してください';
      return;
    }

    btnSettingsSave.disabled = true;
    settingsError.textContent = '保存中…';

    try {
      const currentSecret = await StardustDB.getSecretToken();
      const secretToTest = newSecret || currentSecret;

      if (secretToTest) {
        const res = await StardustAPI.verifySecret(url, secretToTest);
        if (!res || !res.ok) {
          if (res && res.error === 'unauthorized') {
            settingsError.textContent = 'シークレットが違います';
            btnSettingsSave.disabled = false;
            return;
          } else {
            settingsError.textContent = 'GAS接続に失敗しました。URLをご確認ください。';
            btnSettingsSave.disabled = false;
            return;
          }
        }
      }

      await StardustDB.setGasUrl(url);
      if (newSecret) {
        await StardustDB.setSecretToken(newSecret);
      }

      closeSettingsModal();
      showToast('設定を更新しました');
      loadProjects(url, secretToTest);
      StardustSync.flushQueue();
    } catch (err) {
      settingsError.textContent = `エラー: ${err.message}`;
    } finally {
      btnSettingsSave.disabled = false;
    }
  }

  async function handleSettingsClear() {
    if (confirm('保存されているシークレットと接続先設定を初期化しますか？\n（未送信の星屑は保持されます）')) {
      await StardustDB.clearSecretToken();
      await StardustDB.deleteSetting('gas_url');
      await StardustDB.deleteSetting('projects_cache');
      closeSettingsModal();
      showSetupModal();
      showToast('設定を初期化しました');
    }
  }

  // --- Service Worker Registration ---

  function initServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
          .then((reg) => {
            console.log('ServiceWorker registered with scope:', reg.scope);
          })
          .catch((err) => {
            console.warn('ServiceWorker registration failed:', err);
          });
      });
    }
  }
})();
