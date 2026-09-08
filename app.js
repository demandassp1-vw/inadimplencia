/* ============================================================
   Car Bank Cobrança v2 — app.js
   - Login por perfil (GCM / Coordenador / Regional)
   - Dados via Google Apps Script (JSONP — sem CORS)
   - Grava Contatado na coluna AE da planilha
   ============================================================ */

// ▶ URL do Google Apps Script
const API_URL = 'https://script.google.com/macros/s/AKfycby_dmRSxq1zuKVwQ6viIWTPZ4rp5oaRlRvFOCgetJb_4mPU7mpmoqarrgLUI0KnV2P1lA/exec';

// ── Estado ───────────────────────────────────────────────────
let session   = null;  // { usuario, perfil, filtroValor, filtroCol }
let allRows   = [];
let sortCol   = null;
let sortDir   = 1;

// ── localStorage ─────────────────────────────────────────────
const LS_SESSION  = 'carbank_v2_session';
const LS_CONTACTS = 'carbank_v2_contacted';

function loadSession()   { try { return JSON.parse(localStorage.getItem(LS_SESSION)); }  catch { return null; } }
function saveSession(s)  { localStorage.setItem(LS_SESSION, JSON.stringify(s)); }
function clearSession()  { localStorage.removeItem(LS_SESSION); }

function loadContacted() { try { return new Set(JSON.parse(localStorage.getItem(LS_CONTACTS)) || []); } catch { return new Set(); } }
function saveContacted() { localStorage.setItem(LS_CONTACTS, JSON.stringify([...contactedSet])); }
const contactedSet = loadContacted();

// ══════════════════════════════════════════════════════════════
//  JSONP — substitui fetch para evitar CORS com Apps Script
// ══════════════════════════════════════════════════════════════

function fetchJSONP(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const cbName = '_cb_' + Math.random().toString(36).slice(2);
    const script = document.createElement('script');

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timeout: o servidor demorou demais para responder.'));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[cbName] = (data) => {
      cleanup();
      resolve(data);
    };

    script.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cbName;
    script.onerror = () => {
      cleanup();
      reject(new Error('Não foi possível conectar. Verifique sua conexão.'));
    };

    document.head.appendChild(script);
  });
}

// ══════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  // Tenta restaurar sessão salva
  const saved = loadSession();
  if (saved) {
    session = saved;
    showApp();
    fetchData();
  } else {
    showLogin();
  }

  // Eventos de login
  document.getElementById('login-btn').addEventListener('click', doLogin);
  document.getElementById('login-pass').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
  document.getElementById('login-user').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('login-pass').focus();
  });

  // Toggle senha
  document.getElementById('pw-toggle').addEventListener('click', () => {
    const inp  = document.getElementById('login-pass');
    const icon = document.getElementById('eye-icon');
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    icon.innerHTML = show
      ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>`
      : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
  });

  // Eventos do app
  document.getElementById('refresh-btn')?.addEventListener('click', fetchData);
  document.getElementById('logout-btn')?.addEventListener('click', logout);
  document.getElementById('export-btn')?.addEventListener('click', exportCSV);
  document.getElementById('clear-contacted-btn')?.addEventListener('click', () => {
    if (confirm(`Limpar ${contactedSet.size} marcação(ões) de contato?`)) clearAllContacted();
  });
  document.getElementById('nav-toggle')?.addEventListener('click', () => {
    document.getElementById('nav-drawer').classList.toggle('open');
  });
});

// ══════════════════════════════════════════════════════════════
//  TELAS
// ══════════════════════════════════════════════════════════════

function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app-screen').classList.add('hidden');
  document.getElementById('login-user').focus();
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');

  const perfilLabel = {
    gcm:         `GCM — ${session.filtroValor}`,
    coordenador: `Coordenador — ${session.filtroValor}`,
    regional:    `Regional — ${session.filtroValor}`,
  };
  document.getElementById('header-perfil').textContent =
    perfilLabel[session.perfil] || session.usuario;
}

function logout() {
  clearSession();
  session = null;
  allRows = [];
  showLogin();
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
  document.getElementById('login-error').classList.add('hidden');
}

function closeDrawer() {
  document.getElementById('nav-drawer').classList.remove('open');
}

// ══════════════════════════════════════════════════════════════
//  LOGIN  (agora via JSONP)
// ══════════════════════════════════════════════════════════════

async function doLogin() {
  const usuario = document.getElementById('login-user').value.trim();
  const senha   = document.getElementById('login-pass').value.trim();
  const errEl   = document.getElementById('login-error');
  const btn     = document.getElementById('login-btn');
  const spinner = document.getElementById('login-spinner');
  const btnText = document.getElementById('login-btn-text');

  errEl.classList.add('hidden');

  if (!usuario || !senha) {
    showLoginError('Preencha usuário e senha.');
    return;
  }

  btn.disabled = true;
  btnText.textContent = 'Entrando…';
  spinner.classList.remove('hidden');

  try {
    const url  = `${API_URL}?action=login&usuario=${encodeURIComponent(usuario)}&senha=${encodeURIComponent(senha)}`;
    const data = await fetchJSONP(url);

    if (!data.ok) {
      showLoginError(data.error || 'Erro ao fazer login.');
      return;
    }

    session = { usuario: data.usuario, perfil: data.perfil, filtroValor: data.filtroValor, filtroCol: data.filtroCol };
    saveSession(session);
    showApp();
    fetchData();

  } catch (err) {
    showLoginError(err.message || 'Não foi possível conectar. Verifique sua conexão.');
  } finally {
    btn.disabled = false;
    btnText.textContent = 'Entrar';
    spinner.classList.add('hidden');
  }
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

// ══════════════════════════════════════════════════════════════
//  DADOS  (agora via JSONP)
// ══════════════════════════════════════════════════════════════

async function fetchData() {
  setLoadingState(true);
  showStatus('');

  try {
    const url  = `${API_URL}?action=getData&perfil=${session.perfil}&filtroValor=${encodeURIComponent(session.filtroValor)}&filtroCol=${session.filtroCol}`;
    const data = await fetchJSONP(url);

    if (!data.ok) throw new Error(data.error || 'Erro ao buscar dados.');

    allRows = data.rows;
    renderStats();
    renderTable(allRows);
    populateFilters();
    updateLastSync();
    updateClearBtn();
    showStatus('success', `✅ ${allRows.length} contratos carregados.`);

  } catch (err) {
    console.error(err);
    showStatus('error', '⚠️ Erro ao carregar dados: ' + err.message);
  } finally {
    setLoadingState(false);
  }
}

// ══════════════════════════════════════════════════════════════
//  MARCAR CONTATADO  (agora via JSONP)
// ══════════════════════════════════════════════════════════════

async function markContacted(cdContrato, rowNum) {
  // Marca visualmente imediato (optimistic UI)
  contactedSet.add(cdContrato);
  saveContacted();
  updateRowUI(cdContrato, true);
  updateClearBtn();

  // Grava na planilha via JSONP
  try {
    const url  = `${API_URL}?action=markContacted&row=${rowNum}&contrato=${encodeURIComponent(cdContrato)}`;
    const data = await fetchJSONP(url);
    if (!data.ok) console.warn('[CarBank] Falha ao gravar na planilha:', data.error);
  } catch (err) {
    console.warn('[CarBank] Erro de rede ao gravar contato:', err);
  }
}

function updateRowUI(cdContrato, contacted) {
  const tr = document.querySelector(`tr[data-contrato="${cdContrato}"]`);
  if (!tr) return;
  if (contacted) {
    tr.classList.add('row-contacted');
    tr.querySelector('.contacted-badge')?.classList.remove('hidden');
  } else {
    tr.classList.remove('row-contacted');
    tr.querySelector('.contacted-badge')?.classList.add('hidden');
  }
}

function clearAllContacted() {
  contactedSet.clear();
  saveContacted();
  document.querySelectorAll('tr.row-contacted').forEach(tr => {
    tr.classList.remove('row-contacted');
    tr.querySelector('.contacted-badge')?.classList.add('hidden');
  });
  updateClearBtn();
}

function updateClearBtn() {
  const btn = document.getElementById('clear-contacted-btn');
  if (!btn) return;
  if (contactedSet.size > 0) {
    btn.style.display = 'inline-flex';
    btn.textContent   = `🗑 Limpar contatos (${contactedSet.size})`;
  } else {
    btn.style.display = 'none';
  }
}

// ══════════════════════════════════════════════════════════════
//  STATS
// ══════════════════════════════════════════════════════════════

function renderStats() {
  const grid   = document.getElementById('stats-grid');
  const dateEl = document.getElementById('stats-date');

  if (!allRows.length) {
    grid.innerHTML = `<div class="stat-card empty-stat"><div class="empty-icon">📊</div><span>Sem dados.</span></div>`;
    return;
  }

  const total     = allRows.length;
  const mediaDias = Math.round(allRows.reduce((a, r) => a + r.diasAtraso, 0) / total);
  const maxDias   = Math.max(...allRows.map(r => r.diasAtraso));
  const por60     = allRows.filter(r => r.diasAtraso <= 60).length;
  const por60_120 = allRows.filter(r => r.diasAtraso > 60 && r.diasAtraso <= 120).length;
  const por120p   = allRows.filter(r => r.diasAtraso > 120).length;
  const p60       = pct(por60,     total);
  const p120      = pct(por60_120, total);
  const p120p     = pct(por120p,   total);
  const contatados = allRows.filter(r => contactedSet.has(String(r.cdContrato)) || r.contatado).length;

  if (dateEl) dateEl.textContent = `${total} contrato${total !== 1 ? 's' : ''} carregado${total !== 1 ? 's' : ''}`;

  grid.innerHTML = `
    <div class="stat-card accent">
      <div class="stat-label">Total de Contratos</div>
      <div class="stat-value">${total}</div>
      <div class="stat-sub">carteira ativa de inadimplência</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Média de Dias em Atraso</div>
      <div class="stat-value">${mediaDias}<span style="font-size:1rem;font-weight:500">d</span></div>
      <div class="stat-sub">máximo: ${maxDias} dias</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Contatados</div>
      <div class="stat-value">${pct(contatados, total)}<span style="font-size:1rem;font-weight:500">%</span></div>
      <div class="stat-sub">${contatados} de ${total} contratos</div>
    </div>
    <div class="stat-card" style="grid-column: span 2">
      <div class="stat-label">Distribuição por Faixa de Atraso</div>
      <div class="risk-bar-wrap">
        <div class="risk-bar-track">
          <div class="risk-seg low"  style="width:${p60}%"></div>
          <div class="risk-seg mid"  style="width:${p120}%"></div>
          <div class="risk-seg high" style="width:${p120p}%"></div>
        </div>
        <div class="risk-legend">
          <span class="risk-item"><span class="risk-dot" style="background:var(--green)"></span>Até 60d — ${por60} (${p60}%)</span>
          <span class="risk-item"><span class="risk-dot" style="background:#f59e0b"></span>61–120d — ${por60_120} (${p120}%)</span>
          <span class="risk-item"><span class="risk-dot" style="background:#ef4444"></span>+120d — ${por120p} (${p120p}%)</span>
        </div>
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════
//  FILTROS
// ══════════════════════════════════════════════════════════════

function populateFilters() {
  // Filtro de GCM só aparece para coordenador/regional
  const selGCM = document.getElementById('filter-gcm');
  if (session.perfil !== 'gcm') {
    const gcmSet = [...new Set(allRows.map(r => r.nomeGCM).filter(Boolean))].sort();
    selGCM.innerHTML =
      '<option value="">Todos os GCMs</option>' +
      gcmSet.map(g => `<option value="${g}">${g}</option>`).join('');
    selGCM.style.display = '';
    selGCM.addEventListener('change', applyFilters);
  } else {
    selGCM.style.display = 'none';
  }

  document.getElementById('search-input')?.addEventListener('input', applyFilters);
  document.getElementById('table-controls').style.display = 'flex';
}

function applyFilters() {
  const search = (document.getElementById('search-input')?.value || '').toLowerCase().trim();
  const gcm    = document.getElementById('filter-gcm')?.value || '';

  let filtered = allRows.filter(r => {
    if (gcm && r.nomeGCM !== gcm) return false;
    if (search) {
      const hay = [r.nome, r.nomeDN, r.nomeGCM, r.cdContrato, r.modelo].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  if (sortCol) filtered = sortRows(filtered, sortCol);
  renderTable(filtered);
}

// ══════════════════════════════════════════════════════════════
//  TABELA
// ══════════════════════════════════════════════════════════════

const COLUMNS = [
  { key: 'celular',    label: 'WhatsApp'              },
  { key: 'diasAtraso', label: 'Atraso'                },
  { key: 'nomeDN',     label: 'Loja (DN)'             },
  { key: 'nome',       label: 'Cliente'               },
  { key: 'cdContrato', label: 'Contrato',  mono: true  },
  { key: 'modelo',     label: 'Modelo'                },
  { key: 'anoModelo',  label: 'Ano',       mono: true  },
  { key: 'contato',    label: 'Contato Efetuado'      },
  { key: 'nomeGCM',    label: 'GCM'                   },
];

function buildWaMessage(r) {
  const nomeCapit = toTitleCase(String(r.nome || ''));
  const veiculo   = [r.modelo, r.anoModelo].filter(Boolean).join(' ');

  const temEscritorio = r.nomeEsc &&
    r.nomeEsc.trim() !== '' &&
    r.nomeEsc.trim().toUpperCase() !== r.nome.trim().toUpperCase();

  let blocoContato;

  if (temEscritorio) {
    const escritorioText = r.nomeEsc && r.foneEsc
      ? `*${r.nomeEsc}* — *${r.foneEsc}*`
      : r.nomeEsc ? `*${r.nomeEsc}*` : `*${r.foneEsc}*`;

    blocoContato = [
      `Identificamos uma pendência no pagamento do seu financiamento${veiculo ? ` — *${veiculo}*` : ''}.`,
      ``,
      `Entre em contato com o escritório de cobrança responsável:`,
      escritorioText,
    ].join('\n');
  } else {
    blocoContato = [
      `Identificamos que há uma parcela em aberto referente ao seu financiamento${veiculo ? ` — *${veiculo}*` : ''}.`,
      ``,
      `Está com dificuldade na emissão do boleto ou gostaria de auxílio para regularizar? Estamos à disposição para te ajudar! 😊`,
    ].join('\n');
  }

  return [
    `Olá, *${nomeCapit}*!`,
    ``,
    blocoContato,
    ``,
    `_Caso o pagamento já tenha sido realizado, por favor desconsidere esta mensagem._`,
  ].join('\n');
}

function renderTable(rows) {
  const wrap    = document.getElementById('table-wrap');
  const countEl = document.getElementById('table-count');

  if (!rows.length) {
    if (countEl) countEl.textContent = allRows.length ? 'Nenhum resultado.' : 'Aguardando dados...';
    wrap.innerHTML = `<div class="empty-table"><div class="empty-icon">📋</div><p>${allRows.length ? 'Ajuste os filtros.' : 'Carregando...'}</p></div>`;
    return;
  }

  if (countEl) countEl.textContent =
    `${rows.length} contrato${rows.length !== 1 ? 's' : ''}${allRows.length !== rows.length ? ` de ${allRows.length}` : ''}`;

  const isGCM = session?.perfil === 'gcm';

  const thead = COLUMNS
    .filter(c => !(c.key === 'nomeGCM' && isGCM)) // oculta col GCM para o próprio GCM
    .map(c => {
      if (c.key === 'contato' || c.key === 'celular') return `<th>${c.label}</th>`;
      const sc = sortCol === c.key;
      return `<th class="${sc ? 'sorted' : ''}" data-key="${c.key}">${c.label}${sc ? (sortDir === 1 ? ' ↑' : ' ↓') : ''}</th>`;
    }).join('');

  const tbody = rows.map(r => {
    const isContacted = contactedSet.has(r.cdContrato) || r.contatado;
    const rowClass    = isContacted ? 'row-contacted' : '';

    const tds = COLUMNS
      .filter(c => !(c.key === 'nomeGCM' && isGCM))
      .map(c => {

        // ── WhatsApp ─────────────────────────────────────────
        if (c.key === 'celular') {
          const num    = String(r.celular || '').replace(/\D/g, '');
          const waLink = num
            ? `https://wa.me/55${num}?text=${encodeURIComponent(buildWaMessage(r))}`
            : null;
          return `<td>
            <div class="wa-cell">
              ${waLink
                ? `<a href="${waLink}" target="_blank" rel="noopener" class="wa-btn"
                      title="WhatsApp ${r.celular}"
                      onclick="markContacted('${r.cdContrato}', ${r._row})">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                      <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.118 1.528 5.849L.057 23.5l5.825-1.528A11.944 11.944 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.885 0-3.651-.49-5.178-1.347l-.371-.22-3.454.906.923-3.371-.242-.388A9.96 9.96 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
                    </svg>
                  </a>`
                : '<span class="wa-no">—</span>'}
            </div>
          </td>`;
        }

        // ── Contato Efetuado ──────────────────────────────────
        if (c.key === 'contato') {
          return `<td class="td-contato">
            <span class="contacted-badge${isContacted ? '' : ' hidden'}">✅ Contatado</span>
          </td>`;
        }

        // ── Nome (apenas primeiro nome visível) ──────────────
        if (c.key === 'nome') {
          const primeiroNome = r.nome ? toTitleCase(r.nome).split(' ')[0] : '—';
          return `<td><strong title="${toTitleCase(r.nome || '')}">${primeiroNome}</strong></td>`;
        }

        // ── Dias atraso ───────────────────────────────────────
        if (c.key === 'diasAtraso') {
          const cls = r.diasAtraso > 120 ? 'high' : r.diasAtraso > 60 ? 'mid' : 'low';
          return `<td><span class="dias-badge ${cls}">${r.diasAtraso}d</span></td>`;
        }

        // ── Loja (DN) abreviada ────────────────────────────────
        if (c.key === 'nomeDN') {
          const full = r.nomeDN || '';
          return `<td title="${full.replace(/"/g, '&quot;')}">${abbreviate(full)}</td>`;
        }

        // ── Modelo abreviado ─────────────────────────────────────
        if (c.key === 'modelo') {
          const full = r.modelo || '';
          return `<td title="${full.replace(/"/g, '&quot;')}">${abbreviate(full)}</td>`;
        }

        // ── Demais ────────────────────────────────────────────
        let val = r[c.key] ?? '';
        if (val === '' || val === null) val = '—';
        return `<td class="${c.mono ? 'mono' : ''}">${val}</td>`;
      }).join('');

    return `<tr data-contrato="${r.cdContrato}" class="${rowClass}">${tds}</tr>`;
  }).join('');

  wrap.innerHTML = `<table class="data-table"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;

  wrap.querySelectorAll('th[data-key]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (sortCol === key) sortDir *= -1; else { sortCol = key; sortDir = 1; }
      applyFilters();
    });
  });
}

function sortRows(rows, key) {
  return [...rows].sort((a, b) => {
    const av = a[key] ?? '', bv = b[key] ?? '';
    if (typeof av === 'number') return (av - bv) * sortDir;
    return String(av).localeCompare(String(bv), 'pt-BR') * sortDir;
  });
}

// ── Export CSV ───────────────────────────────────────────────
function exportCSV() {
  const search = (document.getElementById('search-input')?.value || '').toLowerCase();
  const gcm    = document.getElementById('filter-gcm')?.value || '';

  const rows = allRows.filter(r => {
    if (gcm && r.nomeGCM !== gcm) return false;
    if (search) {
      const hay = [r.nome, r.nomeDN, r.nomeGCM, r.cdContrato, r.modelo].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  const headers = ['Contato','Cliente','Loja (DN)','GCM','Contrato','Dias Atraso','Modelo','Ano'];
  const csvRows = rows.map(r => [
    (contactedSet.has(r.cdContrato) || r.contatado) ? 'Sim' : 'Não',
    r.nome, r.nomeDN, r.nomeGCM, r.cdContrato, r.diasAtraso, r.modelo, r.anoModelo,
  ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';'));

  const csv  = '\uFEFF' + [headers.join(';'), ...csvRows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a    = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `cobranca_v2_${fmtDateFile()}.csv`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── UI helpers ───────────────────────────────────────────────
function setLoadingState(loading) {
  const btn     = document.getElementById('refresh-btn');
  const spinner = document.getElementById('load-spinner');
  if (btn)     btn.disabled = loading;
  if (spinner) spinner.classList.toggle('hidden', !loading);
}
function showStatus(type, msg) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  el.textContent = msg;
  el.className   = type ? `sync-status sync-status--${type}` : 'sync-status';
}
function updateLastSync() {
  const el  = document.getElementById('last-sync');
  const now = new Date();
  if (el) el.textContent = `Atualizado: ${now.toLocaleDateString('pt-BR')} às ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

// ── Helpers gerais ───────────────────────────────────────────
function pct(n, t) { return t ? Math.round((n / t) * 100) : 0; }
function fmtDateFile() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}
function abbreviate(str, maxChars = 9, dots = 3) {
  const s = String(str ?? '').trim();
  if (!s) return '—';
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars - dots) + '.'.repeat(dots);
}
function toTitleCase(str) {
  const minors = ['de','da','do','das','dos','e','a','o'];
  return str.toLowerCase().split(' ').map((w, i) =>
    (i === 0 || !minors.includes(w)) ? w.charAt(0).toUpperCase() + w.slice(1) : w
  ).join(' ');
}
