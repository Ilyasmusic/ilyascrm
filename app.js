// =================== ГЛОБАЛЬНЫЕ ФУНКЦИИ ===================
function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

function escapeCSV(str) {
  if (typeof str !== 'string') str = String(str);
  return `"${str.replace(/"/g, '""')}"`;
}

function showToast(msg, dur = 2000) {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), dur);
}

const STORAGE_KEY = 'businessSolo';

function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  const def = {
    clients: [],
    obligations: [],
    funnel: {
      stages: ['Созвонились', 'Договорились о цене', 'Получена предоплата', 'Выполнено'],
      clientStage: {},
      trash: []
    },
    lastBackupTime: null,
    theme: 'light',
    themeStartTime: '20:00',
    themeEndTime: '07:00',
    security: { enabled: false, pin: null, recovery: null }
  };
  if (!raw) return def;
  try {
    const p = JSON.parse(raw);
    if (!p.funnel) p.funnel = def.funnel;
    if (!p.funnel.stages) p.funnel.stages = def.funnel.stages;
    if (!p.funnel.clientStage) p.funnel.clientStage = {};
    if (!p.funnel.trash) p.funnel.trash = [];
    p.funnel.trash = p.funnel.trash.map(t =>
      t.stageIndex === undefined && t.stage
        ? { ...t, stageIndex: p.funnel.stages.indexOf(t.stage) }
        : t
    );
    p.clients.forEach(c => { if (!c.type) c.type = 'individual'; });
    if (!p.security) p.security = def.security;
    p.theme = p.theme || 'light';
    return p;
  } catch (e) { return def; }
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  document.dispatchEvent(new CustomEvent('data-updated'));
}

// Тема
function applyTheme() {
  const data = loadData();
  if (data.theme === 'dark') document.body.classList.add('dark');
  else if (data.theme === 'light') document.body.classList.remove('dark');
  else if (data.theme === 'auto') {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = (data.themeStartTime || '20:00').split(':').map(Number);
    const [endH, endM] = (data.themeEndTime || '07:00').split(':').map(Number);
    const start = startH * 60 + startM;
    const end = endH * 60 + endM;
    const isDark = start < end ? (currentMinutes >= start && currentMinutes < end) : (currentMinutes >= start || currentMinutes < end);
    document.body.classList.toggle('dark', isDark);
  }
}
applyTheme();
setInterval(applyTheme, 60000);

function updateLastBackupLabel() {
  const data = loadData();
  const label = document.getElementById('lastBackupLabel');
  if (!label) return;
  if (data.lastBackupTime) {
    const d = new Date(data.lastBackupTime);
    label.textContent = 'Бэкап: ' + d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  } else label.textContent = 'Бэкап: никогда';
}
document.addEventListener('data-updated', updateLastBackupLabel);

// Модальные окна
const modals = {};
function showModal(id, mode = 'default') {
  if (!modals[id]) modals[id] = document.getElementById(id);
  if (modals[id]) {
    if (id === 'consentModal' && mode === 'view') {
      document.getElementById('consentCheckboxGroup').style.display = 'none';
      document.getElementById('acceptConsentBtn').style.display = 'none';
    } else if (id === 'consentModal') {
      document.getElementById('consentCheckboxGroup').style.display = 'block';
      document.getElementById('acceptConsentBtn').style.display = 'block';
    }
    modals[id].style.display = 'flex';
  }
  if (id === 'stagesModal' && window.funnelTabInstance) window.funnelTabInstance.renderStagesManagement();
  window.history.pushState({ modalOpen: id }, '');
}

function hideModal(id) {
  if (modals[id]) modals[id].style.display = 'none';
  if (window.history.length) window.history.back();
}

// Переключение вкладок
function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  const el = document.getElementById(`tab-${tab}`);
  if (el) el.classList.add('active');
  const btn = document.querySelector(`.nav-item[data-tab="${tab}"]`);
  if (btn) btn.classList.add('active');
  document.getElementById('headerTitle').textContent = {
    clients: 'Клиенты',
    tasks: 'Задачи',
    funnel: 'Воронка',
    accounting: 'Бухгалтерия',
    settings: 'Настройки'
  }[tab];
  document.dispatchEvent(new CustomEvent('tab-switched', { detail: tab }));
}

// =================== PIN-КОД ===================
const appDiv = document.getElementById('app');
const lockScreen = document.getElementById('lockScreen');
const unlockBtn = document.getElementById('unlockBtn');
const forgotPinBtn = document.getElementById('forgotPinBtn');
const recoveryBlock = document.getElementById('recoveryBlock');
const recoverySubmitBtn = document.getElementById('recoverySubmitBtn');
const cancelRecoveryBtn = document.getElementById('cancelRecoveryBtn');
const recoveryCodeInput = document.getElementById('recoveryCodeInput');
const fullResetBtn = document.getElementById('fullResetBtn');

let pinDigits = [];
const PIN_LENGTH = 4;
const MAX_ATTEMPTS = 3;
let pinAttempts = 0;
let recoveryAttempts = 0;

function updatePinDisplay() {
  const display = document.getElementById('pinDisplay');
  display.textContent = pinDigits.map(() => '●').join('').padEnd(PIN_LENGTH, '○');
}

function resetPinInput() {
  pinDigits = [];
  updatePinDisplay();
}

function showLockScreen() {
  let data = loadData();
  // Автоисправление: если защита включена, но PIN не задан – отключаем защиту
  if (data.security.enabled && !data.security.pin) {
    data.security.enabled = false;
    data.security.recovery = null;
    saveData(data);
    // обновим данные, чтобы условие ниже точно сработало
    data = loadData();
  }
  if (data.security.enabled && data.security.pin) {
    appDiv.classList.add('locked');
    resetPinInput();
    recoveryBlock.style.display = 'none';
    fullResetBtn.style.display = 'none';
    pinAttempts = 0;
  } else {
    appDiv.classList.remove('locked');
  }
}

// Клавиатура PIN
const keypad = document.getElementById('pinKeypad');
keypad.addEventListener('click', (e) => {
  const btn = e.target.closest('.pin-key');
  if (!btn) return;
  const digit = btn.dataset.digit;
  if (digit !== undefined) {
    if (pinDigits.length < PIN_LENGTH) {
      pinDigits.push(digit);
      updatePinDisplay();
      if (pinDigits.length === PIN_LENGTH) unlockBtn.focus();
    }
  } else if (btn.id === 'pinDelete') {
    pinDigits.pop();
    updatePinDisplay();
  }
});

unlockBtn.addEventListener('click', () => {
  if (pinDigits.length !== PIN_LENGTH) {
    showToast('Введите 4 цифры');
    return;
  }
  const data = loadData();
  if (pinDigits.join('') === data.security.pin) {
    appDiv.classList.remove('locked');
    pinAttempts = 0;
    fullResetBtn.style.display = 'none';
  } else {
    pinAttempts++;
    showToast('Неверный PIN');
    resetPinInput();
    if (pinAttempts >= MAX_ATTEMPTS) fullResetBtn.style.display = 'block';
  }
});

forgotPinBtn.addEventListener('click', () => {
  recoveryBlock.style.display = 'block';
  recoveryCodeInput.value = '';
  recoveryCodeInput.focus();
  recoveryAttempts = 0;
  fullResetBtn.style.display = 'none';
});

cancelRecoveryBtn.addEventListener('click', () => {
  recoveryBlock.style.display = 'none';
});

recoverySubmitBtn.addEventListener('click', () => {
  const data = loadData();
  if (recoveryCodeInput.value.trim() === data.security.recovery) {
    data.security.enabled = false;
    data.security.pin = null;
    data.security.recovery = null;
    saveData(data);
    showToast('PIN сброшен. Защита отключена. Вы можете включить её заново в настройках.');
    appDiv.classList.remove('locked');
    recoveryBlock.style.display = 'none';
    switchTab('settings');
    recoveryAttempts = 0;
    fullResetBtn.style.display = 'none';
  } else {
    recoveryAttempts++;
    showToast('Неверный код восстановления');
    if (recoveryAttempts >= MAX_ATTEMPTS) fullResetBtn.style.display = 'block';
  }
});

// Полная очистка данных
fullResetBtn.addEventListener('click', () => {
  if (confirm('⚠️ Удалить все данные? Восстановить их будет невозможно.')) {
    localStorage.clear();
    location.reload();
  }
});

// =================== КЛИЕНТЫ ===================
class ClientsTab {
  constructor(container) {
    this.container = container;
    this.searchQuery = '';
    this.container.innerHTML = `<input class="search-input" placeholder="🔍 Поиск..." id="clientSearch"><button class="fab" id="addClientFab">+</button><div id="clientListContainer"></div>`;
    this.listContainer = document.getElementById('clientListContainer');
    document.getElementById('clientSearch').addEventListener('input', e => { this.searchQuery = e.target.value; this.renderList(); });
    this.container.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (btn) {
        if (btn.id === 'addClientFab') showModal('clientModal');
        if (btn.dataset.action === 'edit') { const id = btn.closest('.list-item')?.dataset.clientId; if (id) this.editClient(id); }
        if (btn.dataset.action === 'delete') { const id = btn.closest('.list-item')?.dataset.clientId; if (id && confirm('Удалить?')) this.deleteClient(id); }
        return;
      }
      const item = e.target.closest('.list-item');
      if (item && !e.target.closest('button')) this.showClientInfo(item.dataset.clientId);
    });
    document.addEventListener('data-updated', () => this.renderList());
    this.renderList();
  }
  deleteClient(id) { let d = loadData(); d.clients = d.clients.filter(c => c.id !== id); d.obligations = d.obligations.filter(o => o.clientId !== id); delete d.funnel.clientStage[id]; d.funnel.trash = d.funnel.trash.filter(t => t.clientId !== id); saveData(d); }
  editClient(id) { const d = loadData(); const c = d.clients.find(c => c.id === id); if (!c) return; document.getElementById('clientId').value = c.id; document.getElementById('clientFIO').value = c.fio; document.getElementById('clientPhone').value = c.phone || ''; document.getElementById('clientEmail').value = c.email || ''; document.getElementById('clientAddress').value = c.address || ''; document.getElementById('clientDesc').value = c.desc || ''; document.getElementById('clientType').value = c.type || 'individual'; showModal('clientModal'); }
  showClientInfo(id) {
    const d = loadData(); const c = d.clients.find(c => c.id === id); if (!c) return;
    const obl = d.obligations.filter(o => o.clientId === id);
    const content = document.getElementById('clientDetailContent');
    content.innerHTML = `
      <p><strong>ФИО:</strong> ${escapeHtml(c.fio)}</p>
      <p><strong>Тип:</strong> ${c.type === 'company' ? 'Юрлицо/ИП' : 'Физлицо'}</p>
      <p><strong>Телефон:</strong> ${c.phone ? `<a href="tel:${escapeHtml(c.phone)}">${escapeHtml(c.phone)}</a>` : '-'}</p>
      <p><strong>Email:</strong> ${c.email ? `<a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a>` : '-'}</p>
      <p><strong>Адрес:</strong> ${escapeHtml(c.address || '-')}</p>
      <p><strong>Описание:</strong> ${escapeHtml(c.desc || '-')}</p>
      <h4>Обязательства:</h4> ${obl.map(o => `<div>📌 ${escapeHtml(o.desc)} (${o.date ? new Date(o.date).toLocaleDateString() : 'без срока'}) - Пред: ${o.prepay}₽, Пост: ${o.postpay}₽</div>`).join('')}
      <div class="modal-buttons"><button class="btn btn-sm" id="editClientFromDetail">Редактировать</button><button class="btn btn-sm btn-danger" id="deleteClientFromDetail">Удалить</button></div>`;
    document.getElementById('editClientFromDetail').onclick = () => { hideModal('clientDetailModal'); this.editClient(id); };
    document.getElementById('deleteClientFromDetail').onclick = () => { if (confirm('Удалить?')) { this.deleteClient(id); hideModal('clientDetailModal'); } };
    showModal('clientDetailModal');
  }
  renderList() {
    const d = loadData(); const filtered = d.clients.filter(c => c.fio.toLowerCase().includes(this.searchQuery.toLowerCase()));
    this.listContainer.innerHTML = filtered.map(c => `<div class="list-item" data-client-id="${c.id}"><div class="info"><strong>${escapeHtml(c.fio)}</strong> <span style="color:gray;font-size:0.7rem;">${c.type === 'company' ? 'ЮЛ' : 'ФЛ'}</span></div><button class="btn btn-sm" data-action="edit">✏️</button><button class="btn btn-sm btn-danger" data-action="delete">🗑</button></div>`).join('') || '<p style="text-align:center;color:gray;">Нет клиентов</p>';
  }
}

// =================== ЗАДАЧИ ===================
class TasksTab {
  constructor(container) { this.container = container; this.render(); document.addEventListener('data-updated', () => this.render());
    this.container.addEventListener('click', e => {
      const btn = e.target.closest('button'); if (!btn) return;
      if (btn.id === 'addTaskFab') { document.getElementById('taskId').value = ''; document.getElementById('taskModalTitle').textContent = 'Новое обязательство'; showModal('taskModal'); }
      if (btn.dataset.action === 'togglePre') { const id = btn.closest('.list-item')?.dataset.obligId; if (id) this.toggleObligation(id, 'prepaid'); }
      if (btn.dataset.action === 'togglePost') { const id = btn.closest('.list-item')?.dataset.obligId; if (id) this.toggleObligation(id, 'postpaid'); }
      if (btn.dataset.action === 'edit') { const id = btn.closest('.list-item')?.dataset.obligId; if (id) this.editObligation(id); }
      if (btn.dataset.action === 'delete') { const id = btn.closest('.list-item')?.dataset.obligId; if (id && confirm('Удалить?')) this.deleteObligation(id); }
    });
  }
  toggleObligation(id, field) { let d = loadData(); const o = d.obligations.find(o => o.id === id); if (!o) return; o[field] = !o[field]; saveData(d); }
  editObligation(id) { const d = loadData(); const o = d.obligations.find(o => o.id === id); if (!o) return;
    document.getElementById('taskId').value = o.id; document.getElementById('taskClientSelect').value = o.clientId;
    document.getElementById('taskDesc').value = o.desc; document.getElementById('taskPrepay').value = o.prepay || '';
    document.getElementById('taskPostpay').value = o.postpay || ''; document.getElementById('taskCosts').value = o.costs || '';
    document.getElementById('taskDate').value = o.date; document.getElementById('taskModalTitle').textContent = 'Редактировать';
    showModal('taskModal');
  }
  deleteObligation(id) { let d = loadData(); d.obligations = d.obligations.filter(o => o.id !== id); saveData(d); }
  render() {
    const d = loadData(); const obl = [...d.obligations].sort((a, b) => {
      if (a.date && b.date) return new Date(a.date) - new Date(b.date);
      if (a.date) return -1; if (b.date) return 1; return parseInt(b.id) - parseInt(a.id);
    });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let html = '<button class="fab" id="addTaskFab">+</button>';
    obl.forEach(o => {
      const clientName = o.clientId === 'tax' ? '🧾 Налог' : (d.clients.find(c => c.id === o.clientId)?.fio || 'Неизвестный');
      const dateStr = o.date ? new Date(o.date).toLocaleDateString() : 'без срока';
      const overdue = o.date && new Date(o.date) < today ? 'style="border-left:4px solid var(--danger);"' : '';
      const rowClass = o.clientId === 'tax' ? 'tax-row' : '';
      html += `<div class="list-item ${rowClass}" data-oblig-id="${o.id}" ${overdue}>
        <div class="info"><strong>${escapeHtml(clientName)}</strong>: ${escapeHtml(o.desc)}<br><small>📅 ${dateStr} | 💰 ${o.prepay}/${o.postpay}₽</small></div>
        <div class="actions">
          ${o.clientId === 'tax' ? '' : `<button class="btn btn-sm ${o.prepaid ? 'btn-success' : ''}" data-action="togglePre">Прд</button><button class="btn btn-sm ${o.postpaid ? 'btn-success' : ''}" data-action="togglePost">Пст</button>`}
          <button class="btn btn-sm" data-action="edit">✏️</button>
          <button class="btn btn-sm btn-danger" data-action="delete">🗑</button>
        </div></div>`;
    });
    if (obl.length === 0) html += '<p style="text-align:center;color:gray;">Нет задач</p>';
    this.container.innerHTML = html;
  }
}

// =================== ВОРОНКА ===================
class FunnelTab {
  constructor(container) { this.container = container; window.funnelTabInstance = this; this.render(); document.addEventListener('data-updated', () => this.render());
    this.container.addEventListener('click', e => {
      const btn = e.target.closest('button'); if (!btn) return;
      if (btn.id === 'addToFunnelBtn') this.showAddToFunnel();
      if (btn.id === 'trashBtn') this.showTrash();
      if (btn.id === 'manageStagesBtn') showModal('stagesModal');
      if (btn.dataset.move) { const [c, d] = btn.dataset.move.split(','); this.moveClient(c, d); }
      if (btn.dataset.trashClient) { if (confirm('Удалить в мусорку?')) this.sendToTrash(btn.dataset.trashClient); }
    });
  }
  moveClient(cid, dir) { let d = loadData(); let cur = d.funnel.clientStage[cid] ?? 0; if (dir === 'right') cur = Math.min(cur + 1, d.funnel.stages.length - 1); else cur = Math.max(cur - 1, 0); d.funnel.clientStage[cid] = cur; saveData(d); }
  sendToTrash(cid) { let d = loadData(); const c = d.clients.find(c => c.id === cid); if (!c) return; d.funnel.trash.push({ clientId: cid, clientName: c.fio, stageIndex: d.funnel.clientStage[cid] ?? 0, dateRemoved: new Date().toISOString() }); delete d.funnel.clientStage[cid]; saveData(d); }
  showTrash() {
    const d = loadData(); const trash = d.funnel.trash; const stats = {}; trash.forEach(t => { const s = d.funnel.stages[t.stageIndex] || '?'; stats[s] = (stats[s] || 0) + 1; });
    let html = trash.map(t => `<div class="list-item"><span>${escapeHtml(t.clientName)} — «${escapeHtml(d.funnel.stages[t.stageIndex] || '?')}»</span><button class="btn btn-sm" data-restore="${t.clientId}">↩️</button></div>`).join('');
    html += `<div style="margin-top:12px;"><strong>Отвалы:</strong><br>${Object.entries(stats).map(([s, c]) => `${escapeHtml(s)}: ${c}<br>`).join('')}</div>`;
    html += '<button id="clearTrashBtn" class="btn btn-danger btn-sm" style="margin-top:12px;">Очистить</button>';
    document.getElementById('trashContent').innerHTML = html; showModal('trashModal');
    document.querySelectorAll('[data-restore]').forEach(b => b.onclick = () => { let d = loadData(); const it = d.funnel.trash.find(t => t.clientId === b.dataset.restore); if (it) { d.funnel.clientStage[it.clientId] = it.stageIndex; d.funnel.trash = d.funnel.trash.filter(t => t.clientId !== it.clientId); saveData(d); this.showTrash(); } });
    document.getElementById('clearTrashBtn').onclick = () => { if (confirm('Очистить?')) { let d = loadData(); d.funnel.trash = []; saveData(d); hideModal('trashModal'); showToast('Мусорка очищена'); } };
  }
  showAddToFunnel() {
    const d = loadData(); const inF = new Set(Object.keys(d.funnel.clientStage)); const inT = new Set(d.funnel.trash.map(t => t.clientId));
    const avail = d.clients.filter(c => !inF.has(c.id) && !inT.has(c.id));
    document.getElementById('addToFunnelContent').innerHTML = avail.length ? avail.map(c => `<div class="list-item" data-cid="${c.id}">${escapeHtml(c.fio)}<button class="btn btn-sm">+</button></div>`).join('') : '<p>Все уже в воронке</p>';
    showModal('addToFunnelModal');
    document.querySelectorAll('#addToFunnelContent .list-item').forEach(item => item.addEventListener('click', () => { let d = loadData(); d.funnel.clientStage[item.dataset.cid] = 0; saveData(d); hideModal('addToFunnelModal'); }));
  }
  renderStagesManagement() {
    const data = loadData(); const container = document.getElementById('stagesList');
    if (!container) return;
    container.innerHTML = data.funnel.stages.map((s, idx) => `
      <div style="display:flex; align-items:center; margin-bottom:8px;">
        <input type="text" value="${escapeHtml(s)}" data-stage-idx="${idx}" style="flex:1;">
        <button class="btn btn-sm" data-move-stage="${idx},up" ${idx === 0 ? 'disabled' : ''}>↑</button>
        <button class="btn btn-sm" data-move-stage="${idx},down" ${idx === data.funnel.stages.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="btn btn-sm btn-danger" data-del-stage="${idx}" style="margin-left:4px;">🗑</button>
      </div>`).join('');
    container.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('change', () => {
        const idx = parseInt(inp.dataset.stageIdx);
        let d = loadData();
        d.funnel.stages[idx] = inp.value.trim() || d.funnel.stages[idx];
        saveData(d);
      });
    });
    container.querySelectorAll('[data-move-stage]').forEach(btn => {
      btn.addEventListener('click', () => {
        const [idx, dir] = btn.dataset.moveStage.split(','); const i = parseInt(idx);
        let d = loadData(); const stages = d.funnel.stages;
        if (dir === 'up' && i > 0) {
          [stages[i], stages[i - 1]] = [stages[i - 1], stages[i]];
          for (const [cid, s] of Object.entries(d.funnel.clientStage)) { if (s === i) d.funnel.clientStage[cid] = i - 1; else if (s === i - 1) d.funnel.clientStage[cid] = i; }
          for (const item of d.funnel.trash) { if (item.stageIndex === i) item.stageIndex = i - 1; else if (item.stageIndex === i - 1) item.stageIndex = i; }
        } else if (dir === 'down' && i < stages.length - 1) {
          [stages[i], stages[i + 1]] = [stages[i + 1], stages[i]];
          for (const [cid, s] of Object.entries(d.funnel.clientStage)) { if (s === i) d.funnel.clientStage[cid] = i + 1; else if (s === i + 1) d.funnel.clientStage[cid] = i; }
          for (const item of d.funnel.trash) { if (item.stageIndex === i) item.stageIndex = i + 1; else if (item.stageIndex === i + 1) item.stageIndex = i; }
        }
        saveData(d); this.renderStagesManagement();
      });
    });
    container.querySelectorAll('[data-del-stage]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.delStage); const d = loadData();
        const movedCount = Object.values(d.funnel.clientStage).filter(s => s === idx).length + d.funnel.trash.filter(t => t.stageIndex === idx).length;
        if (!confirm(`Удалить стадию «${d.funnel.stages[idx]}»? ${movedCount} клиентов будут перенесены на предыдущую стадию.`)) return;
        if (d.funnel.stages.length <= 1) return;
        const newIdx = idx === 0 ? 0 : idx - 1;
        for (const [cid, s] of Object.entries(d.funnel.clientStage)) { if (s === idx) d.funnel.clientStage[cid] = newIdx; else if (s > idx) d.funnel.clientStage[cid] = s - 1; }
        for (const item of d.funnel.trash) { if (item.stageIndex === idx) item.stageIndex = newIdx; else if (item.stageIndex > idx) item.stageIndex -= 1; }
        d.funnel.stages.splice(idx, 1);
        saveData(d); this.renderStagesManagement();
      });
    });
    document.getElementById('addStageBtn').onclick = () => {
      const name = document.getElementById('newStageName').value.trim(); if (!name) return;
      let d = loadData(); d.funnel.stages.push(name);
      saveData(d); document.getElementById('newStageName').value = ''; this.renderStagesManagement();
    };
  }
  render() {
    const data = loadData();
    let html = '<div style="display:flex; justify-content:space-between; margin-bottom:12px;">';
    html += '<button class="btn btn-sm" id="trashBtn">🗑️ Мусорка</button>';
    html += '<button class="btn btn-sm" id="addToFunnelBtn">+ Клиент</button>';
    html += '</div><div class="funnel-columns">';
    data.funnel.stages.forEach((stage, idx) => {
      const clientsInStage = Object.entries(data.funnel.clientStage).filter(([_, s]) => s === idx).map(([cid]) => data.clients.find(c => c.id === cid)).filter(Boolean);
      html += `<div class="funnel-col"><h3>${escapeHtml(stage)}</h3>`;
      clientsInStage.forEach(client => {
        html += `<div class="funnel-card"><span>${escapeHtml(client.fio)}</span><div>
          <button class="btn btn-sm" data-move="${client.id},left">←</button>
          <button class="btn btn-sm" data-move="${client.id},right">→</button>
          <button class="btn btn-sm btn-warning" data-trash-client="${client.id}">🗑</button></div></div>`;
      });
      html += '</div>';
    });
    html += '</div><button class="btn btn-sm" id="manageStagesBtn" style="margin-top:10px;">Управление стадиями</button>';
    this.container.innerHTML = html;
  }
}

// =================== БУХГАЛТЕРИЯ ===================
class AccountingTab {
  constructor(container) {
    this.container = container;
    this.currentPeriod = 'all';
    this.currentCustomFrom = '';
    this.currentCustomTo = '';
    document.addEventListener('data-updated', () => this.render());
    this.render();
  }
  getFiltered(filter = null) {
    const data = loadData();
    if (!filter) {
      const sel = this.container.querySelector('#periodSelect');
      const df = this.container.querySelector('#dateFrom');
      const dt = this.container.querySelector('#dateTo');
      if (!sel) return data.obligations;
      filter = { period: sel.value, customFrom: df?.value, customTo: dt?.value };
    }
    const { period, customFrom, customTo } = filter;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return data.obligations.filter(o => {
      if (!o.date) return period === 'all';
      const d = new Date(o.date);
      switch (period) {
        case 'today': return d >= todayStart && d < new Date(todayStart.getTime() + 86400000);
        case 'week': { const day = now.getDay() || 7; const mon = new Date(now); mon.setDate(now.getDate() - day + 1); mon.setHours(0,0,0,0); const sun = new Date(mon); sun.setDate(mon.getDate() + 6); sun.setHours(23,59,59,999); return d >= mon && d <= sun; }
        case 'month': return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        case 'year': return d.getFullYear() === now.getFullYear();
        case 'lastMonth': { const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1); const lme = new Date(now.getFullYear(), now.getMonth(), 0); lme.setHours(23,59,59,999); return d >= lm && d <= lme; }
        case 'lastYear': return d.getFullYear() === now.getFullYear() - 1;
        case 'custom': {
          const from = customFrom ? new Date(customFrom) : null; const to = customTo ? new Date(customTo) : null;
          if (from) from.setHours(0,0,0,0); if (to) to.setHours(23,59,59,999);
          if (from && to) return d >= from && d <= to;
          if (from) return d >= from; if (to) return d <= to; return true;
        }
        default: return true;
      }
    });
  }
  render() {
    const filtered = this.getFiltered(); const data = loadData();
    const s = { expPre:0, recPre:0, expPost:0, recPost:0, costs:0 };
    let taxBaseInd = 0, taxBaseComp = 0;
    filtered.forEach(o => {
      if (!o.prepaid) s.expPre += o.prepay; else s.recPre += o.prepay;
      if (!o.postpaid) s.expPost += o.postpay; else s.recPost += o.postpay;
      s.costs += o.costs;
      if (o.clientId !== 'tax') {
        const client = data.clients.find(c => c.id === o.clientId);
        const income = (o.prepaid ? o.prepay : 0) + (o.postpaid ? o.postpay : 0);
        if (client && client.type === 'company') taxBaseComp += income;
        else taxBaseInd += income;
      }
    });
    const taxAmount = taxBaseInd * 0.04 + taxBaseComp * 0.06;
    const profit = s.recPre + s.recPost - s.costs - taxAmount;
    this.container.innerHTML = `
      <div class="card">
        <select id="periodSelect" style="width:100%;margin-bottom:8px;">
          <option value="all">Всё время</option><option value="today">Сегодня</option><option value="week">Неделя</option>
          <option value="month">Месяц</option><option value="year">Год</option><option value="lastMonth">Прошлый месяц</option>
          <option value="lastYear">Прошлый год</option><option value="custom">Произвольный</option>
        </select>
        <div id="customRange" style="display:${this.currentPeriod==='custom'?'flex':'none'};gap:8px;margin-bottom:8px;">
          <input type="date" id="dateFrom"><input type="date" id="dateTo">
        </div>
        <div class="summary-grid">
          <div class="summary-card"><h4>Предоплаты к получению</h4><div class="value">${s.expPre.toFixed(2)}₽</div></div>
          <div class="summary-card"><h4>Получено предоплат</h4><div class="value" style="color:green">${s.recPre.toFixed(2)}₽</div></div>
          <div class="summary-card"><h4>Постоплаты к получению</h4><div class="value">${s.expPost.toFixed(2)}₽</div></div>
          <div class="summary-card"><h4>Получено постоплат</h4><div class="value" style="color:green">${s.recPost.toFixed(2)}₽</div></div>
          <div class="summary-card"><h4>Затраты</h4><div class="value" style="color:red">${s.costs.toFixed(2)}₽</div></div>
          <div class="summary-card"><h4>Налог НПД</h4><div class="value">${taxAmount.toFixed(2)}₽</div><small>ФЛ 4%: ${(taxBaseInd*0.04).toFixed(2)} / ЮЛ 6%: ${(taxBaseComp*0.06).toFixed(2)}</small></div>
          <div class="summary-card"><h4>Чистая прибыль</h4><div class="value">${profit.toFixed(2)}₽</div></div>
        </div>
      </div>`;
    const periodSelect = this.container.querySelector('#periodSelect');
    const customRange = this.container.querySelector('#customRange');
    const dateFromInput = this.container.querySelector('#dateFrom');
    const dateToInput = this.container.querySelector('#dateTo');
    if (periodSelect) {
      periodSelect.value = this.currentPeriod;
      if (this.currentPeriod === 'custom') {
        if (dateFromInput && this.currentCustomFrom) dateFromInput.value = this.currentCustomFrom;
        if (dateToInput && this.currentCustomTo) dateToInput.value = this.currentCustomTo;
      }
      periodSelect.addEventListener('change', () => {
        this.currentPeriod = periodSelect.value;
        if (this.currentPeriod === 'custom') {
          customRange.style.display = 'flex';
          if (dateFromInput && this.currentCustomFrom) dateFromInput.value = this.currentCustomFrom;
          if (dateToInput && this.currentCustomTo) dateToInput.value = this.currentCustomTo;
        } else {
          customRange.style.display = 'none';
          this.currentCustomFrom = '';
          this.currentCustomTo = '';
        }
        this.render();
      });
    }
    if (dateFromInput) { dateFromInput.addEventListener('change', () => { this.currentCustomFrom = dateFromInput.value; this.render(); }); }
    if (dateToInput) { dateToInput.addEventListener('change', () => { this.currentCustomTo = dateToInput.value; this.render(); }); }
  }
}

// =================== НАСТРОЙКИ (с PIN) ===================
class SettingsTab {
  constructor(container) { this.container = container; this.render(); }
  render() {
    const data = loadData();
    this.container.innerHTML = `
      <div class="card"><h3>🔒 Защита паролем</h3>
        <label style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
          <input type="checkbox" id="securityToggle" ${data.security.enabled ? 'checked' : ''}> Включить PIN-код
        </label>
        ${data.security.enabled ? `
          <p style="font-size:0.85rem;">PIN: ${data.security.pin ? 'установлен' : 'не задан'}</p>
          ${data.security.pin ? '<button id="changePinBtn" class="btn btn-sm" style="width:100%;margin-bottom:4px;">Сменить PIN</button>' : ''}
          ${data.security.recovery ? `<p style="font-size:0.8rem; color:var(--gray);">Код восстановления: <strong>${data.security.recovery}</strong></p>` : ''}
        ` : ''}
        <div id="pinSetupBlock" style="display:none; margin-top:8px;">
          <div class="form-group"><label>Новый PIN (4 цифры)</label><input type="password" id="newPin" maxlength="4" inputmode="numeric" pattern="[0-9]*"></div>
          <div class="form-group"><label>Повторите PIN</label><input type="password" id="confirmPin" maxlength="4" inputmode="numeric" pattern="[0-9]*"></div>
          <button id="savePinBtn" class="btn btn-primary" style="width:100%;">Сохранить PIN</button>
          <button id="cancelPinBtn" class="btn" style="width:100%;margin-top:4px;">Отмена</button>
        </div>
      </div>
      <div class="card"><h3>💾 Резервное копирование</h3>
        <button id="downloadBackupBtn" class="btn btn-primary" style="width:100%;margin-bottom:8px;">📥 Скачать</button>
        <button class="btn" style="width:100%;" onclick="document.getElementById('staticBackupInput').click()">📤 Загрузить</button>
        <input id="backupFileInput" accept="*/*" hidden>
      </div>
      <div class="card" id="exportImportCard"><h3>📤 Экспорт / Импорт</h3>
        <div style="margin-bottom:8px;"><strong>Действие:</strong> <button class="option-badge active" data-action="export">Экспорт</button> <button class="option-badge" data-action="import">Импорт</button></div>
        <div style="margin-bottom:8px;"><strong>Формат:</strong> <button class="option-badge active" data-format="json">JSON</button> <button class="option-badge" data-format="csv">CSV</button></div>
        <div style="margin-bottom:8px;"><strong>Тип данных:</strong> <button class="option-badge active" data-type="all">Все данные</button> <button class="option-badge" data-type="clients">Клиенты</button> <button class="option-badge" data-type="tasks">Задачи</button> <button class="option-badge" data-type="funnel">Воронка</button> <button class="option-badge" data-type="accounting">Бухгалтерия</button></div>
        <div style="margin-bottom:12px;"><strong>Период:</strong> <button class="option-badge active" data-period="all">Всё время</button> <button class="option-badge" data-period="year">Год</button> <button class="option-badge" data-period="month">Месяц</button> <button class="option-badge" data-period="week">Неделя</button> <button class="option-badge" data-period="custom">Произв.</button></div>
        <div id="customExportRange" style="display:none;gap:8px;margin-bottom:8px;"><input type="date" id="exportDateFrom"><input type="date" id="exportDateTo"></div>
        <button id="executeExportImportBtn" class="btn btn-primary" style="width:100%;">Выполнить</button>
        <input id="importFileInput" accept="*/*" hidden>
      </div>
      <div class="card"><h3>🎨 Тема оформления</h3>
        <select id="themeSelect" style="width:100%;margin-bottom:8px;">
          <option value="light" ${data.theme === 'light' ? 'selected' : ''}>Светлая</option>
          <option value="dark" ${data.theme === 'dark' ? 'selected' : ''}>Тёмная</option>
          <option value="auto" ${data.theme === 'auto' ? 'selected' : ''}>Авто (по времени)</option>
        </select>
        <div id="autoThemeSettings" style="display:${data.theme === 'auto' ? 'block' : 'none'};">
          <div class="form-group"><label>С (начало тёмной темы)</label><input type="time" id="themeStartTime" value="${data.themeStartTime || '20:00'}"></div>
          <div class="form-group"><label>До (конец тёмной темы)</label><input type="time" id="themeEndTime" value="${data.themeEndTime || '07:00'}"></div>
        </div>
      </div>
      <div class="card"><h3>🛠️ Управление</h3>
        <button id="resetDataBtn" class="btn btn-danger" style="width:100%;">🗑️ Сбросить данные…</button>
      </div>
      <div class="card"><h3>ℹ️ О приложении</h3>
        <a href="https://boosty.to/ilyasishmukhametov" target="_blank" style="display:block;padding:10px 0;">❤️ Boosty</a>
        <a href="https://www.donationalerts.com/r/ilyas_donationalerts" target="_blank" style="display:block;padding:10px 0;">💲 DonationAlerts</a>
        <a href="https://vk.ru/composerbloknot" target="_blank" style="display:block;padding:10px 0;">✉️ ВК</a>
        <a href="https://github.com/Ilyasmusic/ilyascrm" target="_blank" style="display:block;padding:10px 0;">👨‍💻 GitHub</a>
        <button id="showConsentAgain" class="btn btn-sm" style="margin-top:10px;">📄 Политика конфиденциальности</button>
        <button class="btn btn-sm" style="margin-top:10px;" onclick="showModal('helpModal')">📖 Инструкция</button>
        <p style="margin-top:16px;text-align:center;font-size:0.8rem;">© 2026 Бизнес Соло</p>
      </div>`;

    // ======== ОБРАБОТЧИКИ ========
    const securityToggle = document.getElementById('securityToggle');
    const pinSetupBlock = document.getElementById('pinSetupBlock');
    const changePinBtn = document.getElementById('changePinBtn');
    const savePinBtn = document.getElementById('savePinBtn');
    const cancelPinBtn = document.getElementById('cancelPinBtn');

    if (securityToggle) {
      securityToggle.onchange = function () {
        let d = loadData();
        if (this.checked) {
          if (!confirm('Перед включением PIN-кода обязательно скачайте резервную копию данных (JSON) и сохраните её в надёжном месте. Без неё вы не сможете восстановить данные при утере пароля. Нажмите "ОК", чтобы скачать копию сейчас.')) {
            this.checked = false; return;
          }
          // Программно вызываем скачивание
          document.getElementById('downloadBackupBtn').click();
          d.security.enabled = true;
          const recovery = Math.floor(10000000 + Math.random() * 90000000).toString();
          d.security.recovery = recovery;
          d.security.pin = null;
          saveData(d);
          showToast('Код восстановления: ' + recovery + ' (сохраните его)', 5000);
          pinSetupBlock.style.display = 'block';
          this.render(); // обновить чекбокс и показать код восстановления
        } else {
          if (!confirm('Отключить PIN-код? Это удалит всю защиту.')) {
            this.checked = true; return;
          }
          d.security.enabled = false;
          d.security.pin = null;
          d.security.recovery = null;
          saveData(d);
          appDiv.classList.remove('locked');
          this.render();
        }
      };
    }

    if (changePinBtn) changePinBtn.onclick = () => { pinSetupBlock.style.display = 'block'; };
    if (cancelPinBtn) cancelPinBtn.onclick = () => {
      pinSetupBlock.style.display = 'none';
      // Автоматически снимаем галочку и отключаем защиту
      let d = loadData();
      d.security.enabled = false;
      d.security.pin = null;
      d.security.recovery = null;
      saveData(d);
      this.render();
    };
    if (savePinBtn) savePinBtn.onclick = () => {
      const newPin = document.getElementById('newPin').value.trim();
      const confirmPin = document.getElementById('confirmPin').value.trim();
      if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) return showToast('Введите ровно 4 цифры');
      if (newPin !== confirmPin) return showToast('PIN-коды не совпадают');
      let d = loadData();
      d.security.pin = newPin;
      saveData(d);
      showToast('PIN сохранён');
      pinSetupBlock.style.display = 'none';
      this.render();
      showLockScreen();
    };

    // Бэкап скачивание (только один обработчик)
    document.getElementById('downloadBackupBtn').onclick = () => {
        const json = JSON.stringify(loadData());
        if (window.Android && window.Android.downloadFile) {
            Android.downloadFile(json, 'backup.json', 'application/json');
            let d = loadData();
            d.lastBackupTime = new Date().toISOString();
            saveData(d);
        } else {
            const blob = new Blob([json], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'backup.json';
            a.click();
            let d = loadData();
            d.lastBackupTime = new Date().toISOString();
            saveData(d);
        }
    };

    // Экспорт/Импорт UI
    const eiCard = document.getElementById('exportImportCard');
    let eiState = { action: 'export', format: 'json', type: 'all', period: 'all' };
    eiCard.querySelectorAll('.option-badge[data-action]').forEach(b => b.addEventListener('click', () => { eiCard.querySelectorAll('.option-badge[data-action]').forEach(x => x.classList.remove('active')); b.classList.add('active'); eiState.action = b.dataset.action; }));
    eiCard.querySelectorAll('.option-badge[data-format]').forEach(b => b.addEventListener('click', () => { eiCard.querySelectorAll('.option-badge[data-format]').forEach(x => x.classList.remove('active')); b.classList.add('active'); eiState.format = b.dataset.format; }));
    eiCard.querySelectorAll('.option-badge[data-type]').forEach(b => b.addEventListener('click', () => { eiCard.querySelectorAll('.option-badge[data-type]').forEach(x => x.classList.remove('active')); b.classList.add('active'); eiState.type = b.dataset.type; }));
    eiCard.querySelectorAll('.option-badge[data-period]').forEach(b => b.addEventListener('click', () => { eiCard.querySelectorAll('.option-badge[data-period]').forEach(x => x.classList.remove('active')); b.classList.add('active'); eiState.period = b.dataset.period; document.getElementById('customExportRange').style.display = eiState.period === 'custom' ? 'flex' : 'none'; }));

    document.getElementById('executeExportImportBtn').addEventListener('click', () => {
      if (eiState.action === 'export') {
        this.executeExport(eiState);
      } else {
        window.__eiStateForImport = eiState;
        document.getElementById('staticBackupInput').click();
      }
    });

    document.getElementById('showConsentAgain').onclick = () => showModal('consentModal', 'view');

    // Тема
    document.getElementById('themeSelect').onchange = function () { let d = loadData(); d.theme = this.value; saveData(d); applyTheme(); document.getElementById('autoThemeSettings').style.display = this.value === 'auto' ? 'block' : 'none'; };
    document.getElementById('themeStartTime').onchange = function () { let d = loadData(); d.themeStartTime = this.value; saveData(d); applyTheme(); };
    document.getElementById('themeEndTime').onchange = function () { let d = loadData(); d.themeEndTime = this.value; saveData(d); applyTheme(); };

    document.getElementById('resetDataBtn').onclick = () => { showModal('resetDataModal'); this.renderResetModal(); };
  }

executeExport(state) {
    const data = loadData();
    let exportData = {};

    if (state.type === 'all') exportData = data;
    else {
        if (state.type === 'clients') exportData.clients = data.clients;
        else if (state.type === 'tasks') exportData.obligations = data.obligations;
        else if (state.type === 'funnel') exportData.funnel = data.funnel;
        else if (state.type === 'accounting') exportData = { obligations: data.obligations, clients: data.clients };
    }

    if (state.period !== 'all' && exportData.obligations) {
        const filter = this.getPeriodFilter(state);
        exportData.obligations = exportData.obligations.filter(o => {
            if (!o.date) return false;
            const d = new Date(o.date);
            return d >= filter.start && d <= filter.end;
        });
    }

    // Приоритет: Android-интерфейс
    if (window.Android && window.Android.downloadFile) {
        if (state.format === 'json') {
            const jsonString = JSON.stringify(exportData);
            Android.downloadFile(jsonString, 'export.json', 'application/json');
        } else {
            // CSV
            let csv = '';
            if (state.type === 'clients' || state.type === 'all') {
                csv += 'ФИО,Телефон,Email,Адрес,Описание\n';
                (exportData.clients || []).forEach(c => csv += `${escapeCSV(c.fio)},${escapeCSV(c.phone||'')},${escapeCSV(c.email||'')},${escapeCSV(c.address||'')},${escapeCSV(c.desc||'')}\n`);
            }
            if (state.type === 'tasks' || state.type === 'all' || state.type === 'accounting') {
                const map = new Map(data.clients.map(c => [c.id, c.fio]));
                csv += 'Клиент,Описание,Дата,Предоплата,Постоплата,Затраты\n';
                (exportData.obligations || []).forEach(o => csv += `${escapeCSV(map.get(o.clientId)||'')},${escapeCSV(o.desc)},${escapeCSV(o.date||'')},${o.prepay},${o.postpay},${o.costs}\n`);
            }
            if (state.type === 'funnel' || state.type === 'all') {
                csv += 'Клиент,Стадия\n';
                for (const [cid, idx] of Object.entries((exportData.funnel || {}).clientStage || {})) {
                    const client = data.clients.find(c => c.id === cid);
                    csv += `${escapeCSV(client?.fio||'')},${escapeCSV((exportData.funnel?.stages || [])[idx] || '')}\n`;
                }
            }
            Android.downloadFile('\uFEFF' + csv, 'export.csv', 'text/csv');
        }
    } else {
        // Обычный браузер – старый метод с Blob
        if (state.format === 'json') {
            const blob = new Blob([JSON.stringify(exportData)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'export.json';
            a.click();
        } else {
            let csv = '';
            // ... (аналогичное формирование csv, как выше, можно оставить текущий код)
            if (state.type === 'clients' || state.type === 'all') { csv += 'ФИО,Телефон,Email,Адрес,Описание\n'; (exportData.clients||[]).forEach(c => csv += `${escapeCSV(c.fio)},${escapeCSV(c.phone||'')},${escapeCSV(c.email||'')},${escapeCSV(c.address||'')},${escapeCSV(c.desc||'')}\n`); }
            if (state.type === 'tasks' || state.type === 'all' || state.type === 'accounting') { const map = new Map(data.clients.map(c => [c.id, c.fio])); csv += 'Клиент,Описание,Дата,Предоплата,Постоплата,Затраты\n'; (exportData.obligations||[]).forEach(o => csv += `${escapeCSV(map.get(o.clientId)||'')},${escapeCSV(o.desc)},${escapeCSV(o.date||'')},${o.prepay},${o.postpay},${o.costs}\n`); }
            if (state.type === 'funnel' || state.type === 'all') { csv += 'Клиент,Стадия\n'; for (const [cid, idx] of Object.entries((exportData.funnel||{}).clientStage||{})) { const client = data.clients.find(c => c.id === cid); csv += `${escapeCSV(client?.fio||'')},${escapeCSV((exportData.funnel?.stages||[])[idx]||'')}\n`; } }
            const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'export.csv';
            a.click();
        }
    }
}

  executeImport(file, state) {
    const reader = new FileReader();
    reader.onload = (ev) => { try { if (state.format === 'json') { const imported = JSON.parse(ev.target.result); if (!confirm('Импортировать? Будут добавлены только новые записи.')) return; const data = loadData(); if (imported.clients) { const ids = new Set(data.clients.map(c => c.id)); data.clients.push(...imported.clients.filter(c => !ids.has(c.id))); } if (imported.obligations) { const ids = new Set(data.obligations.map(o => o.id)); data.obligations.push(...imported.obligations.filter(o => !ids.has(o.id))); } if (imported.funnel) { if (imported.funnel.stages) data.funnel.stages = imported.funnel.stages; if (imported.funnel.clientStage) Object.assign(data.funnel.clientStage, imported.funnel.clientStage); if (imported.funnel.trash) data.funnel.trash = imported.funnel.trash; } saveData(data); showToast('Импорт завершён'); } else showToast('Импорт CSV не поддерживается'); } catch { showToast('Ошибка чтения'); } };
    reader.readAsText(file);
  }

  getPeriodFilter(state) {
    const now = new Date(); let start, end;
    switch (state.period) {
      case 'year': start = new Date(now.getFullYear(), 0, 1); end = new Date(now.getFullYear(), 11, 31, 23, 59, 59); break;
      case 'month': start = new Date(now.getFullYear(), now.getMonth(), 1); end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59); break;
      case 'week': { const day = now.getDay() || 7; start = new Date(now); start.setDate(now.getDate() - day + 1); start.setHours(0, 0, 0, 0); end = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23, 59, 59, 999); } break;
      case 'custom': { const df = document.getElementById('exportDateFrom')?.value; const dt = document.getElementById('exportDateTo')?.value; start = df ? new Date(df) : new Date(0); end = dt ? new Date(dt) : new Date(); if (df) start.setHours(0, 0, 0, 0); if (dt) end.setHours(23, 59, 59, 999); } break;
      default: start = new Date(0); end = new Date();
    }
    return { start, end };
  }

  renderResetModal() {
    const content = document.getElementById('resetContent');
    content.innerHTML = `
      <div style="margin-bottom:12px;"><strong>Что сбрасываем:</strong>
        <select id="resetType" style="width:100%;">
          <option value="all">Все данные</option>
          <option value="clients">Клиенты</option>
          <option value="obligations">Задачи</option>
          <option value="funnel">Воронка</option>
          <option value="accounting">Бухгалтерия (обязательства)</option>
        </select>
      </div>
      <div id="resetPeriodBlock" style="margin-bottom:12px;"><strong>Период:</strong>
        <select id="resetPeriod" style="width:100%;">
          <option value="all">Всё время</option>
          <option value="year">Год</option>
          <option value="month">Месяц</option>
          <option value="week">Неделя</option>
          <option value="custom">Произвольный</option>
        </select>
      </div>
      <div id="resetCustomRange" style="display:none;gap:8px;margin-bottom:8px;"><input type="date" id="resetDateFrom"><input type="date" id="resetDateTo"></div>
      <button id="performResetBtn" class="btn btn-danger" style="width:100%;">Сбросить</button>`;
    document.getElementById('resetPeriod').addEventListener('change', function () { document.getElementById('resetCustomRange').style.display = this.value === 'custom' ? 'flex' : 'none'; });
    document.getElementById('performResetBtn').onclick = () => {
      const type = document.getElementById('resetType').value;
      const period = document.getElementById('resetPeriod').value;
      const df = document.getElementById('resetDateFrom')?.value;
      const dt = document.getElementById('resetDateTo')?.value;
      this.performReset(type, period, df, dt);
    };
  }

  performReset(type, period, df, dt) {
    if (!confirm('Вы уверены? Данные будут безвозвратно удалены.')) return;
    let data = loadData();
    const filterFn = obligations => {
      if (period === 'all') return obligations;
      const filterObj = this.getPeriodFilter({ period, customFrom: df, customTo: dt });
      return obligations.filter(o => { if (!o.date) return false; const d = new Date(o.date); return d >= filterObj.start && d <= filterObj.end; });
    };
    switch (type) {
      case 'all': if (period === 'all') { data.clients = []; data.obligations = []; data.funnel = { stages: ['Созвонились','Договорились о цене','Получена предоплата','Выполнено'], clientStage: {}, trash: [] }; } else data.obligations = data.obligations.filter(o => o.clientId === 'tax' || !filterFn([o]).length); break;
      case 'clients': data.clients = []; data.obligations = data.obligations.filter(o => o.clientId === 'tax'); data.funnel.clientStage = {}; data.funnel.trash = []; break;
      case 'obligations': data.obligations = data.obligations.filter(o => o.clientId === 'tax' || !filterFn([o]).length); break;
      case 'funnel': data.funnel.clientStage = {}; data.funnel.trash = []; break;
      case 'accounting': data.obligations = data.obligations.filter(o => o.clientId === 'tax' || !filterFn([o]).length); break;
    }
    saveData(data); hideModal('resetDataModal'); showToast('Данные сброшены');
  }
}

// =================== ИНИЦИАЛИЗАЦИЯ ===================
document.addEventListener('DOMContentLoaded', () => {
  const consentKey = 'privacyAccepted';
  if (localStorage.getItem(consentKey) !== 'true') {
    showModal('consentModal');
    document.getElementById('consentCheckbox').addEventListener('change', function () {
      document.getElementById('acceptConsentBtn').disabled = !this.checked;
    });
    document.getElementById('acceptConsentBtn').addEventListener('click', () => {
      if (document.getElementById('consentCheckbox').checked) {
        localStorage.setItem(consentKey, 'true');
        hideModal('consentModal');
        document.getElementById('mainUI').style.display = 'flex';
        initApp();
      }
    });
  } else {
    document.getElementById('mainUI').style.display = 'flex';
    initApp();
  }

  function initApp() {
    document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
    new ClientsTab(document.getElementById('tab-clients'));
    new TasksTab(document.getElementById('tab-tasks'));
    new FunnelTab(document.getElementById('tab-funnel'));
    new AccountingTab(document.getElementById('tab-accounting'));
    new SettingsTab(document.getElementById('tab-settings'));

    document.getElementById('saveClientBtn').addEventListener('click', () => {
      const id = document.getElementById('clientId').value;
      const fio = document.getElementById('clientFIO').value.trim();
      if (!fio) return showToast('ФИО обязательно');
      const client = { id: id || Date.now().toString(), fio, type: document.getElementById('clientType').value, phone: document.getElementById('clientPhone').value, email: document.getElementById('clientEmail').value, address: document.getElementById('clientAddress').value, desc: document.getElementById('clientDesc').value };
      let data = loadData();
      if (id) { const idx = data.clients.findIndex(c => c.id === id); if (idx !== -1) data.clients[idx] = client; } else data.clients.push(client);
      saveData(data); hideModal('clientModal');
    });

    document.getElementById('saveTaskBtn').addEventListener('click', () => {
      const id = document.getElementById('taskId').value;
      const clientId = document.getElementById('taskClientSelect').value;
      const desc = document.getElementById('taskDesc').value.trim();
      if (!clientId || !desc) return showToast('Заполните клиента и описание');
      const task = { id: id || Date.now().toString(), clientId, desc, prepay: parseFloat(document.getElementById('taskPrepay').value) || 0, postpay: parseFloat(document.getElementById('taskPostpay').value) || 0, prepaid: false, postpaid: false, costs: parseFloat(document.getElementById('taskCosts').value) || 0, date: document.getElementById('taskDate').value };
      let data = loadData();
      if (id) { const idx = data.obligations.findIndex(o => o.id === id); if (idx !== -1) data.obligations[idx] = task; } else data.obligations.push(task);
      saveData(data); hideModal('taskModal');
    });

    document.getElementById('taskDateNowBtn').addEventListener('click', () => {
      const now = new Date(); const pad = n => n.toString().padStart(2, '0');
      document.getElementById('taskDate').value = now.getFullYear() + '-' + pad(now.getMonth()+1) + '-' + pad(now.getDate()) + 'T' + pad(now.getHours()) + ':' + pad(now.getMinutes());
    });

    function updateTaskClientSelect() {
      const data = loadData();
      const select = document.getElementById('taskClientSelect');
      if (select) select.innerHTML = '<option value="">Выберите клиента</option>' + data.clients.map(c => `<option value="${c.id}">${escapeHtml(c.fio)}</option>`).join('');
    }
    document.addEventListener('data-updated', updateTaskClientSelect);
    updateTaskClientSelect();

    document.querySelectorAll('.modal-overlay').forEach(overlay => overlay.addEventListener('click', function (e) { if (e.target === this) this.style.display = 'none'; }));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.modal-overlay[style*="display: flex"]').forEach(o => o.style.display = 'none'); });

    showLockScreen();
    // Универсальный обработчик загрузки файла (для резервного копирования и импорта)
    document.getElementById('staticBackupInput').addEventListener('change', function(e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function(ev) {
        try {
          const imported = JSON.parse(ev.target.result);
          // Если есть сохранённое состояние импорта (из панели Экспорт/Импорт)
          if (window.__eiStateForImport) {
            // Вызов executeImport с сохранённым состоянием
            const state = window.__eiStateForImport;
            window.__eiStateForImport = null;
            if (state && state.format === 'json') {
              const data = loadData();
              if (!confirm('Импортировать? Будут добавлены только новые записи.')) return;
              if (imported.clients) {
                const ids = new Set(data.clients.map(c => c.id));
                data.clients.push(...imported.clients.filter(c => !ids.has(c.id)));
              }
              if (imported.obligations) {
                const ids = new Set(data.obligations.map(o => o.id));
                data.obligations.push(...imported.obligations.filter(o => !ids.has(o.id)));
              }
              if (imported.funnel) {
                if (imported.funnel.stages) data.funnel.stages = imported.funnel.stages;
                if (imported.funnel.clientStage) Object.assign(data.funnel.clientStage, imported.funnel.clientStage);
                if (imported.funnel.trash) data.funnel.trash = imported.funnel.trash;
              }
              saveData(data);
              showToast('Импорт завершён');
            }
          } else {
            // Обычная загрузка резервной копии (полная замена)
            if (imported.clients && imported.obligations) {
              if (confirm('Заменить все данные?')) {
                saveData(imported);
                showToast('Данные импортированы');
              }
            } else {
              showToast('Неверный формат файла');
            }
          }
        } catch (err) {
          showToast('Ошибка чтения файла');
        }
      };
      reader.readAsText(file);
    });
  }

  window.addEventListener('popstate', event => {
    if (event.state?.modalOpen) {
      const modalId = event.state.modalOpen;
      if (modals[modalId]) modals[modalId].style.display = 'none';
    }
  });
});