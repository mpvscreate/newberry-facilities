/* ============================================================
   Newberry House Facilities Manager — app.js  v3.0
   Vanilla JS · LocalStorage · No frameworks
   ============================================================ */
'use strict';

/* ── Sites ───────────────────────────────────────────────── */
const SITES = {
  lourensford: { id:'lourensford', name:'Newberry Lourensford', short:'Lourensford', prefix:'NL', color:'#1F3D1D' },
  spier:       { id:'spier',       name:'Newberry Spier',       short:'Spier',       prefix:'NS', color:'#4a7c2f' },
};

/* ── Supabase config ─────────────────────────────────────── */
const SUPABASE_URL = 'https://oikwudpqmbnssttatlhc.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pa3d1ZHBxbWJuc3N0dGF0bGhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxMTMzODEsImV4cCI6MjA5NTY4OTM4MX0.p6I9qlvre5TjF3qOVjAIBus3_PNrbvCF2cMXHe3uiXw';

const SB = {
  // Read headers — return full representation
  readHeaders: {
    'Content-Type':  'application/json',
    'apikey':        SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Accept':        'application/json',
  },
  // Write headers — minimal return (faster, smaller payload)
  writeHeaders: {
    'Content-Type':  'application/json',
    'apikey':        SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Prefer':        'return=minimal',
  },
  // Upsert headers — merge-duplicates is required for ON CONFLICT to update
  upsertHeaders: {
    'Content-Type':  'application/json',
    'apikey':        SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Prefer':        'return=minimal,resolution=merge-duplicates',
  },

  async req(method, path, body, headers) {
    try {
      const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
        method,
        headers: headers || SB.readHeaders,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const err = await res.text();
        console.error(`Supabase ${method} ${path} error ${res.status}:`, err);
        return null;
      }
      const text = await res.text();
      return text ? JSON.parse(text) : [];
    } catch (e) {
      console.warn('Supabase unreachable:', e.message);
      return null;
    }
  },

  get:    (path)       => SB.req('GET',    path, null,       SB.readHeaders),
  post:   (path, body) => SB.req('POST',   path, body,       SB.writeHeaders),
  patch:  (path, body) => SB.req('PATCH',  path, body,       SB.writeHeaders),
  delete: (path)       => SB.req('DELETE', path, null,       SB.writeHeaders),
  // Upsert: POST with on_conflict query param + merge-duplicates Prefer header
  upsert: (table, body) => SB.req('POST', table + '?on_conflict=id', body, SB.upsertHeaders),
};

/* ── Local cache (localStorage) ─────────────────────────── */
const DB = {
  keys(siteId) {
    return {
      projects:    'nhfm_projects_'    + siteId,
      contractors: 'nhfm_contractors_' + siteId,
      settings:    'nhfm_settings_'    + siteId,
      gardens:     'nhfm_gardens_'     + siteId,
      syncAt:      'nhfm_sync_'        + siteId,
    };
  },
  load(key)         { try { return JSON.parse(localStorage.getItem(key)) || []; }   catch { return []; } },
  loadObj(key, def) { try { return JSON.parse(localStorage.getItem(key)) || def; } catch { return def; } },
  save(key, data)   {
    try { localStorage.setItem(key, JSON.stringify(data)); return true; }
    catch (e) {
      if (e.name === 'QuotaExceededError') toast('Storage full — photos may not have been saved. Try removing old photos.', 'error');
      else toast('Save error: ' + e.message, 'error');
      return false;
    }
  },
  clearSite(siteId) { Object.values(DB.keys(siteId)).forEach(k => localStorage.removeItem(k)); },
};

/* ── Sync status UI ─────────────────────────────────────── */
function setSyncStatus(status) {
  // status: 'syncing' | 'synced' | 'offline' | 'error'
  const el = document.getElementById('sync-status');
  if (!el) return;
  const map = {
    syncing: { text: '↻ Syncing…',  cls: 'sync-syncing' },
    synced:  { text: '✓ Synced',    cls: 'sync-ok'      },
    offline: { text: '⚡ Offline',   cls: 'sync-offline' },
    error:   { text: '✗ Sync error', cls: 'sync-error'   },
  };
  const s = map[status] || map.offline;
  el.textContent = s.text;
  el.className   = 'sync-indicator ' + s.cls;
}

/* ── App State ───────────────────────────────────────────── */
const State = {
  projects:    [],
  contractors: [],
  gardens:     [],
  settings:    {},
  currentPage:   'dashboard',
  projectFilter: 'all',
  projectSearch: '',
  projectSort:   { field:'dateCreated', dir:'desc' },
  projectPage:   1,
  perPage:       12,
  combinedView:  false,
};

let currentSiteId = localStorage.getItem('nhfm_current_site') || 'lourensford';
let currentSite   = SITES[currentSiteId] || SITES.lourensford;
let editingProjectId = null;

/* ── Undo / Redo ────────────────────────────────────────── */
const UndoManager = {
  _undoStack: [],
  _redoStack: [],
  _maxHistory: 30,

  _snapshot() {
    return {
      projects:    JSON.stringify(State.projects),
      contractors: JSON.stringify(State.contractors),
      gardens:     JSON.stringify(State.gardens),
      settings:    JSON.stringify(State.settings),
      hw:          JSON.stringify(hwProjects),
      nb:          JSON.stringify(nbProjects),
    };
  },

  push(label) {
    this._undoStack.push({ snap: this._snapshot(), label: label || 'change', page: State.currentPage });
    if (this._undoStack.length > this._maxHistory) this._undoStack.shift();
    this._redoStack.length = 0;
    this._updateUI();
  },

  undo() {
    if (!this._undoStack.length) return;
    const entry = this._undoStack.pop();
    this._redoStack.push({ snap: this._snapshot(), label: entry.label, page: entry.page });
    this._restore(entry.snap);
    this._persist();
    this._rerender(entry.page);
    toast('Undo: ' + entry.label);
    this._updateUI();
  },

  redo() {
    if (!this._redoStack.length) return;
    const entry = this._redoStack.pop();
    this._undoStack.push({ snap: this._snapshot(), label: entry.label, page: entry.page });
    this._restore(entry.snap);
    this._persist();
    this._rerender(entry.page);
    toast('Redo: ' + entry.label);
    this._updateUI();
  },

  _restore(snap) {
    State.projects    = JSON.parse(snap.projects);
    State.contractors = JSON.parse(snap.contractors);
    State.gardens     = JSON.parse(snap.gardens);
    State.settings    = JSON.parse(snap.settings);
    hwProjects        = JSON.parse(snap.hw);
    nbProjects        = JSON.parse(snap.nb);
  },

  _persist() {
    const k = DB.keys(currentSiteId);
    DB.save(k.projects,    State.projects);
    DB.save(k.contractors, State.contractors);
    DB.save(k.gardens,     State.gardens);
    DB.save(k.settings,    State.settings);
    try { localStorage.setItem(hwKey(), JSON.stringify(hwProjects)); } catch {}
    try { localStorage.setItem(nbKey(), JSON.stringify(nbProjects)); } catch {}
  },

  _rerender(page) {
    const p = page || State.currentPage;
    if (p === 'dashboard')   renderDashboard();
    if (p === 'projects')    renderProjectList();
    if (p === 'contractors') renderContractors();
    if (p === 'gardens')     { renderGardens(); renderGardenCostPanel(); }
    if (p === 'holidaywork') renderHolidayWork();
    if (p === 'newbuild')    renderNewBuild();
    if (p === 'newproject' && editingProjectId) renderNewProjectForm(editingProjectId);
    updateNavBadges();
  },

  _updateUI() {
    const undoBtn = $('undo-btn');
    const redoBtn = $('redo-btn');
    if (undoBtn) {
      undoBtn.disabled = !this._undoStack.length;
      undoBtn.title = this._undoStack.length
        ? 'Undo: ' + this._undoStack[this._undoStack.length - 1].label + ' (Ctrl+Z)'
        : 'Nothing to undo';
    }
    if (redoBtn) {
      redoBtn.disabled = !this._redoStack.length;
      redoBtn.title = this._redoStack.length
        ? 'Redo: ' + this._redoStack[this._redoStack.length - 1].label + ' (Ctrl+Y)'
        : 'Nothing to redo';
    }
  },

  get canUndo() { return this._undoStack.length > 0; },
  get canRedo() { return this._redoStack.length > 0; },
};

/* ── Utilities ───────────────────────────────────────────── */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);

const fmt = {
  currency: v  => 'R\u00a0' + parseFloat(v||0).toLocaleString('en-ZA', { minimumFractionDigits:2, maximumFractionDigits:2 }),
  date:     v  => v ? new Date(v).toLocaleDateString('en-ZA', { day:'2-digit', month:'short', year:'numeric' }) : '—',
  dateTime: v  => v ? new Date(v).toLocaleString('en-ZA',    { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—',
};

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function $(id) { return document.getElementById(id); }

/* ── Toast ───────────────────────────────────────────────── */
function toast(msg, type) {
  const el = document.createElement('div');
  el.className = 'toast' + (type && type !== 'success' ? ' ' + type : '');
  el.textContent = msg;
  $('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

/* ── WhatsApp Helper ─────────────────────────────────────── */
function waPhone(raw) {
  if (!raw) return null;
  let n = raw.replace(/[\s\-\(\)]/g, '');
  if (n.startsWith('0')) n = '27' + n.slice(1);
  if (n.startsWith('+')) n = n.slice(1);
  if (!/^\d{10,15}$/.test(n)) return null;
  return n;
}

function waUrl(phone, message) {
  const n = waPhone(phone);
  if (!n) return null;
  return 'https://wa.me/' + n + (message ? '?text=' + encodeURIComponent(message) : '');
}

function openWhatsApp(phone, message) {
  const url = waUrl(phone, message);
  if (!url) { toast('No valid phone number. Add one under Contractor details.', 'warning'); return; }
  window.open(url, '_blank');
}

const WA_MSG = {
  quoteRequest(p) {
    const s = State.settings;
    return 'Hi' + (p.contactPerson ? ' ' + p.contactPerson.split(' ')[0] : '') + ',\n\nWe would like to request a quotation for the following project:\n\n*' + (p.projectName||p.title||'') + '*\nRef: ' + (p.projectNumber||'TBC') + '\nLocation: ' + (p.location||'TBC') + '\nQuote required by: ' + (p.quoteDueDate ? fmt.date(p.quoteDueDate) : 'ASAP') + (p.description ? '\n\nScope: ' + p.description : '') + '\n\nPlease include your lead time and warranty terms.\n\nKind regards,\n' + (s.facilityMgr||'Facilities Manager') + '\n' + currentSite.name;
  },
  statusUpdate(p) {
    const s = State.settings;
    return 'Hi' + (p.contactPerson ? ' ' + p.contactPerson.split(' ')[0] : '') + ',\n\nStatus update for *' + (p.projectName||p.title||'') + '* (' + (p.projectNumber||'TBC') + '):\n\nStatus: ' + (p.status||'') + (p.startDate ? '\nStart Date: ' + fmt.date(p.startDate) : '') + (p.completionDate ? '\nCompletion: ' + fmt.date(p.completionDate) : '') + '\n\nPlease confirm receipt.\n\n' + (s.facilityMgr||'Facilities Manager') + '\n' + currentSite.name;
  },
  appointmentConfirm(p) {
    const s = State.settings;
    return 'Hi' + (p.contactPerson ? ' ' + p.contactPerson.split(' ')[0] : '') + ',\n\nThis confirms your appointment for:\n\n*' + (p.projectName||p.title||'') + '*\nLocation: ' + (p.location||'TBC') + '\nStart Date: ' + (p.startDate ? fmt.date(p.startDate) : 'TBC') + '\nCompletion: ' + ((p.completionDate||p.endDate) ? fmt.date(p.completionDate||p.endDate) : 'TBC') + '\n\nPlease ensure all materials are on site before work commences.\n\n' + (s.facilityMgr||'Facilities Manager') + '\n' + currentSite.name;
  },
  quoteFollow(p) {
    const s = State.settings;
    return 'Hi' + (p.contactPerson ? ' ' + p.contactPerson.split(' ')[0] : '') + ',\n\nFollowing up on our quotation request for:\n\n*' + (p.projectName||p.title||'') + '* (' + (p.projectNumber||'TBC') + ')\n\nWe have not yet received your quote. Please submit as soon as possible.\nDeadline: ' + (p.quoteDueDate ? fmt.date(p.quoteDueDate) : 'ASAP') + '\n\n' + (s.facilityMgr||'Facilities Manager') + '\n' + currentSite.name;
  },
  holidayWork(p) {
    const s = State.settings;
    return 'Hi' + (p.contractor ? ' ' + p.contractor.split(' ')[0] : '') + ',\n\nDetails for your upcoming holiday work:\n\n*' + (p.title||'') + '*\nCategory: ' + (p.category||'') + '\nHoliday: ' + (p.holiday||'') + (p.startDate ? '\nStart: ' + fmt.date(p.startDate) : '') + (p.endDate ? '\nEnd:   ' + fmt.date(p.endDate) : '') + (p.location ? '\nLocation: ' + p.location : '') + (p.scopeSummary ? '\n\nScope: ' + p.scopeSummary : '') + '\n\nPlease confirm your availability.\n\n' + (s.facilityMgr||'Facilities Manager') + '\n' + currentSite.name;
  },
};

/* ── Card share (WhatsApp as image) ─────────────────────── */
function toggleCardMenu(btn, ev) {
  ev.stopPropagation();
  const menu = btn.nextElementSibling;
  const wasOpen = menu.classList.contains('open');
  document.querySelectorAll('.card-menu.open').forEach(m => m.classList.remove('open'));
  if (!wasOpen) menu.classList.add('open');
}

async function shareCardToWhatsApp(btn) {
  const card = btn.closest('.hw-card, .garden-card-full');
  if (!card) return;
  const menu = btn.closest('.card-menu');
  if (menu) menu.classList.remove('open');
  toast('Capturing card…');
  try {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    card.style.transform = 'none';
    const canvas = await window.html2canvas(card, {
      scale: 2, useCORS: true, backgroundColor: '#ffffff',
      logging: false, removeContainer: true,
    });
    canvas.toBlob(async blob => {
      if (!blob) { toast('Could not capture card', 'error'); return; }
      const file = new File([blob], 'project-card.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Project Card' });
          toast('Shared');
        } catch (e) {
          if (e.name !== 'AbortError') toast('Share cancelled', 'warning');
        }
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'project-card.png';
        a.click();
        URL.revokeObjectURL(a.href);
        toast('Image downloaded — attach it in WhatsApp');
      }
    }, 'image/png');
  } catch (e) {
    console.error('Share error:', e);
    toast('Could not capture card', 'error');
  }
}

function cardMenuHtml() {
  return `<div class="card-menu-wrap">
    <button type="button" class="card-menu-btn" onclick="toggleCardMenu(this,event)" title="More options">&#8942;</button>
    <div class="card-menu">
      <button type="button" class="card-menu-item" onclick="shareCardToWhatsApp(this)">
        <svg viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492l4.636-1.467A11.927 11.927 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75c-2.17 0-4.207-.69-5.87-1.875l-.42-.281-2.752.871.883-2.672-.306-.457A9.706 9.706 0 012.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75z"/></svg>
        Share to WhatsApp
      </button>
      <button type="button" class="card-menu-item" onclick="downloadCardImage(this)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Save as Image
      </button>
    </div>
  </div>`;
}

async function downloadCardImage(btn) {
  const card = btn.closest('.hw-card, .garden-card-full');
  if (!card) return;
  const menu = btn.closest('.card-menu');
  if (menu) menu.classList.remove('open');
  toast('Capturing card…');
  try {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    card.style.transform = 'none';
    const canvas = await window.html2canvas(card, {
      scale: 2, useCORS: true, backgroundColor: '#ffffff',
      logging: false, removeContainer: true,
    });
    canvas.toBlob(blob => {
      if (!blob) { toast('Could not capture card', 'error'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'project-card.png';
      a.click();
      URL.revokeObjectURL(a.href);
      toast('Image saved');
    }, 'image/png');
  } catch (e) {
    toast('Could not capture card', 'error');
  }
}

function waButtonGroup(phone, project, type) {
  const pid = (project.id || '').replace(/['"]/g, '');
  const ph  = (phone || '').replace(/['"\\]/g, '');
  const src = type === 'hw' ? 'hwProjects' : 'State.projects';
  const lookup = src + ".find(x=>x.id==='" + pid + "')||{}";
  // Use string concatenation — NOT template literals — so this is safe
  // to embed inside outer template literals without double-evaluation
  return '<div class="wa-btn-group">'
    + '<button class="btn btn-wa" onclick="event.stopPropagation();toggleWAMenu(\'wamenu_' + pid + '\')">WhatsApp</button>'
    + '<div class="wa-menu" id="wamenu_' + pid + '">'
    + '<div class="wa-menu-item" onclick="event.stopPropagation();openWhatsApp(\'' + ph + '\',WA_MSG.quoteRequest(' + lookup + '))">Quote Request</div>'
    + '<div class="wa-menu-item" onclick="event.stopPropagation();openWhatsApp(\'' + ph + '\',WA_MSG.statusUpdate(' + lookup + '))">Status Update</div>'
    + '<div class="wa-menu-item" onclick="event.stopPropagation();openWhatsApp(\'' + ph + '\',WA_MSG.appointmentConfirm(' + lookup + '))">Confirm Appointment</div>'
    + '<div class="wa-menu-item" onclick="event.stopPropagation();openWhatsApp(\'' + ph + '\',WA_MSG.quoteFollow(' + lookup + '))">Follow-up on Quote</div>'
    + '<div class="wa-menu-sep"></div>'
    + '<div class="wa-menu-item" onclick="event.stopPropagation();openWhatsApp(\'' + ph + '\',\'\')">Open Chat Only</div>'
    + '</div></div>';
}

// Simple single-action WA link (for inline use without dropdown)
function waSimpleBtn(phone, msg) {
  const ph = (phone || '').replace(/['"\\]/g, '');
  const n  = waPhone(phone);
  if (!n) return '';
  return '<button class="btn btn-wa btn-wa-sm" onclick="event.stopPropagation();openWhatsApp(\'' + ph + '\',\'' + (msg||'').replace(/'/g,"\\'").replace(/\n/g,'\\n') + '\')" title="WhatsApp">WA</button>';
}

function toggleWAMenu(menuId) {
  document.querySelectorAll('.wa-menu.open').forEach(function(m) { if (m.id !== menuId) m.classList.remove('open'); });
  const menu = $(menuId);
  if (menu) menu.classList.toggle('open');
}

document.addEventListener('click', function() {
  document.querySelectorAll('.wa-menu.open, .card-menu.open').forEach(function(m) { m.classList.remove('open'); });
});

/* ── Site management ─────────────────────────────────────── */
function loadSiteData() {
  const k = DB.keys(currentSiteId);
  // Load from local cache immediately (fast, works offline)
  State.projects    = DB.load(k.projects);
  State.contractors = DB.load(k.contractors);
  State.gardens     = DB.load(k.gardens);
  State.settings    = DB.loadObj(k.settings, {
    schoolName:   currentSite.name,
    facilityMgr:  'Design & Facilities',
    reportFooter: currentSite.name + ' — Facilities Department',
    emailTo:      '',
  });
  State.projectPage   = 1;
  State.projectFilter = 'all';
  State.projectSearch = '';

  // Migrate: strip any old base64 document data
  let migrated = false;
  State.projects.forEach(p => {
    if (!p.documents) return;
    p.documents.forEach(d => { if (d.data) { delete d.data; migrated = true; } });
  });
  if (migrated) DB.save(k.projects, State.projects);

  // Then sync from Supabase in the background (updates UI when done)
  syncFromSupabase();
}

/* ── Pull latest data from Supabase into local cache ─────── */
function showSyncSkeletons() {
  var sg = $('stat-grid');
  if (sg && !sg.querySelector('.skeleton')) {
    sg.querySelectorAll('.stat-card').forEach(function(c) { c.classList.add('skeleton'); });
  }
  var fc = $('dash-feed');
  if (fc && !fc.children.length) {
    fc.innerHTML = Array(3).fill('<div class="skeleton" style="height:72px;border-radius:var(--radius);margin-bottom:10px"></div>').join('');
  }
}
async function syncFromSupabase() {
  setSyncStatus('syncing');
  showSyncSkeletons();
  const k = DB.keys(currentSiteId);
  const snapshot = {
    projects:    localStorage.getItem(k.projects),
    contractors: localStorage.getItem(k.contractors),
    gardens:     localStorage.getItem(k.gardens),
    settings:    localStorage.getItem(k.settings),
    hw:          localStorage.getItem(hwKey()),
    nb:          localStorage.getItem(nbKey()),
  };
  try {
    const [projects, contractors, gardens, settingsRows, hwRows, nbRows] = await Promise.all([
      SB.get(`projects?site_id=eq.${currentSiteId}&select=*&order=date_created.desc`),
      SB.get(`contractors?site_id=eq.${currentSiteId}&select=*`),
      SB.get(`gardens?site_id=eq.${currentSiteId}&select=*`),
      SB.get(`settings?site_id=eq.${currentSiteId}&select=*`),
      SB.get(`hw_projects?site_id=eq.${currentSiteId}&select=*&order=date_created.desc`),
      SB.get(`new_builds?site_id=eq.${currentSiteId}&select=*&order=date_created.desc`),
    ]);

    if (projects === null) { setSyncStatus('offline'); return; }

    const mappedProjects = projects.map(row => ({ ...row.data, id: row.id, site_id: row.site_id }));
    State.projects = mappedProjects;
    DB.save(k.projects, mappedProjects);

    if (contractors) {
      const mapped = contractors.map(row => ({ ...row.data, id: row.id }));
      State.contractors = mapped;
      DB.save(k.contractors, mapped);
    }

    if (gardens) {
      const mapped = gardens.map(row => ({ ...row.data, id: row.id }));
      State.gardens = mapped;
      DB.save(k.gardens, mapped);
    }

    if (settingsRows && settingsRows.length > 0) {
      State.settings = settingsRows[0].data;
      DB.save(k.settings, State.settings);
    }

    if (hwRows && hwRows.length > 0) {
      const mappedHW = hwRows.map(row => ({ ...row.data, id: row.id, site_id: row.site_id }));
      localStorage.setItem(hwKey(), JSON.stringify(mappedHW));
      hwProjects = mappedHW;
    } else if (hwRows) {
      localStorage.setItem(hwKey(), JSON.stringify([]));
      hwProjects = [];
    } else {
      const localHW = loadHWProjects();
      if (localHW.length > 0) pushHWProjectsToSupabase();
    }

    if (nbRows && nbRows.length > 0) {
      const mappedNB = nbRows.map(row => ({ ...row.data, id: row.id, site_id: row.site_id }));
      localStorage.setItem(nbKey(), JSON.stringify(mappedNB));
      nbProjects = mappedNB;
    } else if (nbRows) {
      localStorage.setItem(nbKey(), JSON.stringify([]));
      nbProjects = [];
    } else {
      const localNB = loadNBProjects();
      if (localNB.length > 0) pushNBProjectsToSupabase();
    }

    const page = State.currentPage;
    if (page === 'dashboard')   renderDashboard();
    if (page === 'projects')    renderProjectList();
    if (page === 'contractors') renderContractors();
    if (page === 'gardens')     { renderGardens(); renderGardenCostPanel(); }
    if (page === 'holidaywork') renderHolidayWork();
    if (page === 'newbuild')    renderNewBuild();

    DB.save(k.syncAt, new Date().toISOString());
    setSyncStatus('synced');
  } catch (e) {
    console.warn('Sync failed, rolling back localStorage:', e);
    const rollbacks = [[k.projects, snapshot.projects], [k.contractors, snapshot.contractors], [k.gardens, snapshot.gardens], [k.settings, snapshot.settings], [hwKey(), snapshot.hw], [nbKey(), snapshot.nb]];
    for (const [lsKey, val] of rollbacks) {
      if (val !== null) localStorage.setItem(lsKey, val); else localStorage.removeItem(lsKey);
    }
    setSyncStatus('error');
  }
}

/* ── Combined view pulls fresh from Supabase directly ───── */
async function syncCombinedFromSupabase() {
  try {
    const rows = await SB.get('projects?select=*&order=date_created.desc');
    if (!rows) return null;
    return rows.map(row => ({
      ...row.data,
      id: row.id,
      _site: row.site_id,
      _siteName: SITES[row.site_id]?.short || row.site_id,
    }));
  } catch { return null; }
}

/* Re-read projects — local cache first, Supabase in background ─────────────
   Synchronous for all callers that need data immediately.
   Background Supabase pull happens via loadSiteData/syncFromSupabase. */
function refreshProjectsFromStorage() {
  State.projects = DB.load(DB.keys(currentSiteId).projects);
}

/* Save to localStorage immediately (synchronous), then push to Supabase async */
function saveProjects() {
  const ok = DB.save(DB.keys(currentSiteId).projects, State.projects);
  if (ok) { pushProjectsToSupabase(); triggerBackupOnSave(); }
  return ok;
}
function saveContractors() {
  const ok = DB.save(DB.keys(currentSiteId).contractors, State.contractors);
  if (ok) { pushContractorsToSupabase(); triggerBackupOnSave(); }
  return ok;
}
function saveGardens() {
  const ok = DB.save(DB.keys(currentSiteId).gardens, State.gardens);
  if (ok) { pushGardensToSupabase(); triggerBackupOnSave(); }
  return ok;
}

/* ── Push helpers (fire-and-forget, non-blocking) ─────────── */
async function pushProjectsToSupabase() {
  setSyncStatus('syncing');
  try {
    const rows = State.projects.map(p => ({
      id:             p.id,
      site_id:        currentSiteId,
      project_number: p.projectNumber || null,
      project_name:   p.projectName   || 'Untitled',
      status:         p.status        || 'Draft',
      category:       p.category      || null,
      priority:       p.priority      || null,
      date_created:   p.dateCreated   || null,
      date_updated:   p.dateUpdated   || null,
      data:           p,
    }));
    if (!rows.length) { setSyncStatus('synced'); return; }
    const res = await SB.upsert('projects', rows);
    if (res === null) {
      setSyncStatus('error');
      console.error('pushProjectsToSupabase: upsert returned null');
    } else {
      setSyncStatus('synced');
    }
  } catch (e) {
    setSyncStatus('error');
    console.error('pushProjectsToSupabase error:', e);
  }
}

async function pushContractorsToSupabase() {
  try {
    const rows = State.contractors.map(c => ({
      id:      c.id,
      site_id: currentSiteId,
      name:    c.name,
      data:    c,
    }));
    await SB.upsert('contractors', rows);
  } catch { /* silent */ }
}

async function pushGardensToSupabase() {
  try {
    const rows = State.gardens.map(g => ({
      id:          g.id,
      site_id:     currentSiteId,
      garden_name: g.gardenName || 'Garden',
      data:        g,
    }));
    await SB.upsert('gardens', rows);
  } catch { /* silent */ }
}

async function pushSettingsToSupabase() {
  try {
    await SB.upsert('settings', [{ site_id: currentSiteId, data: State.settings }]);
  } catch { /* silent */ }
}

async function pushHWProjectsToSupabase() {
  try {
    const projs = loadHWProjects();
    const localIds = new Set(projs.map(p => p.id));
    const rows = projs.map(p => ({
      id:           p.id,
      site_id:      currentSiteId,
      project_name: p.title || 'Untitled',
      status:       p.status || 'Planning',
      category:     p.category || null,
      priority:     p.priority || null,
      holiday:      p.holiday || null,
      date_created: p.dateCreated || null,
      date_updated: p.dateUpdated || null,
      data:         p,
    }));
    if (rows.length) await SB.upsert('hw_projects', rows);
    const remote = await SB.get('hw_projects?site_id=eq.' + currentSiteId + '&select=id');
    if (remote) {
      const stale = remote.filter(r => !localIds.has(r.id)).map(r => r.id);
      if (stale.length) await SB.delete('hw_projects?id=in.(' + stale.join(',') + ')');
    }
  } catch (e) { console.error('pushHWProjects error:', e); }
}

function switchSite(siteId) {
  if (!SITES[siteId]) return;
  // Exit combined view when switching to a specific site
  if (State.combinedView) exitCombinedView();
  currentSiteId = siteId;
  currentSite   = SITES[siteId];
  localStorage.setItem('nhfm_current_site', siteId);
  loadSiteData();
  updateSiteUI();
  navigate('dashboard');
  toast('Switched to ' + currentSite.name);
}

function updateSiteUI() {
  document.querySelectorAll('.site-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.site === currentSiteId);
  });
  const sn = $('sidebar-site-name');
  if (sn) sn.textContent = currentSite.short;
}

/* ── Site switcher CSS state helpers ─────────────────────── */
function toggleCombinedView() {
  if (State.combinedView) { exitCombinedView(); return; }
  State.combinedView = true;
  const btn = $('combined-toggle-btn'); if (btn) btn.classList.add('active');
  const col = $('col-site'); if (col) col.style.display = '';
  const npBtn = $('new-project-btn'); if (npBtn) npBtn.style.display = 'none';
  let banner = $('combined-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'combined-banner';
    banner.className = 'combined-banner';
    banner.innerHTML = '<strong>Combined View — Lourensford &amp; Spier</strong> &nbsp;|&nbsp; Read-only. Switch to a campus to add or edit.';
    $('content').prepend(banner);
  }
  navigate('projects');
}

function exitCombinedView() {
  State.combinedView = false;
  const btn = $('combined-toggle-btn'); if (btn) btn.classList.remove('active');
  const col = $('col-site'); if (col) col.style.display = 'none';
  const npBtn = $('new-project-btn'); if (npBtn) npBtn.style.display = '';
  const banner = $('combined-banner'); if (banner) banner.remove();
}

/* ── Navigation ──────────────────────────────────────────── */
function navigate(page, projectId) {
  State.currentPage = page;
  document.querySelectorAll('.page').forEach(p  => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => { n.classList.remove('active'); n.removeAttribute('aria-current'); });
  const pg  = $('page-' + page); if (pg)  pg.classList.add('active');
  const nav = document.querySelector('.nav-item[data-page="' + page + '"]'); if (nav) { nav.classList.add('active'); nav.setAttribute('aria-current', 'page'); }

  const titles = {
    dashboard:'Dashboard', projects:'All Projects', newproject:'New Project',
    contractors:'Contractor Database', gardens:'Garden Projects',
    holidaywork:'Holiday Work', newbuild:'New Build',
    reports:'Report Generator', settings:'Settings',
  };
  $('topbar-title').textContent = titles[page] || '';

  if (page === 'dashboard')    renderDashboard();
  if (page === 'projects')     renderProjectList();
  if (page === 'newproject')   renderNewProjectForm(projectId);
  if (page === 'contractors')  renderContractors();
  if (page === 'gardens')      { renderGardens(); renderGardenCostPanel(); }
  if (page === 'holidaywork')  renderHolidayWork();
  if (page === 'newbuild')     renderNewBuild();
  if (page === 'reports')      renderReportPage();
  if (page === 'settings')     renderSettings();

  $('sidebar').classList.remove('open');
}

/* ── Status helpers ──────────────────────────────────────── */
const STATUS_CLS = {
  'Draft':'draft','Planning':'planning','Awaiting Quotes':'awaiting-quotes',
  'Quotes Received':'quotes-received','Awaiting Approval':'awaiting-approval',
  'Approved':'approved','In Progress':'in-progress','Completed':'completed','Archived':'archived',
};
const statusBadge = s => `<span class="badge badge-${STATUS_CLS[s]||'draft'}">${esc(s)}</span>`;

/* ── Panel toggle — event delegation (works for dynamic panels) ── */
document.addEventListener('click', e => {
  const h = e.target.closest('.panel-header');
  if (h && !e.target.closest('button')) h.closest('.panel').classList.toggle('open');
});

/* ── Dashboard ───────────────────────────────────────────── */
// Tracks what's currently shown in the feed
State.dashFilter  = 'all';   // category filter
State.dashStatus  = 'all';   // status filter from stat card clicks

function setDashScope(scope) {
  State.dashScope = scope;
  document.querySelectorAll('.dash-scope-tab').forEach(t => t.classList.toggle('active', t.dataset.scope === scope));
  renderDashboard();
  renderDashFeed();
}

function renderDashboard() {
  if (!State.dashScope) State.dashScope = 'all';
  const scope = State.dashScope;
  var sg = $('stat-grid');
  if (sg) sg.querySelectorAll('.skeleton').forEach(function(c) { c.classList.remove('skeleton'); });
  var df = $('dash-feed');
  if (df) df.querySelectorAll('.skeleton').forEach(function(c) { c.remove(); });

  let regProjects = State.combinedView
    ? [...DB.load(DB.keys('lourensford').projects), ...DB.load(DB.keys('spier').projects)]
    : State.projects;

  let hwProjects = [];
  if (scope !== 'projects' && scope !== 'newbuild') {
    if (State.combinedView) {
      const hw1 = (function(){ const old = currentSiteId; currentSiteId='lourensford'; const d=loadHWProjects(); currentSiteId=old; return d; })();
      const hw2 = (function(){ const old = currentSiteId; currentSiteId='spier'; const d=loadHWProjects(); currentSiteId=old; return d; })();
      hwProjects = [...hw1, ...hw2];
    } else {
      hwProjects = loadHWProjects();
    }
  }

  let nbProjectsDash = [];
  if (scope !== 'projects' && scope !== 'holidaywork') {
    if (State.combinedView) {
      const nb1 = (function(){ const old = currentSiteId; currentSiteId='lourensford'; const d=loadNBProjects(); currentSiteId=old; return d; })();
      const nb2 = (function(){ const old = currentSiteId; currentSiteId='spier'; const d=loadNBProjects(); currentSiteId=old; return d; })();
      nbProjectsDash = [...nb1, ...nb2];
    } else {
      nbProjectsDash = loadNBProjects();
    }
  }

  const mappedHW = hwProjects.map(h => ({
    ...h, projectName: h.title || 'Untitled HW',
    approvedBudget: h.budget || 0, estimatedBudget: h.budget || 0,
    invoices: h.invoices || [], quotes: h.quotes || [],
  }));
  const mappedNB = nbProjectsDash.map(n => ({
    ...n, projectName: n.title || 'Untitled NB',
    approvedBudget: n.budget || 0, estimatedBudget: n.budget || 0,
    invoices: n.invoices || [], quotes: n.quotes || [],
  }));
  const P = scope === 'holidaywork' ? mappedHW
          : scope === 'newbuild'    ? mappedNB
          : scope === 'projects'    ? regProjects
          : [...regProjects, ...mappedHW, ...mappedNB];

  const totalBudget = P.reduce((s,p) => s + parseFloat(p.approvedBudget||p.estimatedBudget||0), 0);
  const totalSpend  = P.reduce((s,p) => s + (p.invoices||[]).reduce((t,i) => t + parseFloat(i.amount||0), 0), 0);
  const variance    = totalBudget - totalSpend;
  const spendPct    = totalBudget > 0 ? (totalSpend/totalBudget*100).toFixed(0) : 0;
  const over        = totalSpend > totalBudget && totalBudget > 0;

  $('stat-total').textContent    = P.length;
  $('stat-active').textContent   = P.filter(p=>!['Completed','Archived','Draft'].includes(p.status)).length;
  $('stat-complete').textContent = P.filter(p=>p.status==='Completed').length;
  $('stat-pending').textContent  = P.filter(p=>['Awaiting Quotes','Quotes Received'].includes(p.status)).length;
  $('stat-budget').textContent   = fmt.currency(totalBudget);
  $('stat-spend').textContent    = fmt.currency(totalSpend);

  // Variance indicator on budget card
  const varSub = $('stat-variance-sub');
  if (varSub && totalBudget > 0) {
    varSub.textContent = (over ? '▲ Over by ' : '▼ Under by ') + fmt.currency(Math.abs(variance));
    varSub.style.color = over ? 'var(--danger)' : '#2e7d32';
  }
  const pctSub = $('stat-spend-pct');
  if (pctSub) {
    pctSub.textContent = spendPct + '% of budget used';
    pctSub.style.color = over ? 'var(--danger)' : 'inherit';
  }
  // Colour spend card red if over budget
  const spendCard = $('stat-spend-card');
  if (spendCard) spendCard.style.borderTopColor = over ? 'var(--danger)' : '';

  // Deadline alerts
  const today = new Date(), alerts = [];
  P.forEach(p => {
    if (p.quoteDueDate) { const d=Math.ceil((new Date(p.quoteDueDate)-today)/86400000); if(d>=0&&d<=5&&p.status==='Awaiting Quotes') alerts.push({t:'warning',m:`Quote due in ${d} day(s): <strong>${esc(p.projectName)}</strong>`,id:p.id}); }
    if (p.startDate)    { const d=Math.ceil((new Date(p.startDate)-today)/86400000);    if(d>=0&&d<=3&&p.status==='Approved')         alerts.push({t:'info',   m:`Work starts in ${d} day(s): <strong>${esc(p.projectName)}</strong>`,id:p.id}); }
    if (p.completionDate&&p.status==='In Progress') { const d=Math.ceil((new Date(p.completionDate)-today)/86400000); if(d<0) alerts.push({t:'danger',m:`Overdue: <strong>${esc(p.projectName)}</strong> — due ${fmt.date(p.completionDate)}`,id:p.id}); }
  });
  $('alerts-container').innerHTML = alerts.slice(0,5).map(a =>
    `<div class="alert alert-${a.t}" onclick="openDashDrawer('${a.id}')" style="cursor:pointer">${a.m} <span style="float:right;font-size:.75rem;opacity:.7">View ›</span></div>`
  ).join('');

  // Charts
  renderStatusDonut(P);
  renderCategoryBar(P);
  renderPriorityBar(P);

  // Filter chips sync
  document.querySelectorAll('.filter-chip[data-filter]').forEach(c => {
    c.classList.toggle('active', c.dataset.filter === State.projectFilter);
  });

  // Scope tab count badges
  const regCount = regProjects.length;
  const hwCount  = (scope === 'projects' || scope === 'newbuild') ? loadHWProjects().length : hwProjects.length;
  const nbCount  = (scope === 'projects' || scope === 'holidaywork') ? loadNBProjects().length : nbProjectsDash.length;
  document.querySelectorAll('.dash-scope-tab').forEach(t => {
    const s = t.dataset.scope;
    const count = s === 'all' ? (regCount + hwCount + nbCount) : s === 'projects' ? regCount : s === 'holidaywork' ? hwCount : nbCount;
    const label = s === 'all' ? 'All' : s === 'projects' ? 'Projects' : s === 'holidaywork' ? 'Holiday Work' : 'New Build';
    t.innerHTML = label + ' <span class="dash-scope-count">' + count + '</span>';
  });

  // Project feed
  renderDashFeed();
  renderDashActivityLog();
  if (typeof animateCounters === 'function') setTimeout(animateCounters, 50);
  if (typeof updateNavBadges === 'function') updateNavBadges();
}

/* ── Dashboard project feed (live, searchable, filterable) ── */
function renderDashFeed() {
  const container = $('dash-project-cards'); if (!container) return;
  const scope = State.dashScope || 'all';

  let P = State.combinedView
    ? [...DB.load(DB.keys('lourensford').projects).map(p=>({...p,_site:'Lourensford'})),
       ...DB.load(DB.keys('spier').projects).map(p=>({...p,_site:'Spier'}))]
    : State.projects;
  if (scope === 'holidaywork' || scope === 'newbuild') P = [];

  let hwItems = [];
  if (scope !== 'projects' && scope !== 'newbuild') {
    let hwRaw;
    if (State.combinedView) {
      const old = currentSiteId;
      currentSiteId='lourensford'; const hw1=loadHWProjects().map(p=>({...p,_site:'Lourensford'}));
      currentSiteId='spier'; const hw2=loadHWProjects().map(p=>({...p,_site:'Spier'}));
      currentSiteId=old; hwRaw=[...hw1,...hw2];
    } else { hwRaw = loadHWProjects(); }
    hwItems = hwRaw.map(h => ({
      id: h.id, _isHW: true,
      projectName: h.title || 'Untitled HW', projectNumber: h.holiday || 'Holiday Work',
      category: h.category || 'Holiday Work', location: h.location || '',
      status: h.status || 'Planning', priority: h.priority || 'Medium',
      dateUpdated: h.dateUpdated, dateCreated: h.dateCreated,
      contractorName: h.contractor || '',
      approvedBudget: h.budget || 0, estimatedBudget: h.budget || 0,
      invoices: h.invoices || [], quotes: h.quotes || [], photos: [],
      startDate: h.startDate, completionDate: h.endDate, _site: h._site,
    }));
  }

  let nbItems = [];
  if (scope !== 'projects' && scope !== 'holidaywork') {
    let nbRaw;
    if (State.combinedView) {
      const old = currentSiteId;
      currentSiteId='lourensford'; const nb1=loadNBProjects().map(p=>({...p,_site:'Lourensford'}));
      currentSiteId='spier'; const nb2=loadNBProjects().map(p=>({...p,_site:'Spier'}));
      currentSiteId=old; nbRaw=[...nb1,...nb2];
    } else { nbRaw = loadNBProjects(); }
    nbItems = nbRaw.map(n => ({
      id: n.id, _isNB: true,
      projectName: n.title || 'Untitled NB', projectNumber: 'New Build',
      category: n.category || 'New Build', location: n.location || '',
      status: n.status || 'Planning', priority: n.priority || 'Medium',
      dateUpdated: n.dateUpdated, dateCreated: n.dateAdded,
      contractorName: n.contractor || '',
      approvedBudget: n.budget || 0, estimatedBudget: n.budget || 0,
      invoices: n.invoices || [], quotes: n.quotes || [], photos: [],
      startDate: n.startDate, completionDate: n.endDate, _site: n._site,
    }));
  }

  if (scope === 'holidaywork') P = hwItems;
  else if (scope === 'newbuild') P = nbItems;
  else if (scope === 'all') P = [...P, ...hwItems, ...nbItems];
  else P = [...P];

  const search = ($('dash-search')?.value || '').trim().toLowerCase();
  let items = [...P];

  // Include Garden module entries as virtual items
  const gardenVirtual = State.gardens.map(g => ({
    id: 'garden_' + g.id, _isGarden: true, _gardenId: g.id,
    projectName: g.gardenName, projectNumber: 'GARDEN',
    category: 'Garden Projects', location: g.location||'',
    status: g.harvestDate && new Date(g.harvestDate) < new Date() ? 'Completed' : 'In Progress',
    dateUpdated: g.dateAdded, dateCreated: g.dateAdded,
    _crop: g.crop, _area: g.areaSize,
  }));
  items = [...items, ...gardenVirtual];

  // Apply category filter
  if (State.projectFilter !== 'all') items = items.filter(p=>p.category===State.projectFilter);
  // Apply status filter from stat card
  if (State.dashStatus === 'active')    items = items.filter(p=>!['Completed','Archived','Draft'].includes(p.status));
  if (State.dashStatus === 'completed') items = items.filter(p=>p.status==='Completed');
  if (State.dashStatus === 'quotes')    items = items.filter(p=>['Awaiting Quotes','Quotes Received'].includes(p.status));
  // Apply search
  if (search) items = items.filter(p =>
    (p.projectName||'').toLowerCase().includes(search) ||
    (p.projectNumber||'').toLowerCase().includes(search) ||
    (p.location||'').toLowerCase().includes(search) ||
    (p.contractorName||'').toLowerCase().includes(search)
  );

  // Sort by most recently updated
  items.sort((a,b)=>(b.dateUpdated||b.dateCreated||'').localeCompare(a.dateUpdated||a.dateCreated||''));

  // Feed title
  const titleEl = $('dash-feed-title');
  if (titleEl) titleEl.textContent = items.length + ' Project' + (items.length!==1?'s':'') + (search?' matching "'+search+'"':'');

  if (!items.length) {
    container.innerHTML = `<div class="empty-state" style="padding:40px 20px">
      <div class="empty-icon">📋</div>
      <h3>No projects found</h3>
      <p>${search?'Try a different search term.':'Get started by adding your first project.'}</p>
      ${search?'':'<button class="btn btn-primary btn-sm" onclick="openProjectModal()">+ New Project</button>'}
    </div>`;
    return;
  }

  container.innerHTML = items.map(function(p) {
    var budget = parseFloat(p.approvedBudget||p.estimatedBudget||0);
    var spend  = (p.invoices||[]).reduce(function(t,i){return t+parseFloat(i.amount||0);},0);
    var pct    = budget>0 ? Math.min(spend/budget*100,100).toFixed(0) : null;
    var over   = spend > budget && budget > 0;
    var quotes = (p.quotes||[]).length;
    var photos = (p.photos||[]).length;
    var days   = p.completionDate ? Math.ceil((new Date(p.completionDate)-new Date())/86400000) : null;
    var daysStr = '';
    if (days !== null) {
      if      (days < 0)  daysStr = '<span class="hw-count-badge hw-overdue">' + Math.abs(days) + 'd overdue</span>';
      else if (days === 0) daysStr = '<span class="hw-count-badge hw-urgent">Due today</span>';
      else if (days <= 7)  daysStr = '<span class="hw-count-badge hw-soon">' + days + 'd left</span>';
      else                daysStr = '<span class="hw-count-badge" style="background:var(--ivory);color:var(--text-muted)">' + days + 'd left</span>';
    }

    var clickFn = p._isGarden
      ? 'openGardenModal(\'' + (p._gardenId||'') + '\')'
      : p._isHW
      ? 'navigate(\"holidaywork\");setTimeout(function(){var el=document.getElementById(\"hwc-'+p.id+'\");if(el)el.scrollIntoView({behavior:\"smooth\",block:\"center\"})},200)'
      : p._isNB
      ? 'navigate(\"newbuild\")'
      : 'openDashDrawer(\'' + (p.id||'') + '\')';

    var refHtml = p._isGarden
      ? '<span style="font-size:.68rem;background:#d4edda;color:var(--pk-green);padding:1px 7px;border-radius:10px;font-weight:700">GARDEN MODULE</span>'
      : esc(p.projectNumber||'—');
    if (p._site) refHtml += ' <span class="site-badge site-' + p._site.toLowerCase() + '">' + p._site + '</span>';

    var nameHtml = esc(p.projectName||'');
    if (p._crop) nameHtml += '<span style="font-size:.74rem;font-weight:400;color:var(--text-muted);margin-left:6px">&middot; ' + esc(p._crop) + '</span>';

    var html = '<div class="dash-feed-card" onclick="' + clickFn + '">';
    html += '<div class="dfc-header"><div>';
    html += '<div class="dfc-ref">' + refHtml + '</div>';
    html += '<div class="dfc-name">' + nameHtml + '</div>';
    html += '</div><div style="text-align:right;flex-shrink:0">';
    html += statusBadge(p.status||'Draft');
    if (daysStr) html += '<div style="margin-top:4px;font-size:.72rem">' + daysStr + '</div>';
    html += '</div></div>';

    // Meta row
    html += '<div class="dfc-meta">';
    if (p.category)      html += '<span class="cat-badge">' + esc(p.category) + '</span>';
    if (p.location)      html += '<span>&#128205; ' + esc(p.location) + '</span>';
    if (p.contractorName) html += '<span>&#127959; ' + esc(p.contractorName) + '</span>';
    if (quotes > 0)      html += '<span>' + quotes + ' quote' + (quotes!==1?'s':'') + '</span>';
    if (photos > 0)      html += '<span>' + photos + ' photo' + (photos!==1?'s':'') + '</span>';
    if (!p._isGarden && p.telephone) {
      var ph = (p.telephone||'').replace(/'/g,'');
      html += '<span onclick="event.stopPropagation();openWhatsApp(\'' + ph + '\',WA_MSG.quoteRequest(State.projects.find(function(x){return x.id===\'' + (p.id||'') + '\'})||{}))" style="cursor:pointer;color:#25d366;font-weight:600" title="WhatsApp contractor">WhatsApp</span>';
    }
    html += '</div>';

    // Budget bar
    if (budget > 0) {
      html += '<div class="dfc-budget">';
      html += '<div style="display:flex;justify-content:space-between;font-size:.72rem;margin-bottom:3px">';
      html += '<span style="color:var(--text-muted)">Budget: ' + fmt.currency(budget) + '</span>';
      if (pct !== null) html += '<span style="color:' + (over?'var(--danger)':'var(--text-muted)') + ';font-weight:600">' + pct + '% spent</span>';
      html += '</div>';
      if (pct !== null) {
        html += '<div style="height:4px;background:var(--platinum);border-radius:2px;overflow:hidden">';
        html += '<div style="height:100%;width:' + pct + '%;background:' + (over?'var(--danger)':'var(--pk-green)') + ';border-radius:2px"></div></div>';
      }
      html += '</div>';
    }

    html += '</div>'; // /dash-feed-card
    return html;
  }).join('');
}

/* ── Open project detail drawer ──────────────────────────── */
function openDashDrawer(projectId) {
  const allP = State.combinedView
    ? [...DB.load(DB.keys('lourensford').projects), ...DB.load(DB.keys('spier').projects)]
    : State.projects;
  const p = allP.find(x=>x.id===projectId); if (!p) return;

  $('dash-drawer-title').textContent = p.projectName;
  $('dash-drawer-edit-btn').onclick  = () => { closeDashDrawer(); navigate('newproject', p.id); };

  // WhatsApp button in drawer header
  const waDrawerEl = $('dash-drawer-wa');
  if (waDrawerEl) {
    const phone = p.telephone || '';
    if (p.telephone) {
      waDrawerEl.innerHTML = waButtonGroup(phone, p, 'project');
    } else {
      waDrawerEl.innerHTML = '<button class="btn btn-wa btn-wa-dim" onclick="closeDashDrawer();navigate(\'newproject\',\'' + p.id + '\')" title="Add a phone number to enable WhatsApp">WA (add number)</button>';
    }
  }

  const budget   = parseFloat(p.approvedBudget||p.estimatedBudget||0);
  const spend    = (p.invoices||[]).reduce((t,i)=>t+parseFloat(i.amount||0),0);
  const variance = budget - spend;
  const over     = spend > budget && budget > 0;
  const pct      = budget > 0 ? Math.min(spend/budget*100,100).toFixed(1) : null;
  const quotes   = (p.quotes||[]).sort((a,b)=>parseFloat(a.total||a.amount||0)-parseFloat(b.total||b.amount||0));
  const photos   = p.photos || [];
  const invoices = p.invoices || [];

  $('dash-drawer-body').innerHTML = `
    <!-- Header badges -->
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">
      ${statusBadge(p.status||'Draft')}
      ${p.category ? `<span class="cat-badge">${esc(p.category)}</span>` : ''}
      ${p.priority ? `<span class="badge badge-${(p.priority).toLowerCase()}">${esc(p.priority)}</span>` : ''}
    </div>

    <!-- Key info grid -->
    <div class="drawer-info-grid">
      ${p.location        ? `<div class="dig-item"><div class="dig-label">Location</div><div class="dig-val">${esc(p.location)}</div></div>` : ''}
      ${p.contractorName  ? `<div class="dig-item"><div class="dig-label">Contractor</div><div class="dig-val">${esc(p.contractorName)}</div></div>` : ''}
      ${p.contactPerson || p.telephone ? `<div class="dig-item" style="grid-column:1/-1">
        <div class="dig-label">Contact</div>
        <div class="dig-val" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span>${esc(p.contactPerson||'')}${p.telephone?' · '+esc(p.telephone):''}</span>
          ${p.telephone ? `<span style="display:inline-block">${waButtonGroup(p.telephone, p, 'project')}</span>` : ''}
        </div>
      </div>` : ''}
      ${p.requestDate     ? `<div class="dig-item"><div class="dig-label">Request Date</div><div class="dig-val">${fmt.date(p.requestDate)}</div></div>` : ''}
      ${p.startDate       ? `<div class="dig-item"><div class="dig-label">Start Date</div><div class="dig-val">${fmt.date(p.startDate)}</div></div>` : ''}
      ${p.completionDate  ? `<div class="dig-item"><div class="dig-label">Completion</div><div class="dig-val">${fmt.date(p.completionDate)}</div></div>` : ''}
      ${p.fundingSource   ? `<div class="dig-item"><div class="dig-label">Funding</div><div class="dig-val">${esc(p.fundingSource)}</div></div>` : ''}
      <div class="dig-item"><div class="dig-label">Ref</div><div class="dig-val" style="font-weight:700;color:var(--pk-green)">${esc(p.projectNumber||'—')}</div></div>
    </div>

    ${p.description ? `<div class="drawer-section">
      <div class="drawer-section-title">Description</div>
      <p style="font-size:.83rem;color:var(--text-secondary);line-height:1.6">${esc(p.description)}</p>
    </div>` : ''}

    <!-- Budget tracker -->
    <div class="drawer-section">
      <div class="drawer-section-title">Financial</div>
      <div class="drawer-budget-row">
        <div class="dbr-item">
          <div class="dbr-label">Budget</div>
          <div class="dbr-val">${budget ? fmt.currency(budget) : '—'}</div>
        </div>
        <div class="dbr-item">
          <div class="dbr-label">Invoiced</div>
          <div class="dbr-val ${over?'over':''}">${fmt.currency(spend)}</div>
        </div>
        <div class="dbr-item">
          <div class="dbr-label">Variance</div>
          <div class="dbr-val ${over?'over':'under'}">${over?'-':''}${fmt.currency(Math.abs(variance))}</div>
        </div>
      </div>
      ${pct !== null ? `<div class="drawer-progress-wrap">
        <div class="drawer-progress-bar" style="width:${pct}%;background:${over?'var(--danger)':'var(--pk-green)'}"></div>
      </div>
      <div style="font-size:.72rem;color:${over?'var(--danger)':'var(--text-muted)'};margin-top:4px">${pct}% of budget used</div>` : ''}
    </div>

    <!-- Quotes -->
    ${quotes.length ? `<div class="drawer-section">
      <div class="drawer-section-title">Quotations (${quotes.length})</div>
      <div class="drawer-quote-list">
        ${quotes.map((q,i)=>`<div class="dql-item ${i===0?'dql-best':''}">
          <div class="dql-contractor">${esc(q.contractor)}${i===0?' <span class="badge badge-approved" style="font-size:.62rem;margin-left:4px">Lowest</span>':''}</div>
          <div class="dql-amount">${fmt.currency(q.total||q.amount)}</div>
          <div class="dql-meta">${q.leadTime?'Lead: '+esc(q.leadTime):''}${q.warranty?' · '+q.warranty+'mo warranty':''}</div>
        </div>`).join('')}
      </div>
      ${p.recommendation ? `<div style="margin-top:8px;padding:10px;background:#f2f8eb;border-radius:var(--radius-sm);font-size:.8rem;color:var(--pk-green);line-height:1.5">
        <strong>Recommendation:</strong> ${esc(p.recommendation)}
      </div>` : ''}
    </div>` : ''}

    <!-- Invoices -->
    ${invoices.length ? `<div class="drawer-section">
      <div class="drawer-section-title">Invoices (${invoices.length})</div>
      ${invoices.map(inv=>`<div class="dql-item">
        <div class="dql-contractor">${esc(inv.ref||'—')} <span style="color:var(--text-muted)">${esc(inv.supplier||'')}</span></div>
        <div class="dql-amount">${fmt.currency(inv.amount)}</div>
        <div class="dql-meta">${fmt.date(inv.date)} · <span style="color:${inv.paid?'#2e7d32':'var(--warning)'}">${inv.paid?'✓ Paid':'Pending'}</span></div>
      </div>`).join('')}
    </div>` : ''}

    <!-- Photos gallery -->
    ${photos.length ? `<div class="drawer-section">
      <div class="drawer-section-title">Photos (${photos.length})</div>
      <div class="drawer-photo-grid">
        ${photos.map(ph=>`<div class="drawer-photo" onclick="openLightbox('${ph.id}')" title="${esc(ph.label||'Photo')}">
          <img src="${ph.data}" alt="${esc(ph.label||'photo')}">
          <div class="drawer-photo-label">${esc(ph.label||'')}</div>
        </div>`).join('')}
      </div>
    </div>` : ''}

    <!-- Notes -->
    ${p.notes ? `<div class="drawer-section">
      <div class="drawer-section-title">Notes</div>
      <p style="font-size:.82rem;color:var(--text-secondary);line-height:1.6;white-space:pre-wrap">${esc(p.notes)}</p>
    </div>` : ''}

    <!-- Project Activity -->
    ${(p.activity||[]).length ? `<div class="drawer-section">
      <div class="drawer-section-title">Project Activity</div>
      <div class="activity-list">
        ${(p.activity||[]).slice(0,6).map(a=>`<div class="activity-item">
          <div class="activity-dot"></div>
          <div class="activity-text"><strong>${esc(a.text)}</strong></div>
          <div class="activity-time">${fmt.dateTime(a.ts)}</div>
        </div>`).join('')}
      </div>
    </div>` : ''}

    <!-- Global Activity Log -->
    ${renderActivityInDrawer()}
  `;

  // Open drawer
  $('dash-drawer').classList.add('open');
  $('dash-drawer-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeDashDrawer() {
  $('dash-drawer').classList.remove('open');
  $('dash-drawer-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

/* ── Stat card click navigation ──────────────────────────── */
function filterAndGo(type) {
  State.dashStatus = type;
  renderDashFeed();
  // Highlight the clicked stat card
  document.querySelectorAll('.stat-card-clickable').forEach(c => c.classList.remove('stat-active'));
  const map = {all:'stat-total',active:'stat-active',completed:'stat-complete',quotes:'stat-pending'};
  const el  = $(map[type]+'')?.closest('.stat-card');
  if (el) el.classList.add('stat-active');
}

/* ── Chart tab switcher ──────────────────────────────────── */
function switchChartTab(btn, tabId) {
  document.querySelectorAll('.chart-tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  ['tab-status','tab-budget','tab-priority'].forEach(id => {
    const el=$(id); if(el) el.style.display = id===tabId?'block':'none';
  });
}

/* ── Priority bar chart ──────────────────────────────────── */
function renderPriorityBar(P) {
  const el = $('chart-priority-bar'); if (!el) return;
  const COLORS = { High:'#e53935', Medium:'#f57c00', Low:'#388e3c' };
  const counts  = { High:0, Medium:0, Low:0 };
  P.forEach(p => { if (p.priority && counts[p.priority]!==undefined) counts[p.priority]++; });
  const total = P.length || 1;
  el.innerHTML = Object.entries(counts).map(([pri,n])=> {
    const pct = (n/total*100).toFixed(1);
    return `<div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:.78rem;margin-bottom:3px">
        <span style="font-weight:600;color:${COLORS[pri]}">${pri}</span>
        <span style="color:var(--text-muted)">${n} project${n!==1?'s':''}</span>
      </div>
      <div style="height:10px;background:var(--platinum);border-radius:5px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${COLORS[pri]};border-radius:5px;transition:width .4s ease"></div>
      </div>
    </div>`;
  }).join('');
}

/* ── Status Donut Chart (SVG) ───────────────────────────── */
function renderStatusDonut(P) {
  const el = $('chart-status-donut'); if (!el) return;
  if (!P.length) { el.innerHTML = '<p style="color:var(--text-muted);font-size:.78rem;padding:8px">No data yet</p>'; return; }

  // Rich, distinct colours — clearly readable even as small segments
  const STATUS_COLORS = {
    'Draft':              '#9e9e9e',
    'Planning':           '#1976d2',
    'Awaiting Quotes':    '#f57c00',
    'Quotes Received':    '#c2185b',
    'Awaiting Approval':  '#7b1fa2',
    'Approved':           '#388e3c',
    'In Progress':        '#0097a7',
    'Completed':          '#1F3D1D',
    'Archived':           '#546e7a',
  };

  const counts  = {};
  P.forEach(p => { const s = p.status||'Draft'; counts[s] = (counts[s]||0) + 1; });
  const entries = Object.entries(counts).sort((a,b) => b[1]-a[1]);
  const total   = P.length;

  // Donut geometry — small: 72px diameter
  const R=28, CX=38, CY=38, STROKE=11;
  const CIRC = 2 * Math.PI * R;
  let cumPct = 0, slices = '';

  entries.forEach(([status, count]) => {
    const pct   = count / total;
    const dash  = (pct * CIRC).toFixed(2);
    const gap   = ((1 - pct) * CIRC).toFixed(2);
    const offset= (CIRC * 0.25 - cumPct * CIRC).toFixed(2);
    const color = STATUS_COLORS[status] || '#aaa';
    slices += `<circle cx="${CX}" cy="${CY}" r="${R}"
      fill="none" stroke="${color}" stroke-width="${STROKE}"
      stroke-dasharray="${dash} ${gap}"
      stroke-dashoffset="${offset}"
      style="cursor:pointer">
      <title>${status}: ${count} project${count!==1?'s':''}</title>
    </circle>`;
    cumPct += pct;
  });

  const legend = entries.map(([status, count]) => {
    const color = STATUS_COLORS[status] || '#aaa';
    return `<div class="chart-legend-item">
      <span class="chart-legend-dot" style="background:${color}"></span>
      <span>${esc(status)}&thinsp;<strong>(${count})</strong></span>
    </div>`;
  }).join('');

  el.innerHTML = `<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
    <svg viewBox="0 0 76 76" width="76" height="76" style="flex-shrink:0">
      ${slices}
      <text x="${CX}" y="${CY+1}" text-anchor="middle" dominant-baseline="middle"
            font-size="13" font-weight="700" fill="#1F3D1D">${total}</text>
      <text x="${CX}" y="${CY+14}" text-anchor="middle"
            font-size="6" fill="#888">PROJECTS</text>
    </svg>
    <div class="chart-legend" style="gap:4px">${legend}</div>
  </div>`;
}

/* ── Category Budget Bar Chart (SVG) ───────────────────── */
function renderCategoryBar(P) {
  const el = $('chart-category-bar'); if (!el) return;
  if (!P.length) { el.innerHTML = '<p style="color:var(--text-muted);font-size:.78rem;padding:8px">No data yet</p>'; return; }

  const cats = {};
  P.forEach(p => {
    const c = p.category || 'Other';
    if (!cats[c]) cats[c] = { budget:0, spend:0 };
    cats[c].budget += parseFloat(p.approvedBudget||p.estimatedBudget||0);
    cats[c].spend  += (p.invoices||[]).reduce((t,i) => t + parseFloat(i.amount||0), 0);
  });

  const entries = Object.entries(cats).sort((a,b) => b[1].budget - a[1].budget).slice(0,6);
  if (!entries.length) { el.innerHTML = '<p style="color:var(--text-muted);font-size:.78rem">No data</p>'; return; }

  const maxVal  = Math.max(...entries.map(([,v]) => Math.max(v.budget, v.spend, 1)));
  const LABEL_W = 90;   // left label column width
  const BAR_W   = 160;  // max bar width
  const BAR_H   = 10;   // height of each bar
  const ROW_H   = 28;   // total row height (budget bar + spend bar + gap)
  const W       = LABEL_W + BAR_W + 4;
  const H       = entries.length * ROW_H + 8;

  let rows = '';
  entries.forEach(([cat, v], i) => {
    const y       = i * ROW_H + 4;
    const bW      = ((v.budget / maxVal) * BAR_W).toFixed(1);
    const sW      = ((v.spend  / maxVal) * BAR_W).toFixed(1);
    const over    = v.spend > v.budget && v.budget > 0;
    const label   = cat.length > 13 ? cat.slice(0,12) + '…' : cat;
    // Budget amount label — placed inside bar if wide enough, else outside
    const bLabel  = v.budget ? fmt.currency(v.budget) : '';
    const sLabel  = v.spend  ? fmt.currency(v.spend)  : '';
    const bLabelX = parseFloat(bW) > 40 ? LABEL_W + parseFloat(bW) - 3 : LABEL_W + parseFloat(bW) + 3;
    const bAnchor = parseFloat(bW) > 40 ? 'end' : 'start';
    const sLabelX = parseFloat(sW) > 40 ? LABEL_W + parseFloat(sW) - 3 : LABEL_W + parseFloat(sW) + 3;
    const sAnchor = parseFloat(sW) > 40 ? 'end' : 'start';

    rows += `
      <text x="${LABEL_W-4}" y="${y+8}" text-anchor="end" font-size="8" fill="#555" font-weight="600"
            style="font-family:'Noto Sans',Arial,sans-serif">${esc(label)}</text>
      <rect x="${LABEL_W}" y="${y}" width="${bW}" height="${BAR_H}" rx="2" fill="#7DA24B"/>
      <text x="${bLabelX}" y="${y+8}" text-anchor="${bAnchor}" font-size="7"
            fill="${parseFloat(bW)>40?'#fff':'#555'}"
            style="font-family:'Noto Sans',Arial,sans-serif">${bLabel}</text>
      <rect x="${LABEL_W}" y="${y+BAR_H+2}" width="${sW}" height="${BAR_H}" rx="2"
            fill="${over?'#e53935':'#1F3D1D'}"/>
      <text x="${sLabelX}" y="${y+BAR_H+10}" text-anchor="${sAnchor}" font-size="7"
            fill="${parseFloat(sW)>40?(over?'#fff':'#fff'):'#555'}"
            style="font-family:'Noto Sans',Arial,sans-serif">${sLabel}</text>`;
  });

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;display:block;overflow:visible">
      ${rows}
    </svg>
    <div class="chart-legend" style="margin-top:6px;flex-direction:row;flex-wrap:wrap;gap:10px">
      <div class="chart-legend-item"><span class="chart-legend-dot" style="background:#7DA24B"></span><span>Budget</span></div>
      <div class="chart-legend-item"><span class="chart-legend-dot" style="background:#1F3D1D"></span><span>Actual Spend</span></div>
      <div class="chart-legend-item"><span class="chart-legend-dot" style="background:#e53935"></span><span>Over Budget</span></div>
    </div>`;
}

/* ── Project List ────────────────────────────────────────── */
function renderProjectList() {
  refreshProjectsFromStorage();

  let items;
  if (State.combinedView) {
    const lp = DB.load(DB.keys('lourensford').projects).map(p => ({...p, _site:'lourensford', _siteName:'Lourensford'}));
    const sp = DB.load(DB.keys('spier').projects).map(p =>       ({...p, _site:'spier',        _siteName:'Spier'}));
    items = [...lp, ...sp];
    syncCombinedCaches();
  } else {
    items = [...State.projects];
  }

  if (State.projectFilter === 'all' || State.projectFilter === 'Garden Projects') {
    const gardenItems = State.gardens.map(g => ({
      id:             'garden_' + g.id,
      _isGarden:      true,
      projectNumber:  'GDN',
      projectName:    g.gardenName,
      category:       'Garden Projects',
      location:       g.location || '—',
      estimatedBudget: g.budget || '',
      approvedBudget: '',
      status:         g.harvestDate && new Date(g.harvestDate) < new Date() ? 'Completed' : 'In Progress',
      dateCreated:    g.dateAdded || '',
      _gardenId:      g.id,
      _crop:          g.crop,
      _area:          g.areaSize,
    }));
    items = [...items, ...gardenItems];
  }

  if (State.projectFilter === 'all' || State.projectFilter === 'Holiday Work') {
    const hwItems = loadHWProjects().map(h => {
      var spent = (h.invoices||[]).reduce(function(t,i){return t+parseFloat(i.amount||0)},0);
      var scopeDone = (h.scopeItems||[]).filter(function(s){return s.done}).length;
      var scopeTotal = (h.scopeItems||[]).length;
      return {
        id:             'hw_' + h.id,
        _isHW:          true,
        projectNumber:  'HW',
        projectName:    h.title,
        category:       'Holiday Work',
        location:       h.location || '—',
        estimatedBudget: h.budget || '',
        approvedBudget: '',
        status:         h.status || 'Planning',
        dateCreated:    h.dateAdded || '',
        _hwId:          h.id,
        _holiday:       h.holiday,
        _contractor:    h.contractor,
        _cell:          h.cell,
        _priority:      h.priority,
        _startDate:     h.startDate,
        _endDate:       h.endDate,
        _spent:         spent,
        _scopeDone:     scopeDone,
        _scopeTotal:    scopeTotal,
        _quotes:        (h.quotes||[]).length,
      };
    });
    items = [...items, ...hwItems];
  }

  if (State.projectFilter === 'all' || State.projectFilter === 'New Build') {
    const nbItems = loadNBProjects().map(n => {
      var spent = (n.invoices||[]).reduce(function(t,i){return t+parseFloat(i.amount||0)},0);
      var scopeDone = (n.scopeItems||[]).filter(function(s){return s.done}).length;
      var scopeTotal = (n.scopeItems||[]).length;
      return {
        id:             'nb_' + n.id,
        _isNB:          true,
        projectNumber:  'NB',
        projectName:    n.title,
        category:       'New Build',
        location:       n.location || '—',
        estimatedBudget: n.budget || '',
        approvedBudget: '',
        status:         n.status || 'Planning',
        dateCreated:    n.dateAdded || '',
        _nbId:          n.id,
        _architect:     n.architect,
        _contractor:    n.contractor,
        _size:          n.size,
        _startDate:     n.startDate,
        _endDate:       n.endDate,
        _spent:         spent,
        _scopeDone:     scopeDone,
        _scopeTotal:    scopeTotal,
        _quotes:        (n.quotes||[]).length,
      };
    });
    items = [...items, ...nbItems];
  }

  // Category filter
  if (State.projectFilter !== 'all') items = items.filter(p => p.category === State.projectFilter);

  // Search
  if (State.projectSearch) {
    const q = State.projectSearch.toLowerCase();
    items = items.filter(p =>
      (p.projectName||'').toLowerCase().includes(q) ||
      (p.projectNumber||'').toLowerCase().includes(q) ||
      (p.location||'').toLowerCase().includes(q) ||
      (p.contractorName||'').toLowerCase().includes(q) ||
      (p._contractor||'').toLowerCase().includes(q) ||
      (p._holiday||'').toLowerCase().includes(q)
    );
  }

  // Sort
  const { field, dir } = State.projectSort;
  items.sort((a,b) => {
    let av = a[field]||'', bv = b[field]||'';
    if (['estimatedBudget','approvedBudget'].includes(field)) { av=parseFloat(av)||0; bv=parseFloat(bv)||0; }
    return dir === 'asc' ? (av>bv?1:-1) : (av<bv?1:-1);
  });

  // Pagination
  const total = items.length, pages = Math.max(1, Math.ceil(total/State.perPage));
  State.projectPage = Math.min(State.projectPage, pages);
  const paged = items.slice((State.projectPage-1)*State.perPage, State.projectPage*State.perPage);

  // Table rows
  $('project-list-body').innerHTML = paged.length
    ? paged.map(function(p) {
        var budget = p.approvedBudget || p.estimatedBudget;
        var gid    = p._gardenId || '';
        var pid    = p.id || '';

        if (p._isGarden) {
          var row = '<tr style="background:#f2f8eb" draggable="true">';
          row += '<td><span class="drag-handle" title="Drag to reorder">&#9776;</span></td>';
          row += '<td><span class="module-badge module-garden">GARDEN</span></td>';
          row += '<td style="max-width:200px"><strong>' + esc(p.projectName) + '</strong>';
          if (p._crop) row += '<div style="font-size:.74rem;color:var(--text-muted)">Crop: ' + esc(p._crop) + '</div>';
          if (p._area) row += '<div style="font-size:.74rem;color:var(--text-muted)">' + esc(p._area) + ' m\u00b2</div>';
          row += '</td>';
          row += '<td><span class="cat-badge">Garden Projects</span></td>';
          if (State.combinedView) row += '<td></td>';
          row += '<td style="color:var(--text-muted);font-size:.82rem">' + esc(p.location||'') + '</td>';
          row += '<td>' + (p.estimatedBudget ? fmt.currency(p.estimatedBudget) : '—') + '</td>';
          row += '<td>' + statusBadge(p.status||'Draft') + '</td>';
          row += '<td style="color:var(--text-muted);font-size:.8rem">' + fmt.date(p.dateCreated) + '</td>';
          row += '<td class="actions"><div style="display:flex;gap:4px">';
          row += '<button class="btn btn-sm btn-outline" onclick="openGardenModal(\'' + gid + '\')">Edit</button>';
          row += '<button class="btn btn-sm btn-danger" onclick="deleteGarden(\'' + gid + '\');renderProjectList()">Delete</button>';
          row += '</div></td></tr>';
          return row;
        }

        if (p._isHW) {
          var hwid = p._hwId || '';
          var hwBudget = parseFloat(p.estimatedBudget)||0;
          var r = '<tr style="background:#fef9ee" draggable="true">';
          r += '<td><span class="drag-handle" title="Drag to reorder">&#9776;</span></td>';
          r += '<td><span class="module-badge module-hw">HOLIDAY</span>';
          if (p._priority === 'High' || p._priority === 'Urgent') r += '<div style="font-size:.64rem;color:var(--danger);font-weight:700;margin-top:2px">' + esc(p._priority) + '</div>';
          r += '</td>';
          r += '<td style="max-width:220px"><strong>' + esc(p.projectName) + '</strong>';
          if (p._contractor) r += '<div style="font-size:.74rem;color:var(--text-muted)">' + esc(p._contractor) + '</div>';
          if (p._startDate || p._endDate) {
            r += '<div style="font-size:.72rem;color:var(--text-muted)">';
            if (p._startDate) r += fmt.date(p._startDate);
            if (p._startDate && p._endDate) r += ' → ';
            if (p._endDate) r += fmt.date(p._endDate);
            r += '</div>';
          }
          if (p._scopeTotal > 0) r += '<div style="font-size:.72rem;color:var(--text-muted)">Scope: ' + p._scopeDone + '/' + p._scopeTotal + ' done</div>';
          r += '</td>';
          r += '<td><span class="cat-badge">' + esc(p._holiday||'Holiday Work') + '</span></td>';
          if (State.combinedView) r += '<td></td>';
          r += '<td style="color:var(--text-muted);font-size:.82rem">' + esc(p.location||'') + '</td>';
          r += '<td>';
          if (hwBudget) {
            r += fmt.currency(hwBudget);
            if (p._spent > 0) r += '<div style="font-size:.72rem;color:' + (p._spent > hwBudget ? 'var(--danger)' : 'var(--text-muted)') + '">Spent: ' + fmt.currency(p._spent) + '</div>';
          } else { r += '—'; }
          r += '</td>';
          r += '<td>' + statusBadge(p.status||'Planning') + '</td>';
          r += '<td style="color:var(--text-muted);font-size:.8rem">' + fmt.date(p.dateCreated) + '</td>';
          r += '<td class="actions"><div style="display:flex;gap:4px">';
          r += '<button class="btn btn-sm btn-outline" onclick="openHWModal(\'' + hwid + '\')">Edit</button>';
          r += '<button class="btn btn-sm btn-danger" onclick="deleteHWProject(\'' + hwid + '\');renderProjectList()">Delete</button>';
          r += '</div></td></tr>';
          return r;
        }

        if (p._isNB) {
          var nbid = p._nbId || '';
          var nbBudget = parseFloat(p.estimatedBudget)||0;
          var nb = '<tr style="background:#eef3fb" draggable="true">';
          nb += '<td><span class="drag-handle" title="Drag to reorder">&#9776;</span></td>';
          nb += '<td><span class="module-badge module-nb">BUILD</span></td>';
          nb += '<td style="max-width:220px"><strong>' + esc(p.projectName) + '</strong>';
          if (p._contractor) nb += '<div style="font-size:.74rem;color:var(--text-muted)">' + esc(p._contractor) + '</div>';
          if (p._startDate || p._endDate) {
            nb += '<div style="font-size:.72rem;color:var(--text-muted)">';
            if (p._startDate) nb += fmt.date(p._startDate);
            if (p._startDate && p._endDate) nb += ' → ';
            if (p._endDate) nb += fmt.date(p._endDate);
            nb += '</div>';
          }
          if (p._scopeTotal > 0) nb += '<div style="font-size:.72rem;color:var(--text-muted)">Scope: ' + p._scopeDone + '/' + p._scopeTotal + ' done</div>';
          nb += '</td>';
          nb += '<td><span class="cat-badge">New Build</span></td>';
          if (State.combinedView) nb += '<td></td>';
          nb += '<td style="color:var(--text-muted);font-size:.82rem">' + esc(p.location||'') + '</td>';
          nb += '<td>';
          if (nbBudget) {
            nb += fmt.currency(nbBudget);
            if (p._spent > 0) nb += '<div style="font-size:.72rem;color:' + (p._spent > nbBudget ? 'var(--danger)' : 'var(--text-muted)') + '">Spent: ' + fmt.currency(p._spent) + '</div>';
          } else { nb += '—'; }
          nb += '</td>';
          nb += '<td>' + statusBadge(p.status||'Planning') + '</td>';
          nb += '<td style="color:var(--text-muted);font-size:.8rem">' + fmt.date(p.dateCreated) + '</td>';
          nb += '<td class="actions"><div style="display:flex;gap:4px">';
          nb += '<button class="btn btn-sm btn-outline" onclick="openNBModal(\'' + nbid + '\')">Edit</button>';
          nb += '<button class="btn btn-sm btn-danger" onclick="deleteNBProject(\'' + nbid + '\');renderProjectList()">Delete</button>';
          nb += '</div></td></tr>';
          return nb;
        }

        var row2 = '<tr draggable="true">';
        row2 += '<td><span class="drag-handle" title="Drag to reorder">&#9776;</span></td>';
        row2 += '<td><a href="#" onclick="navigate(\'newproject\',\'' + pid + '\');return false" style="color:var(--pk-green);font-weight:600;text-decoration:none">' + esc(p.projectNumber||'—') + '</a></td>';
        row2 += '<td style="max-width:200px"><strong>' + esc(p.projectName) + '</strong></td>';
        row2 += '<td><span class="cat-badge">' + esc(p.category||'—') + '</span></td>';
        if (State.combinedView) row2 += '<td><span class="site-badge site-' + (p._site||'') + '">' + (p._siteName||'') + '</span></td>';
        row2 += '<td style="color:var(--text-muted);font-size:.82rem">' + esc(p.location||'—') + '</td>';
        row2 += '<td>' + (budget ? fmt.currency(budget) : '—') + '</td>';
        row2 += '<td>' + statusBadge(p.status||'Draft') + '</td>';
        row2 += '<td style="color:var(--text-muted);font-size:.8rem">' + fmt.date(p.dateCreated) + '</td>';
        row2 += '<td class="actions"><div style="display:flex;gap:4px">';
        if (!State.combinedView) {
          row2 += '<button class="btn btn-sm btn-outline" onclick="navigate(\'newproject\',\'' + pid + '\')">View</button>';
          row2 += '<button class="btn btn-sm btn-danger" onclick="deleteProject(\'' + pid + '\')">Delete</button>';
        } else {
          row2 += '<span style="font-size:.75rem;color:var(--text-muted)">Read-only</span>';
        }
        row2 += '</div></td></tr>';
        return row2;
      }).join('')
    : '<tr><td colspan="' + (State.combinedView?10:9) + '" class="table-empty">' + (State.projectSearch ? 'No projects match your search.' : 'No projects yet.') + '</td></tr>';

  // Pagination controls
  let pgHtml = `<span style="font-size:.78rem;color:var(--text-muted)">${total} project${total!==1?'s':''}</span>`;
  if (pages > 1) {
    pgHtml += `<button class="pg-btn" onclick="changePage(${State.projectPage-1})" ${State.projectPage===1?'disabled':''}>Prev</button>`;
    for (let i=1; i<=pages; i++) pgHtml += `<button class="pg-btn ${i===State.projectPage?'active':''}" onclick="changePage(${i})">${i}</button>`;
    pgHtml += `<button class="pg-btn" onclick="changePage(${State.projectPage+1})" ${State.projectPage===pages?'disabled':''}>Next</button>`;
  }
  $('project-pagination').innerHTML = pgHtml;

  enableTableDragSort('project-list-body', (from, to) => {
    const a = paged[from], b = paged[to];
    if (!a || !b) return;
    if (a._isGarden && b._isGarden) {
      const fi = State.gardens.findIndex(g => g.id === a._gardenId);
      const ti = State.gardens.findIndex(g => g.id === b._gardenId);
      if (fi >= 0 && ti >= 0) { arrayMove(State.gardens, fi, ti); saveGardens(); }
    } else if (a._isHW && b._isHW) {
      const fi = hwProjects.findIndex(p => p.id === a._hwId);
      const ti = hwProjects.findIndex(p => p.id === b._hwId);
      if (fi >= 0 && ti >= 0) { arrayMove(hwProjects, fi, ti); saveHWProjects(hwProjects); }
    } else if (a._isNB && b._isNB) {
      const fi = nbProjects.findIndex(p => p.id === a._nbId);
      const ti = nbProjects.findIndex(p => p.id === b._nbId);
      if (fi >= 0 && ti >= 0) { arrayMove(nbProjects, fi, ti); saveNBProjects(nbProjects); }
    } else if (!a._isGarden && !a._isHW && !a._isNB && !b._isGarden && !b._isHW && !b._isNB) {
      const fi = State.projects.findIndex(p => p.id === a.id);
      const ti = State.projects.findIndex(p => p.id === b.id);
      if (fi >= 0 && ti >= 0) { arrayMove(State.projects, fi, ti); DB.save(DB.keys(currentSiteId).projects, State.projects); }
    }
    renderProjectList();
  });
}

function changePage(n)   { State.projectPage = n; renderProjectList(); }
function sortProjects(f) {
  State.projectSort.dir   = State.projectSort.field === f && State.projectSort.dir === 'asc' ? 'desc' : 'asc';
  State.projectSort.field = f;
  renderProjectList();
}
async function deleteProject(id) {
  if (!confirm('Delete this project? This cannot be undone.')) return;
  UndoManager.push('delete project');
  const delP = State.projects.find(p => p.id === id);
  State.projects = State.projects.filter(p => p.id !== id);
  DB.save(DB.keys(currentSiteId).projects, State.projects);
  renderProjectList();
  if (delP) ActivityLog.add('delete', 'Deleted project <strong>' + esc(delP.projectName || 'Untitled') + '</strong>');
  toast('Project deleted');
  // Delete from Supabase
  setSyncStatus('syncing');
  const res = await SB.delete('projects?id=eq.' + id);
  setSyncStatus(res !== null ? 'synced' : 'error');
}

/* ── New / Edit Project Form ─────────────────────────────── */
function renderNewProjectForm(projectId) {
  // Always re-read the project fresh from storage so we show the latest saved data
  refreshProjectsFromStorage();
  editingProjectId = projectId || null;
  const p = projectId ? State.projects.find(x => x.id === projectId) : null;

  $('topbar-title').textContent = p ? 'Edit Project — ' + (p.projectName||'') : 'New Project';

  const FIELDS = [
    'projectNumber','projectName','description','category','priority','location',
    'estimatedBudget','approvedBudget','fundingSource','contractorName','contactPerson',
    'email','telephone','requestDate','quoteDueDate','startDate','completionDate','notes','status',
  ];

  if (!p) {
    FIELDS.forEach(f => { const el = $('f-'+f); if (el) el.value = ''; });
    const y = new Date().getFullYear(), seq = (State.projects.length+1).toString().padStart(3,'0');
    $('f-projectNumber').value = currentSite.prefix + '-' + y + '-' + seq;
    $('f-requestDate').value   = new Date().toISOString().split('T')[0];
    $('f-status').value        = 'Draft';
    $('quotes-container').innerHTML    = '<p class="hint-msg">Save the project first to add quotations.</p>';
    $('comparison-container').innerHTML = '';
    $('invoices-container').innerHTML  = '<p class="hint-msg">Save the project first to record invoices.</p>';
    $('photo-gallery').innerHTML       = '<p class="hint-msg">Save the project first to add photos.</p>';
    $('doc-list-inner').innerHTML      = '<p class="hint-msg">Save the project first to add documents.</p>';
    $('timeline-container').innerHTML  = '';
    $('activity-container').innerHTML  = '';
  } else {
    FIELDS.forEach(f => { const el = $('f-'+f); if (el) el.value = p[f] || ''; });
    renderQuotesInForm(p);
    renderPhotosInForm(p);
    renderDocsInForm(p);
    renderInvoicesInForm(p);
    renderTimelineInForm(p);
    renderActivityInForm(p);
    // WhatsApp button in form action bar
    const waFormEl = $('project-form-wa');
    if (waFormEl) {
      waFormEl.innerHTML = p.telephone
        ? waButtonGroup(p.telephone, p, 'project')
        : '<span style="font-size:.76rem;color:var(--text-muted)">Add phone number to enable WhatsApp</span>';
    }
  }
}

/* ── Save Project ────────────────────────────────────────── */
function saveProject() {
  const name = ($('f-projectName')?.value || '').trim();
  if (!name) { toast('Project name is required', 'error'); return; }
  UndoManager.push(editingProjectId ? 'edit project' : 'create project');

  // Capture form values first, before any re-render
  const data = buildFormData();
  const now  = new Date().toISOString();

  // Re-read storage to ensure we're working with the latest array
  refreshProjectsFromStorage();

  let p;
  if (editingProjectId) {
    p = State.projects.find(x => x.id === editingProjectId);
    if (!p) { toast('Project not found — it may have been deleted.', 'error'); return; }
    const oldStatus = p.status;
    Object.assign(p, data);       // merge form data, preserving quotes/photos/documents/activity
    p.dateUpdated = now;
    if (oldStatus !== p.status) {
      addActivity(p, `Status changed from "${oldStatus}" to "${p.status}"`);
      ActivityLog.add('status', '<strong>' + esc(p.projectName) + '</strong> status: ' + esc(oldStatus) + ' → ' + esc(p.status));
    } else {
      addActivity(p, 'Project details updated');
    }
  } else {
    p = { id:uid(), dateCreated:now, dateUpdated:now, quotes:[], photos:[], documents:[], activity:[], invoices:[], ...data };
    addActivity(p, 'Project created');
    ActivityLog.add('create', 'Created project <strong>' + esc(p.projectName) + '</strong>');
    State.projects.push(p);
    editingProjectId = p.id;
  }

  const ok = saveProjects();
  if (!ok) return;

  autoSaveContractor(p);
  toast('Project saved ✓');

  // Re-render so dynamic panels (quotes, photos, timeline, activity) update
  renderNewProjectForm(editingProjectId);
}

function buildFormData() {
  const g = id => ($('f-' + id)?.value || '').trim();
  return {
    projectNumber:   g('projectNumber'),   projectName:    g('projectName'),
    description:     g('description'),     category:       g('category'),
    priority:        g('priority'),        location:       g('location'),
    estimatedBudget: g('estimatedBudget'), approvedBudget: g('approvedBudget'),
    fundingSource:   g('fundingSource'),   contractorName: g('contractorName'),
    contactPerson:   g('contactPerson'),   email:          g('email'),
    telephone:       g('telephone'),       requestDate:    g('requestDate'),
    quoteDueDate:    g('quoteDueDate'),    startDate:      g('startDate'),
    completionDate:  g('completionDate'),  notes:          g('notes'),
    status:          g('status') || 'Draft',
  };
}

function addActivity(p, text) {
  if (!p.activity) p.activity = [];
  p.activity.unshift({ id:uid(), text, ts:new Date().toISOString() });
}

function duplicateProject() {
  if (!editingProjectId) return;
  refreshProjectsFromStorage();
  const orig = State.projects.find(p => p.id === editingProjectId);
  if (!orig) return;
  const now = new Date().toISOString();
  const seq = (State.projects.length+1).toString().padStart(3,'0');
  const copy = JSON.parse(JSON.stringify(orig));
  copy.id = uid();
  copy.projectNumber = currentSite.prefix + '-' + new Date().getFullYear() + '-' + seq;
  copy.projectName   = orig.projectName + ' (Copy)';
  copy.dateCreated   = now; copy.dateUpdated = now;
  copy.status        = 'Draft';
  copy.quotes = []; copy.photos = []; copy.documents = [];
  copy.activity = [{ id:uid(), text:'Duplicated from: ' + orig.projectName, ts:now }];
  State.projects.push(copy);
  saveProjects();
  ActivityLog.add('create', 'Duplicated project <strong>' + esc(copy.projectName) + '</strong>');
  toast('Project duplicated');
  navigate('newproject', copy.id);
}

/* ── Templates ───────────────────────────────────────────── */
const TEMPLATES = {
  'Classroom Upgrade':          { category:'Building Works',   priority:'Medium', description:'Upgrade and refurbish classroom to modern standards including painting, lighting, furniture and ICT infrastructure.' },
  'Building Renovation':        { category:'Building Works',   priority:'High',   description:'Full renovation of building structure including structural repairs, weatherproofing, and finishes.' },
  'Sports Facility Upgrade':    { category:'Capital Projects', priority:'Medium', description:'Upgrade sports facilities including surfaces, equipment, and drainage.' },
  'Garden Development':         { category:'Garden Projects',  priority:'Low',    description:'Development and planting of school garden areas for educational and environmental benefit.' },
  'Maintenance Request':        { category:'Maintenance',      priority:'Medium', description:'Reactive maintenance request. Identify fault, obtain quotes, carry out repair.' },
  'Health & Safety Compliance': { category:'Health & Safety',  priority:'High',   description:'Compliance works required to meet Health & Safety standards. Urgent attention required.' },
};
function applyTemplate() {
  const sel = $('template-select').value;
  if (!sel || !TEMPLATES[sel]) return;
  const t = TEMPLATES[sel];
  if (t.category)    $('f-category').value    = t.category;
  if (t.priority)    $('f-priority').value    = t.priority;
  if (t.description) $('f-description').value = t.description;
  if (!$('f-projectName').value) $('f-projectName').value = sel;
  toast('Template applied');
}

/* ── Quotations ──────────────────────────────────────────── */
function renderQuotesInForm(p) {
  const quotes = p.quotes || [];
  if (!quotes.length) {
    $('quotes-container').innerHTML = '<p style="color:var(--text-muted);font-size:.82rem;padding:8px 0">No quotations yet — click "+ Add Quotation" above.</p>';
    renderQuoteComparison(p);
    return;
  }
  const prices   = quotes.map(q => parseFloat(q.total||q.amount||0)).filter(v => v > 0);
  const minPrice = prices.length ? Math.min(...prices) : null;
  const maxWarr  = Math.max(...quotes.map(q => parseInt(q.warranty)||0));

  $('quotes-container').innerHTML = '<div class="quote-grid">' + quotes.map(q => {
    const tot = parseFloat(q.total||q.amount||0);
    const bp  = prices.length > 1 && minPrice !== null && tot === minPrice;
    const bw  = !bp && quotes.length > 1 && (parseInt(q.warranty)||0) === maxWarr && maxWarr > 0;
    return `<div class="quote-card ${bp?'best-price':bw?'best-warranty':''}">
      <div class="quote-contractor">${esc(q.contractor)}</div>
      <div class="quote-amount">${fmt.currency(q.total||q.amount)}</div>
      <div class="quote-meta"><span>Excl. VAT: ${fmt.currency(q.amount)}</span><span>VAT: ${fmt.currency(q.vat)}</span></div>
      <div class="quote-meta"><span>Lead time: ${esc(q.leadTime||'—')}</span><span>Warranty: ${q.warranty ? q.warranty+' months' : '—'}</span></div>
      ${q.notes ? `<div class="quote-meta" style="margin-top:6px">${esc(q.notes)}</div>` : ''}
      <div class="quote-actions">
        <button class="btn btn-sm btn-outline" onclick="editQuote('${p.id}','${q.id}')">Edit</button>
        <button class="btn btn-sm btn-danger"  onclick="deleteQuote('${p.id}','${q.id}')">Remove</button>
      </div>
    </div>`;
  }).join('') + '</div>';

  renderQuoteComparison(p);
}

function renderQuoteComparison(p) {
  const el = $('comparison-container'); if (!el) return;
  const quotes = (p.quotes||[]).filter(q => parseFloat(q.total||q.amount||0) > 0);
  if (quotes.length < 2) {
    el.innerHTML = '<p style="color:var(--text-muted);font-size:.82rem">Add at least two quotations to compare.</p>';
    return;
  }
  const sorted = [...quotes].sort((a,b) => parseFloat(a.total||a.amount||0) - parseFloat(b.total||b.amount||0));
  el.innerHTML = `<div class="table-wrap"><table><thead><tr>
    <th>Contractor</th><th>Excl. VAT</th><th>Total (incl. VAT)</th><th>Lead Time</th><th>Warranty</th>
  </tr></thead><tbody>
    ${sorted.map((q,i) => `<tr style="${i===0?'background:#f2f8eb':''}">
      <td><strong>${esc(q.contractor)}</strong>${i===0?' <span class="badge badge-approved" style="margin-left:6px">Lowest</span>':''}</td>
      <td>${fmt.currency(q.amount)}</td>
      <td><strong>${fmt.currency(q.total||q.amount)}</strong></td>
      <td>${esc(q.leadTime||'—')}</td>
      <td>${q.warranty ? q.warranty+' months' : '—'}</td>
    </tr>`).join('')}
  </tbody></table></div>
  <div style="margin-top:16px">
    <label style="font-weight:700;color:var(--pk-green);font-size:.88rem">Recommended Contractor &amp; Reasoning</label>
    <textarea id="recommendation-text" style="margin-top:8px;width:100%;min-height:70px" placeholder="Enter your recommendation and reasoning...">${esc(p.recommendation||'')}</textarea>
    <button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="saveRecommendation('${p.id}')">Save Recommendation</button>
  </div>`;
}

function saveRecommendation(pid) {
  refreshProjectsFromStorage();
  const p = State.projects.find(x => x.id === pid); if (!p) return;
  p.recommendation = $('recommendation-text').value;
  p.dateUpdated = new Date().toISOString();
  saveProjects();
  toast('Recommendation saved');
}

function openAddQuote() {
  if (!editingProjectId) { toast('Save the project first', 'warning'); return; }
  ['qf-id','qf-contractor','qf-leadTime','qf-warranty','qf-notes','qf-amount','qf-vat','qf-total']
    .forEach(id => { const el=$(id); if(el) el.value=''; });
  $('qf-dateReceived').value = new Date().toISOString().split('T')[0];
  $('quote-modal-title').textContent = 'Add Quotation';
  openModal('quote-modal');
}

function editQuote(pid, qid) {
  refreshProjectsFromStorage();
  const p = State.projects.find(x => x.id === pid);
  const q = (p.quotes||[]).find(x => x.id === qid);
  if (!q) return;
  $('qf-id').value           = q.id;
  $('qf-contractor').value   = q.contractor  || '';
  $('qf-dateReceived').value = q.dateReceived|| '';
  $('qf-amount').value       = q.amount      || '';
  $('qf-vat').value          = q.vat         || '';
  $('qf-total').value        = q.total       || '';
  $('qf-leadTime').value     = q.leadTime    || '';
  $('qf-warranty').value     = q.warranty    || '';
  $('qf-notes').value        = q.notes       || '';
  $('quote-modal-title').textContent = 'Edit Quotation';
  openModal('quote-modal');
}

function saveQuote() {
  refreshProjectsFromStorage();
  const p = State.projects.find(x => x.id === editingProjectId); if (!p) return;
  if (!p.quotes) p.quotes = [];
  const contractor = ($('qf-contractor').value || '').trim();
  if (!contractor) { toast('Contractor name is required', 'error'); return; }
  const existingId = $('qf-id').value;
  const data = {
    id:           existingId || uid(),
    contractor,
    dateReceived: $('qf-dateReceived').value,
    amount:       $('qf-amount').value,
    vat:          $('qf-vat').value,
    total:        $('qf-total').value,
    leadTime:     $('qf-leadTime').value,
    warranty:     $('qf-warranty').value,
    notes:        $('qf-notes').value,
  };
  if (existingId) {
    const idx = p.quotes.findIndex(x => x.id === existingId);
    if (idx >= 0) p.quotes[idx] = data; else p.quotes.push(data);
  } else {
    p.quotes.push(data);
  }
  addActivity(p, (existingId ? 'Quote updated: ' : 'Quote added: ') + contractor);
  p.dateUpdated = new Date().toISOString();
  saveProjects();
  closeModal('quote-modal');
  renderQuotesInForm(p);
  toast('Quote saved');
}

function deleteQuote(pid, qid) {
  if (!confirm('Remove this quotation?')) return;
  refreshProjectsFromStorage();
  const p = State.projects.find(x => x.id === pid); if (!p) return;
  p.quotes = (p.quotes||[]).filter(q => q.id !== qid);
  addActivity(p, 'Quote removed');
  p.dateUpdated = new Date().toISOString();
  saveProjects();
  renderQuotesInForm(p);
  toast('Quote removed');
}

function calcQuoteTotal() {
  const a = parseFloat($('qf-amount').value) || 0;
  const v = a * 0.15;
  $('qf-vat').value   = v.toFixed(2);
  $('qf-total').value = (a + v).toFixed(2);
}

/* ── Invoice / Actual Spend Tracking ─────────────────────── */
function renderInvoicesInForm(p) {
  const container = $('invoices-container'); if (!container) return;
  const invoices  = p.invoices || [];
  const totalPaid = invoices.reduce((s, i) => s + parseFloat(i.amount||0), 0);
  const budget    = parseFloat(p.approvedBudget || p.estimatedBudget || 0);
  const variance  = budget - totalPaid;
  const pct       = budget > 0 ? Math.min((totalPaid / budget) * 100, 100) : 0;
  const overBudget = totalPaid > budget && budget > 0;

  let html = `
    <div class="budget-tracker">
      <div class="budget-tracker-row">
        <div class="budget-col">
          <div class="budget-label">Budget</div>
          <div class="budget-amount">${budget ? fmt.currency(budget) : '—'}</div>
        </div>
        <div class="budget-col">
          <div class="budget-label">Actual Spend</div>
          <div class="budget-amount ${overBudget?'over':''}">${fmt.currency(totalPaid)}</div>
        </div>
        <div class="budget-col">
          <div class="budget-label">Variance</div>
          <div class="budget-amount ${overBudget?'over':'under'}">${overBudget?'-':''}${fmt.currency(Math.abs(variance))}</div>
        </div>
        <div class="budget-col">
          <div class="budget-label">Spent</div>
          <div class="budget-amount">${pct.toFixed(0)}%</div>
        </div>
      </div>
      <div class="budget-bar-outer">
        <div class="budget-bar-inner ${overBudget?'over':''}" style="width:${pct.toFixed(1)}%"></div>
      </div>
    </div>`;

  if (invoices.length) {
    html += `<div class="invoice-list">` + invoices.map(inv => `
      <div class="invoice-item">
        <span class="invoice-ref">${esc(inv.ref||'—')}</span>
        <span class="invoice-supplier">${esc(inv.supplier||'—')}</span>
        <span class="invoice-date">${fmt.date(inv.date)}</span>
        <span class="invoice-amount"><strong>${fmt.currency(inv.amount)}</strong></span>
        <span class="invoice-status badge badge-${inv.paid?'approved':'awaiting-approval'}">${inv.paid?'Paid':'Pending'}</span>
        <button class="btn btn-xs btn-outline" onclick="editInvoice('${p.id}','${inv.id}')">Edit</button>
        <button class="btn btn-xs btn-danger"  onclick="deleteInvoice('${p.id}','${inv.id}')">Remove</button>
      </div>`).join('') + `</div>`;
  } else {
    html += `<p style="color:var(--text-muted);font-size:.82rem;padding:8px 0">No invoices recorded yet.</p>`;
  }

  container.innerHTML = html;
}

function openAddInvoice() {
  if (!editingProjectId) { toast('Save the project first', 'warning'); return; }
  ['if-id','if-ref','if-supplier','if-amount','if-notes'].forEach(id => { const el=$(id); if(el) el.value=''; });
  $('if-date').value = new Date().toISOString().split('T')[0];
  $('if-paid').checked = false;
  $('invoice-modal-title').textContent = 'Add Invoice';
  openModal('invoice-modal');
}

function editInvoice(pid, iid) {
  refreshProjectsFromStorage();
  const p   = State.projects.find(x => x.id === pid);
  const inv = (p.invoices||[]).find(x => x.id === iid);
  if (!inv) return;
  $('if-id').value       = inv.id;
  $('if-ref').value      = inv.ref      || '';
  $('if-supplier').value = inv.supplier || '';
  $('if-date').value     = inv.date     || '';
  $('if-amount').value   = inv.amount   || '';
  $('if-paid').checked   = !!inv.paid;
  $('if-notes').value    = inv.notes    || '';
  $('invoice-modal-title').textContent = 'Edit Invoice';
  openModal('invoice-modal');
}

function saveInvoice() {
  refreshProjectsFromStorage();
  const p = State.projects.find(x => x.id === editingProjectId); if (!p) return;
  if (!p.invoices) p.invoices = [];
  const amount = parseFloat($('if-amount').value);
  if (!amount || isNaN(amount)) { toast('Amount is required', 'error'); return; }
  const existingId = $('if-id').value;
  const data = {
    id:       existingId || uid(),
    ref:      ($('if-ref').value     || '').trim(),
    supplier: ($('if-supplier').value|| '').trim(),
    date:      $('if-date').value,
    amount:    $('if-amount').value,
    paid:      $('if-paid').checked,
    notes:    ($('if-notes').value   || '').trim(),
  };
  if (existingId) {
    const idx = p.invoices.findIndex(x => x.id === existingId);
    if (idx >= 0) p.invoices[idx] = data; else p.invoices.push(data);
  } else {
    p.invoices.push(data);
  }
  addActivity(p, (existingId?'Invoice updated: ':'Invoice added: ') + fmt.currency(data.amount));
  p.dateUpdated = new Date().toISOString();
  saveProjects();
  closeModal('invoice-modal');
  renderInvoicesInForm(p);
  toast('Invoice saved');
}

function deleteInvoice(pid, iid) {
  if (!confirm('Remove this invoice?')) return;
  refreshProjectsFromStorage();
  const p = State.projects.find(x => x.id === pid); if (!p) return;
  p.invoices = (p.invoices||[]).filter(i => i.id !== iid);
  addActivity(p, 'Invoice removed');
  p.dateUpdated = new Date().toISOString();
  saveProjects();
  renderInvoicesInForm(p);
  toast('Invoice removed');
}
function renderPhotosInForm(p) {
  const photos = p.photos || [];
  $('photo-gallery').innerHTML = photos.length
    ? '<div class="photo-grid">' + photos.map(ph => `
        <div class="photo-thumb">
          <img src="${ph.data}" alt="${esc(ph.label||'photo')}" onclick="openLightbox('${ph.id}')">
          <div class="photo-label">${esc(ph.label||'Photo')}</div>
          <button class="photo-delete-btn" onclick="deletePhoto('${p.id}','${ph.id}')" title="Remove">&#215;</button>
        </div>`).join('') + '</div>'
    : '<p style="color:var(--text-muted);font-size:.82rem;margin-top:4px">No photos attached yet.</p>';
}

function triggerPhotoUpload() {
  if (!editingProjectId) { toast('Save the project first', 'warning'); return; }
  $('photo-file-input').click();
}

function handlePhotoUpload(e) { processPhotoFiles(e.target.files); e.target.value = ''; }

function processPhotoFiles(files) {
  const arr = Array.from(files).filter(f => f.type.startsWith('image/'));
  if (!arr.length) { toast('Please select image files (JPEG, PNG, WEBP)', 'warning'); return; }
  refreshProjectsFromStorage();
  const p = State.projects.find(x => x.id === editingProjectId); if (!p) return;
  if (!p.photos) p.photos = [];
  const category = $('photo-category')?.value || 'General';
  let done = 0;

  arr.forEach(file => {
    const reader = new FileReader();
    reader.onerror = () => { done++; if (done === arr.length) finalisePhotoUpload(p, done); };
    reader.onload  = ev => {
      // ── Compress via canvas before storing ──
      const img = new Image();
      img.onerror = () => {
        // Fallback: store uncompressed
        p.photos.push({ id:uid(), data:ev.target.result, label:category, fileName:file.name, ts:new Date().toISOString() });
        done++; if (done === arr.length) finalisePhotoUpload(p, done);
      };
      img.onload = () => {
        const MAX_W = 900, QUALITY = 0.72;
        let { width, height } = img;
        if (width > MAX_W) { height = Math.round(height * MAX_W / width); width = MAX_W; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL('image/jpeg', QUALITY);
        const origKB  = Math.round(ev.target.result.length * 0.75 / 1024);
        const compKB  = Math.round(compressed.length     * 0.75 / 1024);
        console.log(`Photo compressed: ${origKB}KB → ${compKB}KB (${Math.round(compKB/origKB*100)}%)`);
        p.photos.push({ id:uid(), data:compressed, label:category, fileName:file.name, ts:new Date().toISOString(), origKB, compKB });
        done++; if (done === arr.length) finalisePhotoUpload(p, done);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function finalisePhotoUpload(p, count) {
  addActivity(p, count + ' photo(s) uploaded (compressed)');
  p.dateUpdated = new Date().toISOString();
  if (saveProjects()) renderPhotosInForm(p);
  toast(count + ' photo(s) uploaded');
}

function openLightbox(photoId) {
  refreshProjectsFromStorage();
  const p  = State.projects.find(x => x.id === editingProjectId); if (!p) return;
  const ph = p.photos.find(x => x.id === photoId); if (!ph) return;
  const lb = $('lightbox');
  lb.querySelector('img').src = ph.data;
  lb.classList.add('open');
}

function deletePhoto(pid, phid) {
  if (!confirm('Remove this photo?')) return;
  refreshProjectsFromStorage();
  const p = State.projects.find(x => x.id === pid); if (!p) return;
  p.photos = (p.photos||[]).filter(ph => ph.id !== phid);
  addActivity(p, 'Photo removed');
  p.dateUpdated = new Date().toISOString();
  saveProjects();
  renderPhotosInForm(p);
  toast('Photo removed');
}

/* ── Documents ───────────────────────────────────────────── */
/* ── Documents — metadata-only storage (no base64 in localStorage) ─────────
   Files are held in a session Map as Object URLs. Metadata (name, size, type,
   date) is saved to localStorage. On page reload the file list shows but
   download links are unavailable until re-uploaded — a note explains this.
   This avoids filling the 5 MB localStorage quota with binary data.          */
const _docBlobs = new Map(); // docId → { url, fileName }

function renderDocsInForm(p) {
  const docs = p.documents || [];
  const ext  = fn => (fn.split('.').pop() || 'file').toUpperCase().slice(0, 4);

  if (!docs.length) {
    $('doc-list-inner').innerHTML = '<p style="color:var(--text-muted);font-size:.82rem;margin-top:4px">No documents attached yet.</p>';
    return;
  }

  $('doc-list-inner').innerHTML = '<div class="doc-items-list">' + docs.map(d => {
    const hasBlob = _docBlobs.has(d.id);
    const sizeStr = d.size ? ' · ' + (d.size > 1024*1024 ? (d.size/1024/1024).toFixed(1)+'MB' : (d.size/1024).toFixed(0)+'KB') : '';
    return `<div class="doc-item">
      <span class="doc-ext">${ext(d.fileName)}</span>
      <span class="doc-name">${esc(d.fileName)}<span class="doc-meta">${sizeStr}</span></span>
      <span class="doc-meta">${fmt.date(d.ts)}</span>
      ${hasBlob
        ? `<a class="btn btn-xs btn-outline" href="${_docBlobs.get(d.id).url}" target="_blank">View</a>
           <a class="btn btn-xs btn-secondary" href="${_docBlobs.get(d.id).url}" download="${esc(d.fileName)}">Download</a>`
        : `<span class="doc-meta" style="font-style:italic" title="Re-upload to view or download">Session ended</span>`}
      <button class="btn btn-xs btn-danger" onclick="deleteDoc('${p.id}','${d.id}')">Remove</button>
    </div>`;
  }).join('') + '</div>';
}

function triggerDocUpload() {
  if (!editingProjectId) { toast('Save the project first', 'warning'); return; }
  $('doc-file-input').click();
}

function handleDocUpload(e) { processDocFiles(e.target.files); e.target.value = ''; }

function processDocFiles(files) {
  const arr = Array.from(files); if (!arr.length) return;
  refreshProjectsFromStorage();
  const p = State.projects.find(x => x.id === editingProjectId); if (!p) return;
  if (!p.documents) p.documents = [];

  arr.forEach(file => {
    const id  = uid();
    const url = URL.createObjectURL(file);
    _docBlobs.set(id, { url, fileName: file.name });

    // Only save metadata — NOT the file contents — so localStorage stays small
    p.documents.push({
      id,
      fileName: file.name,
      type:     file.type,
      size:     file.size,
      ts:       new Date().toISOString(),
    });
  });

  addActivity(p, arr.length + ' document(s) attached');
  p.dateUpdated = new Date().toISOString();
  if (saveProjects()) renderDocsInForm(p);
  toast(arr.length + ' document(s) attached');
}

function deleteDoc(pid, did) {
  if (!confirm('Remove this document?')) return;
  refreshProjectsFromStorage();
  const p = State.projects.find(x => x.id === pid); if (!p) return;
  // Revoke blob URL to free memory
  if (_docBlobs.has(did)) { URL.revokeObjectURL(_docBlobs.get(did).url); _docBlobs.delete(did); }
  p.documents = (p.documents||[]).filter(d => d.id !== did);
  addActivity(p, 'Document removed');
  p.dateUpdated = new Date().toISOString();
  saveProjects();
  renderDocsInForm(p);
  toast('Document removed');
}

/* ── Timeline & Gantt ────────────────────────────────────── */
function renderTimelineInForm(p) {
  const events = [
    { label:'Project Created',  date:p.dateCreated,    done:true },
    { label:'Quotes Requested', date:p.quoteDueDate,   done:!!p.quoteDueDate && p.status!=='Draft' },
    { label:'Quotes Received',  date:null,              done:['Quotes Received','Awaiting Approval','Approved','In Progress','Completed'].includes(p.status) },
    { label:'Approved',         date:null,              done:['Approved','In Progress','Completed'].includes(p.status) },
    { label:'Work Started',     date:p.startDate,       done:['In Progress','Completed'].includes(p.status) },
    { label:'Work Completed',   date:p.completionDate,  done:p.status==='Completed' },
  ];
  $('timeline-container').innerHTML = '<div class="timeline">' + events.map(e => `
    <div class="tl-item">
      <div class="tl-dot ${e.done?'':'pending'}"></div>
      <div class="tl-date">${e.date ? fmt.date(e.date) : (e.done ? 'Done' : 'Pending')}</div>
      <div class="tl-title" style="${!e.done?'color:var(--text-muted)':''}">${e.label}</div>
    </div>`).join('') + '</div>';
  setTimeout(renderGantt, 0);
}

function toggleGanttPanel() {
  const panel = $('gantt-sub-panel'); if (!panel) return;
  panel.classList.toggle('collapsed');
}

function renderGantt() {
  const container = $('gantt-container'); if (!container) return;
  const reqDate   = $('f-requestDate')?.value   || '';
  const quoteDate = $('f-quoteDueDate')?.value  || '';
  const startDate = $('f-startDate')?.value     || '';
  const endDate   = $('f-completionDate')?.value|| '';

  const filled = [reqDate, quoteDate, startDate, endDate].filter(Boolean);
  if (filled.length < 2) {
    container.innerHTML = '<p class="gantt-no-dates">Enter at least two project dates above to generate the Gantt chart.</p>';
    return;
  }

  const allMs  = filled.map(d => new Date(d).getTime());
  const rStart = new Date(Math.min(...allMs));
  const rEnd   = new Date(Math.max(...allMs));
  rStart.setDate(rStart.getDate() - 2);
  rEnd.setDate(rEnd.getDate() + 2);
  const spanMs = rEnd.getTime() - rStart.getTime();
  if (spanMs <= 0) { container.innerHTML = '<p class="gantt-no-dates">Invalid date range.</p>'; return; }

  function barPct(s, e) {
    if (!s || !e) return null;
    const sd = new Date(s), ed = new Date(e);
    if (sd >= ed) return null;
    const left  = Math.max(0, (sd - rStart) / spanMs * 100);
    const right = Math.min(100, (ed - rStart) / spanMs * 100);
    if (right <= left) return null;
    return { left: left.toFixed(2)+'%', width: (right-left).toFixed(2)+'%' };
  }

  // Month ruler ticks
  const rulerTicks = [];
  const cur = new Date(rStart.getFullYear(), rStart.getMonth(), 1);
  while (cur <= rEnd) {
    const pctPos = (cur - rStart) / spanMs * 100;
    if (pctPos >= 0 && pctPos <= 100)
      rulerTicks.push({ label: cur.toLocaleDateString('en-ZA',{month:'short',year:'2-digit'}), pct: pctPos.toFixed(2) });
    cur.setMonth(cur.getMonth() + 1);
  }

  // Phases
  const phases = [];
  if (reqDate && quoteDate  && new Date(reqDate) < new Date(quoteDate))   phases.push({label:'Planning & Quotes', cls:'bar-planning', color:'#1565c0', s:reqDate,   e:quoteDate});
  if (quoteDate && startDate && new Date(quoteDate) < new Date(startDate)) phases.push({label:'Approval Stage',   cls:'bar-approval', color:'#6a1b9a', s:quoteDate, e:startDate});
  if (startDate && endDate  && new Date(startDate) < new Date(endDate))   phases.push({label:'Construction Works',cls:'bar-works',   color:'#1F3D1D', s:startDate, e:endDate});
  if (!phases.length) phases.push({label:'Project Duration', cls:'bar-works', color:'#1F3D1D', s:filled[0], e:filled[filled.length-1]});

  const today    = new Date();
  const todayPct = (today - rStart) / spanMs * 100;
  const showToday = todayPct >= 0 && todayPct <= 100;

  const ticksHtml = rulerTicks.map(m =>
    `<div style="position:absolute;left:${m.pct}%;top:0;bottom:0;border-left:1px solid rgba(255,255,255,.25);padding-left:3px;font-size:.62rem;color:rgba(255,255,255,.75);white-space:nowrap;overflow:hidden">${m.label}</div>`
  ).join('');

  const rowsHtml = phases.map(ph => {
    const b = barPct(ph.s, ph.e);
    return `<div class="gantt-row">
      <div class="gantt-label-cell">${ph.label}</div>
      <div class="gantt-track">
        ${showToday ? `<div class="gantt-today-marker" style="left:${todayPct.toFixed(2)}%"><div class="gantt-today-tip">Today</div></div>` : ''}
        ${b ? `<div class="gantt-bar ${ph.cls}" style="left:${b.left};width:${b.width}">${ph.label}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  const legendHtml = phases.map(ph =>
    `<div class="gantt-legend-item"><div class="gantt-legend-dot" style="background:${ph.color}"></div><span>${ph.label}</span></div>`
  ).join('') + (showToday ? '<div class="gantt-legend-item"><div class="gantt-legend-dot" style="background:#e53935;border-radius:50%"></div><span>Today</span></div>' : '');

  container.innerHTML = `
    <div class="gantt-wrap">
      <div class="gantt-ruler"><div class="gantt-ruler-label">Phase</div><div class="gantt-ruler-track">${ticksHtml}</div></div>
      ${rowsHtml}
    </div>
    <div class="gantt-legend">${legendHtml}</div>`;
}

/* ── Activity Log ────────────────────────────────────────── */
function renderActivityInForm(p) {
  const log = (p.activity||[]).slice(0,30);
  $('activity-container').innerHTML = log.length
    ? '<div class="activity-list">' + log.map(a => `
        <div class="activity-item">
          <div class="activity-dot"></div>
          <div class="activity-text"><strong>${esc(a.text)}</strong></div>
          <div class="activity-time">${fmt.dateTime(a.ts)}</div>
        </div>`).join('') + '</div>'
    : '<p style="color:var(--text-muted);font-size:.82rem">No activity recorded yet.</p>';
}

/* ── Contractors ─────────────────────────────────────────── */
function autoSaveContractor(project) {
  if (!project.contractorName) return;
  const exists = State.contractors.find(c => c.name.toLowerCase() === project.contractorName.toLowerCase());
  if (!exists) {
    State.contractors.push({ id:uid(), name:project.contractorName, contactPerson:project.contactPerson, email:project.email, telephone:project.telephone, notes:'', dateAdded:new Date().toISOString() });
    saveContractors();
  }
}
function renderContractors() {
  const c = $('contractor-grid'); if (!c) return;
  if (!State.contractors.length) {
    c.innerHTML = '<div class="empty-state"><div class="empty-icon">🏗</div><h3>No contractors yet</h3><p>Contractors are automatically saved when you add contractor details to a project.</p><button class="btn btn-primary btn-sm" onclick="navigate(\'projects\')">Go to Projects</button></div>';
    return;
  }
  c.innerHTML = State.contractors.map(con => {
    const projs = State.projects.filter(p => p.contractorName && p.contractorName.toLowerCase() === con.name.toLowerCase());
    const spend = projs.reduce((s,p) => s + parseFloat(p.approvedBudget||p.estimatedBudget||0), 0);
    var initials = con.name.split(/\s+/).map(w=>w[0]).join('').substring(0,2).toUpperCase();
    var hue = (con.name.charCodeAt(0)*37 + (con.name.charCodeAt(1)||0)*59) % 360;
    return `<div class="contractor-card">
      <div class="contractor-card-header">
        <div class="con-avatar" style="background:hsl(${hue},45%,42%)">${initials}</div>
        <div class="contractor-name">${esc(con.name)}</div>
      </div>
      <div class="contractor-meta">
        ${con.contactPerson ? 'Contact: '+esc(con.contactPerson)+'<br>' : ''}
        ${con.email ? 'Email: <a href="mailto:'+esc(con.email)+'">'+esc(con.email)+'</a><br>' : ''}
        ${con.telephone ? 'Tel: '+esc(con.telephone) : ''}
      </div>
      <div class="contractor-stats">
        <div class="con-stat"><div class="n">${projs.length}</div><div class="l">Projects</div></div>
        <div class="con-stat"><div class="n">${fmt.currency(spend)}</div><div class="l">Total Value</div></div>
      </div>
      <div style="margin-top:12px">
        <label style="font-size:.76rem;font-weight:600;color:var(--text-muted)">Performance Notes</label>
        <textarea id="con-notes-${con.id}" style="margin-top:6px;font-size:.8rem;min-height:60px;width:100%">${esc(con.notes||'')}</textarea>
        <button class="btn btn-sm btn-primary" style="margin-top:6px" onclick="saveContractorNotes('${con.id}')">Save Notes</button>
      </div>
    </div>`;
  }).join('');
}
function saveContractorNotes(id) {
  const c = State.contractors.find(x => x.id === id); if (!c) return;
  UndoManager.push('edit contractor notes');
  c.notes = $('con-notes-'+id).value;
  saveContractors();
  toast('Notes saved');
}

/* ── Gardens ─────────────────────────────────────────────── */
function renderGardens() {
  const g = $('garden-grid'); if (!g) return;
  if (!State.gardens.length) {
    g.innerHTML = '<div class="empty-state"><div class="empty-icon">&#127807;</div><h3>No garden projects yet</h3><p>Track plantings, maintenance, and landscaping work.</p><button class="btn btn-primary btn-sm" onclick="openGardenModal()">+ New Garden Project</button></div>';
    return;
  }

  g.innerHTML = State.gardens.map(function(gn) {
    var id = gn.id;

    // ── Harvest badge ──────────────────────────────────────
    var harvestBadge = '';
    if (gn.harvestDate) {
      var hd = Math.ceil((new Date(gn.harvestDate) - new Date()) / 86400000);
      if      (hd < 0)  harvestBadge = '<span class="garden-badge harvest-past">Harvested</span>';
      else if (hd === 0) harvestBadge = '<span class="garden-badge harvest-today">Harvest today!</span>';
      else if (hd <= 7)  harvestBadge = '<span class="garden-badge harvest-soon">' + hd + 'd to harvest</span>';
      else               harvestBadge = '<span class="garden-badge harvest-ok">' + hd + ' days to harvest</span>';
    }

    // ── Planting badge ─────────────────────────────────────
    var plantBadge = '';
    if (gn.plantingDate) {
      var pd = Math.ceil((new Date(gn.plantingDate) - new Date()) / 86400000);
      if (pd > 0) plantBadge = '<span class="garden-badge plant-upcoming">Planting in ' + pd + 'd</span>';
    }

    // ── Contact / Cell ─────────────────────────────────────
    var contactHtml = '';
    if (gn.contactPerson || gn.cellNumber) {
      contactHtml = '<div class="gcf-row">'
        + '<span class="gcf-label">Contact</span>'
        + '<span class="gcf-val">'
        + (gn.contactPerson ? esc(gn.contactPerson) : '')
        + (gn.cellNumber    ? (gn.contactPerson ? ' &middot; ' : '') + esc(gn.cellNumber) : '')
        + '</span></div>';
    }

    // ── Header ─────────────────────────────────────────────
    var html = '<div class="garden-card-full" draggable="true" data-id="' + id + '">';
    html += '<div class="gcf-header">';
    html += '<span class="drag-handle" title="Drag to reorder">&#9776;</span>';
    html += '<div>';
    html += '<div class="gcf-name">' + esc(gn.gardenName) + '</div>';
    html += '<div class="gcf-location">' + esc(gn.location || '');
    if (gn.areaSize) html += ' <span class="gcf-area">' + esc(gn.areaSize) + ' m\u00b2</span>';
    html += '</div>';
    html += '</div>';
    html += '<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">';
    if (gn.status) html += '<span class="garden-badge" style="background:var(--asp-green);color:#fff">' + esc(gn.status) + '</span>';
    if (gn.priority) html += '<span class="garden-badge" style="background:' + (gn.priority==='High'?'var(--danger)':gn.priority==='Medium'?'#e67e22':'var(--text-muted)') + ';color:#fff">' + esc(gn.priority) + '</span>';
    html += harvestBadge + plantBadge;
    html += '</div></div>';

    // ── Scope of Work section (collapsible panel) ─────────
    var gscopeItems = gn.scopeItems || [];
    var gscopeDone = gscopeItems.filter(function(s){return s.done}).length;
    if (gn.scopeDescription || gn.startDate || gn.targetDate || gn.scopeNotes || gscopeItems.length) {
      var gscopePct = gscopeItems.length ? Math.round(gscopeDone / gscopeItems.length * 100) : null;
      html += '<div class="panel" style="margin:10px 14px;border-radius:var(--radius-sm)">';
      html += '<div class="panel-header" style="padding:8px 12px;font-size:.78rem">';
      html += '<span class="panel-title" style="font-size:.78rem">Scope of Work' + (gscopeItems.length ? ' (' + gscopeDone + '/' + gscopeItems.length + ' done)' : '') + '</span>';
      html += '<span class="panel-toggle">&#9660;</span>';
      html += '</div>';
      html += '<div class="panel-body" style="padding:10px 12px">';
      if (gn.scopeDescription) html += '<p style="font-size:.8rem;color:var(--text-secondary);line-height:1.5;margin-bottom:' + (gscopeItems.length || gn.startDate ? '10px' : '0') + '">' + esc(gn.scopeDescription) + '</p>';
      if (gn.startDate || gn.targetDate) {
        html += '<div class="gcf-grid" style="margin-bottom:8px">';
        if (gn.startDate)  html += '<div class="gcf-item"><div class="gcf-label">Start Date</div><div class="gcf-val">' + fmt.date(gn.startDate) + '</div></div>';
        if (gn.targetDate) html += '<div class="gcf-item"><div class="gcf-label">Target Completion</div><div class="gcf-val">' + fmt.date(gn.targetDate) + '</div></div>';
        html += '</div>';
      }
      if (gscopeItems.length) {
        html += '<div class="hw-scope-list">';
        html += gscopeItems.map(function(s,i) {
          return '<label class="hw-scope-item"><input type="checkbox" ' + (s.done?'checked':'') + ' onchange="toggleGardenScopeItem(\'' + id + '\',' + i + ',this.checked)" style="accent-color:var(--pk-green)"><span style="' + (s.done?'text-decoration:line-through;color:var(--text-muted)':'') + '">' + esc(s.text) + '</span></label>';
        }).join('');
        html += '</div>';
      }
      if (gscopePct !== null) html += '<div style="margin-top:8px;height:5px;background:var(--platinum);border-radius:3px;overflow:hidden"><div style="height:100%;width:' + gscopePct + '%;background:var(--pk-green);border-radius:3px;transition:width .3s"></div></div>';
      if (gn.scopeNotes) html += '<div style="font-size:.78rem;color:var(--text-muted);margin-top:6px;font-style:italic">' + esc(gn.scopeNotes) + '</div>';
      html += '</div></div>';
    }

    // ── Planting section ───────────────────────────────────
    if (gn.crop || gn.plantingDate || gn.harvestDate) {
      html += '<div class="gcf-section">';
      html += '<div class="gcf-section-title">Planting</div>';
      html += '<div class="gcf-grid">';
      if (gn.crop)         html += '<div class="gcf-item"><div class="gcf-label">Crop / Plant</div><div class="gcf-val">' + esc(gn.crop) + '</div></div>';
      if (gn.plantingDate) html += '<div class="gcf-item"><div class="gcf-label">Planting Date</div><div class="gcf-val">' + fmt.date(gn.plantingDate) + '</div></div>';
      if (gn.harvestDate)  html += '<div class="gcf-item"><div class="gcf-label">Expected Harvest</div><div class="gcf-val">' + fmt.date(gn.harvestDate) + '</div></div>';
      html += '</div></div>';
    }

    // ── Maintenance section ────────────────────────────────
    if (gn.wateringSchedule || gn.weedingSchedule || gn.fertiliserSchedule || gn.pestControlNotes) {
      html += '<div class="gcf-section">';
      html += '<div class="gcf-section-title">Maintenance</div>';
      if (gn.wateringSchedule)   html += '<div class="gcf-row"><span class="gcf-label">Watering</span><span class="gcf-val">' + esc(gn.wateringSchedule) + '</span></div>';
      if (gn.weedingSchedule)    html += '<div class="gcf-row"><span class="gcf-label">Weeding</span><span class="gcf-val">' + esc(gn.weedingSchedule) + '</span></div>';
      if (gn.fertiliserSchedule) html += '<div class="gcf-row"><span class="gcf-label">Fertiliser</span><span class="gcf-val">' + esc(gn.fertiliserSchedule) + '</span></div>';
      if (gn.pestControlNotes)   html += '<div class="gcf-row"><span class="gcf-label">Pest Control</span><span class="gcf-val">' + esc(gn.pestControlNotes) + '</span></div>';
      html += '</div>';
    }

    // ── Educational Value section ──────────────────────────
    if (gn.gradeLevel || gn.subjectLinks || gn.curriculumNotes) {
      html += '<div class="gcf-section">';
      html += '<div class="gcf-section-title">Educational Value</div>';
      html += '<div class="gcf-grid">';
      if (gn.gradeLevel)   html += '<div class="gcf-item"><div class="gcf-label">Grade Level</div><div class="gcf-val">' + esc(gn.gradeLevel) + '</div></div>';
      if (gn.subjectLinks) html += '<div class="gcf-item"><div class="gcf-label">Subjects</div><div class="gcf-val">' + esc(gn.subjectLinks) + '</div></div>';
      html += '</div>';
      if (gn.curriculumNotes) html += '<div class="gcf-curriculum">' + esc(gn.curriculumNotes) + '</div>';
      html += '</div>';
    }

    // ── Contact section ────────────────────────────────────
    if (contactHtml) {
      html += '<div class="gcf-section">';
      html += '<div class="gcf-section-title">Contact</div>';
      html += contactHtml;
      html += '</div>';
    }

    // ── Cost Analysis section ──────────────────────────────
    var budget = parseFloat(gn.budget || 0);
    var spent  = (gn.expenses || []).reduce(function(s,e){ return s + parseFloat(e.amount||0); }, 0);
    if (budget || spent) {
      var over   = spent > budget && budget > 0;
      var pct    = budget > 0 ? Math.min(spent / budget * 100, 100).toFixed(0) : null;
      var sqm    = parseFloat(gn.areaSize || 0);
      var perSqm = (sqm > 0 && spent > 0) ? fmt.currency(spent / sqm) + '/m\u00b2' : null;
      html += '<div class="gcf-section">';
      html += '<div class="gcf-section-title">Cost Analysis</div>';
      html += '<div class="gcf-grid" style="margin-bottom:' + (pct !== null ? '10px' : '0') + '">';
      if (budget) html += '<div class="gcf-item"><div class="gcf-label">Budget</div><div class="gcf-val">' + fmt.currency(budget) + '</div></div>';
      if (spent)  html += '<div class="gcf-item"><div class="gcf-label">Total Spent</div><div class="gcf-val" style="color:' + (over ? 'var(--danger)' : 'inherit') + ';font-weight:700">' + fmt.currency(spent) + '</div></div>';
      if (budget && spent) html += '<div class="gcf-item"><div class="gcf-label">' + (over ? 'Over Budget' : 'Remaining') + '</div><div class="gcf-val" style="color:' + (over ? 'var(--danger)' : '#2e7d32') + ';font-weight:700">' + fmt.currency(Math.abs(budget - spent)) + '</div></div>';
      if (perSqm) html += '<div class="gcf-item"><div class="gcf-label">Cost per m\u00b2</div><div class="gcf-val">' + perSqm + '</div></div>';
      html += '</div>';
      if (pct !== null) {
        html += '<div style="height:6px;background:var(--platinum);border-radius:3px;overflow:hidden">';
        html += '<div style="height:100%;width:' + pct + '%;background:' + (over ? 'var(--danger)' : 'var(--pk-green)') + ';border-radius:3px"></div></div>';
        html += '<div style="font-size:.7rem;color:' + (over ? 'var(--danger)' : 'var(--text-muted)') + ';margin-top:3px">' + pct + '% of budget</div>';
      }
      if ((gn.expenses || []).length) html += '<div style="margin-top:8px;font-size:.74rem;color:var(--text-muted)">' + gn.expenses.length + ' expense item' + (gn.expenses.length !== 1 ? 's' : '') + '</div>';
      html += '</div>';
    }

    // ── Footer ─────────────────────────────────────────────
    html += '<div class="gcf-footer">';
    html += '<span>Added ' + fmt.date(gn.dateAdded) + '</span>';
    html += '<div style="display:flex;gap:6px;align-items:center">';
    html += '<button class="btn btn-sm btn-outline" onclick="openGardenModal(\'' + id + '\')">Edit</button>';
    html += '<button class="btn btn-sm btn-danger" onclick="deleteGarden(\'' + id + '\')">Delete</button>';
    html += cardMenuHtml();
    html += '</div></div>';

    html += '</div>'; // /garden-card-full
    return html;
  }).join('');
  enableDragSort('garden-grid', '.garden-card-full', (from, to) => {
    arrayMove(State.gardens, from, to);
    saveGardens();
    renderGardens();
  });
}
function openGardenModal(id) {
  // Always refresh gardens from storage first
  State.gardens = DB.load(DB.keys(currentSiteId).gardens);
  const gn = id ? State.gardens.find(x => x.id === id) : null;
  $('garden-modal-title').textContent = gn ? 'Edit Garden Project' : 'New Garden Project';

  // Clear all fields first
  ['gardenName','location','areaSize','crop','plantingDate','harvestDate',
   'wateringSchedule','weedingSchedule','fertiliserSchedule','pestControlNotes',
   'gradeLevel','subjectLinks','curriculumNotes','budget','fundingSource',
   'contactPerson','cellNumber',
   'scopeDescription','status','priority','startDate','targetDate','scopeNotes']
    .forEach(f => { const el = $('gf-'+f); if (el) el.value = gn ? (gn[f]||'') : ''; });
  $('gf-id').value = id || '';

  // Switch to general tab FIRST so all panels are in correct visibility state
  switchGardenTab(document.querySelector('#garden-modal .gm-tab'), 'g-tab-general');

  // Render scope items and expense list
  renderGardenScopeList(gn ? gn.scopeItems || [] : []);
  renderGardenExpenseList(gn);

  // Delay cost calc until after modal is open and DOM settled
  setTimeout(() => {
    updateGardenCostSummary();
    updateCostPerSqm();
  }, 50);

  openModal('garden-modal');
}

function renderGardenScopeList(items) {
  const el = $('gf-scope-list'); if (!el) return;
  if (!items.length) { el.innerHTML = '<p class="hint-msg" style="margin-bottom:4px">No scope items yet. Click "+ Add Item" to start.</p>'; return; }
  el.innerHTML = items.map((s,i) => `<div class="hw-scope-row" data-idx="${i}">
    <input type="checkbox" class="hwsr-done" ${s.done?'checked':''} style="accent-color:var(--pk-green);flex-shrink:0">
    <input type="text" class="hwsr-text" value="${esc(s.text)}" placeholder="Scope item description…" style="flex:1">
    <button type="button" class="btn btn-xs btn-danger" onclick="this.closest('.hw-scope-row').remove()">&#215;</button>
  </div>`).join('');
}

function addGardenScopeItem() {
  const el = $('gf-scope-list');
  if (el.querySelector('.hint-msg')) el.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'hw-scope-row';
  row.innerHTML = `
    <input type="checkbox" class="hwsr-done" style="accent-color:var(--pk-green);flex-shrink:0">
    <input type="text" class="hwsr-text" placeholder="e.g. Clear beds, plant seedlings, install irrigation…" style="flex:1">
    <button type="button" class="btn btn-xs btn-danger" onclick="this.closest('.hw-scope-row').remove()">&#215;</button>`;
  el.appendChild(row);
  row.querySelector('.hwsr-text').focus();
}

function toggleGardenScopeItem(gardenId, idx, checked) {
  const gn = State.gardens.find(x => x.id === gardenId);
  if (gn && gn.scopeItems && gn.scopeItems[idx] !== undefined) {
    gn.scopeItems[idx].done = checked;
    saveGardens();
    renderGardens();
  }
}

function collectGardenScopeItems() {
  return Array.from(document.querySelectorAll('#gf-scope-list .hw-scope-row')).map(row => ({
    text: row.querySelector('.hwsr-text')?.value || '',
    done: row.querySelector('.hwsr-done')?.checked || false,
  })).filter(s => s.text.trim());
}

function saveGarden() {
  const name = ($('gf-gardenName')?.value||'').trim();
  if (!name) { toast('Garden name is required','error'); return; }
  UndoManager.push($('gf-id').value ? 'edit garden project' : 'create garden project');
  const existingId = $('gf-id').value;

  // Collect expenses from DOM rows
  const expenses = collectGardenExpenses();

  const data = {
    gardenName:         name,
    location:           $('gf-location')?.value||'',
    areaSize:           $('gf-areaSize')?.value||'',
    crop:               $('gf-crop')?.value||'',
    plantingDate:       $('gf-plantingDate')?.value||'',
    harvestDate:        $('gf-harvestDate')?.value||'',
    wateringSchedule:   $('gf-wateringSchedule')?.value||'',
    weedingSchedule:    $('gf-weedingSchedule')?.value||'',
    fertiliserSchedule: $('gf-fertiliserSchedule')?.value||'',
    pestControlNotes:   $('gf-pestControlNotes')?.value||'',
    gradeLevel:         $('gf-gradeLevel')?.value||'',
    subjectLinks:       $('gf-subjectLinks')?.value||'',
    curriculumNotes:    $('gf-curriculumNotes')?.value||'',
    budget:             $('gf-budget')?.value||'',
    fundingSource:      $('gf-fundingSource')?.value||'',
    contactPerson:      $('gf-contactPerson')?.value||'',
    cellNumber:         $('gf-cellNumber')?.value||'',
    scopeDescription:   $('gf-scopeDescription')?.value||'',
    status:             $('gf-status')?.value||'',
    priority:           $('gf-priority')?.value||'',
    startDate:          $('gf-startDate')?.value||'',
    targetDate:         $('gf-targetDate')?.value||'',
    scopeNotes:         $('gf-scopeNotes')?.value||'',
    scopeItems:         collectGardenScopeItems(),
    expenses,
  };
  if (existingId) { const gn = State.gardens.find(x => x.id === existingId); Object.assign(gn, data); }
  else State.gardens.push({ id:uid(), dateAdded:new Date().toISOString(), ...data });
  saveGardens();
  closeModal('garden-modal');
  renderGardens();
  renderGardenCostPanel();
  toast('Garden project saved');
}

async function deleteGarden(id) {
  if (!confirm('Delete this garden project?')) return;
  UndoManager.push('delete garden project');
  State.gardens = State.gardens.filter(g => g.id !== id);
  DB.save(DB.keys(currentSiteId).gardens, State.gardens);
  renderGardens(); renderGardenCostPanel(); toast('Deleted');
  if (SUPABASE_URL) {
    setSyncStatus('syncing');
    const res = await SB.delete('gardens?id=eq.' + id);
    setSyncStatus(res !== null ? 'synced' : 'error');
  }
}

function switchGardenTab(tabEl, id) {
  document.querySelectorAll('#garden-modal .gm-tab').forEach(t => t.classList.remove('active'));
  if (tabEl) tabEl.classList.add('active');
  ['g-tab-general','g-tab-planting','g-tab-maintenance','g-tab-education','g-tab-costs'].forEach(t => {
    const el = $(t); if (el) el.style.display = t===id ? 'block' : 'none';
  });
  if (id === 'g-tab-costs') { updateGardenCostSummary(); updateCostPerSqm(); }
}

/* ── Garden Expense line items ───────────────────────────── */
const GARDEN_EXPENSE_CATS = ['Seeds & Plants','Soil & Compost','Tools & Equipment','Irrigation','Fertiliser','Pest Control','Labour','Infrastructure','Other'];

function renderGardenExpenseList(gn) {
  var list = $('gf-expense-list'); if (!list) return;
  var expenses = (gn && gn.expenses) ? gn.expenses : [];
  if (!expenses.length) {
    list.innerHTML = '<p class="hint-msg">No expenses yet. Click "+ Add Expense" to start.</p>';
    return;
  }
  var html = '<div class="garden-expense-table">';
  html += '<div class="get-header"><span>Description</span><span>Category</span><span>Date</span><span>Amount (R)</span><span></span></div>';
  expenses.forEach(function(e) {
    html += '<div class="get-row">';
    html += '<input type="text" class="get-desc" value="' + esc(e.description||'') + '" placeholder="Description" oninput="updateGardenCostSummary()">';
    html += '<select class="get-cat" onchange="updateGardenCostSummary()">';
    GARDEN_EXPENSE_CATS.forEach(function(c) {
      html += '<option' + (c === e.category ? ' selected' : '') + '>' + esc(c) + '</option>';
    });
    html += '</select>';
    html += '<input type="date" class="get-date" value="' + esc(e.date||'') + '">';
    html += '<input type="number" class="get-amount" value="' + esc(e.amount||'') + '" placeholder="0.00" step="0.01" min="0" oninput="updateGardenCostSummary();updateCostPerSqm()">';
    html += '<button type="button" class="btn btn-xs btn-danger" onclick="removeGardenExpenseRow(this)">&#215;</button>';
    html += '</div>';
  });
  html += '</div>';
  list.innerHTML = html;
}

function addGardenExpenseRow() {
  let list = $('gf-expense-list');
  // Replace hint if present
  if (list.querySelector('.hint-msg')) {
    list.innerHTML = `<div class="garden-expense-table">
      <div class="get-header"><span>Description</span><span>Category</span><span>Date</span><span>Amount (R)</span><span></span></div>
    </div>`;
  }
  let table = list.querySelector('.garden-expense-table');
  const row = document.createElement('div');
  row.className = 'get-row';
  row.innerHTML = `
    <input type="text"   class="get-desc"   placeholder="e.g. Tomato seedlings" oninput="updateGardenCostSummary()">
    <select class="get-cat" onchange="updateGardenCostSummary()">
      ${GARDEN_EXPENSE_CATS.map(c=>`<option>${c}</option>`).join('')}
    </select>
    <input type="date"   class="get-date"   value="${new Date().toISOString().split('T')[0]}">
    <input type="number" class="get-amount" placeholder="0.00" step="0.01" min="0" oninput="updateGardenCostSummary();updateCostPerSqm()">
    <button type="button" class="btn btn-xs btn-danger" onclick="removeGardenExpenseRow(this)">&#215;</button>`;
  table.appendChild(row);
  row.querySelector('.get-desc').focus();
}

function removeGardenExpenseRow(btn) {
  btn.closest('.get-row').remove();
  const table = $('gf-expense-list').querySelector('.garden-expense-table');
  if (table && !table.querySelectorAll('.get-row').length) {
    $('gf-expense-list').innerHTML = '<p class="hint-msg">No expenses yet. Click "+ Add Expense" to start.</p>';
  }
  updateGardenCostSummary();
  updateCostPerSqm();
}

function collectGardenExpenses() {
  const rows = document.querySelectorAll('#gf-expense-list .get-row');
  return Array.from(rows).map(row => ({
    id:          uid(),
    description: row.querySelector('.get-desc')?.value  || '',
    category:    row.querySelector('.get-cat')?.value   || 'Other',
    date:        row.querySelector('.get-date')?.value  || '',
    amount:      row.querySelector('.get-amount')?.value|| '',
  })).filter(e => e.description || parseFloat(e.amount));
}

function updateGardenCostSummary() {
  const el = $('gf-cost-summary'); if (!el) return;
  const budget  = parseFloat($('gf-budget')?.value || 0);
  const rows    = document.querySelectorAll('#gf-expense-list .get-row');
  const total   = Array.from(rows).reduce((s,r) => s + (parseFloat(r.querySelector('.get-amount')?.value)||0), 0);
  const remaining = budget - total;
  const over    = total > budget && budget > 0;
  const pct     = budget > 0 ? Math.min(total / budget * 100, 100) : null;

  // Also recalc cost per sqm whenever totals change
  updateCostPerSqm();

  // Category breakdown from live rows
  const cats = {};
  rows.forEach(r => {
    const cat = r.querySelector('.get-cat')?.value || 'Other';
    const amt = parseFloat(r.querySelector('.get-amount')?.value) || 0;
    if (amt > 0) cats[cat] = (cats[cat] || 0) + amt;
  });

  const pctStr = pct !== null ? pct.toFixed(1) : '0.0';

  el.innerHTML = `
    <div class="gcost-tracker">
      <div class="gcost-row">
        <div class="gcost-item">
          <div class="gcost-label">Budget</div>
          <div class="gcost-val">${budget ? fmt.currency(budget) : '—'}</div>
        </div>
        <div class="gcost-item">
          <div class="gcost-label">Total Spent</div>
          <div class="gcost-val ${over ? 'over' : ''}">${fmt.currency(total)}</div>
        </div>
        <div class="gcost-item">
          <div class="gcost-label">${over ? 'Over Budget' : 'Remaining'}</div>
          <div class="gcost-val ${over ? 'over' : 'under'}">${fmt.currency(Math.abs(remaining))}</div>
        </div>
      </div>
      <div class="gcost-bar-outer">
        <div class="gcost-bar-inner ${over ? 'over' : ''}" style="width:${pct !== null ? pct.toFixed(1) : 0}%"></div>
      </div>
      <div style="font-size:.72rem;color:${over ? 'var(--danger)' : 'var(--text-muted)'};margin-top:4px">
        ${pctStr}% of budget used
      </div>
      ${Object.keys(cats).length ? `<div class="gcost-breakdown">
        ${Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([cat,amt])=>`
          <div class="gcost-cat-row">
            <span class="gcost-cat-name">${esc(cat)}</span>
            <span class="gcost-cat-bar-wrap">
              <span class="gcost-cat-bar" style="width:${total > 0 ? ((amt/total)*100).toFixed(1) : 0}%"></span>
            </span>
            <span class="gcost-cat-amt">${fmt.currency(amt)}</span>
          </div>`).join('')}
      </div>` : ''}
    </div>`;
}

function updateCostPerSqm() {
  const sqm   = parseFloat($('gf-areaSize')?.value || 0);
  const rows  = document.querySelectorAll('#gf-expense-list .get-row');
  const total = Array.from(rows).reduce((s,r) => s + (parseFloat(r.querySelector('.get-amount')?.value)||0), 0);
  const el    = $('gf-costPerSqm');
  if (el) el.value = (sqm > 0 && total > 0) ? (total / sqm).toFixed(2) : '';
}

/* ── Garden Cost Summary Panel (Gardens page) ─────────────── */
function renderGardenCostPanel() {
  var panel = $('garden-cost-panel');
  var body  = $('garden-cost-summary-body');
  if (!panel || !body) return;

  var gardensWithCosts = State.gardens.filter(function(g){ return g.budget || (g.expenses||[]).length; });
  if (!gardensWithCosts.length) { panel.style.display = 'none'; return; }
  panel.style.display = '';
  panel.classList.add('open');

  var totalBudget = State.gardens.reduce(function(s,g){ return s + parseFloat(g.budget||0); }, 0);
  var totalSpend  = State.gardens.reduce(function(s,g){ return s + (g.expenses||[]).reduce(function(t,e){ return t + parseFloat(e.amount||0); }, 0); }, 0);
  var overallOver = totalSpend > totalBudget && totalBudget > 0;
  var pct         = totalBudget > 0 ? Math.min(totalSpend/totalBudget*100,100).toFixed(1) : null;

  var allCats = {};
  State.gardens.forEach(function(g){
    (g.expenses||[]).forEach(function(e){
      if (parseFloat(e.amount) > 0) { allCats[e.category] = (allCats[e.category]||0) + parseFloat(e.amount); }
    });
  });

  var html = '';

  // Summary bar
  html += '<div style="padding:16px 20px;border-bottom:1px solid var(--border)">';
  html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:12px">';
  html += '<div style="text-align:center"><div class="gcost-label">Total Garden Budget</div><div class="gcost-val" style="font-size:1rem">' + (totalBudget ? fmt.currency(totalBudget) : '—') + '</div></div>';
  html += '<div style="text-align:center"><div class="gcost-label">Total Spent</div><div class="gcost-val ' + (overallOver?'over':'') + '" style="font-size:1rem">' + fmt.currency(totalSpend) + '</div></div>';
  html += '<div style="text-align:center"><div class="gcost-label">' + (overallOver?'Over':'Remaining') + '</div><div class="gcost-val ' + (overallOver?'over':'under') + '" style="font-size:1rem">' + fmt.currency(Math.abs(totalBudget-totalSpend)) + '</div></div>';
  html += '<div style="text-align:center"><div class="gcost-label">Gardens Tracked</div><div class="gcost-val" style="font-size:1rem">' + gardensWithCosts.length + '</div></div>';
  html += '</div>';
  if (pct !== null) {
    html += '<div style="height:8px;background:var(--platinum);border-radius:4px;overflow:hidden;margin-bottom:4px">';
    html += '<div style="height:100%;width:' + pct + '%;background:' + (overallOver?'var(--danger)':'var(--pk-green)') + ';border-radius:4px;transition:width .4s"></div></div>';
    html += '<div style="font-size:.72rem;color:' + (overallOver?'var(--danger)':'var(--text-muted)') + '">Overall: ' + pct + '% of garden budget used</div>';
  }
  html += '</div>';

  // Per-garden table
  html += '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.83rem">';
  html += '<thead><tr style="background:var(--ivory)">';
  ['Garden','Location','Budget','Spent','Variance','Cost/m\u00b2',''].forEach(function(h){
    html += '<th style="padding:9px 14px;text-align:' + (h&&h!=='Garden'&&h!=='Location'?'right':'left') + ';border-bottom:2px solid var(--border);color:var(--text-muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.05em">' + h + '</th>';
  });
  html += '</tr></thead><tbody>';

  State.gardens.forEach(function(g) {
    var gid    = g.id;
    var budget = parseFloat(g.budget||0);
    var spent  = (g.expenses||[]).reduce(function(s,e){ return s + parseFloat(e.amount||0); }, 0);
    var variance = budget - spent;
    var over   = spent > budget && budget > 0;
    var sqm    = parseFloat(g.areaSize||0);
    var perSqm = (sqm > 0 && spent > 0) ? fmt.currency(spent/sqm) : '—';

    html += '<tr style="border-bottom:1px solid var(--border)">';
    html += '<td style="padding:10px 14px"><strong style="color:var(--pk-green)">' + esc(g.gardenName) + '</strong>';
    if (g.crop) html += '<div style="font-size:.73rem;color:var(--text-muted)">' + esc(g.crop) + '</div>';
    html += '</td>';
    html += '<td style="padding:10px 14px;color:var(--text-muted)">' + esc(g.location||'—') + '</td>';
    html += '<td style="padding:10px 14px;text-align:right">' + (budget ? fmt.currency(budget) : '—') + '</td>';
    html += '<td style="padding:10px 14px;text-align:right;font-weight:600;color:' + (over?'var(--danger)':'inherit') + '">' + (spent ? fmt.currency(spent) : '—') + '</td>';
    html += '<td style="padding:10px 14px;text-align:right;font-weight:600;color:' + (over?'var(--danger)':'#2e7d32') + '">' + ((budget||spent) ? (over?'-':'') + fmt.currency(Math.abs(variance)) : '—') + '</td>';
    html += '<td style="padding:10px 14px;text-align:center;color:var(--text-muted)">' + perSqm + '</td>';
    html += '<td style="padding:10px 14px;text-align:right">';
    html += '<button class="btn btn-xs btn-outline" onclick="openGardenModal(\'' + gid + '\')">Edit</button>';
    html += '</td></tr>';
  });

  html += '</tbody>';
  if (totalSpend > 0) {
    html += '<tfoot><tr style="background:var(--ivory);font-weight:700">';
    html += '<td colspan="3" style="padding:10px 14px;color:var(--pk-green)">Total</td>';
    html += '<td style="padding:10px 14px;text-align:right;color:' + (overallOver?'var(--danger)':'inherit') + '">' + fmt.currency(totalSpend) + '</td>';
    html += '<td style="padding:10px 14px;text-align:right;color:' + (overallOver?'var(--danger)':'#2e7d32') + '">' + (totalBudget ? (overallOver?'-':'') + fmt.currency(Math.abs(totalBudget-totalSpend)) : '—') + '</td>';
    html += '<td colspan="2"></td></tr></tfoot>';
  }
  html += '</table></div>';

  // Category breakdown
  var catEntries = Object.entries(allCats).sort(function(a,b){ return b[1]-a[1]; });
  if (catEntries.length && totalSpend > 0) {
    html += '<div style="padding:14px 20px;border-top:1px solid var(--border)">';
    html += '<div style="font-size:.76rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px">Spend by Category</div>';
    html += '<div class="gcost-breakdown">';
    catEntries.forEach(function(entry) {
      var cat = entry[0], amt = entry[1];
      html += '<div class="gcost-cat-row">';
      html += '<span class="gcost-cat-name">' + esc(cat) + '</span>';
      html += '<span class="gcost-cat-bar-wrap"><span class="gcost-cat-bar" style="width:' + ((amt/totalSpend)*100).toFixed(1) + '%"></span></span>';
      html += '<span class="gcost-cat-amt">' + fmt.currency(amt) + '</span>';
      html += '</div>';
    });
    html += '</div></div>';
  }

  body.innerHTML = html;
}

/* ── Holiday Work ─────────────────────────────────────────── */

// Storage key helper
const hwKey = () => 'nhfm_holidaywork_' + currentSiteId;
function loadHWProjects()  { try { return JSON.parse(localStorage.getItem(hwKey())) || []; } catch { return []; } }
function saveHWProjects(d) { try { localStorage.setItem(hwKey(), JSON.stringify(d)); if (SUPABASE_URL) pushHWProjectsToSupabase(); return true; } catch(e) { toast('Save error: '+e.message,'error'); return false; } }

// State
let hwProjects = [];
let hwCurrentCat = 'All';

function renderHolidayWork() {
  hwProjects = loadHWProjects();
  renderHWStats();
  renderHWGrid();
}

/* ── Stats bar ── */
function renderHWStats() {
  const el = $('hw-stats'); if (!el) return;
  const all       = hwProjects;
  const active    = all.filter(p => ['Planning','Approved','Contractor Booked','In Progress'].includes(p.status));
  const done      = all.filter(p => p.status === 'Completed');
  const budget    = all.reduce((s,p) => s + parseFloat(p.budget||0), 0);
  const totalSpend= all.reduce((s,p) => s + (p.invoices||[]).reduce((t,i)=>t+parseFloat(i.amount||0),0), 0);
  const totalQuotes = all.reduce((s,p) => s + (p.quotes||[]).length, 0);
  const thisHol   = all.filter(p => p.holiday === getCurrentHoliday());
  const overBudget= all.filter(p => {
    const b = parseFloat(p.budget||0);
    const sp= (p.invoices||[]).reduce((t,i)=>t+parseFloat(i.amount||0),0);
    return b > 0 && sp > b;
  }).length;

  el.innerHTML = [
    { label:'Total Projects', val: all.length,       sub:'all time' },
    { label:'Active',         val: active.length,    sub:'in progress / planned' },
    { label:'Completed',      val: done.length,      sub:'finished' },
    { label:'This Holiday',   val: thisHol.length,   sub: getCurrentHoliday() },
    { label:'Total Budget',   val: budget ? fmt.currency(budget) : 'R 0.00',    sub:'all HW projects', big:true },
    { label:'Actual Spend',   val: totalSpend ? fmt.currency(totalSpend) : 'R 0.00', sub: overBudget ? overBudget+' over budget' : 'total invoiced', big:true, warn: overBudget > 0 },
    { label:'Total Quotes',   val: totalQuotes,      sub:'across all projects' },
  ].map(s => `<div class="stat-card ${s.warn?'stat-warn':''}">
    <div class="stat-label">${s.label}</div>
    <div class="stat-value" style="${s.big ? 'font-size:1rem' : ''}">${s.val}</div>
    <div class="stat-sub">${s.sub}</div>
  </div>`).join('');
}

function getCurrentHoliday() {
  const m = new Date().getMonth();
  if (m <= 1 || m === 11) return 'Summer Holidays';
  if (m <= 3)              return 'Autumn Holidays';
  if (m <= 6)              return 'Winter Holidays';
  return 'Spring Holidays';
}

/* ── Filter tabs ── */
function switchHWTab(btn) {
  document.querySelectorAll('.hw-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  hwCurrentCat = btn.dataset.hwcat;
  renderHWGrid();
}

/* ── Project cards ── */
function renderHWGrid() {
  const el = $('hw-grid'); if (!el) return;
  const items = hwCurrentCat === 'All' ? hwProjects : hwProjects.filter(p => p.category === hwCurrentCat);
  if (!items.length) {
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="empty-icon">🏗</div>
      <h3>No holiday projects${hwCurrentCat!=='All'?' in this category':''}</h3>
      <p>${hwCurrentCat!=='All'?'Try selecting a different category.':'Plan maintenance work for school holidays.'}</p>
      ${hwCurrentCat==='All'?'<button class="btn btn-primary btn-sm" onclick="openNewHWProject()">+ New Holiday Project</button>':''}
    </div>`;
    return;
  }
  el.innerHTML = items.map(p => {
    const scopeItems = p.scopeItems || [];
    const milestones = p.milestones || [];
    const doneScope  = scopeItems.filter(s => s.done).length;
    const today      = new Date();
    const daysToStart = p.startDate ? Math.ceil((new Date(p.startDate) - today) / 86400000) : null;
    const daysToEnd   = p.endDate   ? Math.ceil((new Date(p.endDate)   - today) / 86400000) : null;
    const isOverdue   = daysToEnd !== null && daysToEnd < 0 && p.status !== 'Completed';

    // Status colour
    const statusMap = {
      'Planning':'draft','Approved':'approved','Contractor Booked':'awaiting-approval',
      'In Progress':'in-progress','Completed':'completed','Deferred':'archived'
    };
    const sBadge = `<span class="badge badge-${statusMap[p.status]||'draft'}">${esc(p.status)}</span>`;

    // Countdown badge
    let countBadge = '';
    if (p.status === 'Completed') countBadge = '';
    else if (isOverdue) countBadge = `<span class="hw-count-badge hw-overdue">${Math.abs(daysToEnd)}d overdue</span>`;
    else if (daysToStart !== null && daysToStart >= 0 && daysToStart <= 14) countBadge = `<span class="hw-count-badge hw-soon">Starts in ${daysToStart}d</span>`;
    else if (daysToEnd !== null && daysToEnd >= 0 && daysToEnd <= 7) countBadge = `<span class="hw-count-badge hw-urgent">${daysToEnd}d left</span>`;

    // Scope progress bar
    const scopePct = scopeItems.length ? Math.round(doneScope / scopeItems.length * 100) : null;

    return `<div class="hw-card" draggable="true" data-id="${p.id}">

      <!-- Header -->
      <div class="hwc-header">
        <span class="drag-handle" title="Drag to reorder">&#9776;</span>
        <div style="flex:1;min-width:0">
          <div class="hwc-cat"><span class="hw-editable" onclick="hwInlineEdit('${p.id}','category',this,event)" title="Click to edit category">${esc(p.category)}</span> · <span class="hw-editable" onclick="hwInlineEdit('${p.id}','holiday',this,event)" title="Click to edit holiday">${esc(p.holiday||'')}</span></div>
          <div class="hwc-title hw-editable" onclick="hwInlineEdit('${p.id}','title',this,event)" title="Click to edit title">${esc(p.title)}</div>
          <div class="hwc-location hw-editable" onclick="hwInlineEdit('${p.id}','location',this,event)" title="Click to edit location">${esc(p.location||'Add location…')}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;display:flex;flex-direction:column;gap:4px;align-items:flex-end">
          <span class="badge badge-${statusMap[p.status]||'draft'} hw-editable" onclick="hwInlineEdit('${p.id}','status',this,event)" title="Click to change status" style="cursor:pointer">${esc(p.status)}</span>
          ${countBadge}
          <span class="badge badge-${(p.priority||'medium').toLowerCase()} hw-editable" onclick="hwInlineEdit('${p.id}','priority',this,event)" title="Click to change priority" style="font-size:.66rem;cursor:pointer">${esc(p.priority||'Medium')}</span>
        </div>
      </div>

      <!-- Key dates row -->
      <div class="hwc-dates">
        <span class="hw-editable" onclick="hwInlineEdit('${p.id}','startDate',this,event)" title="Click to edit start date">Start: <strong>${p.startDate ? fmt.date(p.startDate) : '—'}</strong></span>
        <span class="hw-editable" onclick="hwInlineEdit('${p.id}','endDate',this,event)" title="Click to edit end date">End: <strong>${p.endDate ? fmt.date(p.endDate) : '—'}</strong></span>
        <span class="hw-editable" onclick="hwInlineEdit('${p.id}','handoverDate',this,event)" title="Click to edit handover date">Handover: <strong>${p.handoverDate ? fmt.date(p.handoverDate) : '—'}</strong></span>
      </div>

      <!-- Scope panel (collapsible) -->
      ${(p.scopeSummary || scopeItems.length) ? `<div class="panel" style="margin-top:10px;border-radius:var(--radius-sm)">
        <div class="panel-header" style="padding:8px 12px;font-size:.78rem">
          <span class="panel-title" style="font-size:.78rem">Scope of Work${scopeItems.length ? ` (${doneScope}/${scopeItems.length} done)` : ''}</span>
          <span class="panel-toggle">&#9660;</span>
        </div>
        <div class="panel-body" style="padding:10px 12px">
          ${p.scopeSummary ? `<p style="font-size:.8rem;color:var(--text-secondary);line-height:1.5;margin-bottom:${scopeItems.length?'10px':'0'}">${esc(p.scopeSummary)}</p>` : ''}
          ${scopeItems.length ? `<div class="hw-scope-list">
            ${scopeItems.map((s,i) => `<label class="hw-scope-item">
              <input type="checkbox" ${s.done?'checked':''} onchange="toggleHWScopeItem('${p.id}',${i},this.checked)" style="accent-color:var(--pk-green)">
              <span style="${s.done?'text-decoration:line-through;color:var(--text-muted)':''}">${esc(s.text)}</span>
            </label>`).join('')}
          </div>` : ''}
          ${scopePct !== null ? `<div style="margin-top:8px;height:5px;background:var(--platinum);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${scopePct}%;background:var(--pk-green);border-radius:3px;transition:width .3s"></div>
          </div>` : ''}
        </div>
      </div>` : ''}

      <!-- Timeline / Milestones (collapsible) -->
      ${milestones.length ? `<div class="panel" style="margin-top:8px;border-radius:var(--radius-sm)">
        <div class="panel-header" style="padding:8px 12px">
          <span class="panel-title" style="font-size:.78rem">Milestones (${milestones.filter(m=>m.done).length}/${milestones.length})</span>
          <span class="panel-toggle">&#9660;</span>
        </div>
        <div class="panel-body" style="padding:10px 12px">
          <div class="hw-milestone-list">
            ${milestones.map((m,i) => `<div class="hw-milestone-item">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                <input type="checkbox" ${m.done?'checked':''} onchange="toggleHWMilestone('${p.id}',${i},this.checked)" style="accent-color:var(--pk-green);flex-shrink:0">
                <span style="${m.done?'text-decoration:line-through;color:var(--text-muted)':''};">${esc(m.text)}</span>
              </label>
              ${m.date ? `<span class="hw-milestone-date">${fmt.date(m.date)}</span>` : ''}
            </div>`).join('')}
          </div>
        </div>
      </div>` : ''}

      <!-- Financial summary -->
      ${(() => {
        const budget     = parseFloat(p.budget||0);
        const quotes     = (p.quotes||[]).sort((a,b)=>parseFloat(a.total||a.amount||0)-parseFloat(b.total||b.amount||0));
        const invoices   = p.invoices||[];
        const totalSpend = invoices.reduce((s,i)=>s+parseFloat(i.amount||0),0);
        const paid       = invoices.filter(i=>i.paid).reduce((s,i)=>s+parseFloat(i.amount||0),0);
        const over       = totalSpend > budget && budget > 0;
        const pct        = budget > 0 ? Math.min(totalSpend/budget*100,100).toFixed(0) : null;
        const rec        = quotes[0]?.recommendation || '';
        if (!budget && !quotes.length && !invoices.length) return '';
        let html = '<div class="hwc-financial">';
        // Budget + spend row
        if (budget || totalSpend) {
          html += `<div class="hwc-fin-row">
            ${budget     ? `<div class="hwc-fin-item"><div class="hwc-fin-label">Budget</div><div class="hwc-fin-val">${fmt.currency(budget)}</div></div>` : ''}
            ${totalSpend ? `<div class="hwc-fin-item"><div class="hwc-fin-label">Invoiced</div><div class="hwc-fin-val ${over?'hwc-over':''}">${fmt.currency(totalSpend)}</div></div>` : ''}
            ${paid > 0   ? `<div class="hwc-fin-item"><div class="hwc-fin-label">Paid</div><div class="hwc-fin-val" style="color:#2e7d32">${fmt.currency(paid)}</div></div>` : ''}
            ${budget && totalSpend ? `<div class="hwc-fin-item"><div class="hwc-fin-label">${over?'Over':'Left'}</div><div class="hwc-fin-val ${over?'hwc-over':'hwc-under'}">${fmt.currency(Math.abs(budget-totalSpend))}</div></div>` : ''}
          </div>`;
          if (pct!==null) html += `<div class="hwc-fin-bar-outer"><div class="hwc-fin-bar ${over?'hwc-over':''}" style="width:${pct}%"></div></div>`;
        }
        // Quotes summary
        if (quotes.length) {
          html += `<div class="hwc-quotes-summary">
            <div class="hwc-qs-title">Quotes (${quotes.length})</div>
            ${quotes.slice(0,3).map((q,i)=>`<div class="hwc-qs-row ${i===0?'hwc-qs-best':''}">
              <span>${esc(q.contractor)}</span>
              <span>${fmt.currency(q.total||q.amount||0)}</span>
              ${i===0?'<span class="badge badge-approved" style="font-size:.58rem">Lowest</span>':''}
            </div>`).join('')}
            ${rec ? `<div class="hwc-rec">${esc(rec.slice(0,100))}${rec.length>100?'…':''}</div>` : ''}
          </div>`;
        }
        html += '</div>';
        return html;
      })()}

      <!-- Contractor + notes -->
      <div style="font-size:.78rem;color:var(--text-muted);padding:8px 16px 4px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span class="hw-editable" onclick="hwInlineEdit('${p.id}','contractor',this,event)" title="Click to edit contractor">Contractor: <strong style="color:var(--text-primary)">${esc(p.contractor||'Add…')}</strong></span>
        ${p.cell ? '<div onclick="event.stopPropagation()" style="display:inline-block">' + waButtonGroup(p.cell, {id:p.id, projectName:p.title, projectNumber:'HW', contactPerson:p.contractor, telephone:p.cell, location:p.location||'', startDate:p.startDate||'', completionDate:p.endDate||'', quoteDueDate:'', description:p.scopeSummary||'', status:p.status||''}, 'hw') + '</div>' : ''}
      </div>
      <div class="hw-editable" style="font-size:.78rem;color:var(--text-secondary);padding:8px 16px 4px;line-height:1.5;border-top:1px solid var(--border);cursor:pointer" onclick="hwInlineEdit('${p.id}','notes',this,event)" title="Click to edit notes">${p.notes ? esc(p.notes.slice(0,140)) + (p.notes.length>140?'…':'') : '<span style="color:var(--text-muted);font-style:italic">Add notes…</span>'}</div>

      <!-- Actions -->
      <div class="hwc-actions">
        <span style="font-size:.7rem;color:var(--text-muted)">Added ${fmt.date(p.dateAdded)}</span>
        <div style="display:flex;gap:6px;align-items:center">
          <button class="btn btn-sm btn-outline" onclick="openHWModal('${p.id}')">Edit</button>
          <button class="btn btn-sm btn-danger" onclick="deleteHWProject('${p.id}')">Delete</button>
          ${cardMenuHtml()}
        </div>
      </div>
    </div>`;
  }).join('');
  enableDragSort('hw-grid', '.hw-card', (from, to) => {
    const filtered = hwCurrentCat === 'All' ? hwProjects : hwProjects.filter(p => p.category === hwCurrentCat);
    const fromId = filtered[from]?.id, toId = filtered[to]?.id;
    if (!fromId) return;
    const fi = hwProjects.findIndex(p => p.id === fromId);
    const ti = hwProjects.findIndex(p => p.id === toId);
    if (fi < 0 || ti < 0) return;
    arrayMove(hwProjects, fi, ti);
    saveHWProjects(hwProjects);
    renderHWGrid();
  });
}

/* ── Toggle scope item done state inline ── */
function toggleHWScopeItem(pid, idx, checked) {
  const projs = loadHWProjects();
  const p = projs.find(x => x.id === pid); if (!p) return;
  if (p.scopeItems && p.scopeItems[idx] !== undefined) p.scopeItems[idx].done = checked;
  saveHWProjects(projs);
  hwProjects = projs;
  renderHWStats();
}

function toggleHWMilestone(pid, idx, checked) {
  const projs = loadHWProjects();
  const p = projs.find(x => x.id === pid); if (!p) return;
  if (p.milestones && p.milestones[idx] !== undefined) p.milestones[idx].done = checked;
  saveHWProjects(projs);
  hwProjects = projs;
}

/* ── Inline editing on HW cards ── */
function hwInlineEdit(pid, field, el, ev) {
  ev.stopPropagation();
  if (el.querySelector('input,select')) return;
  const projs = loadHWProjects();
  const p = projs.find(x => x.id === pid);
  if (!p) return;

  const val = p[field] || '';
  const selectOpts = {
    status:   ['Planning','Approved','Contractor Booked','In Progress','Completed','Deferred'],
    priority: ['Low','Medium','High'],
    category: ['Renovation','Building Upgrades','Garden Upgrades','Maintenance','Other'],
    holiday:  ['Summer Holidays','Autumn Holidays','Winter Holidays','Spring Holidays'],
  };

  let input;
  if (selectOpts[field]) {
    input = document.createElement('select');
    selectOpts[field].forEach(o => {
      const opt = document.createElement('option');
      opt.value = o; opt.textContent = o;
      if (o === val) opt.selected = true;
      input.appendChild(opt);
    });
  } else if (['startDate','endDate','handoverDate','planDate'].includes(field)) {
    input = document.createElement('input');
    input.type = 'date';
    input.value = val;
  } else {
    input = document.createElement('input');
    input.type = 'text';
    input.value = val;
  }

  input.className = 'hw-inline-input';
  input.style.cssText = 'font-size:inherit;font-weight:inherit;color:inherit;padding:2px 6px;border:2px solid var(--asp-green);border-radius:4px;background:var(--ivory);outline:none;width:100%;box-sizing:border-box;min-width:80px;';

  const save = () => {
    const nv = input.value;
    if (nv === val) { renderHWGrid(); return; }
    UndoManager.push('edit HW ' + field);
    const projs2 = loadHWProjects();
    const p2 = projs2.find(x => x.id === pid);
    if (p2) {
      p2[field] = nv;
      p2.dateUpdated = new Date().toISOString();
      saveHWProjects(projs2);
      hwProjects = projs2;
    }
    renderHolidayWork();
    toast(field.replace(/([A-Z])/g,' $1').replace(/^./,s=>s.toUpperCase()) + ' updated');
  };

  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') { renderHWGrid(); } });

  el.textContent = '';
  el.appendChild(input);
  if (input.tagName === 'SELECT') input.addEventListener('change', save);
  setTimeout(() => {
    input.focus();
    if (input.type === 'text') input.select();
    input.addEventListener('blur', save);
  }, 0);
}

/* ── Open modal ── */
function openHWModal(id) {
  hwProjects = loadHWProjects();
  const p = id ? hwProjects.find(x => x.id === id) : null;
  $('hw-modal-title').textContent = p ? 'Edit Holiday Project' : 'New Holiday Project';
  $('hwf-id').value = id || '';

  // Basic fields
  const set = (fid, val) => { const el=$(fid); if(el) el.value = val||''; };
  set('hwf-title',          p?.title||'');
  set('hwf-category',       p?.category||'Renovation');
  set('hwf-holiday',        p?.holiday||getCurrentHoliday());
  set('hwf-priority',       p?.priority||'Medium');
  set('hwf-status',         p?.status||'Planning');
  set('hwf-location',       p?.location||'');
  set('hwf-contractor',     p?.contractor||'');
  set('hwf-cell',           p?.cell||p?.telephone||'');
  set('hwf-budget',         p?.budget||'');
  set('hwf-scope-summary',  p?.scopeSummary||'');
  set('hwf-exclusions',     p?.exclusions||'');
  set('hwf-plan-date',      p?.planDate||'');
  set('hwf-start-date',     p?.startDate||'');
  set('hwf-end-date',       p?.endDate||'');
  set('hwf-handover-date',  p?.handoverDate||'');
  set('hwf-timeline-notes', p?.timelineNotes||'');
  set('hwf-notes',          p?.notes||'');
  set('hwf-template', p?.template||'');
  const tplEl = $('hwf-template'); if (tplEl) tplEl.dataset.applied = p?.template||'';

  // Init quote/invoice editing state
  _hwEditingQuotes   = p ? (p.quotes   ? [...p.quotes]   : []) : [];
  _hwCurrentRec      = p?.quotes?.[0]?.recommendation || '';

  // Scope items
  renderHWScopeList(p?.scopeItems || []);
  // Milestones
  renderHWMilestoneList(p?.milestones || []);
  // Quotes & invoices
  renderHWQuoteList(p?.quotes || []);
  renderHWInvoiceList(p?.invoices || [], parseFloat(p?.budget||0));

  openModal('hw-modal');
}

/* ── Scope item rows ── */
function renderHWScopeList(items) {
  const el = $('hwf-scope-list'); if (!el) return;
  if (!items.length) { el.innerHTML = '<p class="hint-msg" style="margin-bottom:4px">No scope items yet.</p>'; return; }
  el.innerHTML = items.map((s,i) => `<div class="hw-scope-row" data-idx="${i}">
    <input type="checkbox" class="hwsr-done" ${s.done?'checked':''} style="accent-color:var(--pk-green);flex-shrink:0">
    <input type="text" class="hwsr-text" value="${esc(s.text)}" placeholder="Scope item description…" style="flex:1">
    <button type="button" class="btn btn-xs btn-danger" onclick="this.closest('.hw-scope-row').remove()">&#215;</button>
  </div>`).join('');
}

function addHWScopeItem() {
  const el = $('hwf-scope-list');
  if (el.querySelector('.hint-msg')) el.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'hw-scope-row';
  row.innerHTML = `
    <input type="checkbox" class="hwsr-done" style="accent-color:var(--pk-green);flex-shrink:0">
    <input type="text" class="hwsr-text" placeholder="e.g. Strip and repaint all classrooms…" style="flex:1">
    <button type="button" class="btn btn-xs btn-danger" onclick="this.closest('.hw-scope-row').remove()">&#215;</button>`;
  el.appendChild(row);
  row.querySelector('.hwsr-text').focus();
}

function collectHWScopeItems() {
  return Array.from(document.querySelectorAll('#hwf-scope-list .hw-scope-row')).map(row => ({
    text: row.querySelector('.hwsr-text')?.value || '',
    done: row.querySelector('.hwsr-done')?.checked || false,
  })).filter(s => s.text.trim());
}

/* ── Milestone rows ── */
function renderHWMilestoneList(items) {
  const el = $('hwf-milestone-list'); if (!el) return;
  if (!items.length) { el.innerHTML = '<p class="hint-msg" style="margin-bottom:4px">No milestones yet.</p>'; return; }
  el.innerHTML = items.map((m,i) => `<div class="hw-milestone-row" data-idx="${i}">
    <input type="checkbox" class="hwmr-done" ${m.done?'checked':''} style="accent-color:var(--pk-green);flex-shrink:0">
    <input type="text" class="hwmr-text" value="${esc(m.text)}" placeholder="Milestone description…" style="flex:1">
    <input type="date" class="hwmr-date" value="${esc(m.date||'')}" style="width:140px">
    <button type="button" class="btn btn-xs btn-danger" onclick="this.closest('.hw-milestone-row').remove()">&#215;</button>
  </div>`).join('');
}

function addHWMilestone() {
  const el = $('hwf-milestone-list');
  if (el.querySelector('.hint-msg')) el.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'hw-milestone-row';
  row.innerHTML = `
    <input type="checkbox" class="hwmr-done" style="accent-color:var(--pk-green);flex-shrink:0">
    <input type="text" class="hwmr-text" placeholder="e.g. All materials delivered…" style="flex:1">
    <input type="date" class="hwmr-date" style="width:140px">
    <button type="button" class="btn btn-xs btn-danger" onclick="this.closest('.hw-milestone-row').remove()">&#215;</button>`;
  el.appendChild(row);
  row.querySelector('.hwmr-text').focus();
}

function collectHWMilestones() {
  return Array.from(document.querySelectorAll('#hwf-milestone-list .hw-milestone-row')).map(row => ({
    text: row.querySelector('.hwmr-text')?.value || '',
    date: row.querySelector('.hwmr-date')?.value || '',
    done: row.querySelector('.hwmr-done')?.checked || false,
  })).filter(m => m.text.trim());
}

/* ── Templates ── */
const HW_TEMPLATES = {
  renovation: {
    category: 'Renovation', priority: 'High',
    scopeSummary: 'Full renovation of the identified area including demolition, structural repairs, finishes and reinstatement.',
    scopeItems: [
      'Appoint contractor and confirm programme',
      'Procure materials and ensure delivery before work starts',
      'Strip out existing finishes and fittings',
      'Complete structural / builder\'s work',
      'Electrical first fix',
      'Plumbing first fix',
      'Plastering and screeding',
      'Electrical second fix',
      'Plumbing second fix',
      'Painting — primer, undercoat, two finish coats',
      'Install new fittings and fixtures',
      'Deep clean and snag list',
      'Final inspection and sign-off',
    ].map(t => ({ text: t, done: false })),
    milestones: [
      { text: 'Contractor appointed', date: '', done: false },
      { text: 'Materials on site', date: '', done: false },
      { text: 'Strip-out complete', date: '', done: false },
      { text: 'Builder\'s work complete', date: '', done: false },
      { text: 'Painting complete', date: '', done: false },
      { text: 'Snag list signed off', date: '', done: false },
    ],
  },
  building: {
    category: 'Building Upgrade', priority: 'Medium',
    scopeSummary: 'Upgrade of building systems and finishes to improve functionality, safety, and learning environment.',
    scopeItems: [
      'Assess current condition and confirm scope with stakeholders',
      'Procure contractor and materials',
      'Install / upgrade identified building systems',
      'Make good all penetrations and disturbances',
      'Paint affected areas to match existing',
      'Test and commission all installed systems',
      'Hand over with O&M manuals and warranties',
    ].map(t => ({ text: t, done: false })),
    milestones: [
      { text: 'Scope confirmed', date: '', done: false },
      { text: 'Contractor on site', date: '', done: false },
      { text: 'Installation complete', date: '', done: false },
      { text: 'Testing complete', date: '', done: false },
      { text: 'Final handover', date: '', done: false },
    ],
  },
  garden: {
    category: 'Garden Upgrade', priority: 'Low',
    scopeSummary: 'Upgrade and improvement of garden and outdoor areas during the holiday break.',
    scopeItems: [
      'Clear existing overgrowth and remove waste',
      'Prepare ground / beds — dig, compost, level',
      'Install new irrigation if required',
      'Plant trees, shrubs, and ground cover as per plan',
      'Mulch all beds',
      'Erect any required structures (raised beds, fencing, signage)',
      'Water and stabilise plantings',
      'Label plants for educational use',
    ].map(t => ({ text: t, done: false })),
    milestones: [
      { text: 'Design and plant list approved', date: '', done: false },
      { text: 'Clearing and prep complete', date: '', done: false },
      { text: 'Planting complete', date: '', done: false },
      { text: 'Structures erected', date: '', done: false },
      { text: 'Site tidy and handover', date: '', done: false },
    ],
  },
  maintenance: {
    category: 'Maintenance', priority: 'Medium',
    scopeSummary: 'General maintenance works to address defects and backlog items identified during the term.',
    scopeItems: [
      'Compile full defects list and prioritise',
      'Source materials and confirm contractor availability',
      'Repair / replace defective items — plumbing, electrical, carpentry',
      'Touch-up paintwork where required',
      'Service all mechanical equipment (HVAC, fire equipment)',
      'Clear gutters and stormwater drains',
      'Test and reset all safety systems',
      'Update maintenance log',
    ].map(t => ({ text: t, done: false })),
    milestones: [
      { text: 'Defects list finalised', date: '', done: false },
      { text: 'All repairs complete', date: '', done: false },
      { text: 'Safety systems tested', date: '', done: false },
      { text: 'Log updated and signed off', date: '', done: false },
    ],
  },
  painting: {
    category: 'Building Upgrade', priority: 'Medium',
    scopeSummary: 'Full interior and/or exterior painting programme covering all identified surfaces.',
    scopeItems: [
      'Confirm colour schedule and obtain approval',
      'Procure paint and materials',
      'Prepare all surfaces — fill, sand, prime',
      'Mask and protect fittings, floors, and glass',
      'Apply undercoat to all surfaces',
      'Apply two finish coats — check coverage',
      'Touch up and snag',
      'Remove masking and clean up',
    ].map(t => ({ text: t, done: false })),
    milestones: [
      { text: 'Colour scheme approved', date: '', done: false },
      { text: 'Preparation complete', date: '', done: false },
      { text: 'Undercoat complete', date: '', done: false },
      { text: 'Final coat complete', date: '', done: false },
      { text: 'Snag and clean-up done', date: '', done: false },
    ],
  },
  electrical: {
    category: 'Building Upgrade', priority: 'High',
    scopeSummary: 'Electrical works including upgrades, repairs, and compliance items to be completed during the holiday.',
    scopeItems: [
      'Obtain electrical compliance certificate for existing installation',
      'Identify and isolate circuits to be worked on',
      'Complete all new wiring, distribution board works',
      'Install new fittings, switches, sockets as required',
      'Test all circuits — continuity, insulation, polarity',
      'Issue CoC on completion',
      'Label all circuits on DB board',
    ].map(t => ({ text: t, done: false })),
    milestones: [
      { text: 'Scope and CoC agreed with electrician', date: '', done: false },
      { text: 'First fix complete', date: '', done: false },
      { text: 'Second fix and fittings installed', date: '', done: false },
      { text: 'Testing and CoC issued', date: '', done: false },
    ],
  },
  plumbing: {
    category: 'Building Upgrade', priority: 'High',
    scopeSummary: 'Plumbing works including repairs, replacements, and upgrades to be completed during the holiday.',
    scopeItems: [
      'Identify all defective plumbing items',
      'Isolate water supply — coordinate with facilities team',
      'Replace / repair identified pipes, fittings, and fixtures',
      'Install new sanitaryware where required',
      'Pressure test all repaired sections',
      'Reinstate water supply and check for leaks',
      'Clean and commission all sanitary facilities',
    ].map(t => ({ text: t, done: false })),
    milestones: [
      { text: 'Plumber appointed and scope agreed', date: '', done: false },
      { text: 'All repairs/replacements complete', date: '', done: false },
      { text: 'Pressure test passed', date: '', done: false },
      { text: 'Facilities reinstated and checked', date: '', done: false },
    ],
  },
};

/* ── HW Quotes ───────────────────────────────────────────── */
function renderHWQuoteList(quotes) {
  const el = $('hwf-quotes-list'); if (!el) return;
  if (!quotes.length) {
    el.innerHTML = '<p class="hint-msg">No quotes yet. Click "+ Add Quotation" below.</p>';
    renderHWQuoteComparison([]);
    return;
  }

  const amounts = quotes.map(q => parseFloat(q.total||q.amount||0)).filter(v=>v>0);
  const lowest  = amounts.length ? Math.min(...amounts) : null;

  el.innerHTML = '<div class="hw-quote-grid">' + quotes.map((q,i) => {
    const tot  = parseFloat(q.total||q.amount||0);
    const best = amounts.length > 1 && lowest !== null && tot === lowest;
    return `<div class="hw-quote-card ${best?'hw-quote-best':''}">
      <div class="hw-qc-header">
        <span class="hw-qc-contractor">${esc(q.contractor||'—')}</span>
        ${best ? '<span class="badge badge-approved" style="font-size:.65rem">Lowest</span>' : ''}
      </div>
      <div class="hw-qc-amount">${fmt.currency(q.total||q.amount||0)}</div>
      <div class="hw-qc-meta">
        <span>Excl. VAT: ${fmt.currency(q.amount||0)}</span>
        <span>VAT (15%): ${fmt.currency(q.vat||0)}</span>
      </div>
      <div class="hw-qc-meta">
        ${q.leadTime  ? '<span>Lead: '+esc(q.leadTime)+'</span>'         : ''}
        ${q.warranty  ? '<span>Warranty: '+esc(q.warranty)+' months</span>' : ''}
      </div>
      ${q.notes ? `<div class="hw-qc-notes">${esc(q.notes)}</div>` : ''}
      <div class="hw-qc-actions">
        <button class="btn btn-xs btn-outline" onclick="editHWQuote(${i})">Edit</button>
        <button class="btn btn-xs btn-danger"  onclick="removeHWQuoteRow(${i})">Remove</button>
      </div>
    </div>`;
  }).join('') + '</div>';

  renderHWQuoteComparison(quotes);
}

function renderHWQuoteComparison(quotes) {
  const el = $('hwf-quote-comparison'); if (!el) return;
  const valid = quotes.filter(q => parseFloat(q.total||q.amount||0) > 0);
  if (valid.length < 2) { el.innerHTML = ''; return; }
  const sorted = [...valid].sort((a,b) => parseFloat(a.total||a.amount||0) - parseFloat(b.total||b.amount||0));
  el.innerHTML = `
    <div style="font-size:.76rem;font-weight:700;color:var(--pk-green);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Quote Comparison</div>
    <div class="table-wrap" style="margin-bottom:0">
    <table><thead><tr>
      <th>Contractor</th><th>Excl. VAT</th><th>Total (incl. VAT)</th><th>Lead Time</th><th>Warranty</th>
    </tr></thead><tbody>
      ${sorted.map((q,i) => `<tr ${i===0?'style="background:#f2f8eb"':''}>
        <td><strong>${esc(q.contractor)}</strong>${i===0?' ✓':''}</td>
        <td>${fmt.currency(q.amount||0)}</td>
        <td><strong>${fmt.currency(q.total||q.amount||0)}</strong></td>
        <td>${esc(q.leadTime||'—')}</td>
        <td>${q.warranty ? q.warranty+' months' : '—'}</td>
      </tr>`).join('')}
    </tbody></table></div>
    <div style="margin-top:12px">
      <label style="font-size:.78rem;font-weight:700;color:var(--pk-green)">Recommendation &amp; Reasoning</label>
      <textarea id="hwf-recommendation" style="margin-top:6px;min-height:56px;width:100%" placeholder="State your recommended contractor and reasons…">${esc(_hwCurrentRec)}</textarea>
    </div>`;
}

// Temp store for quote editing inside modal
let _hwEditingQuotes = [];
let _hwCurrentRec    = '';

function addHWQuoteRow() {
  openHWQuoteEditor(-1);
}

function editHWQuote(idx) {
  openHWQuoteEditor(idx);
}

function openHWQuoteEditor(idx) {
  const q = idx >= 0 ? _hwEditingQuotes[idx] : null;
  // Use a compact inline editor injected at top of list
  const el = $('hwf-quotes-list');
  const existing = el.querySelector('.hw-quote-editor');
  if (existing) existing.remove();

  const editorId = 'hwqe_' + Date.now();
  const div = document.createElement('div');
  div.className = 'hw-quote-editor';
  div.dataset.editIdx = idx;
  div.innerHTML = `
    <div class="hw-qe-header">
      <strong style="font-size:.84rem;color:var(--pk-green)">${idx >= 0 ? 'Edit Quotation' : 'New Quotation'}</strong>
      <button type="button" class="btn btn-xs" onclick="this.closest('.hw-quote-editor').remove()" style="background:none;border:none;font-size:1.1rem;cursor:pointer;color:var(--text-muted)">&#215;</button>
    </div>
    <div class="form-grid" style="margin-top:10px">
      <div class="form-group full"><label>Contractor *</label><input type="text" id="hwqe-contractor" value="${esc(q?.contractor||'')}" placeholder="Company / contractor name"></div>
      <div class="form-group"><label>Amount excl. VAT (R)</label><input type="number" id="hwqe-amount" value="${esc(q?.amount||'')}" step="0.01" min="0" oninput="calcHWQuoteVAT()"></div>
      <div class="form-group"><label>VAT (R) — auto</label><input type="number" id="hwqe-vat" value="${esc(q?.vat||'')}" step="0.01" min="0" readonly style="background:var(--ivory)"></div>
      <div class="form-group"><label>Total incl. VAT (R)</label><input type="number" id="hwqe-total" value="${esc(q?.total||'')}" step="0.01" min="0" readonly style="background:var(--ivory)"></div>
      <div class="form-group"><label>Lead Time</label><input type="text" id="hwqe-lead" value="${esc(q?.leadTime||'')}" placeholder="e.g. 3 weeks"></div>
      <div class="form-group"><label>Warranty (months)</label><input type="number" id="hwqe-warranty" value="${esc(q?.warranty||'')}" min="0"></div>
      <div class="form-group full"><label>Notes</label><textarea id="hwqe-notes" style="min-height:48px">${esc(q?.notes||'')}</textarea></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button type="button" class="btn btn-primary btn-sm" onclick="confirmHWQuote(${idx})">Save Quote</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="this.closest('.hw-quote-editor').remove()">Cancel</button>
    </div>`;
  el.insertBefore(div, el.firstChild);
  div.querySelector('#hwqe-contractor').focus();
}

function calcHWQuoteVAT() {
  const a = parseFloat($('hwqe-amount')?.value||0);
  const v = a * 0.15;
  if ($('hwqe-vat'))   $('hwqe-vat').value   = v.toFixed(2);
  if ($('hwqe-total')) $('hwqe-total').value  = (a+v).toFixed(2);
}

function confirmHWQuote(editIdx) {
  const contractor = ($('hwqe-contractor')?.value||'').trim();
  if (!contractor) { toast('Contractor name is required','error'); return; }
  const q = {
    id:          uid(),
    contractor,
    amount:      $('hwqe-amount')?.value  || '0',
    vat:         $('hwqe-vat')?.value     || '0',
    total:       $('hwqe-total')?.value   || '0',
    leadTime:    $('hwqe-lead')?.value    || '',
    warranty:    $('hwqe-warranty')?.value|| '',
    notes:       $('hwqe-notes')?.value   || '',
  };
  if (editIdx >= 0) _hwEditingQuotes[editIdx] = q;
  else _hwEditingQuotes.push(q);

  // Remove editor
  document.querySelector('.hw-quote-editor')?.remove();
  _hwCurrentRec = $('hwf-recommendation')?.value || _hwCurrentRec;
  renderHWQuoteList(_hwEditingQuotes);
  toast('Quote saved');
}

function removeHWQuoteRow(idx) {
  if (!confirm('Remove this quotation?')) return;
  _hwEditingQuotes.splice(idx, 1);
  renderHWQuoteList(_hwEditingQuotes);
}

function collectHWQuotes() {
  _hwCurrentRec = $('hwf-recommendation')?.value || _hwCurrentRec;
  return _hwEditingQuotes.map(q => ({ ...q, recommendation: _hwCurrentRec }));
}

/* ── HW Invoices / Actual Spend ──────────────────────────── */
let _hwEditingInvoices = [];

function renderHWInvoiceList(invoices, budget) {
  _hwEditingInvoices = invoices ? [...invoices] : [];
  const el = $('hwf-invoices-list'); if (!el) return;
  updateHWSpendTracker(budget);
  if (!_hwEditingInvoices.length) {
    el.innerHTML = '<p class="hint-msg">No expenses recorded yet.</p>';
    return;
  }
  el.innerHTML = '<div class="hw-invoice-table">' +
    '<div class="hw-inv-header"><span>Description</span><span>Supplier</span><span>Date</span><span>Amount (R)</span><span>Paid</span><span></span></div>' +
    _hwEditingInvoices.map((inv,i) => `<div class="hw-inv-row">
      <input type="text"     class="hwinv-desc"     value="${esc(inv.description||'')}" placeholder="Description…">
      <input type="text"     class="hwinv-supplier"  value="${esc(inv.supplier||'')}"   placeholder="Supplier…">
      <input type="date"     class="hwinv-date"     value="${esc(inv.date||'')}">
      <input type="number"   class="hwinv-amount"   value="${esc(inv.amount||'')}" step="0.01" min="0" oninput="updateHWSpendTracker(${budget})">
      <input type="checkbox" class="hwinv-paid"     ${inv.paid?'checked':''} style="accent-color:var(--pk-green);width:18px;height:18px" title="Paid">
      <button type="button" class="btn btn-xs btn-danger" onclick="removeHWInvoiceRow(this,${budget})">&#215;</button>
    </div>`).join('') + '</div>';
}

function addHWInvoiceRow() {
  let list = $('hwf-invoices-list');
  if (list.querySelector('.hint-msg')) list.innerHTML = '<div class="hw-invoice-table"><div class="hw-inv-header"><span>Description</span><span>Supplier</span><span>Date</span><span>Amount (R)</span><span>Paid</span><span></span></div></div>';
  let table = list.querySelector('.hw-invoice-table');
  const budget = parseFloat($('hwf-budget')?.value||0);
  const row = document.createElement('div');
  row.className = 'hw-inv-row';
  row.innerHTML = `
    <input type="text"     class="hwinv-desc"     placeholder="e.g. Labour, materials…">
    <input type="text"     class="hwinv-supplier"  placeholder="Supplier name…">
    <input type="date"     class="hwinv-date"     value="${new Date().toISOString().split('T')[0]}">
    <input type="number"   class="hwinv-amount"   placeholder="0.00" step="0.01" min="0" oninput="updateHWSpendTracker(${budget})">
    <input type="checkbox" class="hwinv-paid"     style="accent-color:var(--pk-green);width:18px;height:18px" title="Paid">
    <button type="button" class="btn btn-xs btn-danger" onclick="removeHWInvoiceRow(this,${budget})">&#215;</button>`;
  table.appendChild(row);
  row.querySelector('.hwinv-desc').focus();
}

function removeHWInvoiceRow(btn, budget) {
  btn.closest('.hw-inv-row').remove();
  const table = $('hwf-invoices-list').querySelector('.hw-invoice-table');
  if (table && !table.querySelectorAll('.hw-inv-row').length) {
    $('hwf-invoices-list').innerHTML = '<p class="hint-msg">No expenses recorded yet.</p>';
  }
  updateHWSpendTracker(budget||parseFloat($('hwf-budget')?.value||0));
}

function updateHWSpendTracker(budget) {
  const el = $('hwf-spend-tracker'); if (!el) return;
  budget = budget || parseFloat($('hwf-budget')?.value||0);
  const rows  = document.querySelectorAll('#hwf-invoices-list .hw-inv-row');
  const total = Array.from(rows).reduce((s,r) => s + (parseFloat(r.querySelector('.hwinv-amount')?.value)||0), 0);
  const paid  = Array.from(rows).filter(r => r.querySelector('.hwinv-paid')?.checked)
                                .reduce((s,r) => s + (parseFloat(r.querySelector('.hwinv-amount')?.value)||0), 0);
  const remaining = budget - total;
  const over  = total > budget && budget > 0;
  const pct   = budget > 0 ? Math.min(total/budget*100,100) : null;

  el.innerHTML = `<div class="hw-spend-tracker">
    <div class="hw-spt-row">
      <div class="hw-spt-item"><div class="hw-spt-label">Budget</div><div class="hw-spt-val">${budget?fmt.currency(budget):'—'}</div></div>
      <div class="hw-spt-item"><div class="hw-spt-label">Total Invoiced</div><div class="hw-spt-val ${over?'hw-over':''}">${fmt.currency(total)}</div></div>
      <div class="hw-spt-item"><div class="hw-spt-label">Paid</div><div class="hw-spt-val" style="color:#2e7d32">${fmt.currency(paid)}</div></div>
      <div class="hw-spt-item"><div class="hw-spt-label">${over?'Over Budget':'Remaining'}</div><div class="hw-spt-val ${over?'hw-over':'hw-under'}">${fmt.currency(Math.abs(remaining))}</div></div>
    </div>
    ${pct!==null?`<div class="hw-spt-bar-outer"><div class="hw-spt-bar-inner ${over?'hw-over':''}" style="width:${pct.toFixed(1)}%"></div></div>
    <div style="font-size:.72rem;color:${over?'var(--danger)':'var(--text-muted)'};margin-top:4px">${pct.toFixed(0)}% of budget used${over?' — OVER BUDGET':''}</div>`:
    '<div style="font-size:.74rem;color:var(--text-muted);margin-top:2px">Set a budget above to track spend</div>'}
  </div>`;
}

function collectHWInvoices() {
  const rows = document.querySelectorAll('#hwf-invoices-list .hw-inv-row');
  return Array.from(rows).map(row => ({
    id:          uid(),
    description: row.querySelector('.hwinv-desc')?.value     || '',
    supplier:    row.querySelector('.hwinv-supplier')?.value  || '',
    date:        row.querySelector('.hwinv-date')?.value      || '',
    amount:      row.querySelector('.hwinv-amount')?.value    || '',
    paid:        row.querySelector('.hwinv-paid')?.checked    || false,
  })).filter(i => i.description || parseFloat(i.amount));
}

function applyHWTemplate() {
  const key = $('hwf-template')?.value;
  if (!key || !HW_TEMPLATES[key]) return;
  const t = HW_TEMPLATES[key];
  if (t.category)      $('hwf-category').value     = t.category;
  if (t.priority)      $('hwf-priority').value      = t.priority;
  if (t.scopeSummary)  $('hwf-scope-summary').value = t.scopeSummary;
  renderHWScopeList(t.scopeItems || []);
  renderHWMilestoneList(t.milestones || []);
  if (!$('hwf-title').value) $('hwf-title').value = key.charAt(0).toUpperCase() + key.slice(1) + ' — ' + getCurrentHoliday();
  $('hwf-template').dataset.applied = key;
  toast('Template applied');
}

/* ── Save ── */
function saveHWProject() {
  const title = ($('hwf-title')?.value || '').trim();
  if (!title) { toast('Project title is required', 'error'); return; }
  UndoManager.push($('hwf-id').value ? 'edit HW project' : 'create HW project');
  const existingId = $('hwf-id').value;
  const projs = loadHWProjects();

  const tplEl = $('hwf-template');
  const data = {
    title,
    category:      $('hwf-category')?.value     || 'Renovation',
    holiday:       $('hwf-holiday')?.value       || '',
    priority:      $('hwf-priority')?.value      || 'Medium',
    status:        $('hwf-status')?.value        || 'Planning',
    location:      $('hwf-location')?.value      || '',
    contractor:    $('hwf-contractor')?.value    || '',
    cell:          $('hwf-cell')?.value          || '',
    budget:        $('hwf-budget')?.value        || '',
    scopeSummary:  $('hwf-scope-summary')?.value || '',
    exclusions:    $('hwf-exclusions')?.value    || '',
    planDate:      $('hwf-plan-date')?.value     || '',
    startDate:     $('hwf-start-date')?.value    || '',
    endDate:       $('hwf-end-date')?.value      || '',
    handoverDate:  $('hwf-handover-date')?.value || '',
    timelineNotes: $('hwf-timeline-notes')?.value|| '',
    notes:         $('hwf-notes')?.value         || '',
    template:      tplEl?.dataset.applied || tplEl?.value || '',
    scopeItems:    collectHWScopeItems(),
    milestones:    collectHWMilestones(),
    quotes:        collectHWQuotes(),
    invoices:      collectHWInvoices(),
  };

  if (existingId) {
    const idx = projs.findIndex(x => x.id === existingId);
    if (idx >= 0) projs[idx] = { ...projs[idx], ...data, dateUpdated: new Date().toISOString() };
  } else {
    projs.push({ id: uid(), dateAdded: new Date().toISOString(), quotes: [], invoices: [], ...data });
  }

  if (saveHWProjects(projs)) {
    hwProjects = projs;
    closeModal('hw-modal');
    renderHolidayWork();
    ActivityLog.add(existingId ? 'status' : 'create', (existingId ? 'Updated' : 'Created') + ' HW project <strong>' + esc(title) + '</strong>');
    triggerBackupOnSave();
    toast('Holiday project saved');
  }
}

async function deleteHWProject(id) {
  if (!confirm('Delete this holiday project?')) return;
  UndoManager.push('delete HW project');
  const delP = loadHWProjects().find(p => p.id === id);
  const projs = loadHWProjects().filter(p => p.id !== id);
  localStorage.setItem(hwKey(), JSON.stringify(projs));
  hwProjects = projs;
  renderHolidayWork();
  if (delP) ActivityLog.add('delete', 'Deleted HW project <strong>' + esc(delP.title || 'Untitled') + '</strong>');
  toast('Deleted');
  if (SUPABASE_URL) {
    setSyncStatus('syncing');
    const res = await SB.delete('hw_projects?id=eq.' + id);
    setSyncStatus(res !== null ? 'synced' : 'error');
  }
}

/* ── New Build ────────────────────────────────────────────── */

const nbKey = () => 'nhfm_newbuild_' + currentSiteId;
function loadNBProjects()  { try { return JSON.parse(localStorage.getItem(nbKey())) || []; } catch { return []; } }
function saveNBProjects(d) { try { localStorage.setItem(nbKey(), JSON.stringify(d)); if (SUPABASE_URL) pushNBProjectsToSupabase(); return true; } catch(e) { toast('Save error: '+e.message,'error'); return false; } }

let nbProjects = [];
let nbCurrentCat = 'All';

function renderNewBuild() {
  nbProjects = loadNBProjects();
  renderNBStats();
  renderNBGrid();
}

function renderNBStats() {
  const el = $('nb-stats'); if (!el) return;
  const all       = nbProjects;
  const active    = all.filter(p => ['Planning','Design','Approved','Tender','Awarded','In Progress','Snag List'].includes(p.status));
  const done      = all.filter(p => p.status === 'Completed');
  const budget    = all.reduce((s,p) => s + parseFloat(p.budget||0), 0);
  const totalSpend= all.reduce((s,p) => s + (p.invoices||[]).reduce((t,i)=>t+parseFloat(i.amount||0),0), 0);
  const totalQuotes = all.reduce((s,p) => s + (p.quotes||[]).length, 0);
  const overBudget= all.filter(p => {
    const b = parseFloat(p.budget||0);
    const sp= (p.invoices||[]).reduce((t,i)=>t+parseFloat(i.amount||0),0);
    return b > 0 && sp > b;
  }).length;

  el.innerHTML = [
    { label:'Total Projects', val: all.length,       sub:'all new builds' },
    { label:'Active',         val: active.length,    sub:'in progress / planned' },
    { label:'Completed',      val: done.length,      sub:'finished' },
    { label:'Total Budget',   val: budget ? fmt.currency(budget) : 'R 0.00',    sub:'all build projects', big:true },
    { label:'Actual Spend',   val: totalSpend ? fmt.currency(totalSpend) : 'R 0.00', sub: overBudget ? overBudget+' over budget' : 'total invoiced', big:true, warn: overBudget > 0 },
    { label:'Total Quotes',   val: totalQuotes,      sub:'across all projects' },
  ].map(s => `<div class="stat-card ${s.warn?'stat-warn':''}">
    <div class="stat-label">${s.label}</div>
    <div class="stat-value" style="${s.big ? 'font-size:1rem' : ''}">${s.val}</div>
    <div class="stat-sub">${s.sub}</div>
  </div>`).join('');
}

function switchNBTab(btn) {
  document.querySelectorAll('#nb-filter-tabs .hw-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  nbCurrentCat = btn.dataset.nbcat;
  renderNBGrid();
}

function renderNBGrid() {
  const el = $('nb-grid'); if (!el) return;
  const items = nbCurrentCat === 'All' ? nbProjects : nbProjects.filter(p => p.category === nbCurrentCat);
  if (!items.length) {
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="empty-icon">🏗</div>
      <h3>No build projects${nbCurrentCat!=='All'?' in this category':''}</h3>
      <p>${nbCurrentCat!=='All'?'Try selecting a different category.':'Track new buildings, extensions and infrastructure projects.'}</p>
      ${nbCurrentCat==='All'?'<button class="btn btn-primary btn-sm" onclick="openNBModal()">+ New Build Project</button>':''}
    </div>`;
    return;
  }
  el.innerHTML = items.map(p => {
    const scopeItems = p.scopeItems || [];
    const milestones = p.milestones || [];
    const doneScope  = scopeItems.filter(s => s.done).length;
    const today      = new Date();
    const daysToStart = p.startDate ? Math.ceil((new Date(p.startDate) - today) / 86400000) : null;
    const daysToEnd   = p.endDate   ? Math.ceil((new Date(p.endDate)   - today) / 86400000) : null;
    const isOverdue   = daysToEnd !== null && daysToEnd < 0 && p.status !== 'Completed';

    const statusMap = {
      'Planning':'draft','Design':'planning','Approved':'approved','Tender':'awaiting-quotes',
      'Awarded':'awaiting-approval','In Progress':'in-progress','Snag List':'quotes-received',
      'Completed':'completed','On Hold':'archived'
    };
    const sBadge = `<span class="badge badge-${statusMap[p.status]||'draft'}">${esc(p.status)}</span>`;

    let countBadge = '';
    if (p.status === 'Completed') countBadge = '';
    else if (isOverdue) countBadge = `<span class="hw-count-badge hw-overdue">${Math.abs(daysToEnd)}d overdue</span>`;
    else if (daysToStart !== null && daysToStart >= 0 && daysToStart <= 14) countBadge = `<span class="hw-count-badge hw-soon">Starts in ${daysToStart}d</span>`;
    else if (daysToEnd !== null && daysToEnd >= 0 && daysToEnd <= 7) countBadge = `<span class="hw-count-badge hw-urgent">${daysToEnd}d left</span>`;

    const scopePct = scopeItems.length ? Math.round(doneScope / scopeItems.length * 100) : null;

    return `<div class="hw-card" draggable="true" data-id="${p.id}">
      <div class="hwc-header">
        <span class="drag-handle" title="Drag to reorder">&#9776;</span>
        <div style="flex:1;min-width:0">
          <div class="hwc-cat"><span class="nb-editable" onclick="nbInlineEdit('${p.id}','category',this,event)" title="Click to edit category">${esc(p.category)}</span>${p.size ? ' · '+esc(p.size)+' m²' : ''}</div>
          <div class="hwc-title nb-editable" onclick="nbInlineEdit('${p.id}','title',this,event)" title="Click to edit title">${esc(p.title)}</div>
          <div class="hwc-location nb-editable" onclick="nbInlineEdit('${p.id}','location',this,event)" title="Click to edit location">${esc(p.location||'Add location…')}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;display:flex;flex-direction:column;gap:4px;align-items:flex-end">
          <span class="badge badge-${statusMap[p.status]||'draft'} nb-editable" onclick="nbInlineEdit('${p.id}','status',this,event)" title="Click to change status" style="cursor:pointer">${esc(p.status)}</span>
          ${countBadge}
          <span class="badge badge-${(p.priority||'medium').toLowerCase()} nb-editable" onclick="nbInlineEdit('${p.id}','priority',this,event)" title="Click to change priority" style="font-size:.66rem;cursor:pointer">${esc(p.priority||'Medium')}</span>
        </div>
      </div>

      <div class="hwc-dates">
        <span class="nb-editable" onclick="nbInlineEdit('${p.id}','startDate',this,event)" title="Click to edit start date">Start: <strong>${p.startDate ? fmt.date(p.startDate) : '—'}</strong></span>
        <span class="nb-editable" onclick="nbInlineEdit('${p.id}','endDate',this,event)" title="Click to edit end date">End: <strong>${p.endDate ? fmt.date(p.endDate) : '—'}</strong></span>
        <span class="nb-editable" onclick="nbInlineEdit('${p.id}','handoverDate',this,event)" title="Click to edit handover date">Handover: <strong>${p.handoverDate ? fmt.date(p.handoverDate) : '—'}</strong></span>
      </div>

      ${(p.scopeSummary || scopeItems.length) ? `<div class="panel" style="margin-top:10px;border-radius:var(--radius-sm)">
        <div class="panel-header" style="padding:8px 12px;font-size:.78rem">
          <span class="panel-title" style="font-size:.78rem">Scope of Work${scopeItems.length ? ` (${doneScope}/${scopeItems.length} done)` : ''}</span>
          <span class="panel-toggle">&#9660;</span>
        </div>
        <div class="panel-body" style="padding:10px 12px">
          ${p.scopeSummary ? `<p style="font-size:.8rem;color:var(--text-secondary);line-height:1.5;margin-bottom:${scopeItems.length?'10px':'0'}">${esc(p.scopeSummary)}</p>` : ''}
          ${scopeItems.length ? `<div class="hw-scope-list">
            ${scopeItems.map((s,i) => `<label class="hw-scope-item">
              <input type="checkbox" ${s.done?'checked':''} onchange="toggleNBScopeItem('${p.id}',${i},this.checked)" style="accent-color:var(--pk-green)">
              <span style="${s.done?'text-decoration:line-through;color:var(--text-muted)':''}">${esc(s.text)}</span>
            </label>`).join('')}
          </div>` : ''}
          ${scopePct !== null ? `<div style="margin-top:8px;height:5px;background:var(--platinum);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${scopePct}%;background:var(--pk-green);border-radius:3px;transition:width .3s"></div>
          </div>` : ''}
        </div>
      </div>` : ''}

      ${milestones.length ? `<div class="panel" style="margin-top:8px;border-radius:var(--radius-sm)">
        <div class="panel-header" style="padding:8px 12px">
          <span class="panel-title" style="font-size:.78rem">Milestones (${milestones.filter(m=>m.done).length}/${milestones.length})</span>
          <span class="panel-toggle">&#9660;</span>
        </div>
        <div class="panel-body" style="padding:10px 12px">
          <div class="hw-milestone-list">
            ${milestones.map((m,i) => `<div class="hw-milestone-item">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                <input type="checkbox" ${m.done?'checked':''} onchange="toggleNBMilestone('${p.id}',${i},this.checked)" style="accent-color:var(--pk-green);flex-shrink:0">
                <span style="${m.done?'text-decoration:line-through;color:var(--text-muted)':''};">${esc(m.text)}</span>
              </label>
              ${m.date ? `<span class="hw-milestone-date">${fmt.date(m.date)}</span>` : ''}
            </div>`).join('')}
          </div>
        </div>
      </div>` : ''}

      ${(() => {
        const budget     = parseFloat(p.budget||0);
        const quotes     = (p.quotes||[]).sort((a,b)=>parseFloat(a.total||a.amount||0)-parseFloat(b.total||b.amount||0));
        const invoices   = p.invoices||[];
        const totalSpend = invoices.reduce((s,i)=>s+parseFloat(i.amount||0),0);
        const paid       = invoices.filter(i=>i.paid).reduce((s,i)=>s+parseFloat(i.amount||0),0);
        const over       = totalSpend > budget && budget > 0;
        const pct        = budget > 0 ? Math.min(totalSpend/budget*100,100).toFixed(0) : null;
        const rec        = quotes[0]?.recommendation || '';
        if (!budget && !quotes.length && !invoices.length) return '';
        let html = '<div class="hwc-financial">';
        if (budget || totalSpend) {
          html += '<div class="hwc-fin-row">';
          if (budget)     html += '<div class="hwc-fin-item"><div class="hwc-fin-label">Budget</div><div class="hwc-fin-val">' + fmt.currency(budget) + '</div></div>';
          if (totalSpend) html += '<div class="hwc-fin-item"><div class="hwc-fin-label">Invoiced</div><div class="hwc-fin-val ' + (over?'hwc-over':'') + '">' + fmt.currency(totalSpend) + '</div></div>';
          if (paid > 0)   html += '<div class="hwc-fin-item"><div class="hwc-fin-label">Paid</div><div class="hwc-fin-val" style="color:#2e7d32">' + fmt.currency(paid) + '</div></div>';
          if (budget && totalSpend) html += '<div class="hwc-fin-item"><div class="hwc-fin-label">' + (over?'Over':'Left') + '</div><div class="hwc-fin-val ' + (over?'hwc-over':'hwc-under') + '">' + fmt.currency(Math.abs(budget-totalSpend)) + '</div></div>';
          html += '</div>';
          if (pct!==null) html += '<div class="hwc-fin-bar-outer"><div class="hwc-fin-bar ' + (over?'hwc-over':'') + '" style="width:' + pct + '%"></div></div>';
        }
        if (quotes.length) {
          html += '<div class="hwc-quotes-summary"><div class="hwc-qs-title">Quotes (' + quotes.length + ')</div>';
          quotes.slice(0,3).forEach((q,i) => {
            html += '<div class="hwc-qs-row ' + (i===0?'hwc-qs-best':'') + '"><span>' + esc(q.contractor) + '</span><span>' + fmt.currency(q.total||q.amount||0) + '</span>' + (i===0?'<span class="badge badge-approved" style="font-size:.58rem">Lowest</span>':'') + '</div>';
          });
          if (rec) html += '<div class="hwc-rec">' + esc(rec.slice(0,100)) + (rec.length>100?'…':'') + '</div>';
          html += '</div>';
        }
        html += '</div>';
        return html;
      })()}

      <div style="font-size:.78rem;color:var(--text-muted);padding:8px 16px 4px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        ${p.architect ? `<span>Architect: <strong style="color:var(--text-primary)">${esc(p.architect)}</strong></span>` : ''}
        <span class="nb-editable" onclick="nbInlineEdit('${p.id}','contractor',this,event)" title="Click to edit contractor">Contractor: <strong style="color:var(--text-primary)">${esc(p.contractor||'Add…')}</strong></span>
        ${p.cell ? '<div onclick="event.stopPropagation()" style="display:inline-block">' + (typeof waButtonGroup==='function' ? waButtonGroup(p.cell, {id:p.id, projectName:p.title, projectNumber:'NB', contactPerson:p.contractor, telephone:p.cell, location:p.location||'', startDate:p.startDate||'', completionDate:p.endDate||'', quoteDueDate:'', description:p.scopeSummary||'', status:p.status||''}, 'nb') : '') + '</div>' : ''}
      </div>
      <div class="nb-editable" style="font-size:.78rem;color:var(--text-secondary);padding:8px 16px 4px;line-height:1.5;border-top:1px solid var(--border);cursor:pointer" onclick="nbInlineEdit('${p.id}','notes',this,event)" title="Click to edit notes">${p.notes ? esc(p.notes.slice(0,140)) + (p.notes.length>140?'…':'') : '<span style="color:var(--text-muted);font-style:italic">Add notes…</span>'}</div>

      <div class="hwc-actions">
        <span style="font-size:.7rem;color:var(--text-muted)">Added ${fmt.date(p.dateAdded)}</span>
        <div style="display:flex;gap:6px;align-items:center">
          <button class="btn btn-sm btn-outline" onclick="openNBModal('${p.id}')">Edit</button>
          <button class="btn btn-sm btn-danger" onclick="deleteNBProject('${p.id}')">Delete</button>
          ${cardMenuHtml()}
        </div>
      </div>
    </div>`;
  }).join('');
  enableDragSort('nb-grid', '.hw-card', (from, to) => {
    const filtered = nbCurrentCat === 'All' ? nbProjects : nbProjects.filter(p => p.category === nbCurrentCat);
    const fromId = filtered[from]?.id, toId = filtered[to]?.id;
    if (!fromId) return;
    const fi = nbProjects.findIndex(p => p.id === fromId);
    const ti = nbProjects.findIndex(p => p.id === toId);
    if (fi < 0 || ti < 0) return;
    arrayMove(nbProjects, fi, ti);
    saveNBProjects(nbProjects);
    renderNBGrid();
  });
}

function toggleNBScopeItem(pid, idx, checked) {
  const projs = loadNBProjects();
  const p = projs.find(x => x.id === pid); if (!p) return;
  if (p.scopeItems && p.scopeItems[idx] !== undefined) p.scopeItems[idx].done = checked;
  saveNBProjects(projs);
  nbProjects = projs;
  renderNBStats();
}

function toggleNBMilestone(pid, idx, checked) {
  const projs = loadNBProjects();
  const p = projs.find(x => x.id === pid); if (!p) return;
  if (p.milestones && p.milestones[idx] !== undefined) p.milestones[idx].done = checked;
  saveNBProjects(projs);
  nbProjects = projs;
}

function nbInlineEdit(pid, field, el, ev) {
  ev.stopPropagation();
  if (el.querySelector('input,select')) return;
  const projs = loadNBProjects();
  const p = projs.find(x => x.id === pid);
  if (!p) return;

  const val = p[field] || '';
  const selectOpts = {
    status:   ['Planning','Design','Approved','Tender','Awarded','In Progress','Snag List','Completed','On Hold'],
    priority: ['Low','Medium','High'],
    category: ['New Building','Extension','Infrastructure','Conversion','Other'],
  };

  let input;
  if (selectOpts[field]) {
    input = document.createElement('select');
    selectOpts[field].forEach(o => {
      const opt = document.createElement('option');
      opt.value = o; opt.textContent = o;
      if (o === val) opt.selected = true;
      input.appendChild(opt);
    });
  } else if (['startDate','endDate','handoverDate','designDate'].includes(field)) {
    input = document.createElement('input');
    input.type = 'date';
    input.value = val;
  } else {
    input = document.createElement('input');
    input.type = 'text';
    input.value = val;
  }

  input.className = 'hw-inline-input';
  input.style.cssText = 'font-size:inherit;font-weight:inherit;color:inherit;padding:2px 6px;border:2px solid var(--asp-green);border-radius:4px;background:var(--ivory);outline:none;width:100%;box-sizing:border-box;min-width:80px;';

  const save = () => {
    const nv = input.value;
    if (nv === val) { renderNBGrid(); return; }
    UndoManager.push('edit build ' + field);
    const projs2 = loadNBProjects();
    const p2 = projs2.find(x => x.id === pid);
    if (p2) {
      p2[field] = nv;
      p2.dateUpdated = new Date().toISOString();
      saveNBProjects(projs2);
      nbProjects = projs2;
    }
    renderNewBuild();
    toast(field.replace(/([A-Z])/g,' $1').replace(/^./,s=>s.toUpperCase()) + ' updated');
  };

  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') { renderNBGrid(); } });

  el.textContent = '';
  el.appendChild(input);
  if (input.tagName === 'SELECT') input.addEventListener('change', save);
  setTimeout(() => {
    input.focus();
    if (input.type === 'text') input.select();
    input.addEventListener('blur', save);
  }, 0);
}

function openNBModal(id) {
  nbProjects = loadNBProjects();
  const p = id ? nbProjects.find(x => x.id === id) : null;
  $('nb-modal-title').textContent = p ? 'Edit Build Project' : 'New Build Project';
  $('nbf-id').value = id || '';

  const set = (fid, val) => { const el=$(fid); if(el) el.value = val||''; };
  set('nbf-title',          p?.title||'');
  set('nbf-category',       p?.category||'New Building');
  set('nbf-priority',       p?.priority||'Medium');
  set('nbf-status',         p?.status||'Planning');
  set('nbf-location',       p?.location||'');
  set('nbf-architect',      p?.architect||'');
  set('nbf-contractor',     p?.contractor||'');
  set('nbf-cell',           p?.cell||'');
  set('nbf-budget',         p?.budget||'');
  set('nbf-size',           p?.size||'');
  set('nbf-scope-summary',  p?.scopeSummary||'');
  set('nbf-exclusions',     p?.exclusions||'');
  set('nbf-design-date',    p?.designDate||'');
  set('nbf-start-date',     p?.startDate||'');
  set('nbf-end-date',       p?.endDate||'');
  set('nbf-handover-date',  p?.handoverDate||'');
  set('nbf-timeline-notes', p?.timelineNotes||'');
  set('nbf-notes',          p?.notes||'');

  _nbEditingQuotes = p ? (p.quotes ? [...p.quotes] : []) : [];

  renderNBScopeList(p?.scopeItems || []);
  renderNBMilestoneList(p?.milestones || []);
  renderNBQuoteList(p?.quotes || []);
  renderNBInvoiceList(p?.invoices || [], parseFloat(p?.budget||0));

  openModal('nb-modal');
}

function renderNBScopeList(items) {
  const el = $('nbf-scope-list'); if (!el) return;
  if (!items.length) { el.innerHTML = '<p class="hint-msg" style="margin-bottom:4px">No scope items yet.</p>'; return; }
  el.innerHTML = items.map((s,i) => `<div class="hw-scope-row" data-idx="${i}">
    <input type="checkbox" class="hwsr-done" ${s.done?'checked':''} style="accent-color:var(--pk-green);flex-shrink:0">
    <input type="text" class="hwsr-text" value="${esc(s.text)}" placeholder="Scope item description…" style="flex:1">
    <button type="button" class="btn btn-xs btn-danger" onclick="this.closest('.hw-scope-row').remove()">&#215;</button>
  </div>`).join('');
}

function addNBScopeItem() {
  const el = $('nbf-scope-list');
  if (el.querySelector('.hint-msg')) el.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'hw-scope-row';
  row.innerHTML = `
    <input type="checkbox" class="hwsr-done" style="accent-color:var(--pk-green);flex-shrink:0">
    <input type="text" class="hwsr-text" placeholder="e.g. Foundation slab complete…" style="flex:1">
    <button type="button" class="btn btn-xs btn-danger" onclick="this.closest('.hw-scope-row').remove()">&#215;</button>`;
  el.appendChild(row);
  row.querySelector('.hwsr-text').focus();
}

function collectNBScopeItems() {
  return Array.from(document.querySelectorAll('#nbf-scope-list .hw-scope-row')).map(row => ({
    text: row.querySelector('.hwsr-text')?.value || '',
    done: row.querySelector('.hwsr-done')?.checked || false,
  })).filter(s => s.text.trim());
}

function renderNBMilestoneList(items) {
  const el = $('nbf-milestone-list'); if (!el) return;
  if (!items.length) { el.innerHTML = '<p class="hint-msg" style="margin-bottom:4px">No milestones yet.</p>'; return; }
  el.innerHTML = items.map((m,i) => `<div class="hw-milestone-row" data-idx="${i}">
    <input type="checkbox" class="hwmr-done" ${m.done?'checked':''} style="accent-color:var(--pk-green);flex-shrink:0">
    <input type="text" class="hwmr-text" value="${esc(m.text)}" placeholder="Milestone description…" style="flex:1">
    <input type="date" class="hwmr-date" value="${esc(m.date||'')}" style="width:140px">
    <button type="button" class="btn btn-xs btn-danger" onclick="this.closest('.hw-milestone-row').remove()">&#215;</button>
  </div>`).join('');
}

function addNBMilestone() {
  const el = $('nbf-milestone-list');
  if (el.querySelector('.hint-msg')) el.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'hw-milestone-row';
  row.innerHTML = `
    <input type="checkbox" class="hwmr-done" style="accent-color:var(--pk-green);flex-shrink:0">
    <input type="text" class="hwmr-text" placeholder="e.g. Roof structure complete…" style="flex:1">
    <input type="date" class="hwmr-date" style="width:140px">
    <button type="button" class="btn btn-xs btn-danger" onclick="this.closest('.hw-milestone-row').remove()">&#215;</button>`;
  el.appendChild(row);
  row.querySelector('.hwmr-text').focus();
}

function collectNBMilestones() {
  return Array.from(document.querySelectorAll('#nbf-milestone-list .hw-milestone-row')).map(row => ({
    text: row.querySelector('.hwmr-text')?.value || '',
    date: row.querySelector('.hwmr-date')?.value || '',
    done: row.querySelector('.hwmr-done')?.checked || false,
  })).filter(m => m.text.trim());
}

let _nbEditingQuotes = [];

function renderNBQuoteList(quotes) {
  const el = $('nbf-quotes-list'); if (!el) return;
  _nbEditingQuotes = quotes && quotes.length ? [...quotes] : [];
  if (!_nbEditingQuotes.length) { el.innerHTML = '<p class="hint-msg">No quotations added yet.</p>'; return; }
  el.innerHTML = _nbEditingQuotes.map((q,i) => `<div class="hw-quote-row" style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;align-items:end;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--border)">
    <div class="form-group"><label>Contractor</label><input type="text" class="nbqr-contractor" value="${esc(q.contractor||'')}" placeholder="Company name"></div>
    <div class="form-group"><label>Amount (excl. VAT)</label><input type="number" class="nbqr-amount" value="${q.amount||''}" step="0.01" min="0" placeholder="0.00"></div>
    <div class="form-group"><label>Total (incl. VAT)</label><input type="number" class="nbqr-total" value="${q.total||''}" step="0.01" min="0" placeholder="0.00"></div>
    <button type="button" class="btn btn-xs btn-danger" style="margin-bottom:4px" onclick="removeNBQuote(${i})">&#215;</button>
  </div>`).join('');
}

function addNBQuoteRow() {
  _nbEditingQuotes.push({contractor:'',amount:'',total:''});
  renderNBQuoteList(_nbEditingQuotes);
}

function removeNBQuote(i) {
  _nbEditingQuotes = collectNBQuotes();
  _nbEditingQuotes.splice(i,1);
  renderNBQuoteList(_nbEditingQuotes);
}

function collectNBQuotes() {
  return Array.from(document.querySelectorAll('#nbf-quotes-list .hw-quote-row')).map(row => ({
    contractor: row.querySelector('.nbqr-contractor')?.value || '',
    amount:     row.querySelector('.nbqr-amount')?.value || '',
    total:      row.querySelector('.nbqr-total')?.value || '',
  })).filter(q => q.contractor || q.amount || q.total);
}

function renderNBInvoiceList(invoices, budget) {
  const el = $('nbf-invoices-list'); if (!el) return;
  if (!invoices || !invoices.length) { el.innerHTML = '<p class="hint-msg">No invoices added yet.</p>'; return; }
  el.innerHTML = invoices.map((inv,i) => `<div class="hw-invoice-row" style="display:grid;grid-template-columns:1fr 1fr auto auto;gap:8px;align-items:end;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--border)">
    <div class="form-group"><label>Description</label><input type="text" class="nbir-desc" value="${esc(inv.description||'')}" placeholder="Invoice description"></div>
    <div class="form-group"><label>Amount (R)</label><input type="number" class="nbir-amount" value="${inv.amount||''}" step="0.01" min="0"></div>
    <label style="display:flex;align-items:center;gap:4px;font-size:.78rem;margin-bottom:4px"><input type="checkbox" class="nbir-paid" ${inv.paid?'checked':''}>Paid</label>
    <button type="button" class="btn btn-xs btn-danger" style="margin-bottom:4px" onclick="this.closest('.hw-invoice-row').remove()">&#215;</button>
  </div>`).join('');

  const tracker = $('nbf-spend-tracker');
  if (tracker && budget > 0) {
    const total = invoices.reduce((s,i)=>s+parseFloat(i.amount||0),0);
    const pct = Math.min(total/budget*100,100).toFixed(0);
    const over = total > budget;
    tracker.innerHTML = `<div style="font-size:.8rem;color:var(--text-muted);margin-bottom:6px">Spend: ${fmt.currency(total)} of ${fmt.currency(budget)} (${pct}%)</div>
      <div style="height:6px;background:var(--platinum);border-radius:3px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${over?'var(--danger)':'var(--pk-green)'};border-radius:3px"></div></div>`;
  }
}

function addNBInvoiceRow() {
  const el = $('nbf-invoices-list');
  if (el.querySelector('.hint-msg')) el.innerHTML = '';
  const invoices = collectNBInvoices();
  invoices.push({description:'',amount:'',paid:false});
  renderNBInvoiceList(invoices, parseFloat($('nbf-budget')?.value||0));
}

function collectNBInvoices() {
  return Array.from(document.querySelectorAll('#nbf-invoices-list .hw-invoice-row')).map(row => ({
    description: row.querySelector('.nbir-desc')?.value || '',
    amount:      row.querySelector('.nbir-amount')?.value || '',
    paid:        row.querySelector('.nbir-paid')?.checked || false,
  })).filter(i => i.description || i.amount);
}

function saveNBProject() {
  const title = ($('nbf-title')?.value || '').trim();
  if (!title) { toast('Project title is required', 'error'); return; }
  UndoManager.push($('nbf-id').value ? 'edit new build' : 'create new build');
  const existingId = $('nbf-id').value;
  const projs = loadNBProjects();

  const data = {
    title,
    category:      $('nbf-category')?.value     || 'New Building',
    priority:      $('nbf-priority')?.value      || 'Medium',
    status:        $('nbf-status')?.value        || 'Planning',
    location:      $('nbf-location')?.value      || '',
    architect:     $('nbf-architect')?.value      || '',
    contractor:    $('nbf-contractor')?.value     || '',
    cell:          $('nbf-cell')?.value           || '',
    budget:        $('nbf-budget')?.value         || '',
    size:          $('nbf-size')?.value           || '',
    scopeSummary:  $('nbf-scope-summary')?.value  || '',
    exclusions:    $('nbf-exclusions')?.value     || '',
    designDate:    $('nbf-design-date')?.value    || '',
    startDate:     $('nbf-start-date')?.value     || '',
    endDate:       $('nbf-end-date')?.value       || '',
    handoverDate:  $('nbf-handover-date')?.value  || '',
    timelineNotes: $('nbf-timeline-notes')?.value || '',
    notes:         $('nbf-notes')?.value          || '',
    scopeItems:    collectNBScopeItems(),
    milestones:    collectNBMilestones(),
    quotes:        collectNBQuotes(),
    invoices:      collectNBInvoices(),
  };

  if (existingId) {
    const idx = projs.findIndex(x => x.id === existingId);
    if (idx >= 0) projs[idx] = { ...projs[idx], ...data, dateUpdated: new Date().toISOString() };
  } else {
    projs.push({ id: uid(), dateAdded: new Date().toISOString(), quotes: [], invoices: [], ...data });
  }

  if (saveNBProjects(projs)) {
    nbProjects = projs;
    closeModal('nb-modal');
    renderNewBuild();
    ActivityLog.add(existingId ? 'status' : 'create', (existingId ? 'Updated' : 'Created') + ' NB project <strong>' + esc(title) + '</strong>');
    triggerBackupOnSave();
    toast('Build project saved');
  }
}

async function deleteNBProject(id) {
  if (!confirm('Delete this build project?')) return;
  UndoManager.push('delete new build');
  const delP = loadNBProjects().find(p => p.id === id);
  const projs = loadNBProjects().filter(p => p.id !== id);
  localStorage.setItem(nbKey(), JSON.stringify(projs));
  nbProjects = projs;
  renderNewBuild();
  if (delP) ActivityLog.add('delete', 'Deleted NB project <strong>' + esc(delP.title || 'Untitled') + '</strong>');
  toast('Deleted');
  if (SUPABASE_URL) {
    setSyncStatus('syncing');
    const res = await SB.delete('new_builds?id=eq.' + id);
    setSyncStatus(res !== null ? 'synced' : 'error');
  }
}

async function pushNBProjectsToSupabase() {
  try {
    const projs = loadNBProjects();
    const localIds = new Set(projs.map(p => p.id));
    const rows = projs.map(p => ({
      id:           p.id,
      site_id:      currentSiteId,
      project_name: p.title || 'Untitled',
      status:       p.status || 'Planning',
      category:     p.category || null,
      priority:     p.priority || null,
      date_created: p.dateAdded || null,
      date_updated: p.dateUpdated || null,
      data:         p,
    }));
    if (rows.length) await SB.upsert('new_builds', rows);
    const remote = await SB.get('new_builds?site_id=eq.' + currentSiteId + '&select=id');
    if (remote) {
      const stale = remote.filter(r => !localIds.has(r.id)).map(r => r.id);
      if (stale.length) await SB.delete('new_builds?id=in.(' + stale.join(',') + ')');
    }
  } catch (e) { console.error('pushNBProjects error:', e); }
}

/* ── Reports ─────────────────────────────────────────────── */
function renderReportPage() {
  // Always re-read projects from storage so the dropdown reflects all saves
  refreshProjectsFromStorage();
  const sel = $('report-project-select'); if (!sel) return;
  const cur = sel.value; // preserve current selection if already set
  sel.innerHTML = '<option value="">— Select a project —</option>'
    + State.projects.map(p =>
        `<option value="${p.id}">${esc((p.projectNumber ? p.projectNumber+' — ' : '') + p.projectName)}</option>`
      ).join('');
  // Restore the previously selected project if it still exists
  if (cur && State.projects.find(x => x.id === cur)) sel.value = cur;

  // Hide action bar until a report is generated
  const bar = $('report-action-bar');
  if (bar && !$('printable-report')) bar.style.display = 'none';

  // Pre-fill email recipient from settings if field is empty
  const emailInput = $('report-email-to');
  if (emailInput && !emailInput.value) {
    State.settings = DB.loadObj(DB.keys(currentSiteId).settings, State.settings);
    emailInput.value = State.settings.emailTo || '';
  }
}

function generateReport() {
  const id = $('report-project-select').value;
  if (!id) { toast('Please select a project', 'warning'); return; }

  // Always re-read from storage so the report reflects the very latest saved state
  refreshProjectsFromStorage();
  const p = State.projects.find(x => x.id === id);
  if (!p) { toast('Project not found — please re-select it from the list', 'error'); renderReportPage(); return; }

  // Re-read settings fresh
  State.settings = DB.loadObj(DB.keys(currentSiteId).settings, State.settings);
  const s = State.settings;

  const quotes = (p.quotes||[]).sort((a,b) => parseFloat(a.total||a.amount||0) - parseFloat(b.total||b.amount||0));

  const quotesHtml = quotes.length
    ? `<table style="width:100%;border-collapse:collapse;font-size:.85rem;margin-top:8px">
        <thead><tr style="background:#f2f8eb">
          <th style="padding:8px 12px;border:1px solid #ddd;text-align:left">Contractor</th>
          <th style="padding:8px 12px;border:1px solid #ddd;text-align:right">Excl. VAT</th>
          <th style="padding:8px 12px;border:1px solid #ddd;text-align:right">Total (incl. VAT)</th>
          <th style="padding:8px 12px;border:1px solid #ddd">Lead Time</th>
          <th style="padding:8px 12px;border:1px solid #ddd">Warranty</th>
        </tr></thead>
        <tbody>${quotes.map((q,i) => `
          <tr style="background:${i===0?'#f2f8eb':'#fff'}">
            <td style="padding:8px 12px;border:1px solid #ddd">${esc(q.contractor)}${i===0?' ✓':''}</td>
            <td style="padding:8px 12px;border:1px solid #ddd;text-align:right">${fmt.currency(q.amount)}</td>
            <td style="padding:8px 12px;border:1px solid #ddd;text-align:right"><strong>${fmt.currency(q.total||q.amount)}</strong></td>
            <td style="padding:8px 12px;border:1px solid #ddd">${esc(q.leadTime||'—')}</td>
            <td style="padding:8px 12px;border:1px solid #ddd">${q.warranty ? q.warranty+' months' : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>`
    : '<p style="color:#888;font-size:.85rem">No quotations received.</p>';

  // ── Photos section ────────────────────────────────────────
  const photos = p.photos || [];
  const photosHtml = photos.length
    ? `<div class="report-section">
        <h3>Photographs (${photos.length})</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;margin-top:10px">
          ${photos.map(ph => `
            <div style="break-inside:avoid">
              <img src="${ph.data}" alt="${esc(ph.label||'Photo')}"
                   style="width:100%;height:160px;object-fit:cover;border-radius:6px;border:1px solid #ddd;display:block">
              <div style="font-size:.72rem;color:#666;text-align:center;margin-top:4px;font-weight:600;text-transform:uppercase;letter-spacing:.04em">
                ${esc(ph.label||'Photo')} · ${fmt.date(ph.ts)}
              </div>
            </div>`).join('')}
        </div>
      </div>`
    : '';

  // ── Documents section ─────────────────────────────────────
  const docs = p.documents || [];
  const docsHtml = docs.length
    ? `<div class="report-section">
        <h3>Documents &amp; Attachments (${docs.length})</h3>
        <table style="width:100%;border-collapse:collapse;font-size:.84rem;margin-top:8px">
          <thead><tr style="background:#f2f8eb">
            <th style="padding:7px 12px;border:1px solid #ddd;text-align:left">File Name</th>
            <th style="padding:7px 12px;border:1px solid #ddd">Type</th>
            <th style="padding:7px 12px;border:1px solid #ddd;text-align:right">Size</th>
            <th style="padding:7px 12px;border:1px solid #ddd">Date Attached</th>
          </tr></thead>
          <tbody>${docs.map(d => {
            const ext  = (d.fileName.split('.').pop()||'').toUpperCase();
            const size = d.size ? (d.size > 1024*1024 ? (d.size/1024/1024).toFixed(1)+' MB' : (d.size/1024).toFixed(0)+' KB') : '—';
            return `<tr>
              <td style="padding:7px 12px;border:1px solid #ddd;font-weight:500">${esc(d.fileName)}</td>
              <td style="padding:7px 12px;border:1px solid #ddd;text-align:center">
                <span style="background:#1F3D1D;color:#fff;padding:2px 7px;border-radius:3px;font-size:.68rem;font-weight:700">${esc(ext)}</span>
              </td>
              <td style="padding:7px 12px;border:1px solid #ddd;text-align:right;color:#666">${size}</td>
              <td style="padding:7px 12px;border:1px solid #ddd;color:#666">${fmt.date(d.ts)}</td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>
        <p style="font-size:.74rem;color:#999;margin-top:8px">
          * Documents listed above are referenced attachments. Open original files for full content.
        </p>
      </div>`
    : '';

  $('report-preview').innerHTML = `
    <div class="report-preview" id="printable-report">
      <div class="report-header">
        <div class="report-logo-bar">
          <div>
            <div class="report-logo-text">${esc(s.schoolName)}</div>
            <div style="font-size:.82rem;color:#888">Facilities Management Department</div>
          </div>
          <div class="report-ref">
            <div>Ref: ${esc(p.projectNumber||'N/A')}</div>
            <div>Campus: ${esc(currentSite.name)}</div>
            <div>Generated: ${fmt.date(new Date().toISOString())}</div>
          </div>
        </div>
        <div class="report-project-name">${esc(p.projectName)}</div>
        <div style="margin-top:6px">
          ${statusBadge(p.status||'Draft')}
          ${p.category ? `<span class="cat-badge" style="margin-left:6px">${esc(p.category)}</span>` : ''}
          ${p.priority ? `<span class="badge badge-${(p.priority||'').toLowerCase()}" style="margin-left:6px">${esc(p.priority)}</span>` : ''}
        </div>
      </div>

      <div class="report-section">
        <h3>Project Summary</h3>
        <dl class="report-kv">
          <dt>Location</dt>      <dd>${esc(p.location||'—')}</dd>
          <dt>Priority</dt>      <dd>${esc(p.priority||'—')}</dd>
          <dt>Description</dt>   <dd>${esc(p.description||'—')}</dd>
          <dt>Request Date</dt>  <dd>${fmt.date(p.requestDate)}</dd>
          <dt>Target Completion</dt><dd>${fmt.date(p.completionDate)}</dd>
          <dt>Start Date</dt>    <dd>${fmt.date(p.startDate)}</dd>
          <dt>Status</dt>        <dd>${esc(p.status||'—')}</dd>
          <dt>Contractor</dt>    <dd>${esc(p.contractorName||'—')}</dd>
          <dt>Contact</dt>       <dd>${esc(p.contactPerson||'—')}${p.telephone?' · '+esc(p.telephone):''}</dd>
        </dl>
      </div>

      <div class="report-section">
        <h3>Financial Summary</h3>
        <dl class="report-kv">
          <dt>Estimated Budget</dt><dd>${p.estimatedBudget ? fmt.currency(p.estimatedBudget) : '—'}</dd>
          <dt>Approved Budget</dt> <dd>${p.approvedBudget  ? fmt.currency(p.approvedBudget)  : '—'}</dd>
          <dt>Funding Source</dt>  <dd>${esc(p.fundingSource||'—')}</dd>
        </dl>
      </div>

      <div class="report-section">
        <h3>Quotation Comparison</h3>
        ${quotesHtml}
      </div>

      ${p.recommendation ? `<div class="report-section"><h3>Recommendation</h3><p style="font-size:.88rem;line-height:1.7">${esc(p.recommendation)}</p></div>` : ''}
      ${p.notes          ? `<div class="report-section"><h3>Notes</h3><p style="font-size:.88rem;line-height:1.7;white-space:pre-wrap">${esc(p.notes)}</p></div>` : ''}

      ${photosHtml}
      ${docsHtml}

      ${(() => {
        const invoices = p.invoices || [];
        if (!invoices.length) return '';
        const totalPaid = invoices.reduce((s,i) => s + parseFloat(i.amount||0), 0);
        const budget    = parseFloat(p.approvedBudget||p.estimatedBudget||0);
        const variance  = budget - totalPaid;
        const over      = totalPaid > budget && budget > 0;
        return `<div class="report-section">
          <h3>Actual Spend (${invoices.length} Invoice${invoices.length!==1?'s':''})</h3>
          <dl class="report-kv" style="margin-bottom:12px">
            <dt>Budget</dt><dd>${budget?fmt.currency(budget):'—'}</dd>
            <dt>Total Invoiced</dt><dd style="color:${over?'#e53935':'inherit'};font-weight:700">${fmt.currency(totalPaid)}</dd>
            <dt>Variance</dt><dd style="color:${over?'#e53935':'#2e7d32'};font-weight:700">${over?'Over by ':'Under by '}${fmt.currency(Math.abs(variance))}</dd>
          </dl>
          <table style="width:100%;border-collapse:collapse;font-size:.84rem">
            <thead><tr style="background:#f2f8eb">
              <th style="padding:7px 12px;border:1px solid #ddd">Invoice Ref</th>
              <th style="padding:7px 12px;border:1px solid #ddd">Supplier</th>
              <th style="padding:7px 12px;border:1px solid #ddd">Date</th>
              <th style="padding:7px 12px;border:1px solid #ddd;text-align:right">Amount</th>
              <th style="padding:7px 12px;border:1px solid #ddd;text-align:center">Status</th>
            </tr></thead>
            <tbody>${invoices.map(inv=>`<tr>
              <td style="padding:7px 12px;border:1px solid #ddd;font-weight:500">${esc(inv.ref||'—')}</td>
              <td style="padding:7px 12px;border:1px solid #ddd">${esc(inv.supplier||'—')}</td>
              <td style="padding:7px 12px;border:1px solid #ddd">${fmt.date(inv.date)}</td>
              <td style="padding:7px 12px;border:1px solid #ddd;text-align:right"><strong>${fmt.currency(inv.amount)}</strong></td>
              <td style="padding:7px 12px;border:1px solid #ddd;text-align:center">${inv.paid?'✓ Paid':'Pending'}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>`;
      })()}

      <div class="report-signoff-single">
        <div class="sign-approval-row">
          <span class="sign-approval-label">Approved:</span>
          <span class="sign-tick-box"></span><span class="sign-tick-label">Yes</span>
          <span class="sign-tick-box"></span><span class="sign-tick-label">No</span>
        </div>
        <div class="sign-field-wide"><span class="sign-field-label">Name</span><span class="sign-line-wide"></span></div>
        <div class="sign-field-wide"><span class="sign-field-label">Signature</span><span class="sign-line-wide"></span></div>
        <div class="sign-field-wide"><span class="sign-field-label">Date</span><span class="sign-line-medium"></span></div>
      </div>
      <div class="report-footer">
        <span>${esc(s.reportFooter)}</span>
        <span>Generated: ${new Date().toLocaleString('en-ZA')}</span>
      </div>
    </div>`;

  // Show the action bar and pre-fill email recipient
  const bar = $('report-action-bar');
  if (bar) bar.style.display = '';
  const emailInput = $('report-email-to');
  if (emailInput && !emailInput.value) {
    emailInput.value = s.emailTo || '';
  }
}

/* ── Shared helper: builds the complete standalone report HTML document ───── */
function buildFullReportDoc(reportEl) {
  const logoEl  = document.querySelector('.sidebar-logo-img');
  const logoSrc = logoEl ? logoEl.src : '';
  const title   = esc(reportEl.querySelector('.report-project-name')?.textContent || 'Facilities Report');

  // ── Rebuild logo bar with real <img> ──────────────────────
  const logoTextEl = reportEl.querySelector('.report-logo-text');
  const refEl      = reportEl.querySelector('.report-ref');
  const logoBarHtml = `<div class="report-logo-bar">
    <div class="report-logo-wrap">
      ${logoSrc ? `<img src="${logoSrc}" class="report-logo-img" alt="Logo">` : ''}
      <div>
        <div class="report-logo-text">${logoTextEl ? logoTextEl.innerHTML : ''}</div>
        <div class="report-logo-sub">Facilities Management Department</div>
      </div>
    </div>
    <div class="report-ref">${refEl ? refEl.innerHTML : ''}</div>
  </div>`;

  // ── Clone and patch ───────────────────────────────────────
  const clone = reportEl.cloneNode(true);
  // Replace logo bar
  const cloneBar = clone.querySelector('.report-logo-bar');
  if (cloneBar) cloneBar.outerHTML = logoBarHtml;
  // Apply photo-grid-report class
  clone.querySelectorAll('[style*="grid-template-columns"]').forEach(el => {
    if (el.querySelector('img')) {
      el.style.cssText = '';
      el.className = 'photo-grid-report';
      el.querySelectorAll('[style*="break-inside"]').forEach(item => {
        item.className = 'photo-item';
        item.style.cssText = '';
      });
    }
  });
  // Remove non-print elements
  clone.querySelectorAll('.no-print').forEach(el => el.remove());
  const bodyContent = clone.innerHTML;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;500;600&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Noto Sans',Arial,sans-serif;font-size:14px;color:#1a1a1a;background:#fff}

    /* Toolbar — screen only */
    .print-toolbar{position:fixed;top:0;left:0;right:0;z-index:999;background:#1F3D1D;color:#fff;
      padding:10px 24px;display:flex;align-items:center;gap:10px;box-shadow:0 2px 8px rgba(0,0,0,.2)}
    .print-toolbar .tb-title{flex:1;font-weight:600;font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .print-toolbar button{padding:7px 18px;border:none;border-radius:6px;
      font-family:inherit;font-size:.82rem;font-weight:600;cursor:pointer;white-space:nowrap}
    .btn-print{background:#fff;color:#1F3D1D}.btn-print:hover{background:#e8f5e9}
    .btn-dl{background:#7DA24B;color:#fff}.btn-dl:hover{background:#6a8f3e}
    .btn-close{background:rgba(255,255,255,.15);color:#fff}.btn-close:hover{background:rgba(255,255,255,.28)}
    @media print{.print-toolbar{display:none!important}}

    /* Page */
    .page-wrap{max-width:800px;margin:72px auto 64px;padding:48px;background:#fff}
    @media print{
      .page-wrap{margin:0;padding:24mm 20mm;max-width:100%}
      *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
      @page{size:A4;margin:0}
    }
    @media screen{body{background:#f0f0f0}.page-wrap{box-shadow:0 4px 24px rgba(0,0,0,.13);border-radius:8px}}

    /* Header */
    .report-logo-bar{display:flex;justify-content:space-between;align-items:flex-start;
      margin-bottom:16px;padding-bottom:16px;border-bottom:3px solid #1F3D1D}
    .report-logo-wrap{display:flex;align-items:center;gap:14px}
    .report-logo-img{width:52px;height:52px;object-fit:contain}
    .report-logo-text{font-size:1.2rem;font-weight:700;color:#1F3D1D;font-family:'Trebuchet MS',sans-serif}
    .report-logo-sub{font-size:.78rem;color:#888;margin-top:2px}
    .report-ref{font-size:.78rem;color:#666;text-align:right;line-height:1.8}
    .report-project-name{font-family:'Trebuchet MS',sans-serif;font-size:1.5rem;font-weight:700;color:#1F3D1D;margin:12px 0 6px}

    /* Badges */
    .badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:.72rem;font-weight:700}
    .badge-draft{background:#f0f0f0;color:#666}.badge-planning{background:#e3f0ff;color:#1565c0}
    .badge-awaiting-quotes{background:#fff3e0;color:#e65100}.badge-quotes-received{background:#fce4ec;color:#880e4f}
    .badge-awaiting-approval{background:#f3e5f5;color:#6a1b9a}.badge-approved{background:#e8f5e9;color:#2e7d32}
    .badge-in-progress{background:#e0f7fa;color:#006064}.badge-completed{background:#e8f5e9;color:#1b5e20}
    .badge-archived{background:#eceff1;color:#546e7a}
    .badge-high{background:#fde8e8;color:#c62828}.badge-medium{background:#fff3e0;color:#e65100}.badge-low{background:#e8f5e9;color:#2e7d32}
    .cat-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:.7rem;font-weight:600;background:#D1C7A3;color:#1F3D1D}

    /* Sections */
    .report-section{margin-bottom:28px}
    .report-section h3{font-family:'Trebuchet MS',sans-serif;font-size:.95rem;font-weight:700;
      color:#1F3D1D;border-bottom:1px solid #e0e0e0;padding-bottom:6px;margin-bottom:12px}
    dl.report-kv{display:grid;grid-template-columns:160px 1fr;gap:6px 16px;font-size:.85rem}
    dl.report-kv dt{color:#888;font-weight:600}
    dl.report-kv dd{color:#1a1a1a}

    /* Tables */
    table{width:100%;border-collapse:collapse}
    th,td{padding:8px 12px;border:1px solid #ddd;font-size:.84rem;text-align:left}
    th{background:#f2f8eb;font-weight:700}

    /* Photos */
    .photo-grid-report{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:12px}
    .photo-item{break-inside:avoid;page-break-inside:avoid}
    .photo-item img{width:100%;height:160px;object-fit:cover;border-radius:6px;border:1px solid #ddd;display:block}
    .photo-caption{font-size:.72rem;color:#666;text-align:center;margin-top:4px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}

    /* Sign-off */
    .report-signoff-single{border-top:2px solid #1F3D1D;padding-top:20px;margin-top:40px;
      display:flex;flex-direction:column;gap:20px;max-width:480px}
    .sign-approval-row{display:flex;align-items:center;gap:10px;font-size:.88rem}
    .sign-approval-label{font-weight:700;color:#1F3D1D;margin-right:6px}
    .sign-tick-box{display:inline-block;width:22px;height:22px;border:2px solid #444;border-radius:3px;flex-shrink:0}
    .sign-tick-label{font-size:.88rem;margin-right:14px;font-weight:500}
    .sign-field-wide{display:flex;align-items:flex-end;gap:14px}
    .sign-field-label{white-space:nowrap;min-width:72px;font-size:.78rem;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.05em;padding-bottom:4px}
    .sign-line-wide{flex:1;border-bottom:1.5px solid #999;height:28px;min-width:200px}
    .sign-line-medium{width:200px;border-bottom:1.5px solid #999;height:28px}

    /* Footer */
    .report-footer{border-top:1px solid #e0e0e0;padding-top:14px;display:flex;
      justify-content:space-between;font-size:.74rem;color:#999;margin-top:32px}
  </style>
</head>
<body>
  <div class="print-toolbar">
    <span class="tb-title">&#128438; ${title}</span>
    <button class="btn-print" onclick="window.print()">&#128438; Print / Save as PDF</button>
    <button class="btn-dl"    onclick="downloadSelf()">&#8681; Download</button>
    <button class="btn-close" onclick="window.close()">&#x2715; Close</button>
  </div>
  <div class="page-wrap">${bodyContent}</div>
  <script>
    function downloadSelf(){
      const blob=new Blob([document.documentElement.outerHTML],{type:'text/html'});
      const a=document.createElement('a');
      a.href=URL.createObjectURL(blob);
      a.download=document.title.replace(/[^a-z0-9 _-]/gi,'_')+'.html';
      a.click();
    }
  <\/script>
</body>
</html>`;
}

function printReport() {
  const reportEl = $('printable-report');
  if (!reportEl) { toast('Generate a report first', 'warning'); return; }
  const win = window.open('', '_blank', 'width=920,height=760');
  if (!win) { toast('Pop-up blocked — please allow pop-ups for this page and try again.', 'error'); return; }
  win.document.write(buildFullReportDoc(reportEl));
  win.document.close();
  win.focus();
}

function downloadReport() {
  const reportEl = $('printable-report');
  if (!reportEl) { toast('Generate a report first', 'warning'); return; }

  // Use jsPDF + html2canvas for a real PDF
  toast('Generating PDF — please wait…');

  // Dynamically load libraries if not already loaded
  Promise.all([
    loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'),
    loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'),
  ]).then(() => {
    const { jsPDF } = window.jspdf;

    // Temporarily style the preview for capture
    const origStyle = reportEl.style.cssText;
    reportEl.style.width       = '794px';  // A4 at 96dpi
    reportEl.style.padding     = '40px';
    reportEl.style.boxShadow   = 'none';
    reportEl.style.borderRadius= '0';

    window.html2canvas(reportEl, {
      scale:           2,        // 2× for crisp text
      useCORS:         true,
      allowTaint:      true,
      backgroundColor: '#ffffff',
      logging:         false,
    }).then(canvas => {
      reportEl.style.cssText = origStyle; // restore

      const imgData  = canvas.toDataURL('image/jpeg', 0.92);
      const pdf      = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
      const pageW    = pdf.internal.pageSize.getWidth();
      const pageH    = pdf.internal.pageSize.getHeight();
      const margin   = 10;
      const usableW  = pageW - margin*2;
      const imgW     = canvas.width;
      const imgH     = canvas.height;
      const ratio    = usableW / imgW;
      const scaledH  = imgH * ratio;
      const pagesNeeded = Math.ceil(scaledH / (pageH - margin*2));

      for (let page = 0; page < pagesNeeded; page++) {
        if (page > 0) pdf.addPage();
        const srcY  = page * (pageH - margin*2) / ratio;
        const srcH  = Math.min((pageH - margin*2) / ratio, imgH - srcY);
        // Crop canvas to current page slice
        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width  = imgW;
        sliceCanvas.height = Math.round(srcH);
        sliceCanvas.getContext('2d').drawImage(canvas, 0, Math.round(srcY), imgW, Math.round(srcH), 0, 0, imgW, Math.round(srcH));
        const sliceImg  = sliceCanvas.toDataURL('image/jpeg', 0.92);
        const sliceH    = srcH * ratio;
        pdf.addImage(sliceImg, 'JPEG', margin, margin, usableW, sliceH);
      }

      const title  = reportEl.querySelector('.report-project-name')?.textContent || 'Facilities-Report';
      const safe   = title.trim().replace(/[^a-z0-9 _-]/gi, '_');
      pdf.save(safe + '.pdf');
      toast('PDF downloaded ✓');
    }).catch(err => {
      reportEl.style.cssText = origStyle;
      console.error('html2canvas error:', err);
      toast('PDF generation failed — downloading HTML instead', 'warning');
      downloadReportAsHtml();
    });
  }).catch(() => {
    toast('Could not load PDF library — downloading HTML instead', 'warning');
    downloadReportAsHtml();
  });
}

function downloadReportAsHtml() {
  const reportEl = $('printable-report');
  if (!reportEl) return;
  const html  = buildFullReportDoc(reportEl);
  const title = reportEl.querySelector('.report-project-name')?.textContent || 'Facilities-Report';
  const safe  = title.trim().replace(/[^a-z0-9 _-]/gi, '_');
  const blob  = new Blob([html], { type:'text/html' });
  const a     = document.createElement('a');
  a.href      = URL.createObjectURL(blob);
  a.download  = safe + '.html';
  a.click();
  URL.revokeObjectURL(a.href);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s  = document.createElement('script');
    s.src    = src;
    s.onload = resolve;
    s.onerror= reject;
    document.head.appendChild(s);
  });
}

function emailReport() {
  const id = $('report-project-select').value;
  if (!id) { toast('Please select and generate a report first', 'warning'); return; }
  if (!$('printable-report')) { toast('Click "Generate Report" first', 'warning'); return; }

  // Re-read fresh from storage
  refreshProjectsFromStorage();
  const p = State.projects.find(x => x.id === id);
  if (!p) { toast('Project not found', 'error'); return; }
  State.settings = DB.loadObj(DB.keys(currentSiteId).settings, State.settings);
  const s = State.settings;

  // Recipient — use input field, fall back to settings emailTo
  const toField = ($('report-email-to')?.value || '').trim();
  const to      = toField || s.emailTo || '';

  // Subject
  const subject = `[${esc(currentSite.name)}] Facilities Report — ${p.projectNumber || ''} ${p.projectName}`.trim();

  // Plain-text body — concise summary suitable for email
  const budget  = p.approvedBudget || p.estimatedBudget;
  const quotes  = (p.quotes || []).sort((a,b) => parseFloat(a.total||a.amount||0) - parseFloat(b.total||b.amount||0));
  const bestQuote = quotes.length ? quotes[0] : null;

  const lines = [
    `${s.schoolName} — Facilities Management Report`,
    `Generated: ${new Date().toLocaleDateString('en-ZA', { day:'2-digit', month:'long', year:'numeric' })}`,
    '',
    `PROJECT: ${p.projectName}`,
    `Reference: ${p.projectNumber || 'N/A'}`,
    `Campus: ${currentSite.name}`,
    `Status: ${p.status || 'Draft'}`,
    `Category: ${p.category || '—'}`,
    `Priority: ${p.priority || '—'}`,
    `Location: ${p.location || '—'}`,
    '',
    'FINANCIAL',
    `Estimated Budget: ${budget ? fmt.currency(budget) : '—'}`,
    `Approved Budget:  ${p.approvedBudget ? fmt.currency(p.approvedBudget) : '—'}`,
    `Funding Source:   ${p.fundingSource || '—'}`,
    '',
    'TIMELINE',
    `Request Date:   ${fmt.date(p.requestDate)}`,
    `Quote Due:      ${fmt.date(p.quoteDueDate)}`,
    `Start Date:     ${fmt.date(p.startDate)}`,
    `Completion:     ${fmt.date(p.completionDate)}`,
    '',
    'CONTRACTOR',
    `Company:  ${p.contractorName || '—'}`,
    `Contact:  ${p.contactPerson  || '—'}`,
    `Email:    ${p.email          || '—'}`,
    `Tel:      ${p.telephone      || '—'}`,
  ];

  if (quotes.length) {
    lines.push('', `QUOTATIONS (${quotes.length} received)`);
    quotes.forEach((q, i) => {
      lines.push(`  ${i+1}. ${q.contractor} — ${fmt.currency(q.total || q.amount)}${i===0 ? ' ← Lowest' : ''}`);
    });
    if (bestQuote) lines.push(`Recommended: ${bestQuote.contractor} at ${fmt.currency(bestQuote.total || bestQuote.amount)}`);
  }

  if (p.recommendation) { lines.push('', 'RECOMMENDATION', p.recommendation); }
  if (p.description)    { lines.push('', 'DESCRIPTION',   p.description); }
  if (p.notes)          { lines.push('', 'NOTES',         p.notes); }

  lines.push(
    '',
    '─────────────────────────────────────',
    s.reportFooter || s.schoolName,
    'This report was generated by the Newberry House Facilities Manager.',
  );

  const body = lines.join('\n');

  // Build mailto link — encode carefully
  const mailtoHref = 'mailto:' + encodeURIComponent(to)
    + '?subject=' + encodeURIComponent(subject)
    + '&body='    + encodeURIComponent(body);

  // mailto URIs have a practical length limit (~2000 chars for body in most clients)
  // If too long, warn and still open — client will truncate gracefully
  if (mailtoHref.length > 8000) {
    toast('Email body is long — some email clients may truncate it. Use Print/PDF for full report.', 'warning');
  }

  const a = document.createElement('a');
  a.href = mailtoHref;
  a.click();
  toast('Opening your email app…');
}

/* ── Settings ────────────────────────────────────────────── */
function renderSettings() {
  // Re-read settings from storage before displaying
  State.settings = DB.loadObj(DB.keys(currentSiteId).settings, State.settings);
  const s = State.settings;
  $('s-schoolName').value   = s.schoolName   || '';
  $('s-facilityMgr').value  = s.facilityMgr  || '';
  $('s-reportFooter').value = s.reportFooter || '';
  $('s-emailTo').value      = s.emailTo      || '';
  // Mirror sync status into settings page indicator
  const topEl = $('sync-status');
  const setEl = $('sync-status-settings');
  if (setEl && topEl) { setEl.textContent = topEl.textContent; setEl.className = topEl.className; }
}

/* ── Migrate all localStorage data to Supabase ───────────── */
async function migrateLocalToSupabase() {
  toast('Pushing all local data to Supabase…');
  setSyncStatus('syncing');
  let total = 0;
  try {
    for (const siteId of ['lourensford', 'spier']) {
      const k = DB.keys(siteId);
      const projects    = DB.load(k.projects);
      const contractors = DB.load(k.contractors);
      const gardens     = DB.load(k.gardens);
      const settings    = DB.loadObj(k.settings, {});

      if (projects.length) {
        const rows = projects.map(p => ({
          id: p.id, site_id: siteId,
          project_number: p.projectNumber||null, project_name: p.projectName||'Untitled',
          status: p.status||'Draft', category: p.category||null, priority: p.priority||null,
          date_created: p.dateCreated||null, date_updated: p.dateUpdated||null, data: p,
        }));
        await SB.upsert('projects', rows);
        total += projects.length;
      }
      if (contractors.length) {
        const rows = contractors.map(c => ({ id:c.id, site_id:siteId, name:c.name, data:c }));
        await SB.upsert('contractors', rows);
      }
      if (gardens.length) {
        const rows = gardens.map(g => ({ id:g.id, site_id:siteId, garden_name:g.gardenName||'Garden', data:g }));
        await SB.upsert('gardens', rows);
      }
      if (Object.keys(settings).length) {
        await SB.upsert('settings', [{ site_id:siteId, data:settings }]);
      }
    }
    setSyncStatus('synced');
    toast(`Migration complete — ${total} project(s) pushed to Supabase ✓`);
    renderSettings();
  } catch(e) {
    setSyncStatus('error');
    toast('Migration failed: ' + e.message, 'error');
  }
}

function saveSettings() {
  State.settings.schoolName   = $('s-schoolName').value;
  State.settings.facilityMgr  = $('s-facilityMgr').value;
  State.settings.reportFooter = $('s-reportFooter').value;
  State.settings.emailTo      = $('s-emailTo').value;
  DB.save(DB.keys(currentSiteId).settings, State.settings);
  pushSettingsToSupabase();
  toast('Settings saved');
}

/* ── Data management ─────────────────────────────────────── */
function _siteExportObj(siteId) {
  const k = DB.keys(siteId);
  const hwData = (() => { try { return JSON.parse(localStorage.getItem('nhfm_holidaywork_' + siteId)) || []; } catch { return []; } })();
  const nbData = (() => { try { return JSON.parse(localStorage.getItem('nhfm_newbuild_' + siteId)) || []; } catch { return []; } })();
  return { projects:DB.load(k.projects), contractors:DB.load(k.contractors), gardens:DB.load(k.gardens), holidayWork:hwData, newBuild:nbData, settings:DB.loadObj(k.settings,{}) };
}

function exportData(siteId) {
  siteId = siteId || currentSiteId;
  let data;
  if (siteId === 'combined') {
    data = {
      combined: true, version: 2,
      lourensford: _siteExportObj('lourensford'),
      spier:       _siteExportObj('spier'),
      exported: new Date().toISOString(),
    };
  } else {
    data = { site:siteId, version:2, ..._siteExportObj(siteId), exported:new Date().toISOString() };
  }
  const blob = new Blob([JSON.stringify(data,null,2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'nhfm-' + siteId + '-' + new Date().toISOString().split('T')[0] + '.json';
  a.click();
  toast('Data exported');
}

function _importSiteData(sid, obj) {
  const k = DB.keys(sid);
  if (obj.projects)    DB.save(k.projects,    obj.projects);
  if (obj.contractors) DB.save(k.contractors, obj.contractors);
  if (obj.gardens)     DB.save(k.gardens,     obj.gardens);
  if (obj.settings)    DB.save(k.settings,    obj.settings);
  if (obj.holidayWork) { try { localStorage.setItem('nhfm_holidaywork_' + sid, JSON.stringify(obj.holidayWork)); } catch {} }
  if (obj.newBuild)    { try { localStorage.setItem('nhfm_newbuild_' + sid, JSON.stringify(obj.newBuild)); } catch {} }
}

function importData(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (data.combined) {
        ['lourensford','spier'].forEach(sid => {
          if (!data[sid]) return;
          _importSiteData(sid, data[sid]);
        });
        toast('Both campuses imported');
      } else {
        _importSiteData(currentSiteId, data);
        toast('Data imported into ' + currentSite.name);
      }
      loadSiteData();
      navigate('dashboard');
    } catch(err) { toast('Import failed — invalid file', 'error'); console.error(err); }
  };
  reader.readAsText(file);
  e.target.value = '';
}

async function syncCombinedCaches() {
  // Pull both sites into their local caches silently
  try {
    const [lp, sp] = await Promise.all([
      SB.get('projects?site_id=eq.lourensford&select=*'),
      SB.get('projects?site_id=eq.spier&select=*'),
    ]);
    if (lp) { const m=lp.map(r=>({...r.data,id:r.id})); DB.save(DB.keys('lourensford').projects,m); }
    if (sp) { const m=sp.map(r=>({...r.data,id:r.id})); DB.save(DB.keys('spier').projects,m); }
  } catch { /* silent */ }
}

async function clearAllData() {
  if (!confirm('Clear ALL data for ' + currentSite.name + '? This cannot be undone.')) return;
  if (!confirm('Final confirmation — all projects for ' + currentSite.name + ' will be permanently deleted.')) return;
  DB.clearSite(currentSiteId);
  State.projects=[]; State.contractors=[]; State.gardens=[];
  // Delete from Supabase too
  setSyncStatus('syncing');
  await Promise.all([
    SB.delete('projects?site_id=eq.'    + currentSiteId),
    SB.delete('contractors?site_id=eq.' + currentSiteId),
    SB.delete('gardens?site_id=eq.'     + currentSiteId),
  ]);
  setSyncStatus('synced');
  loadSiteData();
  toast('All data cleared for ' + currentSite.name);
  navigate('dashboard');
}

async function clearBothSites() {
  if (!confirm('Clear ALL data for BOTH campuses? This cannot be undone.')) return;
  if (!confirm('Final confirmation — everything will be deleted.')) return;
  DB.clearSite('lourensford'); DB.clearSite('spier');
  setSyncStatus('syncing');
  await Promise.all([
    SB.delete('projects?site_id=in.(lourensford,spier)'),
    SB.delete('contractors?site_id=in.(lourensford,spier)'),
    SB.delete('gardens?site_id=in.(lourensford,spier)'),
  ]);
  setSyncStatus('synced');
  loadSiteData(); navigate('dashboard');
  toast('All data cleared');
}

/* ── Drag-to-reorder ────────────────────────────────────── */
function enableDragSort(containerId, itemSelector, onReorder) {
  const container = $(containerId); if (!container) return;
  let dragIdx = null, handleGrabbed = false;

  container.addEventListener('mousedown', e => { handleGrabbed = !!e.target.closest('.drag-handle'); });

  container.addEventListener('dragstart', e => {
    const item = e.target.closest(itemSelector);
    if (!item || !handleGrabbed) { e.preventDefault(); return; }
    dragIdx = [...container.querySelectorAll(itemSelector)].indexOf(item);
    item.classList.add('drag-active');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragIdx);
    container.classList.add('drag-sorting');
  });

  container.addEventListener('dragend', e => {
    const item = e.target.closest(itemSelector);
    if (item) item.classList.remove('drag-active');
    container.classList.remove('drag-sorting');
    container.querySelectorAll('.drag-indicator').forEach(el => el.remove());
    dragIdx = null;
  });

  container.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const target = e.target.closest(itemSelector);
    if (!target) return;
    container.querySelectorAll('.drag-indicator').forEach(el => el.remove());
    const rect = target.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    const indicator = document.createElement('div');
    indicator.className = 'drag-indicator';
    if (e.clientY < mid) {
      target.style.position = 'relative';
      indicator.style.top = '-2px';
      target.prepend(indicator);
    } else {
      target.style.position = 'relative';
      indicator.style.bottom = '-2px'; indicator.style.top = 'auto';
      target.append(indicator);
    }
  });

  container.addEventListener('drop', e => {
    e.preventDefault();
    container.querySelectorAll('.drag-indicator').forEach(el => el.remove());
    const target = e.target.closest(itemSelector);
    if (!target || dragIdx === null) return;
    const items = [...container.querySelectorAll(itemSelector)];
    const dropIdx = items.indexOf(target);
    const rect = target.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    const insertBefore = e.clientY < mid;
    let toIdx = insertBefore ? dropIdx : dropIdx + 1;
    if (toIdx > dragIdx) toIdx--;
    if (toIdx !== dragIdx) onReorder(dragIdx, toIdx);
  });

  // Touch support for mobile
  let touchItem = null, touchIdx = null, touchClone = null, lastTouchY = 0;
  container.addEventListener('touchstart', e => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    const item = handle.closest(itemSelector);
    if (!item) return;
    e.preventDefault();
    touchItem = item;
    touchIdx = [...container.querySelectorAll(itemSelector)].indexOf(item);
    lastTouchY = e.touches[0].clientY;
    touchClone = item.cloneNode(true);
    touchClone.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;opacity:.8;width:'+item.offsetWidth+'px;left:'+item.getBoundingClientRect().left+'px;top:'+item.getBoundingClientRect().top+'px;transition:none;transform:scale(.97);box-shadow:0 8px 30px rgba(0,0,0,.18)';
    document.body.appendChild(touchClone);
    item.classList.add('drag-active');
    container.classList.add('drag-sorting');
  }, { passive: false });

  container.addEventListener('touchmove', e => {
    if (!touchItem) return;
    e.preventDefault();
    const y = e.touches[0].clientY;
    if (touchClone) touchClone.style.top = y - 30 + 'px';
    lastTouchY = y;
    container.querySelectorAll('.drag-indicator').forEach(el => el.remove());
    const items = [...container.querySelectorAll(itemSelector)];
    for (const el of items) {
      const r = el.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) {
        el.style.position = 'relative';
        const ind = document.createElement('div');
        ind.className = 'drag-indicator';
        if (y < r.top + r.height / 2) el.prepend(ind);
        else el.append(ind);
        break;
      }
    }
  }, { passive: false });

  container.addEventListener('touchend', e => {
    if (!touchItem) return;
    if (touchClone) { touchClone.remove(); touchClone = null; }
    touchItem.classList.remove('drag-active');
    container.classList.remove('drag-sorting');
    container.querySelectorAll('.drag-indicator').forEach(el => el.remove());
    const items = [...container.querySelectorAll(itemSelector)];
    let dropTo = touchIdx;
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      if (lastTouchY >= r.top && lastTouchY <= r.bottom) {
        dropTo = lastTouchY < r.top + r.height / 2 ? i : i + 1;
        if (dropTo > touchIdx) dropTo--;
        break;
      }
    }
    if (dropTo !== touchIdx) onReorder(touchIdx, dropTo);
    touchItem = null; touchIdx = null;
  });
}

function enableTableDragSort(tbodyId, onReorder) {
  const tbody = $(tbodyId); if (!tbody) return;
  let dragIdx = null, handleGrabbed = false;

  tbody.addEventListener('mousedown', e => { handleGrabbed = !!e.target.closest('.drag-handle'); });

  tbody.addEventListener('dragstart', e => {
    const row = e.target.closest('tr');
    if (!row || !handleGrabbed) { e.preventDefault(); return; }
    dragIdx = [...tbody.children].indexOf(row);
    row.classList.add('drag-active');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragIdx);
  });

  tbody.addEventListener('dragend', () => {
    tbody.querySelectorAll('.drag-active,.drag-over-above,.drag-over-below').forEach(el =>
      el.classList.remove('drag-active','drag-over-above','drag-over-below'));
    dragIdx = null;
  });

  tbody.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    tbody.querySelectorAll('.drag-over-above,.drag-over-below').forEach(el =>
      el.classList.remove('drag-over-above','drag-over-below'));
    const row = e.target.closest('tr');
    if (!row) return;
    const rect = row.getBoundingClientRect();
    row.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drag-over-above' : 'drag-over-below');
  });

  tbody.addEventListener('drop', e => {
    e.preventDefault();
    tbody.querySelectorAll('.drag-over-above,.drag-over-below').forEach(el =>
      el.classList.remove('drag-over-above','drag-over-below'));
    const row = e.target.closest('tr');
    if (!row || dragIdx === null) return;
    const dropIdx = [...tbody.children].indexOf(row);
    const rect = row.getBoundingClientRect();
    let toIdx = e.clientY < rect.top + rect.height / 2 ? dropIdx : dropIdx + 1;
    if (toIdx > dragIdx) toIdx--;
    if (toIdx !== dragIdx) onReorder(dragIdx, toIdx);
  });
}

function arrayMove(arr, from, to) {
  const item = arr.splice(from, 1)[0];
  arr.splice(to, 0, item);
  return arr;
}

/* ── Modals ──────────────────────────────────────────────── */
function openModal(id)  { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }

/* ── Init ────────────────────────────────────────────────── */
function init() {
  // Nav
  document.querySelectorAll('.nav-item[data-page]').forEach(el =>
    el.addEventListener('click', () => navigate(el.dataset.page))
  );
  $('menu-toggle').addEventListener('click', () => { const sb = $('sidebar'); sb.classList.toggle('open'); $('menu-toggle').setAttribute('aria-expanded', sb.classList.contains('open')); });

  // Global search
  $('global-search').addEventListener('input', e => {
    State.projectSearch = e.target.value.trim();
    State.projectPage   = 1;
    if (State.currentPage !== 'projects') navigate('projects'); else renderProjectList();
  });

  // Lightbox close
  $('lightbox').addEventListener('click', () => $('lightbox').classList.remove('open'));

  // Dashboard filter chips
  document.querySelectorAll('.filter-chip[data-filter]').forEach(c =>
    c.addEventListener('click', () => {
      State.projectFilter = c.dataset.filter;
      State.projectPage   = 1;
      document.querySelectorAll('.filter-chip[data-filter]').forEach(x => { x.classList.toggle('active', x.dataset.filter === c.dataset.filter); x.setAttribute('aria-pressed', x.dataset.filter === c.dataset.filter); });
      if (State.currentPage === 'dashboard') renderDashFeed();
      else if (State.currentPage !== 'projects') navigate('projects'); else renderProjectList();
    })
  );

  // VAT auto-calc — delegated so it works whenever modal is open
  document.addEventListener('input', e => { if (e.target.id === 'qf-amount') calcQuoteTotal(); });

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(ov =>
    ov.addEventListener('click', e => { if (e.target === ov) ov.classList.remove('open'); })
  );

  // Persistent drag-and-drop zones
  function wireDropZone(zoneId, processor) {
    const dz = $(zoneId); if (!dz) return;
    dz.addEventListener('dragover',  e  => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop',      e  => {
      e.preventDefault(); dz.classList.remove('dragover');
      if (!editingProjectId) { toast('Save the project first', 'warning'); return; }
      processor(e.dataTransfer.files);
    });
  }
  wireDropZone('photo-drop-zone', processPhotoFiles);
  wireDropZone('doc-drop-zone',   processDocFiles);

  // Ensure campus column is hidden on startup (not combined)
  const col = $('col-site'); if (col) col.style.display = 'none';

  // Dark mode — restore saved preference
  initTheme();

  // Auto-backup — start timer if configured
  initAutoBackup();

  // Load site data and launch
  loadSiteData();
  updateSiteUI();
  navigate('dashboard');
}

document.addEventListener('DOMContentLoaded', init);

/* ============================================================
   UX POLISH — ROUND 2
   ============================================================ */

/* #12 Topbar scroll shadow */
(function() {
  var content = document.getElementById('content');
  if (!content) return;
  var topbar = document.getElementById('topbar');
  if (!topbar) return;
  content.addEventListener('scroll', function() {
    topbar.classList.toggle('scrolled', content.scrollTop > 8);
  });
  window.addEventListener('scroll', function() {
    topbar.classList.toggle('scrolled', window.scrollY > 8);
  });
})();

/* #13 Animated stat counters */
function animateCounters() {
  document.querySelectorAll('.stat-value').forEach(function(el) {
    var text = el.textContent.trim();
    var match = text.match(/^R?\s?([\d\s,.]+)/);
    if (!match) return;
    var raw = match[1].replace(/\s/g,'').replace(/,/g,'');
    var target = parseFloat(raw);
    if (isNaN(target) || target === 0) return;
    var isRand = text.charAt(0) === 'R';
    var start = 0;
    var duration = 600;
    var startTime = null;
    function step(ts) {
      if (!startTime) startTime = ts;
      var progress = Math.min((ts - startTime) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      var current = Math.round(start + (target - start) * eased);
      el.textContent = isRand ? fmt.currency(current) : current.toLocaleString();
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });
}

/* #15 Notification badge on sidebar */
function updateNavBadges() {
  var allProjects = State.projects || [];
  var hwProjects = [];
  try { hwProjects = JSON.parse(localStorage.getItem(hwKey()) || '[]'); } catch(e) {}
  var nbProjectsBadge = [];
  try { nbProjectsBadge = JSON.parse(localStorage.getItem(nbKey()) || '[]'); } catch(e) {}
  var overdueCount = 0;
  var now = new Date();
  allProjects.concat(hwProjects.map(function(h) {
    return { completionDate: h.completionDate || h.endDate || h.dueDate, status: h.status };
  })).concat(nbProjectsBadge.map(function(n) {
    return { completionDate: n.endDate, status: n.status };
  })).forEach(function(p) {
    var d = p.completionDate || p.endDate;
    if (d && p.status !== 'Completed' && p.status !== 'Archived') {
      if (new Date(d) < now) overdueCount++;
    }
  });
  document.querySelectorAll('.nav-item').forEach(function(nav) {
    var existing = nav.querySelector('.nav-badge');
    if (existing) existing.remove();
    if (nav.dataset.page === 'dashboard' && overdueCount > 0) {
      nav.insertAdjacentHTML('beforeend', '<span class="nav-badge">' + overdueCount + '</span>');
    }
  });
}

/* #16 Ctrl+K keyboard shortcut */
document.addEventListener('keydown', function(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    var input = document.getElementById('global-search');
    if (input) { input.focus(); input.select(); }
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.isContentEditable)) return;
    e.preventDefault();
    UndoManager.undo();
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.isContentEditable)) return;
    e.preventDefault();
    UndoManager.redo();
  }
});

/* #18 Better sort indicators */
var _origSortProjects = typeof sortProjects === 'function' ? sortProjects : null;
sortProjects = function(f) {
  if (_origSortProjects) _origSortProjects(f);
  document.querySelectorAll('#project-list-body').forEach(function(){});
  var dir = State.projectSort.dir;
  var field = State.projectSort.field;
  document.querySelectorAll('th[onclick*="sortProjects"]').forEach(function(th) {
    th.classList.remove('sort-active');
    var arrow = th.querySelector('.sort-arrow');
    if (arrow) arrow.textContent = '⇅';
    var col = th.getAttribute('onclick').match(/sortProjects\('(\w+)'\)/);
    if (col && col[1] === field) {
      th.classList.add('sort-active');
      if (arrow) arrow.textContent = dir === 'asc' ? '↑' : '↓';
    }
  });
};

/* ============================================================
   DARK MODE
   ============================================================ */
function initTheme() {
  const saved = localStorage.getItem('nhfm_theme');
  if (saved === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    const mc = document.querySelector('meta[name="theme-color"]');
    if (mc) mc.setAttribute('content', '#15181b');
  }
  updateThemeIcon();
}

function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('nhfm_theme', 'light');
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('nhfm_theme', 'dark');
  }
  updateThemeIcon();
  const mc = document.querySelector('meta[name="theme-color"]');
  if (mc) mc.setAttribute('content', isDark ? '#1F3D1D' : '#15181b');
}

function updateThemeIcon() {
  const btn = $('theme-toggle');
  if (!btn) return;
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  btn.innerHTML = isDark ? '&#9788;' : '&#9789;';
  btn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
}

/* ============================================================
   ACTIVITY LOG (Global)
   ============================================================ */
const ActivityLog = {
  _key() { return 'nhfm_activity_' + currentSiteId; },

  load() {
    try { return JSON.parse(localStorage.getItem(this._key())) || []; }
    catch { return []; }
  },

  add(type, text) {
    const log = this.load();
    log.unshift({ type, text, ts: new Date().toISOString() });
    if (log.length > 200) log.length = 200;
    try { localStorage.setItem(this._key(), JSON.stringify(log)); } catch {}
    this._pushToSupabase(type, text);
  },

  async _pushToSupabase(type, text) {
    try {
      await SB.post('activity_log', {
        site_id: currentSiteId,
        type: type,
        text: text,
        created_at: new Date().toISOString(),
      });
    } catch {}
  },
};

function renderDashActivityLog() {
  const el = $('dash-activity-log'); if (!el) return;
  const log = ActivityLog.load();
  if (!log.length) {
    el.innerHTML = '<p style="font-size:.82rem;color:var(--text-muted);padding:8px 0">No activity recorded yet. Actions like creating, editing, and deleting projects will appear here.</p>';
    return;
  }
  const typeClass = { create:'al-create', status:'al-status', finance:'al-finance', delete:'al-delete', backup:'al-status' };
  el.innerHTML = '<div class="activity-log-global">'
    + log.slice(0, 50).map(function(a) {
        return '<div class="al-item">'
          + '<span class="al-dot ' + (typeClass[a.type]||'') + '"></span>'
          + '<div class="al-body"><div class="al-text">' + a.text + '</div>'
          + '<div class="al-time">' + fmt.dateTime(a.ts) + '</div></div></div>';
      }).join('')
    + '</div>';
}

function clearActivityLog() {
  if (!confirm('Clear the activity log for ' + currentSite.name + '?')) return;
  localStorage.removeItem('nhfm_activity_' + currentSiteId);
  renderDashActivityLog();
  toast('Activity log cleared');
}

function renderActivityInDrawer() {
  const log = ActivityLog.load();
  if (!log.length) return '';
  const typeClass = { create:'al-create', status:'al-status', finance:'al-finance', delete:'al-delete' };
  return '<div class="drawer-section"><div class="drawer-section-title">Activity Log</div>'
    + '<div class="activity-log-global">'
    + log.slice(0, 30).map(function(a) {
        return '<div class="al-item">'
          + '<span class="al-dot ' + (typeClass[a.type]||'') + '"></span>'
          + '<div class="al-body"><div class="al-text">' + a.text + '</div>'
          + '<div class="al-time">' + fmt.dateTime(a.ts) + '</div></div></div>';
      }).join('')
    + '</div></div>';
}

/* ============================================================
   SHARE DRAWER TO WHATSAPP (project detail)
   ============================================================ */
async function shareDrawerToWhatsApp() {
  const drawer = $('dash-drawer');
  if (!drawer) return;
  toast('Capturing project detail…');
  try {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    const body = drawer.querySelector('.dash-drawer-body');
    if (!body) return;
    const canvas = await window.html2canvas(body, {
      scale: 2, useCORS: true,
      backgroundColor: document.documentElement.getAttribute('data-theme') === 'dark' ? '#1e2124' : '#ffffff',
      logging: false, removeContainer: true,
    });
    canvas.toBlob(async function(blob) {
      if (!blob) { toast('Could not capture', 'error'); return; }
      const file = new File([blob], 'project-detail.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Project Detail' });
          toast('Shared');
        } catch (e) {
          if (e.name !== 'AbortError') toast('Share cancelled', 'warning');
        }
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'project-detail.png';
        a.click();
        URL.revokeObjectURL(a.href);
        toast('Image downloaded — attach it in WhatsApp');
      }
    }, 'image/png');
  } catch (e) {
    console.error('Share error:', e);
    toast('Could not capture', 'error');
  }
}

/* ============================================================
   AUTO-BACKUP
   ============================================================ */
let _autoBackupTimer = null;

function initAutoBackup() {
  const mode = localStorage.getItem('nhfm_autobackup') || 'off';
  const sel = $('s-autoBackup');
  if (sel) sel.value = mode;
  updateBackupStatus();
  if (mode === 'daily' || mode === 'weekly') startBackupTimer(mode);
}

function setAutoBackup(mode) {
  localStorage.setItem('nhfm_autobackup', mode);
  if (_autoBackupTimer) { clearInterval(_autoBackupTimer); _autoBackupTimer = null; }
  if (mode === 'daily' || mode === 'weekly') startBackupTimer(mode);
  updateBackupStatus();
  toast('Auto-backup: ' + (mode === 'off' ? 'disabled' : mode));
}

function startBackupTimer(mode) {
  const ms = mode === 'daily' ? 24*60*60*1000 : 7*24*60*60*1000;
  const lastKey = 'nhfm_lastbackup';
  const last = parseInt(localStorage.getItem(lastKey) || '0', 10);
  const elapsed = Date.now() - last;
  if (elapsed >= ms) {
    runAutoBackup();
  } else {
    _autoBackupTimer = setTimeout(function() { runAutoBackup(); startBackupTimer(mode); }, ms - elapsed);
  }
}

function runAutoBackup() {
  localStorage.setItem('nhfm_lastbackup', String(Date.now()));
  exportData('combined');
  ActivityLog.add('backup', 'Auto-backup exported');
  updateBackupStatus();
}

function triggerBackupOnSave() {
  const mode = localStorage.getItem('nhfm_autobackup');
  if (mode === 'change') {
    const now = Date.now();
    const last = parseInt(localStorage.getItem('nhfm_lastbackup') || '0', 10);
    if (now - last > 60000) {
      localStorage.setItem('nhfm_lastbackup', String(now));
      exportData('combined');
      updateBackupStatus();
    }
  }
}

function updateBackupStatus() {
  const el = $('backup-status');
  if (!el) return;
  const mode = localStorage.getItem('nhfm_autobackup') || 'off';
  const last = parseInt(localStorage.getItem('nhfm_lastbackup') || '0', 10);
  if (mode === 'off') {
    el.className = 'backup-info backup-off';
    el.innerHTML = '<span class="backup-dot"></span><span>No auto-backup configured</span>';
  } else {
    el.className = 'backup-info';
    el.innerHTML = '<span class="backup-dot"></span><span>Mode: ' + mode
      + (last ? ' · Last backup: ' + fmt.dateTime(new Date(last).toISOString()) : '') + '</span>';
  }
}
