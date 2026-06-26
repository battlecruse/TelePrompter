import './styles.css';

// ===== Types =====
interface Settings {
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
  theme: 'dark' | 'studio' | 'light' | 'high-contrast';
  readPosition: 'center' | 'upper' | 'lower';
  fadeEdges: boolean;
  guideLine: boolean;
  defaultSpeed: number;
  countdown: boolean;
  autoHideControls: boolean;
}

interface ScriptData {
  title: string;
  content: string;
  updatedAt: number;
}

// ===== Constants =====
const STORAGE_KEY = 'teleprompter-pro';
const FILE_DB_NAME = 'teleprompter-pro-files';
const FILE_DB_STORE = 'handles';
const WPM_KOREAN = 150;

const DEFAULT_SETTINGS: Settings = {
  fontSize: 42,
  lineHeight: 1.8,
  fontFamily: "'Noto Sans KR', sans-serif",
  theme: 'dark',
  readPosition: 'center',
  fadeEdges: true,
  guideLine: true,
  defaultSpeed: 50,
  countdown: true,
  autoHideControls: true,
};

// ===== DOM Elements =====
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const welcome = $('#welcome');
const prompterView = $('#prompter-view');
const welcomeNewBtn = $('#btn-new-script');
const fileImport = $('#file-import') as HTMLInputElement;
const fileImportEditor = $('#file-import-editor') as HTMLInputElement;

const btnBack = $('#btn-back');
const scriptTitle = $('#script-title');
const btnPlay = $('#btn-play');
const playIcon = $('#play-icon');
const playLabel = $('#play-label');
const btnSpeedDown = $('#btn-speed-down');
const btnSpeedUp = $('#btn-speed-up');
const speedDisplay = $('#speed-display');
const btnEdit = $('#btn-edit');
const btnMirror = $('#btn-mirror');
const btnFullscreen = $('#btn-fullscreen');
const btnSettings = $('#btn-settings');

const progressBar = $('#progress-bar');
const displayArea = $('#display-area');
const fadeTop = $('#fade-top');
const fadeBottom = $('#fade-bottom');
const readingGuide = $('#reading-guide');
const scrollContainer = $('#scroll-container');
const scriptContent = $('#script-content');

const editorOverlay = $('#editor-overlay');
const titleInput = $('#title-input') as HTMLInputElement;
const scriptEditor = $('#script-editor') as HTMLTextAreaElement;
const charCount = $('#char-count');
const wordCount = $('#word-count');
const readTime = $('#read-time');
const btnSave = $('#btn-save');
const saveStatus = $('#save-status');
const btnClear = $('#btn-clear');
const btnDoneEdit = $('#btn-done-edit');

const statusProgress = $('#status-progress');
const statusElapsed = $('#status-elapsed');
const statusRemaining = $('#status-remaining');

const countdownEl = $('#countdown');
const countdownNumber = $('#countdown-number');

const settingsPanel = $('#settings-panel');
const settingsBackdrop = $('#settings-backdrop');
const btnCloseSettings = $('#btn-close-settings');
const btnResetSettings = $('#btn-reset-settings');
const shortcutsHint = $('#shortcuts-hint');
const shortcutsBackdrop = $('#shortcuts-backdrop');
const btnCloseShortcuts = $('#btn-close-shortcuts');

// Setting inputs
const settingFontSize = $('#setting-font-size') as HTMLInputElement;
const settingLineHeight = $('#setting-line-height') as HTMLInputElement;
const settingFontFamily = $('#setting-font-family') as HTMLSelectElement;
const settingTheme = $('#setting-theme') as HTMLSelectElement;
const settingReadPosition = $('#setting-read-position') as HTMLSelectElement;
const settingFadeEdges = $('#setting-fade-edges') as HTMLInputElement;
const settingGuideLine = $('#setting-guide-line') as HTMLInputElement;
const settingDefaultSpeed = $('#setting-default-speed') as HTMLInputElement;
const settingCountdown = $('#setting-countdown') as HTMLInputElement;
const settingAutoHide = $('#setting-auto-hide') as HTMLInputElement;
const fontSizeVal = $('#font-size-val');
const lineHeightVal = $('#line-height-val');
const defaultSpeedVal = $('#default-speed-val');

// ===== State =====
let settings: Settings = { ...DEFAULT_SETTINGS };
let script: ScriptData = { title: '새 대본', content: '', updatedAt: Date.now() };
let isPlaying = false;
let isEditing = false;
let isMirrored = false;
let speed = 50;
let scrollPosition = 0;
let maxScroll = 0;
let animationId: number | null = null;
let playStartTime = 0;
let elapsedBeforePause = 0;
let controlsHideTimer: ReturnType<typeof setTimeout> | null = null;
let shortcutsVisible = false;
let linkedFileHandle: FileSystemFileHandle | null = null;
let linkedFileName: string | null = null;
let fileSaveTimer: ReturnType<typeof setTimeout> | null = null;
let fileSaveStatusTimer: ReturnType<typeof setTimeout> | null = null;

// ===== Persistence =====
function loadState(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.settings) settings = { ...DEFAULT_SETTINGS, ...data.settings };
    if (data.script) script = data.script;
    if (data.speed) speed = data.speed;
  } catch { /* ignore corrupt data */ }
}

function saveState(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings, script, speed }));
}

// ===== PC File Auto-Save (File System Access API) =====
function supportsFileSystemAccess(): boolean {
  return 'showSaveFilePicker' in window;
}

function openFileDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(FILE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(FILE_DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeFileHandle(handle: FileSystemFileHandle): Promise<void> {
  const db = await openFileDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FILE_DB_STORE, 'readwrite');
    tx.objectStore(FILE_DB_STORE).put(handle, 'script');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function loadStoredFileHandle(): Promise<FileSystemFileHandle | null> {
  try {
    const db = await openFileDB();
    const handle = await new Promise<FileSystemFileHandle | null>((resolve, reject) => {
      const tx = db.transaction(FILE_DB_STORE, 'readonly');
      const req = tx.objectStore(FILE_DB_STORE).get('script');
      req.onsuccess = () => resolve((req.result as FileSystemFileHandle) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return handle;
  } catch {
    return null;
  }
}

async function ensureWritePermission(handle: FileSystemFileHandle): Promise<boolean> {
  if ((await handle.queryPermission({ mode: 'write' })) === 'granted') return true;
  return (await handle.requestPermission({ mode: 'write' })) === 'granted';
}

function setSaveStatus(message: string, type: 'idle' | 'saving' | 'saved' | 'error' = 'idle'): void {
  saveStatus.textContent = message;
  saveStatus.className = `save-status${type !== 'idle' ? ` ${type}` : ''}`;
  if (type === 'saved' || type === 'error') {
    if (fileSaveStatusTimer) clearTimeout(fileSaveStatusTimer);
    fileSaveStatusTimer = setTimeout(() => updateSaveStatus(), 3000);
  }
}

function updateSaveStatus(): void {
  if (linkedFileName) {
    setSaveStatus(`자동 저장: ${linkedFileName}`);
  } else if (supportsFileSystemAccess()) {
    setSaveStatus('저장하기로 PC 파일을 연결하세요');
  } else {
    setSaveStatus('이 브라우저는 PC 자동 저장을 지원하지 않습니다');
  }
}

async function writeToLinkedFile(content: string, silent = false): Promise<boolean> {
  if (!linkedFileHandle) return false;
  if (!(await ensureWritePermission(linkedFileHandle))) {
    if (!silent) {
      setSaveStatus('파일 쓰기 권한이 없습니다. 저장하기를 다시 눌러 주세요', 'error');
      await clearLinkedFile();
      updateSaveStatus();
    }
    return false;
  }
  try {
    if (!silent) setSaveStatus('저장 중...', 'saving');
    const writable = await linkedFileHandle.createWritable();
    await writable.write(content);
    await writable.close();
    if (!silent) {
      setSaveStatus(`저장됨: ${linkedFileName}`, 'saved');
    }
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotFoundError') {
      await clearLinkedFile();
      if (!silent) updateSaveStatus();
    }
    if (!silent) {
      setSaveStatus(getSaveErrorMessage(err) || '파일 저장 실패', 'error');
    }
    return false;
  }
}

function scheduleFileSave(): void {
  if (!linkedFileHandle) return;
  if (fileSaveTimer) clearTimeout(fileSaveTimer);
  fileSaveTimer = setTimeout(() => {
    void writeToLinkedFile(scriptEditor.value, true);
  }, 500);
}

async function clearLinkedFile(): Promise<void> {
  linkedFileHandle = null;
  linkedFileName = null;
  try {
    const db = await openFileDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(FILE_DB_STORE, 'readwrite');
      tx.objectStore(FILE_DB_STORE).delete('script');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch { /* ignore */ }
}

function isUserCancelled(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'AbortError' || err.code === 20);
}

function getSaveErrorMessage(err: unknown): string {
  if (isUserCancelled(err)) return '';
  if (err instanceof DOMException) {
    if (err.name === 'SecurityError') {
      return 'PC 저장은 HTTPS 또는 localhost에서만 가능합니다';
    }
    if (err.name === 'NotAllowedError') {
      return '파일 접근 권한이 거부되었습니다';
    }
    if (err.name === 'NotFoundError') {
      return '파일을 찾을 수 없습니다. 다시 연결해 주세요';
    }
  }
  return '파일 저장에 실패했습니다';
}

async function pickSaveFile(suggestedName: string): Promise<FileSystemFileHandle> {
  return window.showSaveFilePicker({ suggestedName });
}

async function linkLinkedFile(handle: FileSystemFileHandle): Promise<void> {
  linkedFileHandle = handle;
  linkedFileName = handle.name;
  await storeFileHandle(handle);
  updateSaveStatus();
}

async function restoreLinkedFile(): Promise<void> {
  if (!supportsFileSystemAccess()) {
    updateSaveStatus();
    return;
  }
  const handle = await loadStoredFileHandle();
  if (!handle) {
    updateSaveStatus();
    return;
  }
  linkedFileHandle = handle;
  linkedFileName = handle.name;
  updateSaveStatus();
}

async function saveToFile(): Promise<void> {
  const content = scriptEditor.value;
  const suggestedName = `${titleInput.value.trim() || '대본'}.txt`;

  if (!window.isSecureContext) {
    downloadAsFile(content, suggestedName);
    setSaveStatus('PC 저장 불가 — 다운로드로 저장했습니다', 'saved');
    return;
  }

  if (!supportsFileSystemAccess()) {
    downloadAsFile(content, suggestedName);
    setSaveStatus('파일을 다운로드했습니다', 'saved');
    return;
  }

  try {
    if (!linkedFileHandle) {
      const handle = await pickSaveFile(suggestedName);
      await linkLinkedFile(handle);
    }

    if (await writeToLinkedFile(content)) {
      script.content = content;
      script.title = titleInput.value.trim() || '새 대본';
      script.updatedAt = Date.now();
      saveState();
    }
  } catch (err) {
    const message = getSaveErrorMessage(err);
    if (message) {
      setSaveStatus(message, 'error');
    } else {
      updateSaveStatus();
    }
  }
}

function downloadAsFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function syncEditorToState(): void {
  script.content = scriptEditor.value;
  script.title = titleInput.value.trim() || '새 대본';
  script.updatedAt = Date.now();
  saveState();
  scheduleFileSave();
}

// ===== Script Parsing =====
function parseScript(text: string): string {
  const lines = text.split('\n');
  return lines.map(line => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//')) {
      const label = trimmed.slice(2).trim();
      return `<span class="section-label">${escapeHtml(label)}</span>`;
    }
    return escapeHtml(line).replace(/\[([^\]]+)\]/g, '<span class="cue-hint">[$1]</span>');
  }).join('\n');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function countWords(text: string): number {
  const korean = (text.match(/[\uAC00-\uD7AF]/g) || []).length;
  const english = (text.match(/[a-zA-Z]+/g) || []).length;
  return korean + english;
}

function estimateReadTime(text: string): string {
  const words = countWords(text);
  const minutes = words / WPM_KOREAN;
  if (minutes < 1) return '약 1분 미만';
  const m = Math.floor(minutes);
  const s = Math.round((minutes - m) * 60);
  return s > 0 ? `약 ${m}분 ${s}초` : `약 ${m}분`;
}

function updateEditorMeta(): void {
  const text = scriptEditor.value;
  const chars = text.replace(/\s/g, '').length;
  charCount.textContent = `${chars.toLocaleString()}자`;
  wordCount.textContent = `${countWords(text).toLocaleString()}단어`;
  readTime.textContent = estimateReadTime(text);
}

// ===== Settings Application =====
function applySettings(): void {
  document.documentElement.setAttribute('data-theme', settings.theme);

  scriptContent.style.fontSize = `${settings.fontSize}px`;
  scriptContent.style.lineHeight = String(settings.lineHeight);
  scriptContent.style.fontFamily = settings.fontFamily;
  document.documentElement.style.setProperty('--font-script', settings.fontFamily);

  fadeTop.classList.toggle('disabled', !settings.fadeEdges);
  fadeBottom.classList.toggle('disabled', !settings.fadeEdges);
  readingGuide.style.display = settings.guideLine ? '' : 'none';

  updateGuidePosition();
  syncSettingsUI();
}

function updateGuidePosition(): void {
  const positions: Record<Settings['readPosition'], string> = {
    center: '50%',
    upper: '33%',
    lower: '66%',
  };
  readingGuide.style.top = positions[settings.readPosition];
}

function syncSettingsUI(): void {
  settingFontSize.value = String(settings.fontSize);
  settingLineHeight.value = String(settings.lineHeight);
  settingFontFamily.value = settings.fontFamily;
  settingTheme.value = settings.theme;
  settingReadPosition.value = settings.readPosition;
  settingFadeEdges.checked = settings.fadeEdges;
  settingGuideLine.checked = settings.guideLine;
  settingDefaultSpeed.value = String(settings.defaultSpeed);
  settingCountdown.checked = settings.countdown;
  settingAutoHide.checked = settings.autoHideControls;
  fontSizeVal.textContent = `${settings.fontSize}px`;
  lineHeightVal.textContent = String(settings.lineHeight);
  defaultSpeedVal.textContent = String(settings.defaultSpeed);
}

// ===== View Management =====
function showWelcome(): void {
  stopPlay();
  welcome.classList.remove('hidden');
  prompterView.classList.add('hidden');
}

function showPrompter(edit = false): void {
  welcome.classList.add('hidden');
  prompterView.classList.remove('hidden');
  renderScript();
  applySettings();
  speed = settings.defaultSpeed;
  speedDisplay.textContent = String(speed);
  scriptTitle.textContent = script.title;

  if (edit || !script.content) {
    openEditor();
  } else {
    closeEditor();
  }
}

function openEditor(): void {
  isEditing = true;
  editorOverlay.classList.remove('hidden');
  titleInput.value = script.title;
  scriptEditor.value = script.content;
  updateEditorMeta();
  updateSaveStatus();
  scriptEditor.focus();
  stopPlay();
}

function closeEditor(): void {
  script.title = titleInput.value.trim() || '새 대본';
  script.content = scriptEditor.value;
  script.updatedAt = Date.now();
  isEditing = false;
  editorOverlay.classList.add('hidden');
  scriptTitle.textContent = script.title;
  renderScript();
  saveState();
  if (linkedFileHandle) {
    if (fileSaveTimer) clearTimeout(fileSaveTimer);
    void writeToLinkedFile(script.content);
  }
}

function renderScript(): void {
  scriptContent.innerHTML = parseScript(script.content) || '<span style="opacity:0.4">대본을 입력하세요...</span>';
  resetScroll();
}

// ===== Scroll & Playback =====
function resetScroll(): void {
  scrollPosition = 0;
  scrollContainer.scrollTop = 0;
  updateProgress();
}

function getMaxScroll(): number {
  return scrollContainer.scrollHeight - scrollContainer.clientHeight;
}

function updateProgress(): void {
  maxScroll = getMaxScroll();
  const pct = maxScroll > 0 ? Math.min(100, (scrollPosition / maxScroll) * 100) : 0;
  progressBar.style.width = `${pct}%`;
  statusProgress.textContent = `${Math.round(pct)}%`;

  const totalWords = countWords(script.content);
  const totalTime = (totalWords / WPM_KOREAN) * 60;
  const elapsed = isPlaying
    ? elapsedBeforePause + (performance.now() - playStartTime) / 1000
    : elapsedBeforePause;
  const remaining = Math.max(0, totalTime - elapsed);

  statusElapsed.textContent = formatTime(elapsed);
  statusRemaining.textContent = `남은 ${formatTime(remaining)}`;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

let lastFrameTime: number | null = null;

function scrollLoop(timestamp: number): void {
  if (!isPlaying) return;

  if (!playStartTime) playStartTime = timestamp;

  if (lastFrameTime === null) {
    lastFrameTime = timestamp;
    animationId = requestAnimationFrame(scrollLoop);
    return;
  }

  const delta = timestamp - lastFrameTime;
  lastFrameTime = timestamp;

  const pixelsPerSecond = speed * 1.2;
  scrollPosition += (pixelsPerSecond * delta) / 1000;
  scrollPosition = Math.min(scrollPosition, getMaxScroll());
  scrollContainer.scrollTop = scrollPosition;

  updateProgress();

  if (scrollPosition >= getMaxScroll()) {
    stopPlay();
    return;
  }

  animationId = requestAnimationFrame(scrollLoop);
}

function startPlay(): void {
  if (isEditing || !script.content.trim()) return;

  if (settings.countdown) {
    runCountdown(() => beginScroll());
  } else {
    beginScroll();
  }
}

function beginScroll(): void {
  isPlaying = true;
  playIcon.textContent = '⏸';
  playLabel.textContent = '일시정지';
  playStartTime = 0;
  lastFrameTime = null;
  animationId = requestAnimationFrame(scrollLoop);
  scheduleHideControls();
}

function stopPlay(): void {
  if (isPlaying && playStartTime > 0) {
    elapsedBeforePause += (performance.now() - playStartTime) / 1000;
  }
  isPlaying = false;
  playIcon.textContent = '▶';
  playLabel.textContent = '시작';
  if (animationId !== null) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  showControls();
}

function togglePlay(): void {
  if (isPlaying) {
    stopPlay();
  } else {
    if (scrollPosition >= getMaxScroll()) {
      resetScroll();
      elapsedBeforePause = 0;
    }
    startPlay();
  }
}

function runCountdown(callback: () => void): void {
  let count = 3;
  countdownEl.classList.remove('hidden');
  countdownNumber.textContent = String(count);

  const tick = () => {
    count--;
    if (count > 0) {
      countdownNumber.textContent = String(count);
      setTimeout(tick, 1000);
    } else {
      countdownEl.classList.add('hidden');
      callback();
    }
  };
  setTimeout(tick, 1000);
}

// ===== Speed =====
function changeSpeed(delta: number): void {
  speed = Math.max(1, Math.min(100, speed + delta));
  speedDisplay.textContent = String(speed);
  saveState();
}

// ===== Mirror & Fullscreen =====
function toggleMirror(): void {
  isMirrored = !isMirrored;
  prompterView.classList.toggle('mirrored', isMirrored);
  btnMirror.classList.toggle('btn-accent', isMirrored);
}

async function toggleFullscreen(): Promise<void> {
  if (!document.fullscreenElement) {
    await prompterView.requestFullscreen();
  } else {
    await document.exitFullscreen();
  }
}

// ===== Controls visibility =====
function scheduleHideControls(): void {
  if (!settings.autoHideControls || !isPlaying) return;
  if (controlsHideTimer) clearTimeout(controlsHideTimer);
  controlsHideTimer = setTimeout(() => {
    if (isPlaying) prompterView.classList.add('controls-hidden');
  }, 3000);
}

function showControls(): void {
  prompterView.classList.remove('controls-hidden');
  if (controlsHideTimer) clearTimeout(controlsHideTimer);
}

function openShortcutsModal(): void {
  shortcutsVisible = true;
  shortcutsHint.classList.remove('hidden');
  shortcutsBackdrop.classList.remove('hidden');
}

function closeShortcutsModal(): void {
  shortcutsVisible = false;
  shortcutsHint.classList.add('hidden');
  shortcutsBackdrop.classList.add('hidden');
}

function toggleShortcutsModal(): void {
  if (shortcutsVisible) closeShortcutsModal();
  else openShortcutsModal();
}

// ===== Settings Panel =====
function openSettings(): void {
  settingsPanel.classList.remove('hidden');
  settingsBackdrop.classList.remove('hidden');
}

function closeSettingsPanel(): void {
  settingsPanel.classList.add('hidden');
  settingsBackdrop.classList.add('hidden');
  saveState();
}

function resetSettings(): void {
  settings = { ...DEFAULT_SETTINGS };
  speed = settings.defaultSpeed;
  speedDisplay.textContent = String(speed);
  applySettings();
  saveState();
}

// ===== File I/O =====
function importFile(file: File): void {
  const reader = new FileReader();
  reader.onload = () => {
    const text = reader.result as string;
    script.content = text;
    script.title = file.name.replace(/\.(txt|md|text)$/i, '');
    script.updatedAt = Date.now();
    showPrompter(true);
    saveState();
  };
  reader.readAsText(file, 'UTF-8');
}

// ===== Keyboard Shortcuts =====
function handleKeydown(e: KeyboardEvent): void {
  const target = e.target as HTMLElement;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
    if (e.key === 'Escape' && isEditing) {
      closeEditor();
    }
    return;
  }

  switch (e.key) {
    case ' ':
      e.preventDefault();
      togglePlay();
      break;
    case 'ArrowUp':
      e.preventDefault();
      changeSpeed(5);
      break;
    case 'ArrowDown':
      e.preventDefault();
      changeSpeed(-5);
      break;
    case 'e':
    case 'E':
      if (!isEditing) openEditor();
      break;
    case 'm':
    case 'M':
      toggleMirror();
      break;
    case 'f':
    case 'F':
      toggleFullscreen();
      break;
    case 'r':
    case 'R':
      resetScroll();
      elapsedBeforePause = 0;
      break;
    case 'Escape':
      if (!settingsPanel.classList.contains('hidden')) {
        closeSettingsPanel();
      } else if (shortcutsVisible) {
        closeShortcutsModal();
      } else {
        showControls();
      }
      break;
    case '?':
      toggleShortcutsModal();
      break;
    case '+':
    case '=':
      changeSpeed(5);
      break;
    case '-':
      changeSpeed(-5);
      break;
  }
}

// ===== Event Listeners =====
function bindEvents(): void {
  welcomeNewBtn.addEventListener('click', () => {
    script = { title: '새 대본', content: '', updatedAt: Date.now() };
    showPrompter(true);
  });

  fileImport.addEventListener('change', () => {
    const file = fileImport.files?.[0];
    if (file) importFile(file);
    fileImport.value = '';
  });

  fileImportEditor.addEventListener('change', () => {
    const file = fileImportEditor.files?.[0];
    if (file) importFile(file);
    fileImportEditor.value = '';
  });

  btnBack.addEventListener('click', () => {
    stopPlay();
    saveState();
    showWelcome();
  });

  btnPlay.addEventListener('click', togglePlay);
  btnSpeedUp.addEventListener('click', () => changeSpeed(5));
  btnSpeedDown.addEventListener('click', () => changeSpeed(-5));
  btnEdit.addEventListener('click', openEditor);
  btnMirror.addEventListener('click', toggleMirror);
  btnFullscreen.addEventListener('click', toggleFullscreen);
  btnSettings.addEventListener('click', openSettings);

  btnDoneEdit.addEventListener('click', closeEditor);
  btnClear.addEventListener('click', () => {
    if (confirm('대본을 모두 지울까요?')) {
      scriptEditor.value = '';
      updateEditorMeta();
    }
  });
  btnSave.addEventListener('click', () => { void saveToFile(); });
  scriptEditor.addEventListener('input', () => {
    updateEditorMeta();
    clearTimeout((scriptEditor as { saveTimer?: ReturnType<typeof setTimeout> }).saveTimer);
    (scriptEditor as { saveTimer?: ReturnType<typeof setTimeout> }).saveTimer = setTimeout(() => {
      syncEditorToState();
    }, 500);
  });
  titleInput.addEventListener('input', () => {
    script.title = titleInput.value.trim() || '새 대본';
    scheduleFileSave();
  });

  btnCloseSettings.addEventListener('click', closeSettingsPanel);
  settingsBackdrop.addEventListener('click', closeSettingsPanel);
  btnResetSettings.addEventListener('click', resetSettings);
  btnCloseShortcuts.addEventListener('click', closeShortcutsModal);
  shortcutsBackdrop.addEventListener('click', closeShortcutsModal);

  // Settings change handlers
  settingFontSize.addEventListener('input', () => {
    settings.fontSize = Number(settingFontSize.value);
    fontSizeVal.textContent = `${settings.fontSize}px`;
    applySettings();
  });
  settingLineHeight.addEventListener('input', () => {
    settings.lineHeight = Number(settingLineHeight.value);
    lineHeightVal.textContent = String(settings.lineHeight);
    applySettings();
  });
  settingFontFamily.addEventListener('change', () => {
    settings.fontFamily = settingFontFamily.value;
    applySettings();
  });
  settingTheme.addEventListener('change', () => {
    settings.theme = settingTheme.value as Settings['theme'];
    applySettings();
  });
  settingReadPosition.addEventListener('change', () => {
    settings.readPosition = settingReadPosition.value as Settings['readPosition'];
    updateGuidePosition();
  });
  settingFadeEdges.addEventListener('change', () => {
    settings.fadeEdges = settingFadeEdges.checked;
    applySettings();
  });
  settingGuideLine.addEventListener('change', () => {
    settings.guideLine = settingGuideLine.checked;
    applySettings();
  });
  settingDefaultSpeed.addEventListener('input', () => {
    settings.defaultSpeed = Number(settingDefaultSpeed.value);
    defaultSpeedVal.textContent = String(settings.defaultSpeed);
  });
  settingCountdown.addEventListener('change', () => {
    settings.countdown = settingCountdown.checked;
  });
  settingAutoHide.addEventListener('change', () => {
    settings.autoHideControls = settingAutoHide.checked;
  });

  displayArea.addEventListener('mousemove', () => {
    if (isPlaying) {
      showControls();
      scheduleHideControls();
    }
  });

  scrollContainer.addEventListener('wheel', (e) => {
    if (isPlaying) {
      e.preventDefault();
      changeSpeed(e.deltaY < 0 ? 2 : -2);
    }
  }, { passive: false });

  document.addEventListener('keydown', handleKeydown);

  window.addEventListener('resize', () => {
    updateGuidePosition();
    maxScroll = getMaxScroll();
  });
}

// ===== Init =====
function init(): void {
  loadState();
  applySettings();
  bindEvents();
  void restoreLinkedFile();

  if (script.content) {
    showPrompter(false);
  }
}

init();
