// State management
let currentTable = 'TRABAJADOR';
let currentCrudTable = 'TRABAJADOR';
let currentSchema = null;
let currentColumns = [];
let currentRows = [];
let availableTables = ['TRABAJADOR', 'EDIFICIO', 'ASIGNACION'];
let reqCounter = 0;
const callbacks = {};

// Python Bridge communication
window.__onPythonResponse = (id, res) => {
  if (callbacks[id]) {
    callbacks[id](res);
    delete callbacks[id];
  }
};

function callPython(action, payload = {}) {
  return new Promise((resolve) => {
    const id = ++reqCounter;
    callbacks[id] = resolve;
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.api) {
      window.webkit.messageHandlers.api.postMessage(JSON.stringify({ id, action, payload }));
    } else {
      console.warn("Python bridge not available. Running in mock/fallback mode.");
      setTimeout(() => resolve({ success: true, message: "Mock response" }), 100);
    }
  });
}

// Switch between navigation tabs
function switchView(viewName) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.view-content').forEach(v => v.classList.remove('active'));

  if (viewName === 'query') {
    document.getElementById('tabBtnQuery').classList.add('active');
    document.getElementById('viewQuery').classList.add('active');
  } else if (viewName === 'er') {
    document.getElementById('tabBtnER').classList.add('active');
    document.getElementById('viewER').classList.add('active');
    setTimeout(renderERDiagram, 60);
  } else if (viewName === 'crud') {
    document.getElementById('tabBtnCrud').classList.add('active');
    document.getElementById('viewCrud').classList.add('active');
    loadCrudTable(currentCrudTable);
  }
}

// Dark mode state and toggle
let isDarkMode = false;
function toggleTheme() {
  isDarkMode = !isDarkMode;
  document.body.classList.toggle('dark-theme', isDarkMode);
  const icon = document.getElementById('themeIcon');
  if (icon) {
    icon.innerHTML = isDarkMode ?
      `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>` :
      `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
  }
  if (document.getElementById('viewER') && document.getElementById('viewER').classList.contains('active')) {
    drawERRelationships();
  }
}

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.toString().replace(/[&<>"']/g, m => map[m]);
}

// Authentication Engine toggle
let currentEngine = 'sqlite';
function setAuthEngine(engine) {
  currentEngine = engine;
  document.getElementById('btnEngineSqlite').classList.toggle('active', engine === 'sqlite');
  document.getElementById('btnEngineMysql').classList.toggle('active', engine === 'mysql');
  document.getElementById('mysqlFields').style.display = (engine === 'mysql') ? 'block' : 'none';
}

let isUserAuthenticated = false;

function openAuthModal() {
  document.getElementById('authAlert').className = 'modal-alert';
  document.getElementById('authAlert').innerText = '';
  document.getElementById('authAlert').style.display = 'none';
  const closeBtn = document.getElementById('authModalCloseBtn');
  if (closeBtn) {
    closeBtn.style.display = isUserAuthenticated ? 'block' : 'none';
  }
  document.getElementById('authModal').classList.remove('hidden');
}

function openAuthModalForUse(targetDb = '') {
  if (targetDb) {
    const authDb = document.getElementById('authDb');
    if (authDb) authDb.value = targetDb;
  }
  openAuthModal();
  const alertEl = document.getElementById('authAlert');
  if (alertEl) {
    alertEl.className = 'modal-alert info';
    alertEl.style.display = 'block';
    const dbLabel = targetDb ? ` ${escapeHtml(targetDb)}` : '';
    alertEl.innerHTML = `<strong>Cambio de base de datos (USE${dbLabel}):</strong> Ingrese y confirme sus credenciales en este panel de autenticación para conectarse a la base de datos solicitada.`;
  }
  const tbody = document.getElementById('tableBody');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #2563eb; padding: 24px; font-weight: 500;">ℹ️ Se abrió el panel de autenticación para validar el cambio de base de datos (USE).</td></tr>`;
  }
}

function closeAuthModal() {
  document.getElementById('authModal').classList.add('hidden');
}

async function submitAuthentication() {
  const user = document.getElementById('authUser').value.trim();
  const password = document.getElementById('authPass').value;
  const alertEl = document.getElementById('authAlert');

  const payload = {
    engine: currentEngine,
    user: user,
    password: password,
    host: document.getElementById('authHost').value.trim(),
    port: document.getElementById('authPort').value.trim(),
    database: document.getElementById('authDb').value.trim()
  };

  alertEl.className = 'modal-alert';
  alertEl.innerText = 'Validando credenciales...';
  alertEl.style.display = 'block';

  const res = await callPython('authenticate', payload);
  if (res && res.success) {
    isUserAuthenticated = true;
    alertEl.className = 'modal-alert success';
    alertEl.innerText = res.message || 'Conexión validada exitosamente.';
    const dbName = res.database || (currentEngine === 'mysql' ? (document.getElementById('authDb').value.trim() || 'empresa') : 'empresa');
    document.getElementById('activeUserLabel').innerText = `Conectado: ${user} (${dbName})`;
    setTimeout(async () => {
      closeAuthModal();
      // Dynamically load available tables from schema
      await refreshAvailableTables();
      // Load initial table data and ER diagram
      await loadTableData(currentTable);
      fetchAndRenderERDiagram();
    }, 400);
  } else {
    alertEl.className = 'modal-alert error';
    const category = (res && res.category) ? res.category : 'Error de Conexión';
    const code = (res && res.error_code) ? res.error_code : '';
    const message = (res && res.message) ? res.message : 'No se pudo conectar con la base de datos.';
    const suggestion = (res && res.suggestion) ? res.suggestion : '';
    const details = (res && res.details) ? res.details : '';

    alertEl.innerHTML = `
      <div class="auth-error-box">
        <div class="auth-error-top">
          <svg class="auth-error-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <div class="auth-error-heading">
            <div class="auth-error-category">${escapeHtml(category)}</div>
            ${code ? `<span class="auth-error-code">Código ${code}</span>` : ''}
          </div>
        </div>
        <div class="auth-error-msg">${escapeHtml(message)}</div>
        ${suggestion ? `
          <div class="auth-error-suggestion">
            <span class="suggestion-bulb">💡</span>
            <div class="suggestion-desc"><strong>Sugerencia:</strong> ${escapeHtml(suggestion)}</div>
          </div>
        ` : ''}
        ${details ? `
          <div class="auth-error-details">
            <span class="details-label">Diagnóstico de parámetros:</span>
            <code class="details-code">${escapeHtml(details)}</code>
          </div>
        ` : ''}
      </div>
    `;
    alertEl.style.display = 'block';
    setTimeout(() => {
      alertEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  }
}

function getCanonicalTableName(name) {
  if (!name) return name;
  const found = availableTables.find(t => t.toLowerCase() === name.toLowerCase());
  return found ? found : name;
}

// Refresh dynamic table recommendations
async function refreshAvailableTables() {
  const res = await callPython('get_tables');
  if (res && res.success && res.tables && res.tables.length > 0) {
    availableTables = res.tables;
    renderTableButtons(availableTables);
    // If currentTable is not in available tables, default to the first one
    const tableNamesLower = availableTables.map(t => t.toLowerCase());
    if (!tableNamesLower.includes(currentTable.toLowerCase())) {
      currentTable = availableTables[0];
      currentCrudTable = availableTables[0];
    } else {
      currentTable = getCanonicalTableName(currentTable);
      currentCrudTable = getCanonicalTableName(currentCrudTable);
    }
  }
}

function renderTableButtons(tables) {
  const queryGroup = document.getElementById('queryQuickTables');
  const crudGroup = document.getElementById('crudQuickTables');
  const queryToggle = document.getElementById('queryTablesToggle');
  const crudToggle = document.getElementById('crudTablesToggle');

  if (queryGroup) {
    queryGroup.innerHTML = '';
    tables.forEach(tableName => {
      const btn = document.createElement('button');
      btn.className = 'quick-table-btn' + (tableName.toLowerCase() === currentTable.toLowerCase() ? ' active' : '');
      btn.innerText = tableName;
      btn.onclick = () => loadTableData(tableName);
      queryGroup.appendChild(btn);
    });
  }

  if (crudGroup) {
    crudGroup.innerHTML = '';
    tables.forEach(tableName => {
      const btn = document.createElement('button');
      btn.className = 'quick-table-btn' + (tableName.toLowerCase() === currentCrudTable.toLowerCase() ? ' active' : '');
      btn.innerText = tableName;
      btn.onclick = () => loadCrudTable(tableName);
      crudGroup.appendChild(btn);
    });
  }

  // Check if tables should show expand/collapse button
  const shouldShowToggle = tables.length > 5;
  if (queryToggle) {
    queryToggle.style.display = shouldShowToggle ? 'inline-flex' : 'none';
    updateToggleBtnText('query', tables.length);
  }
  if (crudToggle) {
    crudToggle.style.display = shouldShowToggle ? 'inline-flex' : 'none';
    updateToggleBtnText('crud', tables.length);
  }
}

function updateToggleBtnText(type, totalCount) {
  const container = document.getElementById(type === 'query' ? 'queryTablesContainer' : 'crudTablesContainer');
  const toggle = document.getElementById(type === 'query' ? 'queryTablesToggle' : 'crudTablesToggle');
  if (!toggle || !container) return;
  const isExpanded = container.classList.contains('is-expanded');
  const label = toggle.querySelector('.expand-label');
  if (label) {
    label.innerText = isExpanded ? 'Contraer' : `+ Más (${totalCount})`;
  }
}

function toggleTablesExpand(type) {
  const container = document.getElementById(type === 'query' ? 'queryTablesContainer' : 'crudTablesContainer');
  if (!container) return;
  container.classList.toggle('is-expanded');
  const count = availableTables ? availableTables.length : 0;
  updateToggleBtnText(type, count);
}

// Multiline SQL Editor & Realtime Syntax Highlighting / Validation
function highlightSql(code) {
  if (!code) return '';
  const tokenRegex = /('(?:''|[^'])*'|"(?:""|[^"])*")|(--[^\n]*|\/\*[\s\S]*?\*\/)|(\b\d+(?:\.\d+)?\b)|(\b(?:SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|TABLES|DROP|ALTER|JOIN|INNER|LEFT|RIGHT|FULL|OUTER|CROSS|ON|GROUP|BY|ORDER|HAVING|LIMIT|OFFSET|AND|OR|NOT|IN|IS|NULL|LIKE|AS|DISTINCT|UNION|ALL|CASE|WHEN|THEN|ELSE|END|PRIMARY|KEY|FOREIGN|REFERENCES|DEFAULT|CHECK|INDEX|VIEW|TRIGGER|CASCADE|ASC|DESC|COUNT|SUM|AVG|MIN|MAX|EXISTS|BETWEEN|CONSTRAINT|AUTO_INCREMENT|UNSIGNED|UNIQUE|SHOW|USE|DATABASE|DATABASES|DESCRIBE|EXPLAIN|STATUS|VARIABLES|GRANT|REVOKE)\b)|(\b(?:VARCHAR|CHAR|TEXT|MEDIUMTEXT|LONGTEXT|INT|INTEGER|BIGINT|SMALLINT|TINYINT|DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL|DATE|DATETIME|TIMESTAMP|TIME|YEAR|BOOLEAN|BOOL|ENUM|JSON|BLOB|VARBINARY)\b)|([=<>!+\-*/%,;().:@]+)|(\s+)|([a-zA-Z0-9_]+)|(.)/gi;

  let result = '';
  let match;
  while ((match = tokenRegex.exec(code)) !== null) {
    const [full, str, comment, num, kw, datatype, op, ws, word, other] = match;
    if (str) {
      result += `<span class="sql-str">${escapeHtml(str)}</span>`;
    } else if (comment) {
      result += `<span class="sql-comment">${escapeHtml(comment)}</span>`;
    } else if (num) {
      result += `<span class="sql-num">${escapeHtml(num)}</span>`;
    } else if (kw) {
      result += `<span class="sql-kw">${escapeHtml(kw)}</span>`;
    } else if (datatype) {
      result += `<span class="sql-type">${escapeHtml(datatype)}</span>`;
    } else if (op) {
      result += `<span class="sql-op">${escapeHtml(op)}</span>`;
    } else if (ws) {
      result += escapeHtml(ws);
    } else if (word) {
      result += escapeHtml(word);
    } else if (other) {
      result += escapeHtml(other);
    } else {
      result += escapeHtml(full);
    }
  }
  return result;
}

function validateSqlSyntax(sql) {
  const trimmed = sql.trim();
  if (!trimmed) {
    return { valid: true, message: 'Ingrese una consulta SQL' };
  }

  // Check quotes and parentheses
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let openParenCount = 0;

  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'" && !inDoubleQuote) {
      if (inSingleQuote && sql[i + 1] === "'") {
        i++; // escaped quote
      } else {
        inSingleQuote = !inSingleQuote;
      }
    } else if (c === '"' && !inSingleQuote) {
      if (inDoubleQuote && sql[i + 1] === '"') {
        i++; // escaped quote
      } else {
        inDoubleQuote = !inDoubleQuote;
      }
    } else if (!inSingleQuote && !inDoubleQuote) {
      if (c === '(') openParenCount++;
      if (c === ')') {
        openParenCount--;
        if (openParenCount < 0) {
          return { valid: false, message: 'Paréntesis de cierre ")" inesperado sin apertura' };
        }
      }
    }
  }

  if (inSingleQuote) {
    return { valid: false, message: 'Comilla simple (\') sin cerrar' };
  }
  if (inDoubleQuote) {
    return { valid: false, message: 'Comilla doble (") sin cerrar' };
  }
  if (openParenCount > 0) {
    return { valid: false, message: `Hay ${openParenCount} paréntesis "(" sin cerrar` };
  }

  // Remove trailing semicolon for structural syntax validation
  const cleanSql = trimmed.replace(/;+\s*$/, '');
  const tokens = cleanSql.split(/\s+/);
  const firstKw = tokens[0].toUpperCase();

  if (firstKw === 'SELECT') {
    if (!cleanSql.toUpperCase().includes('FROM')) {
      const afterSelect = cleanSql.substring(6).trim();
      if (!afterSelect) {
        return { valid: false, message: 'Falta especificar columnas después de SELECT' };
      }
      if (afterSelect.startsWith('*') || afterSelect === '*') {
        return { valid: false, message: 'Falta la cláusula FROM después de SELECT *' };
      }
      if (afterSelect.endsWith(',')) {
        return { valid: false, message: 'Coma sobrante al final de la lista de columnas' };
      }
    } else {
      if (/FROM\s*$/i.test(cleanSql)) {
        return { valid: false, message: 'Falta especificar el nombre de la tabla después de FROM' };
      }
    }
  } else if (firstKw === 'SHOW') {
    if (tokens.length < 2) {
      return { valid: false, message: 'Especifique qué mostrar (ejemplo: SHOW TABLES)' };
    }
    return { valid: true, message: 'Sintaxis SQL válida (comando SHOW)' };
  } else if (firstKw === 'USE' || /\bUSE\s+/i.test(cleanSql)) {
    const target = tokens[1] ? tokens[1].replace(/;+$/, '') : '';
    return {
      valid: true,
      isUse: true,
      message: target
        ? `USE ${target}: Presione Ejecutar para cambiar de base de datos en el panel de autenticación`
        : 'Para cambiar de base de datos (USE), se abrirá el panel de autenticación al ejecutar'
    };
  } else if (firstKw === 'INSERT') {
    if (!cleanSql.toUpperCase().includes('INTO')) {
      return { valid: false, message: 'Falta la palabra clave INTO después de INSERT' };
    }
  } else if (firstKw === 'UPDATE') {
    if (!cleanSql.toUpperCase().includes('SET')) {
      return { valid: false, message: 'Falta la palabra clave SET en la instrucción UPDATE' };
    }
  } else if (firstKw === 'DELETE') {
    if (!cleanSql.toUpperCase().includes('FROM')) {
      return { valid: false, message: 'Falta la palabra clave FROM en la instrucción DELETE' };
    }
  }

  // Check dangling logical operators at the end
  const lastToken = tokens[tokens.length - 1].toUpperCase();
  if (['AND', 'OR', 'WHERE', 'ON', 'JOIN', 'SET', 'INTO'].includes(lastToken) || cleanSql.endsWith(',')) {
    return { valid: false, message: `Expresión incompleta: termina en "${tokens[tokens.length - 1]}"` };
  }

  return { valid: true, message: 'Sintaxis SQL válida' };
}

function updateSyntaxBadge(status) {
  const badge = document.getElementById('syntaxStatusBadge');
  const text = document.getElementById('syntaxStatusText');
  if (!badge || !text) return;

  if (status.isUse) {
    badge.className = 'syntax-status-badge info';
    text.innerHTML = `${escapeHtml(status.message)} <button type="button" class="btn-status-auth" onclick="openAuthModalForUse()">Abrir panel</button>`;
  } else if (status.valid) {
    badge.className = 'syntax-status-badge valid';
    text.innerText = status.message || 'Sintaxis válida';
  } else {
    badge.className = 'syntax-status-badge error';
    text.innerText = status.message;
  }
}

// Editor History Stack for Undo/Redo & Shortcuts
let editorHistory = [];
let historyIndex = -1;
let isUndoRedoAction = false;
let editorSaveTimer = null;

function saveEditorState() {
  if (isUndoRedoAction) return;
  const input = document.getElementById('sqlInput');
  if (!input) return;

  const state = {
    value: input.value,
    selectionStart: input.selectionStart,
    selectionEnd: input.selectionEnd
  };

  if (historyIndex >= 0 && editorHistory[historyIndex].value === state.value) {
    editorHistory[historyIndex] = state;
    return;
  }

  editorHistory = editorHistory.slice(0, historyIndex + 1);
  editorHistory.push(state);
  if (editorHistory.length > 100) editorHistory.shift();
  historyIndex = editorHistory.length - 1;
}

function editorUndo() {
  if (historyIndex > 0) {
    historyIndex--;
    applyEditorState(editorHistory[historyIndex]);
  }
}

function editorRedo() {
  if (historyIndex < editorHistory.length - 1) {
    historyIndex++;
    applyEditorState(editorHistory[historyIndex]);
  }
}

function applyEditorState(state) {
  const input = document.getElementById('sqlInput');
  if (!input || !state) return;
  isUndoRedoAction = true;
  input.value = state.value;
  input.setSelectionRange(state.selectionStart, state.selectionEnd);
  updateSqlEditor();
  isUndoRedoAction = false;
}

function toggleComment() {
  const input = document.getElementById('sqlInput');
  if (!input) return;

  const val = input.value;
  const start = input.selectionStart;
  const end = input.selectionEnd;

  const lineStart = val.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = val.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = val.length;

  const selectedText = val.substring(lineStart, lineEnd);
  const lines = selectedText.split('\n');

  const allCommented = lines.every(l => l.trim().length === 0 || l.trim().startsWith('--'));

  let newLines;
  if (allCommented) {
    newLines = lines.map(l => l.replace(/^(\s*)--\s?/, '$1'));
  } else {
    newLines = lines.map(l => {
      if (l.trim().length === 0) return l;
      return l.replace(/^(\s*)(.*)$/, '$1-- $2');
    });
  }

  const replacement = newLines.join('\n');
  input.setRangeText(replacement, lineStart, lineEnd, 'select');
  updateSqlEditor();
  saveEditorState();
}

function selectCurrentLine() {
  const input = document.getElementById('sqlInput');
  if (!input) return;

  const val = input.value;
  const start = input.selectionStart;
  const end = input.selectionEnd;

  const lineStart = val.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = val.indexOf('\n', end);
  if (lineEnd === -1) {
    lineEnd = val.length;
  } else {
    lineEnd += 1; // Include trailing newline
  }

  input.setSelectionRange(lineStart, lineEnd);
}

function handleTabIndent(shiftKey) {
  const input = document.getElementById('sqlInput');
  if (!input) return;

  const val = input.value;
  const start = input.selectionStart;
  const end = input.selectionEnd;

  if (start === end && !shiftKey) {
    input.setRangeText('  ', start, end, 'end');
    updateSqlEditor();
    saveEditorState();
    return;
  }

  const lineStart = val.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = val.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = val.length;

  const selectedText = val.substring(lineStart, lineEnd);
  const lines = selectedText.split('\n');

  let newLines;
  if (shiftKey) {
    newLines = lines.map(l => l.replace(/^ {1,2}/, ''));
  } else {
    newLines = lines.map(l => '  ' + l);
  }

  const replacement = newLines.join('\n');
  input.setRangeText(replacement, lineStart, lineEnd, 'select');
  updateSqlEditor();
  saveEditorState();
}

function duplicateLine() {
  duplicateLineBlock(1);
}

function moveLine(direction) {
  const input = document.getElementById('sqlInput');
  if (!input) return;

  const val = input.value;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const lines = val.split('\n');

  // Calculate start offset of each line
  const lineOffsets = [];
  let curr = 0;
  for (let i = 0; i < lines.length; i++) {
    lineOffsets.push(curr);
    curr += lines[i].length + 1;
  }

  let startLine = 0;
  for (let i = 0; i < lines.length; i++) {
    if (start >= lineOffsets[i]) startLine = i;
    else break;
  }

  let searchEnd = end;
  if (end > start && val[end - 1] === '\n') {
    searchEnd = end - 1;
  }

  let endLine = 0;
  for (let i = 0; i < lines.length; i++) {
    if (searchEnd >= lineOffsets[i]) endLine = i;
    else break;
  }

  const startCol = start - lineOffsets[startLine];
  const endCol = end - lineOffsets[endLine];

  if (direction === -1) {
    // Move Up: Alt + Up
    if (startLine === 0) return; // Already on line 1

    const targetIdx = startLine - 1;
    const moved = lines.splice(startLine, endLine - startLine + 1);
    lines.splice(targetIdx, 0, ...moved);

    let newCurr = 0;
    const newLineOffsets = [];
    for (let i = 0; i < lines.length; i++) {
      newLineOffsets.push(newCurr);
      newCurr += lines[i].length + 1;
    }

    input.value = lines.join('\n');
    const newStartLine = targetIdx;
    const newEndLine = targetIdx + moved.length - 1;
    const newStart = newLineOffsets[newStartLine] + Math.min(startCol, lines[newStartLine].length);
    const newEnd = newLineOffsets[newEndLine] + Math.min(endCol, lines[newEndLine].length);
    input.setSelectionRange(newStart, newEnd);
  } else if (direction === 1) {
    // Move Down: Alt + Down
    if (endLine >= lines.length - 1) return; // Already on last line

    const moved = lines.splice(startLine, endLine - startLine + 1);
    const targetIdx = startLine + 1;
    lines.splice(targetIdx, 0, ...moved);

    let newCurr = 0;
    const newLineOffsets = [];
    for (let i = 0; i < lines.length; i++) {
      newLineOffsets.push(newCurr);
      newCurr += lines[i].length + 1;
    }

    input.value = lines.join('\n');
    const newStartLine = targetIdx;
    const newEndLine = targetIdx + moved.length - 1;
    const newStart = newLineOffsets[newStartLine] + Math.min(startCol, lines[newStartLine].length);
    const newEnd = newLineOffsets[newEndLine] + Math.min(endCol, lines[newEndLine].length);
    input.setSelectionRange(newStart, newEnd);
  }

  updateSqlEditor();
  saveEditorState();
}

function duplicateLineBlock(direction) {
  const input = document.getElementById('sqlInput');
  if (!input) return;

  const val = input.value;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const lines = val.split('\n');

  const lineOffsets = [];
  let curr = 0;
  for (let i = 0; i < lines.length; i++) {
    lineOffsets.push(curr);
    curr += lines[i].length + 1;
  }

  let startLine = 0;
  for (let i = 0; i < lines.length; i++) {
    if (start >= lineOffsets[i]) startLine = i;
    else break;
  }

  let searchEnd = end;
  if (end > start && val[end - 1] === '\n') {
    searchEnd = end - 1;
  }

  let endLine = 0;
  for (let i = 0; i < lines.length; i++) {
    if (searchEnd >= lineOffsets[i]) endLine = i;
    else break;
  }

  const startCol = start - lineOffsets[startLine];
  const endCol = end - lineOffsets[endLine];

  const blockLines = lines.slice(startLine, endLine + 1);

  if (direction === 1) {
    // Duplicate Down: Shift + Alt + Down or Ctrl + Shift + Alt + Down
    lines.splice(endLine + 1, 0, ...blockLines);
    const newStartLine = endLine + 1;
    const newEndLine = newStartLine + blockLines.length - 1;

    let newCurr = 0;
    const newLineOffsets = [];
    for (let i = 0; i < lines.length; i++) {
      newLineOffsets.push(newCurr);
      newCurr += lines[i].length + 1;
    }
    input.value = lines.join('\n');
    const newStart = newLineOffsets[newStartLine] + Math.min(startCol, lines[newStartLine].length);
    const newEnd = newLineOffsets[newEndLine] + Math.min(endCol, lines[newEndLine].length);
    input.setSelectionRange(newStart, newEnd);
  } else {
    // Duplicate Up: Shift + Alt + Up or Ctrl + Shift + Alt + Up
    lines.splice(startLine, 0, ...blockLines);
    let newCurr = 0;
    const newLineOffsets = [];
    for (let i = 0; i < lines.length; i++) {
      newLineOffsets.push(newCurr);
      newCurr += lines[i].length + 1;
    }
    input.value = lines.join('\n');
    const newStart = newLineOffsets[startLine] + Math.min(startCol, lines[startLine].length);
    const newEnd = newLineOffsets[startLine + blockLines.length - 1] + Math.min(endCol, lines[startLine + blockLines.length - 1].length);
    input.setSelectionRange(newStart, newEnd);
  }

  updateSqlEditor();
  saveEditorState();
}

function deleteLine() {
  const input = document.getElementById('sqlInput');
  if (!input) return;

  const val = input.value;
  const start = input.selectionStart;
  const end = input.selectionEnd;

  let lineStart = val.lastIndexOf('\n', start - 1) + 1;
  let searchEnd = end;
  if (end > start && val[end - 1] === '\n') {
    searchEnd = end - 1;
  }
  let lineEnd = val.indexOf('\n', searchEnd);

  if (lineEnd !== -1) {
    lineEnd += 1; // Include trailing newline
  } else if (lineStart > 0) {
    lineStart -= 1; // Include leading newline
  }

  input.setRangeText('', lineStart, lineEnd, 'end');
  input.setSelectionRange(lineStart, lineStart);
  updateSqlEditor();
  saveEditorState();
}

function handleCopy(e) {
  const input = document.getElementById('sqlInput');
  if (!input) return;

  if (input.selectionStart === input.selectionEnd) {
    const val = input.value;
    const lineStart = val.lastIndexOf('\n', input.selectionStart - 1) + 1;
    let lineEnd = val.indexOf('\n', input.selectionEnd);
    if (lineEnd === -1) lineEnd = val.length;
    const lineText = val.substring(lineStart, lineEnd);
    if (e.clipboardData) {
      e.clipboardData.setData('text/plain', lineText + '\n');
      e.preventDefault();
    }
  }
}

function handleCut(e) {
  const input = document.getElementById('sqlInput');
  if (!input) return;

  if (input.selectionStart === input.selectionEnd) {
    const val = input.value;
    const start = input.selectionStart;
    let lineStart = val.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = val.indexOf('\n', start);

    let cutText = '';
    let removeEnd = lineEnd;
    if (lineEnd !== -1) {
      cutText = val.substring(lineStart, lineEnd + 1);
      removeEnd = lineEnd + 1;
    } else {
      cutText = val.substring(lineStart, val.length) + '\n';
      if (lineStart > 0) {
        lineStart -= 1;
        removeEnd = val.length;
      } else {
        removeEnd = val.length;
      }
    }

    if (e.clipboardData) {
      e.clipboardData.setData('text/plain', cutText);
      e.preventDefault();
    }
    input.setRangeText('', lineStart, removeEnd, 'end');
    input.setSelectionRange(lineStart, lineStart);
    updateSqlEditor();
    saveEditorState();
  }
}

function updateSqlEditor() {
  const input = document.getElementById('sqlInput');
  const highlightedCode = document.getElementById('sqlHighlightedCode');
  const lineNumbers = document.getElementById('sqlLineNumbers');
  const card = document.getElementById('queryEditorCard');
  if (!input) return;

  const code = input.value;
  const lines = code.split('\n');

  // Line numbers (each line exactly matches 22px height)
  if (lineNumbers) {
    lineNumbers.innerHTML = lines.map((_, i) => `<div>${i + 1}</div>`).join('');
  }

  // Syntax Highlighting
  if (highlightedCode) {
    let html = highlightSql(code);
    if (code.endsWith('\n')) {
      html += '\n ';
    }
    highlightedCode.innerHTML = html;
  }

  // Real-time early syntax validation
  const validation = validateSqlSyntax(code);
  updateSyntaxBadge(validation);

  // Adapt editor card height automatically to line count if not manually resized
  if (card) {
    const lineCount = lines.length;
    const neededHeight = Math.min(Math.max(lineCount * 22 + 48, 74), 480);

    if (!card.dataset.userResized) {
      card.style.height = neededHeight + 'px';
    } else {
      // If user cleared text or single short line, reset manual resize lock
      if (lineCount <= 1 && input.value.trim().length === 0) {
        delete card.dataset.userResized;
        card.style.height = '74px';
      }
    }
  }
}

function setSqlInputValue(sql) {
  const input = document.getElementById('sqlInput');
  const card = document.getElementById('queryEditorCard');
  if (input) {
    if (card) {
      delete card.dataset.userResized;
    }
    input.value = sql;
    updateSqlEditor();
    saveEditorState();
  }
}

function initSqlEditor() {
  const input = document.getElementById('sqlInput');
  const highlightLayer = document.querySelector('.sql-highlight-layer');
  const lineNumbers = document.getElementById('sqlLineNumbers');
  const card = document.getElementById('queryEditorCard');

  if (!input) return;

  // Track if user manually resizes the editor card via bottom edge / resize handle
  if (card) {
    let isResizingHandle = false;
    let preResizeHeight = 0;

    card.addEventListener('mousedown', (e) => {
      const rect = card.getBoundingClientRect();
      if (e.clientY >= rect.bottom - 22) {
        isResizingHandle = true;
        preResizeHeight = card.offsetHeight;
      }
    });

    window.addEventListener('mouseup', () => {
      if (isResizingHandle) {
        isResizingHandle = false;
        if (Math.abs(card.offsetHeight - preResizeHeight) > 2) {
          card.dataset.userResized = 'true';
        }
      }
    });

    // Double-click status bar or prompt to reset to auto-height
    const statusBar = document.getElementById('syntaxStatusBar');
    if (statusBar) {
      statusBar.addEventListener('dblclick', () => {
        delete card.dataset.userResized;
        updateSqlEditor();
      });
    }
    const promptEl = card.querySelector('.query-prompt');
    if (promptEl) {
      promptEl.addEventListener('dblclick', () => {
        delete card.dataset.userResized;
        updateSqlEditor();
      });
    }
  }

  // Input listener with debounce for undo history
  input.addEventListener('input', () => {
    updateSqlEditor();
    clearTimeout(editorSaveTimer);
    editorSaveTimer = setTimeout(saveEditorState, 300);
  });

  // Synchronize scrolling between textarea, highlight layer, and line-numbers
  input.addEventListener('scroll', () => {
    if (highlightLayer) {
      highlightLayer.scrollTop = input.scrollTop;
      highlightLayer.scrollLeft = input.scrollLeft;
    }
    if (lineNumbers) {
      lineNumbers.scrollTop = input.scrollTop;
    }
  });

  // Keyboard Shortcuts: VS Code compatible
  // Alt+Up/Down (move line), Shift+Alt+Up/Down & Ctrl+Shift+Alt+Up/Down (duplicate line)
  // Ctrl+Shift+K (delete line), Ctrl+C/Ctrl+X (line copy/cut), Ctrl+Z/Y (undo/redo), Ctrl+L (line select)
  // Ctrl+/ (toggle comment), Tab/Shift+Tab (indent), Ctrl+Enter (run query)
  input.addEventListener('keydown', (e) => {
    const isCtrl = e.ctrlKey || e.metaKey;

    // Duplicate Line Up: Shift + Alt + Up OR Ctrl + Shift + Alt + Up
    if (e.altKey && e.shiftKey && (e.key === 'ArrowUp' || e.code === 'ArrowUp')) {
      e.preventDefault();
      duplicateLineBlock(-1);
      return;
    }

    // Duplicate Line Down: Shift + Alt + Down OR Ctrl + Shift + Alt + Down
    if (e.altKey && e.shiftKey && (e.key === 'ArrowDown' || e.code === 'ArrowDown')) {
      e.preventDefault();
      duplicateLineBlock(1);
      return;
    }

    // Move Line Up: Alt + Up
    if (e.altKey && !e.shiftKey && (e.key === 'ArrowUp' || e.code === 'ArrowUp')) {
      e.preventDefault();
      moveLine(-1);
      return;
    }

    // Move Line Down: Alt + Down
    if (e.altKey && !e.shiftKey && (e.key === 'ArrowDown' || e.code === 'ArrowDown')) {
      e.preventDefault();
      moveLine(1);
      return;
    }

    // Ctrl + Shift + K : Delete line
    if (isCtrl && e.shiftKey && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      deleteLine();
      return;
    }

    // Ctrl + Enter: Run query
    if (isCtrl && e.key === 'Enter') {
      e.preventDefault();
      runQueryFromInput();
      return;
    }

    // Ctrl + / : Toggle comment
    if (isCtrl && (e.key === '/' || e.code === 'Slash' || (e.key === '7' && e.shiftKey))) {
      e.preventDefault();
      toggleComment();
      return;
    }

    // Ctrl + L : Select line
    if (isCtrl && !e.shiftKey && !e.altKey && (e.key === 'l' || e.key === 'L')) {
      e.preventDefault();
      selectCurrentLine();
      return;
    }

    // Ctrl + D : Duplicate line
    if (isCtrl && !e.shiftKey && !e.altKey && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      duplicateLine();
      return;
    }

    // Ctrl + Z : Undo
    if (isCtrl && !e.shiftKey && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      editorUndo();
      return;
    }

    // Ctrl + Y or Ctrl + Shift + Z : Redo
    if (isCtrl && (e.key === 'y' || e.key === 'Y' || (e.shiftKey && (e.key === 'z' || e.key === 'Z')))) {
      e.preventDefault();
      editorRedo();
      return;
    }

    // Tab / Shift + Tab: Indent / Unindent
    if (e.key === 'Tab') {
      e.preventDefault();
      handleTabIndent(e.shiftKey);
      return;
    }
  });

  input.addEventListener('copy', handleCopy);
  input.addEventListener('cut', handleCut);

  updateSqlEditor();
  saveEditorState();
}

// Query Execution & Table Rendering
async function loadTableData(tableName) {
  currentTable = getCanonicalTableName(tableName);
  document.querySelectorAll('#queryQuickTables .quick-table-btn').forEach(btn => {
    btn.classList.toggle('active', btn.innerText.trim().toLowerCase() === currentTable.toLowerCase());
  });
  const sql = `SELECT * FROM ${currentTable};`;
  setSqlInputValue(sql);
  document.getElementById('tableTitleDisplay').innerText = `Tabla: ${currentTable}`;
  await executeAndDisplayQuery(sql);
}

async function runQueryFromInput() {
  const sql = document.getElementById('sqlInput').value.trim();
  if (!sql) return;

  // Direct user to authentication panel if USE command is used
  const useMatch = sql.match(/\bUSE\s+([a-zA-Z0-9_]+)/i);
  if (useMatch || /^\s*USE\b/i.test(sql)) {
    const targetDb = useMatch ? useMatch[1] : '';
    openAuthModalForUse(targetDb);
    return;
  }

  const match = sql.match(/from\s+([a-zA-Z0-9_]+)/i);
  if (match) {
    const rawName = match[1];
    currentTable = getCanonicalTableName(rawName);
    document.getElementById('tableTitleDisplay').innerText = `Tabla: ${currentTable}`;
    document.querySelectorAll('#queryQuickTables .quick-table-btn').forEach(btn => {
      btn.classList.toggle('active', btn.innerText.trim().toLowerCase() === currentTable.toLowerCase());
    });
  } else if (/^\s*SHOW\s+TABLES\b/i.test(sql)) {
    document.getElementById('tableTitleDisplay').innerText = `Tablas en la Base de Datos`;
  }
  await executeAndDisplayQuery(sql);
}

async function executeAndDisplayQuery(sql) {
  // If query attempts to use USE, direct user to authentication panel
  const useMatch = sql.match(/\bUSE\s+([a-zA-Z0-9_]+)/i);
  if (useMatch || /^\s*USE\b/i.test(sql)) {
    const targetDb = useMatch ? useMatch[1] : '';
    openAuthModalForUse(targetDb);
    return;
  }

  const res = await callPython('execute_query', { sql });
  if (res && res.is_use_command) {
    openAuthModalForUse(res.target_database || '');
    return;
  }
  if (res && res.success) {
    currentColumns = res.columns || [];
    currentRows = res.rows || [];
    renderDataTable(currentColumns, currentRows, document.getElementById('tableHead'), document.getElementById('tableBody'), false);
  } else {
    const err = (res && res.error) ? res.error : "Error desconocido al ejecutar la consulta";
    const tbody = document.getElementById('tableBody');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 24px; font-weight: 600;">⚠️ ${escapeHtml(err)}</td></tr>`;
    }
    console.error("Error al ejecutar consulta:", err);
  }
}

function renderDataTable(columns, rows, theadEl, tbodyEl, isCrudView = false) {
  // Render headers
  let thHtml = '<tr>';
  columns.forEach(col => {
    thHtml += `<th>${col.toUpperCase()}</th>`;
  });
  if (isCrudView) {
    thHtml += `<th style="text-align: right; width: 110px;">ACCIONES</th>`;
  }
  thHtml += `</tr>`;
  theadEl.innerHTML = thHtml;

  // Render rows
  if (!rows || rows.length === 0) {
    const colspan = columns.length + (isCrudView ? 1 : 0);
    tbodyEl.innerHTML = `<tr><td colspan="${colspan}" style="text-align: center; color: #94a3b8; padding: 24px;">No se encontraron registros</td></tr>`;
    return;
  }

  let tbHtml = '';
  rows.forEach((row, rowIdx) => {
    tbHtml += '<tr>';
    row.forEach((cell, cellIdx) => {
      const colName = columns[cellIdx].toLowerCase();
      let cellClass = '';
      let cellText = cell;

      if (cell === null || cell === undefined) {
        cellClass = 'cell-null';
        cellText = 'NULL';
      } else if (typeof cell === 'number' || (!isNaN(cell) && cell.toString().trim() !== '' && (colName.includes('id') || colName.includes('tarifa') || colName.includes('num') || colName.includes('nivel') || colName.includes('cat')))) {
        cellClass = 'cell-number';
      }

      tbHtml += `<td class="${cellClass}">${cellText}</td>`;
    });

    if (isCrudView) {
      tbHtml += `
        <td style="text-align: right;">
          <div class="row-actions">
            <button class="btn-action-edit" onclick="handleEditRow('${currentCrudTable}', ${rowIdx})">Editar</button>
            <button class="btn-action-del" onclick="handleDeleteRow('${currentCrudTable}', ${rowIdx})">Borrar</button>
          </div>
        </td>
      `;
    }
    tbHtml += '</tr>';
  });
  tbodyEl.innerHTML = tbHtml;
}

// Automatic ER Diagram & Pan & Zoom
let erZoom = 1;
let erPanX = 0;
let erPanY = 0;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.5;

function setErTransform(zoom, panX, panY) {
  erZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
  erPanX = panX;
  erPanY = panY;

  const surface = document.getElementById('erCanvasSurface');
  if (surface) {
    surface.style.transform = `translate(${erPanX}px, ${erPanY}px) scale(${erZoom})`;
  }
  const badge = document.getElementById('erZoomLevel');
  if (badge) {
    badge.innerText = `${Math.round(erZoom * 100)}%`;
  }
  drawERRelationships();
}

function erZoomIn() {
  const newZoom = Math.min(MAX_ZOOM, +(erZoom + 0.15).toFixed(2));
  setErTransform(newZoom, erPanX, erPanY);
}

function erZoomOut() {
  const newZoom = Math.max(MIN_ZOOM, +(erZoom - 0.15).toFixed(2));
  setErTransform(newZoom, erPanX, erPanY);
}

function resetErView() {
  setErTransform(1, 0, 0);
}

function initErPanAndZoom() {
  const container = document.getElementById('erContainer');
  if (!container) return;

  // Wheel zoom
  container.addEventListener('wheel', (e) => {
    if (e.target.closest('.er-sidebar') || e.target.closest('.er-toolbar')) {
      return;
    }
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, +(erZoom + delta).toFixed(2)));
    setErTransform(newZoom, erPanX, erPanY);
  }, { passive: false });

  // Prevent sidebar wheel scroll from bubbling up
  const sidebar = document.getElementById('erSidebar');
  if (sidebar) {
    sidebar.addEventListener('wheel', (e) => {
      e.stopPropagation();
    }, { passive: true });
  }

  // Pan background by dragging empty space
  let isPanning = false;
  let panStartX, panStartY, origPanX, origPanY;

  container.addEventListener('mousedown', (e) => {
    // If clicking on a card or toolbar button, don't pan canvas
    if (e.target.closest('.er-table-card') || e.target.closest('.er-toolbar') || e.target.closest('button')) {
      return;
    }
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    origPanX = erPanX;
    origPanY = erPanY;
    container.style.cursor = 'grabbing';

    const onMouseMove = (ev) => {
      if (!isPanning) return;
      const dx = ev.clientX - panStartX;
      const dy = ev.clientY - panStartY;
      setErTransform(erZoom, origPanX + dx, origPanY + dy);
    };

    const onMouseUp = () => {
      isPanning = false;
      container.style.cursor = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
}

async function fetchAndRenderERDiagram() {
  const res = await callPython('get_schema');
  if (res && res.success) {
    currentSchema = res;
    renderERDiagram();
  }
}

// Table Card positions matching picture-1.png
const defaultCardPositions = {
  'TRABAJADOR': { left: 24, top: 96 },
  'ASIGNACION': { left: 210, top: 196 },
  'EDIFICIO': { left: 396, top: 96 }
};
const cardPositions = { ...defaultCardPositions };

function resetCardPositions() {
  Object.assign(cardPositions, defaultCardPositions);
  resetErView();
  renderERDiagram();
}

function renderERDiagram() {
  if (!currentSchema || !currentSchema.tables) return;
  const container = document.getElementById('erTablesContainer');
  if (!container) return;
  container.innerHTML = '';

  currentSchema.tables.forEach((t, idx) => {
    const tname = t.name.toUpperCase();
    // Default stagger position for any arbitrary tables
    const fallbackPos = { left: 30 + (idx % 3) * 220, top: 40 + Math.floor(idx / 3) * 240 };
    const pos = cardPositions[tname] || fallbackPos;

    const card = document.createElement('div');
    const isSel = erSelectedTable && erSelectedTable.toUpperCase() === tname;
    card.className = `er-table-card ${isSel ? 'is-selected' : ''}`;
    card.id = `er-card-${tname}`;
    card.style.left = `${pos.left}px`;
    card.style.top = `${pos.top}px`;

    // Header
    let cardHtml = `
      <div class="er-card-header">
        <svg class="er-card-header-icon" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 3.79 2 6v12c0 2.21 4.48 4 10 4s10-1.79 10-4V6c0-2.21-4.48-4-10-4zm0 2c4.42 0 8 1.34 8 2s-3.58 2-8 2-8-1.34-8-2 3.58-2 8-2zm8 6c0 .66-3.58 2-8 2s-8-1.34-8-2V8.41C5.64 9.38 8.65 10 12 10s6.36-.62 8-1.59V10zm0 6c0 .66-3.58 2-8 2s-8-1.34-8-2v-1.59c1.64.97 4.65 1.59 8 1.59s6.36-.62 8-1.59V16z"/>
        </svg>
        <span class="er-card-title">${tname}</span>
      </div>
      <div class="er-card-body">
    `;

    // Columns
    t.columns.forEach(col => {
      let icon = '';
      if (col.is_pk) {
        icon = `<svg class="er-key-icon" viewBox="0 0 20 20" fill="#f59e0b"><path fill-rule="evenodd" clip-rule="evenodd" d="M 5 6.5 C 3.07 6.5 1.5 8.07 1.5 10 C 1.5 11.93 3.07 13.5 5 13.5 C 6.54 13.5 7.84 12.5 8.3 11 L 13 11 L 13 13.5 L 14.5 13.5 L 14.5 11 L 16.5 11 L 16.5 13.5 L 18 13.5 L 18 9 L 8.3 9 C 7.84 7.5 6.54 6.5 5 6.5 Z M 5 8.5 C 5.83 8.5 6.5 9.17 6.5 10 C 6.5 10.83 5.83 11.5 5 11.5 C 4.17 11.5 3.5 10.83 3.5 10 C 3.5 9.17 4.17 8.5 5 8.5 Z"/></svg>`;
      } else if (col.is_fk) {
        icon = `<svg class="er-key-icon" viewBox="0 0 24 24" fill="#3b82f6"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>`;
      } else {
        icon = `<span style="width: 14px; display: inline-block;"></span>`;
      }

      const isColSel = (erSelectedTable && erSelectedTable.toUpperCase() === tname && erSelectedCol && erSelectedCol.toUpperCase() === col.name.toUpperCase());

      cardHtml += `
        <div class="er-column-row ${isColSel ? 'is-selected' : ''}" id="er-col-${tname.toUpperCase()}-${col.name.toUpperCase()}" data-table="${tname}" data-col="${col.name}">
          <div class="er-col-left">
            <span class="er-col-dot" title="Arrastrar para conectar con otra columna" data-table="${tname}" data-col="${col.name}"></span>
            ${icon}
            <span class="er-col-name">${col.name}</span>
          </div>
          <span class="er-col-type">${col.type}</span>
        </div>
      `;
    });

    cardHtml += `</div>`;
    card.innerHTML = cardHtml;

    card.addEventListener('click', (e) => {
      e.stopPropagation();
      const colRow = e.target.closest('.er-column-row');
      if (colRow && colRow.dataset.col) {
        selectErCol(tname, colRow.dataset.col);
      } else {
        selectErTable(tname);
      }
    });

    makeDraggable(card, tname);
    container.appendChild(card);
  });

  setTimeout(drawERRelationships, 30);
  if (isErSidebarOpen) {
    if (currentSidebarTab === 'code') {
      updateSidebarSqlCode();
    } else {
      renderErSidebar();
    }
  }
}

function makeDraggable(el, tableName) {
  let isDragging = false;
  let hasMoved = false;
  let startX, startY, origX, origY;

  el.addEventListener('mousedown', (e) => {
    // Only drag with left mouse button and not on connection dot
    if (e.button !== 0 || e.target.closest('.er-col-dot')) return;
    e.stopPropagation();

    isDragging = true;
    hasMoved = false;
    startX = e.clientX;
    startY = e.clientY;
    origX = el.offsetLeft;
    origY = el.offsetTop;
    el.style.zIndex = 40;

    const onMouseMove = (ev) => {
      if (!isDragging) return;
      const dx = (ev.clientX - startX) / erZoom;
      const dy = (ev.clientY - startY) / erZoom;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved = true;
      const newX = Math.round(origX + dx);
      const newY = Math.round(origY + dy);
      el.style.left = `${newX}px`;
      el.style.top = `${newY}px`;
      cardPositions[tableName] = { left: newX, top: newY };
      drawERRelationships();
    };

    const onMouseUp = () => {
      isDragging = false;
      el.style.zIndex = 20;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      if (!hasMoved) {
        selectErTable(tableName);
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
}

// Drag & Drop Column Connection
function initErConnectionDrag() {
  const container = document.getElementById('erContainer');
  const previewLine = document.getElementById('erDragPreviewLine');
  const surface = document.getElementById('erCanvasSurface');
  if (!container || !previewLine || !surface) return;

  let isConnecting = false;
  let fromTable = null;
  let fromCol = null;
  let startX = 0;
  let startY = 0;

  container.addEventListener('mousedown', (e) => {
    const dot = e.target.closest('.er-col-dot');
    if (!dot) return;
    e.stopPropagation();
    e.preventDefault();

    fromTable = dot.dataset.table;
    fromCol = dot.dataset.col;
    if (!fromTable || !fromCol) return;

    isConnecting = true;
    dot.classList.add('is-active');

    const surfaceRect = surface.getBoundingClientRect();
    const dotRect = dot.getBoundingClientRect();
    startX = ((dotRect.left + dotRect.width / 2) - surfaceRect.left) / erZoom;
    startY = ((dotRect.top + dotRect.height / 2) - surfaceRect.top) / erZoom;

    previewLine.style.display = 'block';

    const onMouseMove = (ev) => {
      if (!isConnecting) return;
      const currentMouseX = (ev.clientX - surfaceRect.left) / erZoom;
      const currentMouseY = (ev.clientY - surfaceRect.top) / erZoom;

      const dx = Math.max(Math.abs(currentMouseX - startX) * 0.5, 30);
      const cp1x = (startX < currentMouseX) ? startX + dx : startX - dx;
      const cp2x = (startX < currentMouseX) ? currentMouseX - dx : currentMouseX + dx;

      const d = `M ${startX} ${startY} C ${cp1x} ${startY}, ${cp2x} ${currentMouseY}, ${currentMouseX} ${currentMouseY}`;
      previewLine.setAttribute('d', d);
    };

    const onMouseUp = (ev) => {
      if (!isConnecting) return;
      isConnecting = false;
      previewLine.style.display = 'none';
      dot.classList.remove('is-active');

      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);

      const dropEl = document.elementFromPoint(ev.clientX, ev.clientY);
      if (!dropEl) return;
      const targetRow = dropEl.closest('.er-column-row');
      if (!targetRow) return;

      const toTable = targetRow.dataset.table;
      const toCol = targetRow.dataset.col;

      if (!toTable || !toCol) return;
      if (fromTable.toUpperCase() === toTable.toUpperCase() && fromCol.toUpperCase() === toCol.toUpperCase()) {
        return;
      }

      if (!currentSchema.relations) currentSchema.relations = [];
      const exists = currentSchema.relations.some(r =>
        r.from_table.toUpperCase() === fromTable.toUpperCase() &&
        r.from_col.toUpperCase() === fromCol.toUpperCase() &&
        r.to_table.toUpperCase() === toTable.toUpperCase() &&
        r.to_col.toUpperCase() === toCol.toUpperCase()
      );

      if (!exists) {
        currentSchema.relations.push({
          from_table: fromTable,
          from_col: fromCol,
          to_table: toTable,
          to_col: toCol
        });

        const sourceTableObj = currentSchema.tables.find(t => t.name.toUpperCase() === fromTable.toUpperCase());
        if (sourceTableObj) {
          const colObj = sourceTableObj.columns.find(c => c.name.toUpperCase() === fromCol.toUpperCase());
          if (colObj) colObj.is_fk = true;
        }

        renderERDiagram();
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
}

// Collapsible Left Sidebar Table Management & Integrated SQL Code
let isErSidebarOpen = false;
let currentSidebarTab = 'tables';
let erSelectedTable = null;
let erSelectedCol = null;

const ALL_DATA_TYPES = [
  'VARCHAR', 'CHAR', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT',
  'INT', 'BIGINT', 'SMALLINT', 'TINYINT', 'DECIMAL', 'FLOAT', 'DOUBLE',
  'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR',
  'BOOLEAN', 'ENUM', 'JSON', 'BLOB'
];

function parseColTypeInfo(rawType) {
  const str = (rawType || 'VARCHAR(50)').trim();
  const match = str.match(/^([A-Za-z]+)(?:\(([^)]+)\))?/i);
  const base = match ? match[1].toUpperCase() : 'VARCHAR';
  const args = match && match[2] ? match[2].split(',').map(s => s.trim()) : [];

  let length = 50;
  let precision = 10;
  let scale = 2;

  if (base === 'CHAR') length = 10;
  if (base === 'VARCHAR' || base === 'CHAR') {
    if (args[0] && !isNaN(parseInt(args[0]))) length = parseInt(args[0]);
  } else if (base === 'DECIMAL' || base === 'NUMERIC') {
    if (args[0] && !isNaN(parseInt(args[0]))) precision = parseInt(args[0]);
    if (args[1] && !isNaN(parseInt(args[1]))) scale = parseInt(args[1]);
  }

  return { base, length, precision, scale };
}

function formatColTypeString(col) {
  const base = (col.baseType || col.type || 'VARCHAR').toUpperCase().split('(')[0];
  if (base === 'VARCHAR' || base === 'CHAR') {
    const max = base === 'CHAR' ? 255 : 65535;
    const defLen = base === 'CHAR' ? 10 : 50;
    const len = col.length !== undefined ? Math.min(max, Math.max(0, col.length)) : defLen;
    return `${base}(${len})`;
  }
  if (base === 'DECIMAL' || base === 'NUMERIC') {
    const prec = col.precision !== undefined ? col.precision : 10;
    const sc = col.scale !== undefined ? col.scale : 2;
    return `${base}(${prec},${sc})`;
  }
  if (base === 'ENUM') {
    return `ENUM(${col.enum_values || "'Activo','Inactivo'"})`;
  }
  return base;
}

let savedSidebarWidth = 380;

function updateSidebarExpandIndicator() {
  const indicator = document.getElementById('erSidebarExpandIndicator');
  if (indicator) {
    indicator.style.display = isErSidebarOpen ? 'none' : 'inline-flex';
  }
}

function toggleErSidebar(forceState) {
  const sidebar = document.getElementById('erSidebar');
  if (!sidebar) return;

  if (typeof forceState === 'boolean') {
    isErSidebarOpen = forceState;
  } else {
    isErSidebarOpen = !isErSidebarOpen;
  }

  sidebar.classList.toggle('collapsed', !isErSidebarOpen);

  if (isErSidebarOpen) {
    const widthToUse = (savedSidebarWidth && savedSidebarWidth >= 280) ? savedSidebarWidth : 380;
    sidebar.style.width = `${widthToUse}px`;
    if (currentSidebarTab === 'code') {
      updateSidebarSqlCode();
    } else {
      renderErSidebar();
    }
  }

  updateSidebarExpandIndicator();
  setTimeout(drawERRelationships, 260);
}

function initSidebarResizer() {
  const resizer = document.getElementById('erSidebarResizer');
  const sidebar = document.getElementById('erSidebar');
  if (!resizer || !sidebar) return;

  let isDragging = false;
  let startX = 0;
  let startWidth = 0;

  resizer.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    isDragging = true;
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
    resizer.classList.add('is-dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev) => {
      if (!isDragging) return;
      const dx = ev.clientX - startX;
      const newWidth = startWidth + dx;

      // When width is narrow enough, collapse and hide panel
      if (newWidth < 260) {
        isDragging = false;
        resizer.classList.remove('is-dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        toggleErSidebar(false);
        return;
      }

      // Constrain within boundaries
      const clampedWidth = Math.max(280, Math.min(newWidth, 750));
      sidebar.style.width = `${clampedWidth}px`;
      savedSidebarWidth = clampedWidth;
      drawERRelationships();
    };

    const onMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      resizer.classList.remove('is-dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      drawERRelationships();
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
}

async function switchSidebarTab(tabName) {
  currentSidebarTab = tabName;
  const btnTables = document.getElementById('tabBtnSidebarTables');
  const btnCode = document.getElementById('tabBtnSidebarCode');
  const paneTables = document.getElementById('paneSidebarTables');
  const paneCode = document.getElementById('paneSidebarCode');
  const title = document.getElementById('erSidebarHeaderTitle');

  if (tabName === 'code') {
    if (btnTables) btnTables.classList.remove('active');
    if (btnCode) btnCode.classList.add('active');
    if (paneTables) paneTables.classList.remove('active');
    if (paneCode) paneCode.classList.add('active');
    if (title) title.innerText = 'Código SQL (DDL)';
    if (!currentSchema || !currentSchema.tables || currentSchema.tables.length === 0) {
      await fetchAndRenderERDiagram();
    }
    updateSidebarSqlCode();
  } else {
    if (btnTables) btnTables.classList.add('active');
    if (btnCode) btnCode.classList.remove('active');
    if (paneTables) paneTables.classList.add('active');
    if (paneCode) paneCode.classList.remove('active');
    if (title) title.innerText = 'Esquema ER';
    renderErSidebar();
  }
}

async function showSidebarTab(tabName) {
  const sidebar = document.getElementById('erSidebar');
  if (!sidebar) return;

  if (!isErSidebarOpen) {
    toggleErSidebar(true);
    await switchSidebarTab(tabName);
  } else if (currentSidebarTab === tabName) {
    toggleErSidebar(false);
  } else {
    await switchSidebarTab(tabName);
  }
}

function updateSidebarSqlCode() {
  const lineNumbersEl = document.getElementById('sidebarSqlLineNumbers');
  const codeDisplayEl = document.getElementById('sidebarSqlCodeDisplay');
  if (!codeDisplayEl) return;

  const ddl = generateSqlDDL();
  const lines = ddl.split('\n');

  if (lineNumbersEl) {
    lineNumbersEl.innerHTML = lines.map((_, i) => `<div>${i + 1}</div>`).join('');
  }
  codeDisplayEl.innerHTML = highlightSql(ddl);
}

async function copySidebarSqlCode() {
  const ddl = generateSqlDDL();
  const badge = document.getElementById('sidebarCopySuccessBadge');
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(ddl);
    } else {
      throw new Error('Clipboard API unavailable');
    }
  } catch (err) {
    const ta = document.createElement('textarea');
    ta.value = ddl;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  if (badge) {
    badge.style.display = 'inline-flex';
    setTimeout(() => { badge.style.display = 'none'; }, 2200);
  }
}

function removeRelation(fromTable, fromCol, toTable, toCol) {
  if (!currentSchema || !currentSchema.relations) return;
  currentSchema.relations = currentSchema.relations.filter(r =>
    !(r.from_table.toUpperCase() === fromTable.toUpperCase() &&
      r.from_col.toUpperCase() === fromCol.toUpperCase() &&
      r.to_table.toUpperCase() === toTable.toUpperCase() &&
      r.to_col.toUpperCase() === toCol.toUpperCase())
  );

  const hasOther = currentSchema.relations.some(r =>
    r.from_table.toUpperCase() === fromTable.toUpperCase() &&
    r.from_col.toUpperCase() === fromCol.toUpperCase()
  );
  const sourceTable = currentSchema.tables.find(t => t.name.toUpperCase() === fromTable.toUpperCase());
  if (sourceTable) {
    const col = sourceTable.columns.find(c => c.name.toUpperCase() === fromCol.toUpperCase());
    if (col && !hasOther) col.is_fk = false;
  }

  renderERDiagram();
  renderErSidebar();
  updateSidebarSqlCode();
}

function toggleSidebarTable(tableName, e) {
  if (e) e.stopPropagation();
  const item = document.getElementById(`sidebar-table-${tableName.toUpperCase()}`);
  if (!item) return;

  const isOpen = item.classList.contains('open');
  if (isOpen) {
    item.classList.remove('open');
    if (erSelectedTable && erSelectedTable.toUpperCase() === tableName.toUpperCase()) {
      erSelectedTable = null;
      document.querySelectorAll('.er-table-card').forEach(c => c.classList.remove('is-selected'));
      document.querySelectorAll('.er-column-row').forEach(r => r.classList.remove('is-selected'));
    }
  } else {
    item.classList.add('open');
    selectErTable(tableName);
  }
}

function renderAdvPanelHtml(tableName, col, cIdx) {
  const base = (col.baseType || col.type || 'VARCHAR').toUpperCase().split('(')[0];
  let specificFieldsHtml = '';

  if (base === 'VARCHAR' || base === 'CHAR') {
    const max = base === 'CHAR' ? 255 : 65535;
    const defLen = base === 'CHAR' ? 10 : 50;
    const curLen = col.length !== undefined ? col.length : defLen;
    specificFieldsHtml = `
      <div class="adv-field">
        <label>Tamaño (0-${max}):</label>
        <input type="number" min="0" max="${max}" style="width: 70px;" value="${curLen}" oninput="updateColLength('${tableName}', ${cIdx}, this.value)" onclick="event.stopPropagation()">
      </div>
    `;
  } else if (base === 'DECIMAL' || base === 'NUMERIC') {
    specificFieldsHtml = `
      <div class="adv-field">
        <label>Precisión:</label>
        <input type="number" min="1" max="65" style="width: 50px;" value="${col.precision !== undefined ? col.precision : 10}" oninput="updateColDecimal('${tableName}', ${cIdx}, 'precision', this.value)" onclick="event.stopPropagation()">
      </div>
      <div class="adv-field">
        <label>Escala:</label>
        <input type="number" min="0" max="30" style="width: 50px;" value="${col.scale !== undefined ? col.scale : 2}" oninput="updateColDecimal('${tableName}', ${cIdx}, 'scale', this.value)" onclick="event.stopPropagation()">
      </div>
    `;
  } else if (base === 'INT' || base === 'BIGINT' || base === 'SMALLINT' || base === 'TINYINT') {
    specificFieldsHtml = `
      <label class="adv-checkbox-label"><input type="checkbox" ${col.auto_increment ? 'checked' : ''} onchange="updateColAdv('${tableName}', ${cIdx}, 'auto_increment', this.checked)"> Autoinc</label>
      <label class="adv-checkbox-label"><input type="checkbox" ${col.unsigned ? 'checked' : ''} onchange="updateColAdv('${tableName}', ${cIdx}, 'unsigned', this.checked)"> Sin signo (Unsigned)</label>
    `;
  } else if (base === 'ENUM') {
    specificFieldsHtml = `
      <div class="adv-field" style="width: 100%;">
        <label>Valores:</label>
        <input type="text" style="flex: 1;" value="${escapeHtml(col.enum_values || "'Activo','Inactivo'")}" placeholder="'A','B'..." oninput="updateColEnum('${tableName}', ${cIdx}, this.value)" onclick="event.stopPropagation()">
      </div>
    `;
  }

  return `
    <div class="er-col-adv-panel" id="adv_panel_${tableName}_${cIdx}" style="display: none;">
      <div class="adv-row">
        <label class="adv-checkbox-label"><input type="checkbox" ${col.not_null ? 'checked' : ''} onchange="updateColAdv('${tableName}', ${cIdx}, 'not_null', this.checked)"> No nulo</label>
        <label class="adv-checkbox-label"><input type="checkbox" ${col.unique ? 'checked' : ''} onchange="updateColAdv('${tableName}', ${cIdx}, 'unique', this.checked)"> Único</label>
        ${specificFieldsHtml}
      </div>
      <div class="adv-row">
        <div class="adv-field" style="width: 100%;">
          <label>Por defecto:</label>
          <input type="text" style="flex: 1;" value="${escapeHtml(col.default_val || '')}" placeholder="Ej: NULL, 0, 'valor'" oninput="updateColAdv('${tableName}', ${cIdx}, 'default_val', this.value)" onclick="event.stopPropagation()">
        </div>
      </div>
    </div>
  `;
}

function renderErSidebar(filterQuery = '') {
  const listEl = document.getElementById('erSidebarTablesList');
  const countEl = document.getElementById('erSidebarTablesCount');
  if (!listEl || !currentSchema || !currentSchema.tables) return;

  if (countEl) countEl.innerText = currentSchema.tables.length;
  listEl.innerHTML = '';

  const q = (filterQuery || '').trim().toLowerCase();

  currentSchema.tables.forEach((t, tIdx) => {
    if (q && !t.name.toLowerCase().includes(q)) return;

    const isOpen = (erSelectedTable && erSelectedTable.toUpperCase() === t.name.toUpperCase()) || (!erSelectedTable && tIdx === 0);
    const item = document.createElement('div');
    item.className = `er-sidebar-table-item ${isOpen ? 'open' : ''} ${erSelectedTable && erSelectedTable.toUpperCase() === t.name.toUpperCase() ? 'is-selected' : ''}`;
    item.id = `sidebar-table-${t.name.toUpperCase()}`;

    let columnsHtml = '';
    t.columns.forEach((col, cIdx) => {
      const typeInfo = parseColTypeInfo(col.type);
      const baseType = (col.baseType || typeInfo.base).toUpperCase();
      col.baseType = baseType;
      if (col.length === undefined) col.length = typeInfo.length;
      if (col.precision === undefined) col.precision = typeInfo.precision;
      if (col.scale === undefined) col.scale = typeInfo.scale;

      const isColSel = (erSelectedTable && erSelectedTable.toUpperCase() === t.name.toUpperCase() && erSelectedCol && erSelectedCol.toUpperCase() === col.name.toUpperCase());
      const optHtml = ALL_DATA_TYPES.map(tp => `<option value="${tp}" ${baseType === tp ? 'selected' : ''}>${tp}</option>`).join('');

      let relBadgeHtml = '';
      if (currentSchema.relations) {
        const colRels = currentSchema.relations.filter(r =>
          r.from_table.toUpperCase() === t.name.toUpperCase() &&
          r.from_col.toUpperCase() === col.name.toUpperCase()
        );
        colRels.forEach(rel => {
          relBadgeHtml += `
            <div class="er-col-relation-pill" title="Relación activa">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              <span>→ ${escapeHtml(rel.to_table)}.${escapeHtml(rel.to_col)}</span>
              <button type="button" class="btn-del-rel" onclick="event.stopPropagation(); removeRelation('${t.name}', '${col.name}', '${rel.to_table}', '${rel.to_col}')" title="Eliminar relación">✕</button>
            </div>
          `;
        });
      }

      const advHtml = renderAdvPanelHtml(t.name, col, cIdx);

      columnsHtml += `
        <div class="er-col-edit-wrapper" id="sidebar-col-${t.name.toUpperCase()}-${col.name.toUpperCase()}">
          <div class="er-col-edit-row ${isColSel ? 'is-selected' : ''}" onclick="selectErCol('${t.name}', '${col.name}')">
            <input type="text" class="er-col-name-input" value="${escapeHtml(col.name)}" onchange="updateColName('${t.name}', ${cIdx}, this.value)" title="Nombre de columna" onclick="event.stopPropagation()">
            <select class="er-col-type-select" onchange="onSelectColType('${t.name}', ${cIdx}, this.value)" title="Tipo de dato" onclick="event.stopPropagation()">
              ${optHtml}
            </select>
            <button type="button" class="er-col-pk-btn ${col.is_pk ? 'active' : ''}" onclick="event.stopPropagation(); toggleColPk('${t.name}', ${cIdx})" title="${col.is_pk ? 'Llave primaria activa' : 'Hacer llave primaria'}">
              <span class="badge-pk-text">PK</span>
            </button>
            <button type="button" class="er-col-adv-btn" id="btn_adv_${t.name}_${cIdx}" onclick="event.stopPropagation(); toggleAdvPanel('${t.name}_${cIdx}')" title="Opciones avanzadas">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>
            </button>
            <button type="button" class="er-btn-icon-subtle delete" onclick="event.stopPropagation(); deleteColFromTable('${t.name}', ${cIdx})" title="Eliminar columna">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
          ${relBadgeHtml}
          ${advHtml}
        </div>
      `;
    });

    item.innerHTML = `
      <div class="er-sidebar-table-header" onclick="toggleSidebarTable('${t.name}', event)">
        <div class="er-table-header-left">
          <svg class="er-tbl-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 3.79 2 6v12c0 2.21 4.48 4 10 4s10-1.79 10-4V6c0-2.21-4.48-4-10-4zm0 2c4.42 0 8 1.34 8 2s-3.58 2-8 2-8-1.34-8-2 3.58-2 8-2zm8 6c0 .66-3.58 2-8 2s-8-1.34-8-2V8.41C5.64 9.38 8.65 10 12 10s6.36-.62 8-1.59V10zm0 6c0 .66-3.58 2-8 2s-8-1.34-8-2v-1.59c1.64.97 4.65 1.59 8 1.59s6.36-.62 8-1.59V16z"/></svg>
          <span>${escapeHtml(t.name)}</span>
          <span style="font-size: 10px; font-weight: normal; color: #64748b;">(${t.columns.length})</span>
          <svg class="er-accordion-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="er-table-header-actions" onclick="event.stopPropagation()">
          <button type="button" class="er-btn-icon-subtle" onclick="focusCanvasTable('${t.name}')" title="Ubicar en diagrama">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          <button type="button" class="er-btn-icon-subtle delete" onclick="deleteTableFromSchema('${t.name}')" title="Eliminar tabla">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
      <div class="er-sidebar-table-body">
        <div class="er-table-name-input-group">
          <span class="er-table-name-label">Nombre:</span>
          <input type="text" class="er-table-name-input" value="${escapeHtml(t.name)}" onchange="renameTableInSchema('${t.name}', this.value)" onclick="event.stopPropagation()">
        </div>
        <div class="er-cols-list">
          ${columnsHtml}
        </div>
        <button type="button" class="btn-add-col-dashed" onclick="addColumnToTable('${t.name}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          Agregar Columna
        </button>
      </div>
    `;

    listEl.appendChild(item);
  });
}

function toggleAdvPanel(id) {
  const el = document.getElementById('adv_panel_' + id);
  if (el) {
    el.style.display = el.style.display === 'none' ? 'flex' : 'none';
  }
}

function onSelectColType(tableName, colIdx, newBase) {
  const table = currentSchema.tables.find(t => t.name.toUpperCase() === tableName.toUpperCase());
  if (!table || !table.columns[colIdx]) return;
  const col = table.columns[colIdx];
  col.baseType = newBase.toUpperCase();
  if (col.baseType === 'CHAR' && (!col.length || col.length > 255)) col.length = 10;
  if (col.baseType === 'VARCHAR' && !col.length) col.length = 50;
  if (col.baseType === 'DECIMAL') {
    if (!col.precision) col.precision = 10;
    if (!col.scale) col.scale = 2;
  }
  col.type = formatColTypeString(col);
  renderERDiagram();
  renderErSidebar();
  updateSidebarSqlCode();
}

function updateColLength(tableName, colIdx, val) {
  const table = currentSchema.tables.find(t => t.name.toUpperCase() === tableName.toUpperCase());
  if (!table || !table.columns[colIdx]) return;
  const col = table.columns[colIdx];
  const base = (col.baseType || col.type || 'VARCHAR').toUpperCase().split('(')[0];
  const max = base === 'CHAR' ? 255 : 65535;
  col.length = Math.min(max, Math.max(0, parseInt(val) || 0));
  col.type = formatColTypeString(col);
  renderERDiagram();
  updateSidebarSqlCode();
}

function updateColDecimal(tableName, colIdx, prop, val) {
  const table = currentSchema.tables.find(t => t.name.toUpperCase() === tableName.toUpperCase());
  if (!table || !table.columns[colIdx]) return;
  const col = table.columns[colIdx];
  col[prop] = parseInt(val) || 0;
  col.type = formatColTypeString(col);
  renderERDiagram();
  updateSidebarSqlCode();
}

function updateColEnum(tableName, colIdx, val) {
  const table = currentSchema.tables.find(t => t.name.toUpperCase() === tableName.toUpperCase());
  if (!table || !table.columns[colIdx]) return;
  const col = table.columns[colIdx];
  col.enum_values = val;
  col.type = formatColTypeString(col);
  renderERDiagram();
  updateSidebarSqlCode();
}

function updateColAdv(tableName, colIdx, prop, val) {
  const table = currentSchema.tables.find(t => t.name.toUpperCase() === tableName.toUpperCase());
  if (!table || !table.columns[colIdx]) return;
  table.columns[colIdx][prop] = val;
  renderERDiagram();
  updateSidebarSqlCode();
}

function updateColName(tableName, colIdx, newName) {
  const cleanName = newName.trim();
  if (!cleanName) return;
  const table = currentSchema.tables.find(t => t.name.toUpperCase() === tableName.toUpperCase());
  if (table && table.columns[colIdx]) {
    const oldName = table.columns[colIdx].name;
    table.columns[colIdx].name = cleanName;
    if (currentSchema.relations) {
      currentSchema.relations.forEach(r => {
        if (r.from_table.toUpperCase() === tableName.toUpperCase() && r.from_col.toUpperCase() === oldName.toUpperCase()) {
          r.from_col = cleanName;
        }
        if (r.to_table.toUpperCase() === tableName.toUpperCase() && r.to_col.toUpperCase() === oldName.toUpperCase()) {
          r.to_col = cleanName;
        }
      });
    }
    renderERDiagram();
    updateSidebarSqlCode();
  }
}

function updateColType(tableName, colIdx, newType) {
  onSelectColType(tableName, colIdx, newType);
}

function toggleColPk(tableName, colIdx) {
  const table = currentSchema.tables.find(t => t.name.toUpperCase() === tableName.toUpperCase());
  if (table && table.columns[colIdx]) {
    table.columns[colIdx].is_pk = !table.columns[colIdx].is_pk;
    renderERDiagram();
    renderErSidebar();
    updateSidebarSqlCode();
  }
}

function addColumnToTable(tableName) {
  const table = currentSchema.tables.find(t => t.name.toUpperCase() === tableName.toUpperCase());
  if (table) {
    const colCount = table.columns.length + 1;
    table.columns.push({
      name: `col_${colCount}`,
      baseType: 'VARCHAR',
      length: 50,
      type: 'VARCHAR(50)',
      is_pk: false,
      is_fk: false,
      not_null: false,
      unique: false,
      auto_increment: false
    });
    renderERDiagram();
    renderErSidebar();
    updateSidebarSqlCode();
  }
}

function deleteColFromTable(tableName, colIdx) {
  const table = currentSchema.tables.find(t => t.name.toUpperCase() === tableName.toUpperCase());
  if (table && table.columns.length > 1) {
    const deletedCol = table.columns[colIdx].name;
    table.columns.splice(colIdx, 1);
    if (currentSchema.relations) {
      currentSchema.relations = currentSchema.relations.filter(r =>
        !(r.from_table.toUpperCase() === tableName.toUpperCase() && r.from_col.toUpperCase() === deletedCol.toUpperCase()) &&
        !(r.to_table.toUpperCase() === tableName.toUpperCase() && r.to_col.toUpperCase() === deletedCol.toUpperCase())
      );
    }
    renderERDiagram();
    renderErSidebar();
    updateSidebarSqlCode();
  } else {
    alert("Una tabla debe tener al menos una columna.");
  }
}

function addNewTableToSchema() {
  if (!currentSchema) currentSchema = { tables: [], relations: [] };
  const count = currentSchema.tables.length + 1;
  const newTableName = `tabla_${count}`;

  const posX = 40 + ((count - 1) % 4) * 220;
  const posY = 100 + Math.floor((count - 1) / 4) * 240;
  cardPositions[newTableName.toUpperCase()] = { left: posX, top: posY };

  currentSchema.tables.push({
    name: newTableName,
    columns: [
      { name: 'id', baseType: 'INT', type: 'INT', is_pk: true, is_fk: false, not_null: true, unique: true, auto_increment: true },
      { name: 'nombre', baseType: 'VARCHAR', length: 50, type: 'VARCHAR(50)', is_pk: false, is_fk: false, not_null: false, unique: false, auto_increment: false }
    ]
  });

  if (availableTables && !availableTables.includes(newTableName)) {
    availableTables.push(newTableName);
    renderTableButtons(availableTables);
  }

  erSelectedTable = newTableName;
  renderERDiagram();
  renderErSidebar();
  updateSidebarSqlCode();
  focusCanvasTable(newTableName);
}

function renameTableInSchema(oldName, newName) {
  const clean = newName.trim();
  if (!clean || clean.toUpperCase() === oldName.toUpperCase()) return;
  const table = currentSchema.tables.find(t => t.name.toUpperCase() === oldName.toUpperCase());
  if (table) {
    table.name = clean;
    if (cardPositions[oldName.toUpperCase()]) {
      cardPositions[clean.toUpperCase()] = cardPositions[oldName.toUpperCase()];
      delete cardPositions[oldName.toUpperCase()];
    }
    if (currentSchema.relations) {
      currentSchema.relations.forEach(r => {
        if (r.from_table.toUpperCase() === oldName.toUpperCase()) r.from_table = clean;
        if (r.to_table.toUpperCase() === oldName.toUpperCase()) r.to_table = clean;
      });
    }
    erSelectedTable = clean;
    renderERDiagram();
    renderErSidebar();
    updateSidebarSqlCode();
  }
}

function deleteTableFromSchema(tableName) {
  if (!confirm(`¿Está seguro de eliminar la tabla '${tableName}' del diagrama?`)) return;
  currentSchema.tables = currentSchema.tables.filter(t => t.name.toUpperCase() !== tableName.toUpperCase());
  if (currentSchema.relations) {
    currentSchema.relations = currentSchema.relations.filter(r =>
      r.from_table.toUpperCase() !== tableName.toUpperCase() &&
      r.to_table.toUpperCase() !== tableName.toUpperCase()
    );
  }
  delete cardPositions[tableName.toUpperCase()];
  if (erSelectedTable && erSelectedTable.toUpperCase() === tableName.toUpperCase()) {
    erSelectedTable = null;
  }
  renderERDiagram();
  renderErSidebar();
  updateSidebarSqlCode();
}

function scrollSidebarItemIntoView(itemEl) {
  const list = document.getElementById('erSidebarTablesList');
  if (!list || !itemEl) return;
  const listRect = list.getBoundingClientRect();
  const itemRect = itemEl.getBoundingClientRect();
  if (itemRect.top < listRect.top) {
    list.scrollTop -= (listRect.top - itemRect.top + 8);
  } else if (itemRect.bottom > listRect.bottom) {
    list.scrollTop += (itemRect.bottom - listRect.bottom + 8);
  }
}

function selectErTable(tableName) {
  erSelectedTable = tableName;
  erSelectedCol = null;

  document.querySelectorAll('.er-table-card').forEach(c => {
    c.classList.toggle('is-selected', c.id === `er-card-${tableName.toUpperCase()}`);
  });

  document.querySelectorAll('.er-column-row').forEach(r => {
    r.classList.remove('is-selected');
  });

  document.querySelectorAll('.er-sidebar-table-item').forEach(item => {
    const isThis = item.id === `sidebar-table-${tableName.toUpperCase()}`;
    item.classList.toggle('is-selected', isThis);
    if (isThis) {
      item.classList.add('open');
      scrollSidebarItemIntoView(item);
    }
  });

  document.querySelectorAll('.er-col-edit-row').forEach(row => {
    row.classList.remove('is-selected');
  });
}

function selectErCol(tableName, colName) {
  erSelectedTable = tableName;
  erSelectedCol = colName;

  document.querySelectorAll('.er-table-card').forEach(c => {
    c.classList.toggle('is-selected', c.id === `er-card-${tableName.toUpperCase()}`);
  });
  document.querySelectorAll('.er-column-row').forEach(r => {
    r.classList.toggle('is-selected', r.id === `er-col-${tableName.toUpperCase()}-${colName.toUpperCase()}`);
  });

  document.querySelectorAll('.er-sidebar-table-item').forEach(item => {
    const isThis = item.id === `sidebar-table-${tableName.toUpperCase()}`;
    item.classList.toggle('is-selected', isThis);
    if (isThis) {
      item.classList.add('open');
      scrollSidebarItemIntoView(item);
    }
  });

  document.querySelectorAll('.er-col-edit-wrapper').forEach(w => {
    const isThis = w.id === `sidebar-col-${tableName.toUpperCase()}-${colName.toUpperCase()}`;
    const row = w.querySelector('.er-col-edit-row');
    if (row) {
      row.classList.toggle('is-selected', isThis);
      if (isThis) {
        scrollSidebarItemIntoView(row);
      }
    }
  });
}

function focusCanvasTable(tableName) {
  selectErTable(tableName);
  const card = document.getElementById(`er-card-${tableName.toUpperCase()}`);
  if (card) {
    const targetX = -card.offsetLeft + 120;
    const targetY = -card.offsetTop + 100;
    setErTransform(erZoom, targetX, targetY);
  }
}

function filterErSidebarTables(query) {
  renderErSidebar(query);
}

// SQL DDL Code Generation
function generateSqlDDL() {
  if (!currentSchema || !currentSchema.tables || currentSchema.tables.length === 0) {
    return '-- No hay tablas en el diagrama actual.';
  }

  let sql = '-- ==========================================\n';
  sql += `-- Sentencias DDL para Creación de Tablas\n`;
  sql += `-- Generado automáticamente desde el Diagrama ER\n`;
  sql += '-- ==========================================\n\n';

  currentSchema.tables.forEach(t => {
    sql += `CREATE TABLE ${t.name} (\n`;
    const colDefs = [];

    t.columns.forEach(col => {
      const typeStr = formatColTypeString(col);
      let def = `  ${col.name} ${typeStr}`;
      if (col.unsigned) def += ' UNSIGNED';
      if (col.is_pk) def += ' PRIMARY KEY';
      if (col.auto_increment) def += ' AUTO_INCREMENT';
      if (col.not_null && !col.is_pk) def += ' NOT NULL';
      if (col.unique && !col.is_pk) def += ' UNIQUE';
      if (col.default_val !== undefined && col.default_val !== '') {
        def += ` DEFAULT ${col.default_val}`;
      }
      colDefs.push(def);
    });

    if (currentSchema.relations) {
      currentSchema.relations.forEach(rel => {
        if (rel.from_table.toUpperCase() === t.name.toUpperCase()) {
          const fkName = `fk_${rel.from_table.toLowerCase()}_${rel.from_col.toLowerCase()}_${rel.to_table.toLowerCase()}`;
          colDefs.push(`  CONSTRAINT ${fkName} FOREIGN KEY (${rel.from_col}) REFERENCES ${rel.to_table}(${rel.to_col})`);
        }
      });
    }

    sql += colDefs.join(',\n');
    sql += '\n);\n\n';
  });

  return sql;
}

async function openSqlCodeModal() {
  if (!currentSchema || !currentSchema.tables || currentSchema.tables.length === 0) {
    await fetchAndRenderERDiagram();
  }
  await showSidebarTab('code');
}

function closeSqlCodeModal() {
  const modal = document.getElementById('sqlCodeModal');
  if (modal) modal.classList.add('hidden');
}

async function copySqlDdlCode() {
  copySidebarSqlCode();
}

function drawERRelationships() {
  const svg = document.getElementById('erSvg');
  const surface = document.getElementById('erCanvasSurface');
  if (!svg || !surface || !currentSchema || !currentSchema.relations) return;

  const existingPaths = svg.querySelectorAll('g.er-relation-group, path.er-connector, g.er-connector-del-group');
  existingPaths.forEach(p => p.remove());

  const strokeColor = document.body.classList.contains('dark-theme') ? '#60a5fa' : '#8ca1bb';
  const arrowMarker = document.querySelector('#arrow path');
  if (arrowMarker) {
    arrowMarker.setAttribute('fill', strokeColor);
  }

  const surfaceRect = surface.getBoundingClientRect();

  currentSchema.relations.forEach(rel => {
    const fromColEl = document.getElementById(`er-col-${rel.from_table.toUpperCase()}-${rel.from_col.toUpperCase()}`);
    const toColEl = document.getElementById(`er-col-${rel.to_table.toUpperCase()}-${rel.to_col.toUpperCase()}`);
    const fromCardEl = document.getElementById(`er-card-${rel.from_table.toUpperCase()}`);
    const toCardEl = document.getElementById(`er-card-${rel.to_table.toUpperCase()}`);

    if (!fromCardEl || !toCardEl) return;

    const relGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    relGroup.setAttribute('class', 'er-relation-group');

    // Self-referencing link (e.g., TRABAJADOR.idsupv -> TRABAJADOR.idtrabajador)
    if (rel.from_table.toUpperCase() === rel.to_table.toUpperCase()) {
      const fromColRect = fromColEl ? fromColEl.getBoundingClientRect() : fromCardEl.getBoundingClientRect();
      const toColRect = toColEl ? toColEl.getBoundingClientRect() : fromCardEl.getBoundingClientRect();

      const startX = fromCardEl.offsetLeft + fromCardEl.offsetWidth;
      const startY = (fromColRect.top + fromColRect.bottom) / 2 - surfaceRect.top;
      const endX = toCardEl.offsetLeft + toCardEl.offsetWidth;
      const endY = (toColRect.top + toColRect.bottom) / 2 - surfaceRect.top;

      const normStartY = startY / erZoom;
      const normEndY = endY / erZoom;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'er-connector');
      const loopWidth = 40;
      const d = `M ${startX} ${normStartY} C ${startX + loopWidth} ${normStartY}, ${endX + loopWidth} ${normEndY}, ${endX + 3} ${normEndY}`;
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', strokeColor);
      path.setAttribute('stroke-width', '1.8');
      path.setAttribute('marker-end', 'url(#arrow)');
      path.style.cursor = 'pointer';
      path.addEventListener('click', (ev) => {
        ev.stopPropagation();
        removeRelation(rel.from_table, rel.from_col, rel.to_table, rel.to_col);
      });
      relGroup.appendChild(path);

      // Midpoint delete badge on curve
      const midX = startX + loopWidth * 0.75;
      const midY = (normStartY + normEndY) / 2;
      const delGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      delGroup.setAttribute('class', 'er-connector-del-group');
      delGroup.innerHTML = `
        <title>Eliminar relación ${rel.from_table}.${rel.from_col} -> ${rel.to_table}.${rel.to_col}</title>
        <circle cx="${midX}" cy="${midY}" r="9" class="er-connector-del-circle" />
        <text x="${midX}" y="${midY + 3.5}" text-anchor="middle" class="er-connector-del-text">×</text>
      `;
      delGroup.addEventListener('click', (ev) => {
        ev.stopPropagation();
        removeRelation(rel.from_table, rel.from_col, rel.to_table, rel.to_col);
      });
      relGroup.appendChild(delGroup);
      svg.appendChild(relGroup);
      return;
    }

    // Inter-table connections
    const fromColRect = fromColEl ? fromColEl.getBoundingClientRect() : fromCardEl.getBoundingClientRect();
    const toColRect = toColEl ? toColEl.getBoundingClientRect() : toCardEl.getBoundingClientRect();

    const startY = ((fromColRect.top + fromColRect.bottom) / 2 - surfaceRect.top) / erZoom;
    const endY = ((toColRect.top + toColRect.bottom) / 2 - surfaceRect.top) / erZoom;

    let startX, endX;
    if (fromCardEl.offsetLeft < toCardEl.offsetLeft) {
      startX = fromCardEl.offsetLeft + fromCardEl.offsetWidth;
      endX = toCardEl.offsetLeft;
    } else {
      startX = fromCardEl.offsetLeft;
      endX = toCardEl.offsetLeft + toCardEl.offsetWidth;
    }

    const dx = Math.max(Math.abs(endX - startX) * 0.55, 35);
    const cp1x = (startX < endX) ? startX + dx : startX - dx;
    const cp2x = (startX < endX) ? endX - dx : endX + dx;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'er-connector');
    const d = `M ${startX} ${startY} C ${cp1x} ${startY}, ${cp2x} ${endY}, ${endX} ${endY}`;
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', strokeColor);
    path.setAttribute('stroke-width', '1.8');
    path.setAttribute('marker-end', 'url(#arrow)');
    path.style.cursor = 'pointer';
    path.addEventListener('click', (ev) => {
      ev.stopPropagation();
      removeRelation(rel.from_table, rel.from_col, rel.to_table, rel.to_col);
    });
    relGroup.appendChild(path);

    // Midpoint delete badge on connection curve
    const midX = (startX + endX) / 2;
    const midY = (startY + endY) / 2;
    const delGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    delGroup.setAttribute('class', 'er-connector-del-group');
    delGroup.innerHTML = `
      <title>Eliminar relación ${rel.from_table}.${rel.from_col} -> ${rel.to_table}.${rel.to_col}</title>
      <circle cx="${midX}" cy="${midY}" r="9" class="er-connector-del-circle" />
      <text x="${midX}" y="${midY + 3.5}" text-anchor="middle" class="er-connector-del-text">×</text>
    `;
    delGroup.addEventListener('click', (ev) => {
      ev.stopPropagation();
      removeRelation(rel.from_table, rel.from_col, rel.to_table, rel.to_col);
    });
    relGroup.appendChild(delGroup);
    svg.appendChild(relGroup);
  });
}

// CRUD Management View
async function loadCrudTable(tname) {
  currentCrudTable = getCanonicalTableName(tname);
  document.querySelectorAll('#crudQuickTables .quick-table-btn').forEach(btn => {
    btn.classList.toggle('active', btn.innerText.trim().toLowerCase() === currentCrudTable.toLowerCase());
  });
  document.getElementById('crudTableTitleDisplay').innerText = `Gestión CRUD: ${currentCrudTable}`;

  const res = await callPython('execute_query', { sql: `SELECT * FROM ${currentCrudTable};` });
  if (res && res.success) {
    currentColumns = res.columns || [];
    currentRows = res.rows || [];
    renderDataTable(currentColumns, currentRows, document.getElementById('crudTableHead'), document.getElementById('crudTableBody'), true);
  } else {
    const err = (res && res.error) ? res.error : "Error desconocido al cargar registros";
    const tbody = document.getElementById('crudTableBody');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #ef4444; padding: 24px; font-weight: 600;">⚠️ ${escapeHtml(err)}</td></tr>`;
    }
  }
}

// CRUD Modal Logic (Create & Edit)
let crudModalMode = 'create';
let crudTargetTable = 'TRABAJADOR';
let crudOriginalRow = null;

async function openCrudModal(mode, table, rowIdx = null) {
  crudModalMode = mode;
  crudTargetTable = table;
  document.getElementById('crudModalTitle').innerText = (mode === 'create') ? `Nuevo Registro (${table})` : `Editar Registro (${table})`;
  document.getElementById('crudModalSubtitle').innerText = `Complete los campos para guardar en la tabla ${table}`;

  let cols = currentColumns;
  if (!cols || cols.length === 0 || currentTable !== table) {
    const q = await callPython('execute_query', { sql: `SELECT * FROM ${table} LIMIT 1;` });
    if (q && q.columns) cols = q.columns;
  }

  const formBody = document.getElementById('crudModalFormBody');
  formBody.innerHTML = '';

  let rowData = null;
  if (mode === 'edit' && rowIdx !== null) {
    rowData = currentRows[rowIdx];
    crudOriginalRow = rowData;
  }

  cols.forEach((col, idx) => {
    const val = (rowData && rowData[idx] !== null && rowData[idx] !== undefined) ? rowData[idx] : '';
    const group = document.createElement('div');
    group.className = 'form-group';
    group.innerHTML = `
      <label class="form-label">${col.toUpperCase()}</label>
      <input type="text" id="crudInput_${col}" class="form-input" value="${escapeHtml(val)}" placeholder="Valor para ${col}...">
    `;
    formBody.appendChild(group);
  });

  document.getElementById('crudModal').classList.remove('hidden');
}

function closeCrudModal() {
  document.getElementById('crudModal').classList.add('hidden');
}

async function saveCrudRecord() {
  const inputs = document.querySelectorAll('#crudModalFormBody input');
  const data = {};
  inputs.forEach(inp => {
    const col = inp.id.replace('crudInput_', '');
    let val = inp.value.trim();
    if (val === '' || val.toUpperCase() === 'NULL') {
      val = null;
    }
    data[col] = val;
  });

  if (crudModalMode === 'create') {
    const res = await callPython('crud_insert', { table: crudTargetTable, data });
    if (res && res.success) {
      closeCrudModal();
      loadTableData(currentTable);
      loadCrudTable(currentCrudTable);
      fetchAndRenderERDiagram();
    } else {
      alert("Error al insertar: " + (res ? res.error : "Desconocido"));
    }
  } else {
    const pkDict = {};
    const firstCol = currentColumns[0];
    pkDict[firstCol] = crudOriginalRow[0];

    const res = await callPython('crud_update', { table: crudTargetTable, pk: pkDict, data });
    if (res && res.success) {
      closeCrudModal();
      loadTableData(currentTable);
      loadCrudTable(currentCrudTable);
      fetchAndRenderERDiagram();
    } else {
      alert("Error al actualizar: " + (res ? res.error : "Desconocido"));
    }
  }
}

async function handleEditRow(table, rowIdx) {
  openCrudModal('edit', table, rowIdx);
}

async function handleDeleteRow(table, rowIdx) {
  const row = currentRows[rowIdx];
  const firstCol = currentColumns[0];
  const pkVal = row[0];

  if (!confirm(`¿Está seguro de eliminar el registro con ${firstCol} = ${pkVal}?`)) {
    return;
  }

  const pkDict = {};
  pkDict[firstCol] = pkVal;
  const res = await callPython('crud_delete', { table, pk: pkDict });
  if (res && res.success) {
    loadTableData(currentTable);
    loadCrudTable(currentCrudTable);
    fetchAndRenderERDiagram();
  } else {
    alert("Error al eliminar: " + (res ? res.error : "Desconocido"));
  }
}

// Window load init
window.addEventListener('DOMContentLoaded', () => {
  initSqlEditor();
  initErPanAndZoom();
  initErConnectionDrag();
  initSidebarResizer();
  updateSidebarExpandIndicator();

  const sqlCodeArea = document.getElementById('sidebarSqlCodeArea');
  if (sqlCodeArea) {
    sqlCodeArea.addEventListener('scroll', () => {
      const lineNumbers = document.getElementById('sidebarSqlLineNumbers');
      if (lineNumbers) lineNumbers.scrollTop = sqlCodeArea.scrollTop;
    });
  }

  if (window.__AUTO_CONNECT__) {
    submitAuthentication();
  }
});
