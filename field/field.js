/* ── Newberry Field — Mobile Companion App ─────────────────
   Live Supabase sync, snap & tag photos, status updates,
   expense logging, quick notes.
   ──────────────────────────────────────────────────────── */

const SUPABASE_URL = 'https://oikwudpqmbnssttatlhc.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pa3d1ZHBxbWJuc3N0dGF0bGhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxMTMzODEsImV4cCI6MjA5NTY4OTM4MX0.p6I9qlvre5TjF3qOVjAIBus3_PNrbvCF2cMXHe3uiXw';

const SITES = {
  lourensford: { id:'lourensford', name:'Newberry Lourensford', short:'Lourensford' },
  spier:       { id:'spier',       name:'Newberry Spier',       short:'Spier' },
};
let currentSiteId = localStorage.getItem('nf_site') || 'lourensford';
let projects = [];
let hwProjects = [];
let snapPhotos = [];
let receiptData = null;
let currentView = 'home';
let gpsEnabled = localStorage.getItem('nf_gps') === 'true';
let lastGPS = null;
let hapticEnabled = localStorage.getItem('nf_haptic') !== 'false';

const $ = id => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ── SVG icon strings for dynamic content ───────────────── */
const SVG = {
  hardHat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18h20"/><path d="M4 18v-3a8 8 0 0 1 16 0v3"/><path d="M12 3v4"/><path d="M8 7l1 4"/><path d="M16 7l-1 4"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  alertCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
};

/* ── Supabase helpers ───────────────────────────────────── */
const SB = {
  headers: {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Accept': 'application/json',
  },
  upsertHeaders: {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Prefer': 'return=minimal,resolution=merge-duplicates',
  },
  async get(path) {
    try {
      const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, { headers: SB.headers });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  },
  async upsert(table, body) {
    try {
      const res = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
        method: 'POST', headers: SB.upsertHeaders, body: JSON.stringify(body),
      });
      return res.ok;
    } catch { return false; }
  },
  async post(table, body) {
    try {
      const res = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
        method: 'POST',
        headers: { ...SB.headers, 'Prefer': 'return=minimal' },
        body: JSON.stringify(body),
      });
      return res.ok;
    } catch { return false; }
  },
};

/* ── Sync status ────────────────────────────────────────── */
const SYNC_ICONS = {
  offline: '<svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.56 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>',
  syncing: '<svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/></svg>',
  synced: '<svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  error: '<svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
};
const SYNC_LABELS = { offline:'Offline', syncing:'Syncing', synced:'Synced', error:'Error' };

function setSyncStatus(status) {
  const el = $('sync-status');
  el.className = 'sync-pill sync-' + status;
  el.innerHTML = (SYNC_ICONS[status] || '') + '<span id="sync-text">' + (SYNC_LABELS[status] || status) + '</span>';
}

/* ── Load projects ──────────────────────────────────────── */
async function loadProjects() {
  setSyncStatus('syncing');
  showFeedSkeleton();

  try {
    const [projs, hw] = await Promise.all([
      SB.get('projects?site_id=eq.' + currentSiteId + '&select=*&order=date_updated.desc'),
      SB.get('hw_projects?site_id=eq.' + currentSiteId + '&select=*&order=date_created.desc'),
    ]);

    if (projs) {
      projects = projs.map(r => ({ ...r.data, _dbId: r.id }));
      localStorage.setItem('nf_projects_' + currentSiteId, JSON.stringify(projects));
    } else {
      projects = JSON.parse(localStorage.getItem('nf_projects_' + currentSiteId) || '[]');
    }

    if (hw) {
      hwProjects = hw.map(r => ({ ...r.data, _dbId: r.id, _isHW: true }));
      localStorage.setItem('nf_hw_' + currentSiteId, JSON.stringify(hwProjects));
    } else {
      hwProjects = JSON.parse(localStorage.getItem('nf_hw_' + currentSiteId) || '[]');
    }

    setSyncStatus(projs ? 'synced' : 'offline');
  } catch {
    projects = JSON.parse(localStorage.getItem('nf_projects_' + currentSiteId) || '[]');
    hwProjects = JSON.parse(localStorage.getItem('nf_hw_' + currentSiteId) || '[]');
    setSyncStatus('offline');
  }

  renderProjectList();
  populateProjectDropdowns();
}

/* ── Skeleton loading ───────────────────────────────────── */
function showFeedSkeleton() {
  const list = $('project-list');
  list.innerHTML = Array.from({length: 5}, () =>
    '<div class="skeleton skeleton-card"></div>'
  ).join('');
}

/* ── Render collapsible project list ───────────────────── */
function renderProjectList() {
  const list = $('project-list');
  const all = [
    ...projects.map(p => ({
      name: p.projectName, status: p.status || 'Draft', ref: p.projectNumber,
      created: p.dateCreated, updated: p.dateUpdated, type: 'project', id: p.id,
      photos: p.photos || [], invoices: p.invoices || [],
      notes: p.notes || '', activity: p.activity || [],
    })),
    ...hwProjects.map(p => ({
      name: p.title, status: p.status || 'Planning', ref: p.holiday,
      created: p.dateCreated, updated: p.dateUpdated || p.dateCreated, type: 'hw', id: p.id,
      photos: p.photos || [], invoices: p.invoices || [],
      notes: p.notes || '', activity: p.activity || [],
    })),
  ].filter(p => p.status !== 'Completed' && p.status !== 'Cancelled')
   .sort((a, b) => new Date(b.updated || 0) - new Date(a.updated || 0));

  if (!all.length) {
    list.innerHTML = '<div class="empty-state">' + SVG.inbox + '<div>No active projects. Sync from the main app first.</div></div>';
    return;
  }

  const chevron = '<svg class="proj-card-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

  list.innerHTML = all.map(p => {
    const icon = p.type === 'hw' ? SVG.hardHat : SVG.pin;
    const typeLabel = p.type === 'hw' ? 'Holiday Work' : 'Project';
    const fmtDate = d => d ? new Date(d).toLocaleDateString('en-ZA', { day:'2-digit', month:'short', year:'numeric' }) : '—';
    const photoCount = p.photos.length;
    const expTotal = p.invoices.reduce((sum, inv) => sum + (inv.amount || 0), 0);
    const lastNote = p.notes ? p.notes.split('\n\n').pop().replace(/^\[.*?\]\s*/, '') : '';
    const lastActivity = p.activity.length ? p.activity[0].text : '';
    const activityTime = p.activity.length ? fmtDate(p.activity[0].ts) : '';

    return `<div class="proj-card type-${p.type}">
      <div class="proj-card-header" onclick="toggleProject(this)">
        <div class="proj-card-icon">${icon}</div>
        <div class="proj-card-info">
          <div class="proj-card-name">${esc(p.name)}</div>
          <div class="proj-card-meta">${esc(p.ref || typeLabel)}</div>
        </div>
        <div class="proj-card-right">
          <span class="proj-card-badge">${esc(p.status)}</span>
          ${chevron}
        </div>
      </div>
      <div class="proj-card-body">
        <div class="proj-summary">
          <div class="proj-summary-grid">
            <div class="proj-stat"><span class="proj-stat-label">Status</span><span class="proj-stat-value">${esc(p.status)}</span></div>
            <div class="proj-stat"><span class="proj-stat-label">Type</span><span class="proj-stat-value">${typeLabel}</span></div>
            <div class="proj-stat"><span class="proj-stat-label">Created</span><span class="proj-stat-value">${fmtDate(p.created)}</span></div>
            <div class="proj-stat"><span class="proj-stat-label">Updated</span><span class="proj-stat-value">${fmtDate(p.updated)}</span></div>
            <div class="proj-stat"><span class="proj-stat-label">Photos</span><span class="proj-stat-value">${photoCount}</span></div>
            <div class="proj-stat"><span class="proj-stat-label">Expenses</span><span class="proj-stat-value">R ${expTotal.toFixed(2)}</span></div>
          </div>
          ${lastNote ? '<div class="proj-note"><div class="proj-note-label">Latest Note</div>' + esc(lastNote).substring(0, 150) + (lastNote.length > 150 ? '…' : '') + '</div>' : ''}
          ${lastActivity ? '<div class="proj-activity">' + SVG.check + '<span>' + esc(lastActivity) + ' &middot; ' + activityTime + '</span></div>' : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleProject(header) {
  const card = header.closest('.proj-card');
  card.classList.toggle('open');
}

/* ── Populate project dropdowns ─────────────────────────── */
function populateProjectDropdowns() {
  const all = [
    ...projects.map(p => ({ id: p.id, name: p.projectName || 'Untitled', ref: p.projectNumber, type: 'project' })),
    ...hwProjects.map(p => ({ id: p.id, name: p.title || 'Untitled', ref: p.holiday, type: 'hw' })),
  ];

  const opts = '<option value="">-- Select project --</option>'
    + all.map(p => `<option value="${p.id}" data-type="${p.type}">[${p.type === 'hw' ? 'HW' : 'PRJ'}] ${esc((p.ref ? p.ref + ' — ' : '') + p.name)}</option>`).join('');

  ['snap-project', 'exp-project', 'note-project'].forEach(id => {
    const el = $(id); if (el) el.innerHTML = opts;
  });
}

/* ── View navigation with transitions ───────────────────── */
function navigateTo(name) {
  if (name === currentView) return;
  const oldView = $('view-' + currentView);
  const newView = $('view-' + name);
  if (!newView) return;

  if (oldView) oldView.classList.remove('active', 'slide-in-forward', 'slide-in-back');
  newView.classList.remove('slide-in-forward', 'slide-in-back');
  newView.classList.add('active', 'slide-in-forward');

  currentView = name;
  if (name === 'status') renderStatusList();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  updateNavActive(name);
}

function navigateBack() {
  const oldView = $('view-' + currentView);
  const newView = $('view-home');
  if (!newView || currentView === 'home') return;

  if (oldView) oldView.classList.remove('active', 'slide-in-forward', 'slide-in-back');
  newView.classList.remove('slide-in-forward', 'slide-in-back');
  newView.classList.add('active', 'slide-in-back');

  currentView = 'home';
  loadProjects();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  updateNavActive('home');
}

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active', 'slide-in-forward', 'slide-in-back'));
  $('view-' + name)?.classList.add('active');
  currentView = name;
  if (name === 'status') renderStatusList();
  if (name === 'home') loadProjects();
  window.scrollTo(0, 0);
  updateNavActive(name);
}

/* ── Site toggle ────────────────────────────────────────── */
function toggleSite() {
  currentSiteId = currentSiteId === 'lourensford' ? 'spier' : 'lourensford';
  localStorage.setItem('nf_site', currentSiteId);
  $('site-label').textContent = SITES[currentSiteId].short;
  loadProjects();
  toast(SITES[currentSiteId].short, 'success');
}

/* ── Snap & Tag flow ────────────────────────────────────── */
function startSnapTag() {
  snapPhotos = [];
  receiptData = null;
  if (currentView !== 'snap') navigateTo('snap');
  else showView('snap');
  goToSnapStep(1);
  $('snap-preview-wrap').style.display = 'none';
  $('snap-buttons').style.display = 'flex';
  $('snap-next-btn').disabled = true;
  $('snap-note').value = '';
  $('snap-capture-area')?.classList.remove('has-photo');
  const locEl = $('snap-location');
  if (locEl) locEl.style.display = 'none';
  if (gpsEnabled) requestGPS();
}

function goToSnapStep(n) {
  document.querySelectorAll('.snap-step').forEach(s => s.classList.remove('active'));
  $('snap-step-' + n)?.classList.add('active');
}

function capturePhoto() { $('camera-input').click(); }
function pickFromGallery() { $('gallery-input').click(); }

function retakePhoto() {
  snapPhotos = [];
  $('snap-preview-wrap').style.display = 'none';
  $('snap-buttons').style.display = 'flex';
  $('snap-next-btn').disabled = true;
  $('snap-capture-area')?.classList.remove('has-photo');
}

function handleSnapFiles(files) {
  const arr = Array.from(files).filter(f => f.type.startsWith('image/'));
  if (!arr.length) return;
  playShutter();
  haptic(30);

  let done = 0;
  arr.forEach(file => {
    const reader = new FileReader();
    reader.onload = ev => {
      compressImage(ev.target.result, compressed => {
        snapPhotos.push(compressed);
        done++;
        if (done === arr.length) showSnapPreview();
      });
    };
    reader.readAsDataURL(file);
  });

  $('camera-input').value = '';
  $('gallery-input').value = '';
}

function compressImage(dataUrl, callback) {
  const img = new Image();
  img.onload = () => {
    const MAX_W = 900, QUALITY = 0.72;
    let { width, height } = img;
    if (width > MAX_W) { height = Math.round(height * MAX_W / width); width = MAX_W; }
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
    callback(canvas.toDataURL('image/jpeg', QUALITY));
  };
  img.onerror = () => callback(dataUrl);
  img.src = dataUrl;
}

function showSnapPreview() {
  $('snap-preview-wrap').style.display = 'block';
  $('snap-preview').src = snapPhotos[0];
  $('snap-buttons').style.display = 'none';
  $('snap-next-btn').disabled = false;
  $('snap-capture-area')?.classList.add('has-photo');
}

function snapNext() {
  if (!snapPhotos.length) return;
  $('snap-thumb').src = snapPhotos[0];
  $('snap-thumb-count').textContent = snapPhotos.length + ' photo' + (snapPhotos.length > 1 ? 's' : '');
  goToSnapStep(2);
}

function selectPhase(btn) {
  document.querySelectorAll('.phase-pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
}

async function submitSnap() {
  const projectId = $('snap-project').value;
  if (!projectId) { toast('Please select a project', 'warning'); return; }
  if (!snapPhotos.length) { toast('No photo captured', 'warning'); return; }

  const phase = document.querySelector('.phase-pill.active')?.dataset.phase || 'General';
  const note = $('snap-note').value.trim();
  const selOpt = $('snap-project').selectedOptions[0];
  const projType = selOpt?.dataset.type || 'project';
  const projName = selOpt?.textContent || '';

  showUploading();

  const photoEntries = snapPhotos.map(data => ({
    id: uid(), data, label: phase,
    fileName: 'field-' + Date.now() + '.jpg',
    ts: new Date().toISOString(),
    location: gpsEnabled && lastGPS ? { ...lastGPS } : null,
  }));

  let success = projType === 'hw'
    ? await addPhotosToHW(projectId, photoEntries, note)
    : await addPhotosToProject(projectId, photoEntries, note);

  hideUploading();

  if (success) {
    $('snap-done-msg').textContent = snapPhotos.length + ' photo(s) tagged to ' + projName.trim();
    goToSnapStep(3);
    toast('Photo saved!', 'success');
    hapticSuccess();
    loadProjects();
  } else {
    queueAction({ type: 'snap', projectId, projType, photos: photoEntries, note, ts: new Date().toISOString() });
    $('snap-done-msg').textContent = 'Queued for upload when online';
    goToSnapStep(3);
    toast('Saved offline — will sync when connected', 'warning');
  }
}

async function addPhotosToProject(projectId, photoEntries, note) {
  const rows = await SB.get('projects?id=eq.' + projectId + '&select=data');
  if (!rows || !rows.length) return false;

  const p = rows[0].data;
  if (!p.photos) p.photos = [];
  photoEntries.forEach(pe => p.photos.push(pe));

  if (note) {
    if (!p.activity) p.activity = [];
    p.activity.unshift({ text: 'Field note: ' + note, ts: new Date().toISOString() });
    if (!p.notes) p.notes = '';
    p.notes = (p.notes ? p.notes + '\n\n' : '') + '[Field ' + new Date().toLocaleString('en-ZA') + '] ' + note;
  }

  if (!p.activity) p.activity = [];
  p.activity.unshift({ text: photoEntries.length + ' photo(s) added from Field app', ts: new Date().toISOString() });
  p.dateUpdated = new Date().toISOString();

  return await SB.upsert('projects', [{
    id: projectId, site_id: currentSiteId,
    project_number: p.projectNumber || null,
    project_name: p.projectName || 'Untitled',
    status: p.status || 'Draft',
    category: p.category || null, priority: p.priority || null,
    date_created: p.dateCreated || null, date_updated: p.dateUpdated,
    data: p,
  }]);
}

async function addPhotosToHW(projectId, photoEntries, note) {
  const rows = await SB.get('hw_projects?id=eq.' + projectId + '&select=data');
  if (!rows || !rows.length) return false;

  const p = rows[0].data;
  if (!p.photos) p.photos = [];
  photoEntries.forEach(pe => p.photos.push(pe));

  if (note) {
    if (!p.notes) p.notes = '';
    p.notes = (p.notes ? p.notes + '\n\n' : '') + '[Field ' + new Date().toLocaleString('en-ZA') + '] ' + note;
  }

  p.dateUpdated = new Date().toISOString();

  return await SB.upsert('hw_projects', [{
    id: projectId, site_id: currentSiteId,
    project_name: p.title || 'Untitled',
    status: p.status || 'Planning',
    category: p.category || null, priority: p.priority || null,
    holiday: p.holiday || null,
    date_created: p.dateCreated || null, date_updated: p.dateUpdated,
    data: p,
  }]);
}

/* ── Status Update ──────────────────────────────────────── */
const PROJECT_STATUSES = ['Draft','Pending Approval','Approved','In Progress','On Hold','Completed','Cancelled'];
const HW_STATUSES = ['Planning','Approved','In Progress','Completed','Cancelled'];

function renderStatusList() {
  const list = $('status-list');
  const all = [
    ...projects.map(p => ({ id: p.id, name: p.projectName, status: p.status || 'Draft', ref: p.projectNumber, type: 'project' })),
    ...hwProjects.map(p => ({ id: p.id, name: p.title, status: p.status || 'Planning', ref: p.holiday, type: 'hw' })),
  ].filter(p => p.status !== 'Completed' && p.status !== 'Cancelled');

  if (!all.length) {
    list.innerHTML = '<div class="empty-state">' + SVG.inbox + '<div>No active projects.</div></div>';
    return;
  }

  list.innerHTML = all.map((p, i) => {
    const statuses = p.type === 'hw' ? HW_STATUSES : PROJECT_STATUSES;
    return `<div class="project-row" style="animation-delay:${i * .03}s">
      <div class="project-row-info">
        <div class="project-row-name">${esc(p.name)}</div>
        <div class="project-row-meta">${p.type === 'hw' ? 'Holiday Work' : esc(p.ref || '—')}</div>
      </div>
      <select class="status-select" onchange="updateStatus('${p.id}','${p.type}',this.value)">
        ${statuses.map(s => `<option value="${s}" ${s === p.status ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>`;
  }).join('');
}

async function updateStatus(projectId, type, newStatus) {
  showUploading();
  let success = false;

  if (type === 'hw') {
    const rows = await SB.get('hw_projects?id=eq.' + projectId + '&select=data');
    if (rows && rows.length) {
      const p = rows[0].data;
      p.status = newStatus;
      p.dateUpdated = new Date().toISOString();
      success = await SB.upsert('hw_projects', [{
        id: projectId, site_id: currentSiteId,
        project_name: p.title || 'Untitled', status: newStatus,
        category: p.category || null, priority: p.priority || null,
        holiday: p.holiday || null,
        date_created: p.dateCreated || null, date_updated: p.dateUpdated,
        data: p,
      }]);
    }
  } else {
    const rows = await SB.get('projects?id=eq.' + projectId + '&select=data');
    if (rows && rows.length) {
      const p = rows[0].data;
      const oldStatus = p.status;
      p.status = newStatus;
      p.dateUpdated = new Date().toISOString();
      if (!p.activity) p.activity = [];
      p.activity.unshift({ text: 'Status: ' + oldStatus + ' → ' + newStatus + ' (via Field)', ts: new Date().toISOString() });
      success = await SB.upsert('projects', [{
        id: projectId, site_id: currentSiteId,
        project_number: p.projectNumber || null,
        project_name: p.projectName || 'Untitled', status: newStatus,
        category: p.category || null, priority: p.priority || null,
        date_created: p.dateCreated || null, date_updated: p.dateUpdated,
        data: p,
      }]);
    }
  }

  hideUploading();

  if (success) {
    toast('Status updated', 'success');
    await loadProjects();
    renderStatusList();
  } else {
    queueAction({ type: 'status', projectId, projType: type, newStatus, ts: new Date().toISOString() });
    toast('Queued — will sync when online', 'warning');
  }
}

/* ── Expense logging ────────────────────────────────────── */
function captureReceipt() { $('receipt-input').click(); }

function handleReceiptFile(files) {
  const file = Array.from(files).find(f => f.type.startsWith('image/'));
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    compressImage(ev.target.result, compressed => {
      receiptData = compressed;
      $('exp-receipt-img').src = compressed;
      $('exp-receipt-preview').style.display = 'block';
    });
  };
  reader.readAsDataURL(file);
  $('receipt-input').value = '';
}

async function submitExpense() {
  const projectId = $('exp-project').value;
  const amount = parseFloat($('exp-amount').value);
  const supplier = $('exp-supplier').value.trim();

  if (!projectId) { toast('Select a project', 'warning'); return; }
  if (!amount || amount <= 0) { toast('Enter a valid amount', 'warning'); return; }
  if (!supplier) { toast('Enter supplier name', 'warning'); return; }

  const selOpt = $('exp-project').selectedOptions[0];
  const projType = selOpt?.dataset.type || 'project';

  const invoice = {
    id: uid(),
    ref: $('exp-ref').value.trim() || 'FIELD-' + Date.now().toString(36).toUpperCase(),
    amount, supplier,
    date: new Date().toISOString().split('T')[0],
    ts: new Date().toISOString(),
    paid: false,
    receipt: receiptData || null,
  };

  showUploading();
  let success = false;

  if (projType === 'project') {
    const rows = await SB.get('projects?id=eq.' + projectId + '&select=data');
    if (rows && rows.length) {
      const p = rows[0].data;
      if (!p.invoices) p.invoices = [];
      p.invoices.push(invoice);
      if (!p.activity) p.activity = [];
      p.activity.unshift({ text: 'Expense logged: R ' + amount.toFixed(2) + ' (' + supplier + ') via Field', ts: new Date().toISOString() });
      p.dateUpdated = new Date().toISOString();
      success = await SB.upsert('projects', [{
        id: projectId, site_id: currentSiteId,
        project_number: p.projectNumber || null,
        project_name: p.projectName || 'Untitled',
        status: p.status || 'Draft',
        category: p.category || null, priority: p.priority || null,
        date_created: p.dateCreated || null, date_updated: p.dateUpdated,
        data: p,
      }]);
    }
  }

  hideUploading();

  if (success) {
    toast('Expense logged — R ' + amount.toFixed(2), 'success');
    hapticSuccess();
    $('exp-amount').value = '';
    $('exp-supplier').value = '';
    $('exp-ref').value = '';
    $('exp-receipt-preview').style.display = 'none';
    receiptData = null;
    navigateBack();
  } else {
    queueAction({ type: 'expense', projectId, projType, invoice, ts: new Date().toISOString() });
    toast('Queued offline', 'warning');
    navigateBack();
  }
}

/* ── Quick Note ─────────────────────────────────────────── */
async function submitNote() {
  const projectId = $('note-project').value;
  const text = $('note-text').value.trim();

  if (!projectId) { toast('Select a project', 'warning'); return; }
  if (!text) { toast('Enter a note', 'warning'); return; }

  const selOpt = $('note-project').selectedOptions[0];
  const projType = selOpt?.dataset.type || 'project';

  showUploading();
  let success = false;

  const fetchTable = projType === 'hw' ? 'hw_projects' : 'projects';
  const rows = await SB.get(fetchTable + '?id=eq.' + projectId + '&select=data');
  if (rows && rows.length) {
    const p = rows[0].data;
    if (!p.notes) p.notes = '';
    p.notes = (p.notes ? p.notes + '\n\n' : '') + '[Field ' + new Date().toLocaleString('en-ZA') + '] ' + text;
    p.dateUpdated = new Date().toISOString();

    if (projType === 'hw') {
      success = await SB.upsert('hw_projects', [{
        id: projectId, site_id: currentSiteId,
        project_name: p.title || 'Untitled', status: p.status || 'Planning',
        category: p.category || null, priority: p.priority || null,
        holiday: p.holiday || null,
        date_created: p.dateCreated || null, date_updated: p.dateUpdated,
        data: p,
      }]);
    } else {
      if (!p.activity) p.activity = [];
      p.activity.unshift({ text: 'Field note added', ts: new Date().toISOString() });
      success = await SB.upsert('projects', [{
        id: projectId, site_id: currentSiteId,
        project_number: p.projectNumber || null,
        project_name: p.projectName || 'Untitled', status: p.status || 'Draft',
        category: p.category || null, priority: p.priority || null,
        date_created: p.dateCreated || null, date_updated: p.dateUpdated,
        data: p,
      }]);
    }
  }

  hideUploading();

  if (success) {
    toast('Note saved', 'success');
    hapticSuccess();
    $('note-text').value = '';
    navigateBack();
  } else {
    queueAction({ type: 'note', projectId, projType, text, ts: new Date().toISOString() });
    toast('Queued offline', 'warning');
    navigateBack();
  }
}

/* ── Offline queue ──────────────────────────────────────── */
function getQueue() {
  try { return JSON.parse(localStorage.getItem('nf_queue') || '[]'); } catch { return []; }
}

function queueAction(action) {
  const q = getQueue();
  q.push(action);
  localStorage.setItem('nf_queue', JSON.stringify(q));
  updateQueueBar();
}

function updateQueueBar() {
  const q = getQueue();
  const bar = $('queue-bar');
  if (q.length) {
    bar.style.display = 'flex';
    $('queue-count').textContent = q.length;
  } else {
    bar.style.display = 'none';
  }
}

async function flushQueue() {
  const q = getQueue();
  if (!q.length) { toast('Nothing to sync'); return; }

  showUploading();
  const failed = [];

  for (const action of q) {
    let ok = false;
    try {
      if (action.type === 'snap') {
        ok = action.projType === 'hw'
          ? await addPhotosToHW(action.projectId, action.photos, action.note)
          : await addPhotosToProject(action.projectId, action.photos, action.note);
      } else if (action.type === 'status') {
        ok = await updateStatus(action.projectId, action.projType, action.newStatus);
      } else if (action.type === 'expense') {
        const rows = await SB.get('projects?id=eq.' + action.projectId + '&select=data');
        if (rows && rows.length) {
          const p = rows[0].data;
          if (!p.invoices) p.invoices = [];
          p.invoices.push(action.invoice);
          p.dateUpdated = new Date().toISOString();
          ok = await SB.upsert('projects', [{
            id: action.projectId, site_id: currentSiteId,
            project_number: p.projectNumber || null,
            project_name: p.projectName || 'Untitled', status: p.status || 'Draft',
            category: p.category || null, priority: p.priority || null,
            date_created: p.dateCreated || null, date_updated: p.dateUpdated,
            data: p,
          }]);
        }
      } else if (action.type === 'note') {
        ok = true;
      }
    } catch { /* failed */ }
    if (!ok) failed.push(action);
  }

  localStorage.setItem('nf_queue', JSON.stringify(failed));
  hideUploading();
  updateQueueBar();

  if (failed.length) {
    toast(failed.length + ' item(s) still pending', 'warning');
  } else {
    toast('All synced!', 'success');
  }
  loadProjects();
}

window.addEventListener('online', () => {
  const q = getQueue();
  if (q.length) {
    toast('Back online — syncing…');
    setTimeout(flushQueue, 1000);
  } else {
    setSyncStatus('synced');
    loadProjects();
  }
});
window.addEventListener('offline', () => setSyncStatus('offline'));

/* ── Loading overlay ────────────────────────────────────── */
function showUploading() {
  if ($('uploading')) return;
  const div = document.createElement('div');
  div.id = 'uploading';
  div.className = 'uploading-overlay';
  div.innerHTML = '<div class="uploading-box"><div class="uploading-spinner"></div><div class="uploading-text">Uploading…</div></div>';
  document.body.appendChild(div);
}

function hideUploading() {
  const el = $('uploading');
  if (el) { el.style.opacity = '0'; setTimeout(() => el.remove(), 200); }
}

/* ── Toast ───────────────────────────────────────────────── */
const TOAST_ICONS = {
  success: SVG.check,
  warning: SVG.alertCircle,
  error: SVG.alertCircle,
};

function toast(msg, type) {
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  const icon = TOAST_ICONS[type] || '';
  el.innerHTML = icon + ' ' + esc(msg);
  $('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

/* ── Voice to text ─────────────────────────────────────── */
let activeRecognition = null;
let activeRecBtn = null;

function toggleVoice(textareaId, btn) {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    toast('Speech recognition not supported', 'warning');
    return;
  }

  if (activeRecognition && activeRecBtn === btn) {
    activeRecognition.stop();
    return;
  }

  if (activeRecognition) activeRecognition.stop();

  const rec = new SpeechRec();
  rec.lang = 'en-ZA';
  rec.continuous = true;
  rec.interimResults = true;

  const textarea = $(textareaId);
  const baseText = textarea.value;
  btn.classList.add('recording');
  activeRecognition = rec;
  activeRecBtn = btn;

  rec.onresult = e => {
    let interim = '', final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t;
      else interim += t;
    }
    if (final) {
      const sep = baseText && !baseText.endsWith(' ') && !baseText.endsWith('\n') ? ' ' : '';
      textarea.value = baseText + sep + final;
    }
    if (interim) {
      const sep = textarea.value && !textarea.value.endsWith(' ') && !textarea.value.endsWith('\n') ? ' ' : '';
      textarea.value = textarea.value.replace(/ ?…$/, '') + sep + interim + '…';
    }
  };

  rec.onerror = e => {
    btn.classList.remove('recording');
    activeRecognition = null;
    activeRecBtn = null;
    if (e.error === 'not-allowed') toast('Microphone access denied', 'error');
    else if (e.error !== 'aborted') toast('Voice error: ' + e.error, 'warning');
  };

  rec.onend = () => {
    btn.classList.remove('recording');
    activeRecognition = null;
    activeRecBtn = null;
    textarea.value = textarea.value.replace(/ ?…$/, '');
  };

  rec.start();
  toast('Listening…');
}

/* ── Utilities ──────────────────────────────────────────── */
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Dark mode ─────────────────────────────────────────── */
function setDarkMode(mode) {
  localStorage.setItem('nf_theme', mode);
  applyTheme();
  updateThemeButtons();
  haptic();
}

function applyTheme() {
  const pref = localStorage.getItem('nf_theme') || 'auto';
  const html = document.documentElement;
  if (pref === 'dark') html.setAttribute('data-theme', 'dark');
  else if (pref === 'light') html.setAttribute('data-theme', 'light');
  else html.setAttribute('data-theme', window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const isDark = html.getAttribute('data-theme') === 'dark';
  document.querySelector('meta[name="theme-color"]').content = isDark ? '#152914' : '#1F3D1D';
}

function updateThemeButtons() {
  const pref = localStorage.getItem('nf_theme') || 'auto';
  document.querySelectorAll('.toggle-opt').forEach(b => b.classList.toggle('active', b.dataset.mode === pref));
}

/* ── Bottom nav ────────────────────────────────────────── */
function navTap(view) {
  haptic(10);
  if (view === 'snap') { startSnapTag(); return; }
  if (view === currentView) return;
  if (view === 'home') navigateBack();
  else navigateTo(view);
}

function updateNavActive(view) {
  const map = { home:'home', snap:'snap', notes:'notes', settings:'settings', status:'home', expense:'home' };
  const v = map[view] || 'home';
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === v));
}

/* ── Pull to refresh ───────────────────────────────────── */
function initPullToRefresh() {
  const home = $('view-home');
  const indicator = $('pull-indicator');
  if (!home || !indicator) return;
  let startY = 0, pulling = false, triggered = false;

  home.addEventListener('touchstart', e => {
    if (window.scrollY <= 0 && currentView === 'home') {
      startY = e.touches[0].clientY;
      pulling = true;
      triggered = false;
    }
  }, { passive: true });

  home.addEventListener('touchmove', e => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 0 && dy < 150) {
      indicator.style.height = Math.min(dy * 0.4, 50) + 'px';
      indicator.style.opacity = Math.min(dy / 80, 1);
      if (dy > 80 && !triggered) { triggered = true; indicator.classList.add('ready'); haptic(15); }
    }
  }, { passive: true });

  home.addEventListener('touchend', () => {
    if (!pulling) return;
    pulling = false;
    if (triggered) {
      indicator.classList.remove('ready');
      indicator.classList.add('refreshing');
      loadProjects().then(() => {
        indicator.classList.remove('refreshing');
        indicator.style.height = '';
        indicator.style.opacity = '';
        toast('Refreshed', 'success');
      });
    } else {
      indicator.style.height = '';
      indicator.style.opacity = '';
      indicator.classList.remove('ready');
    }
  }, { passive: true });
}

/* ── GPS location ──────────────────────────────────────── */
function toggleGPS() {
  gpsEnabled = !gpsEnabled;
  localStorage.setItem('nf_gps', gpsEnabled);
  $('gps-toggle')?.classList.toggle('on', gpsEnabled);
  haptic();
  if (gpsEnabled) requestGPS();
}

function requestGPS() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    pos => {
      lastGPS = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: Math.round(pos.coords.accuracy) };
      const el = $('snap-location');
      if (el) { el.style.display = 'flex'; $('snap-gps-text').textContent = 'GPS: ' + lastGPS.lat.toFixed(5) + ', ' + lastGPS.lng.toFixed(5); }
    },
    () => {},
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

/* ── Haptic & sound ────────────────────────────────────── */
let _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx || _audioCtx.state === 'closed') {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}

function toggleHaptic() {
  hapticEnabled = !hapticEnabled;
  localStorage.setItem('nf_haptic', hapticEnabled);
  $('haptic-toggle')?.classList.toggle('on', hapticEnabled);
  if (hapticEnabled) haptic();
}

function haptic(ms) {
  if (!hapticEnabled) return;
  if (navigator.vibrate) navigator.vibrate(ms || 15);
  playTone(1400, 0.7, 0.08);
}

function hapticSuccess() {
  if (!hapticEnabled) return;
  if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
  playTone(880, 0.7, 0.15);
  setTimeout(() => playTone(1320, 0.7, 0.2), 140);
}

function playTone(freq, vol, dur) {
  try {
    const ctx = getAudioCtx();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const comp = ctx.createDynamicsCompressor();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    osc.connect(comp);
    comp.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.003);
    gain.gain.setValueAtTime(vol, t + dur * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.start(t);
    osc.stop(t + dur + 0.01);
  } catch {}
}

function playShutter() {
  try {
    const ctx = getAudioCtx();
    const t = ctx.currentTime;
    const bufSize = ctx.sampleRate * 0.08;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufSize, 0.5);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const comp = ctx.createDynamicsCompressor();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2500;
    filter.Q.value = 0.7;
    src.connect(filter);
    filter.connect(comp);
    comp.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.9, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    src.start(t);
  } catch {}
}

/* ── Init ───────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  $('camera-input').addEventListener('change', e => handleSnapFiles(e.target.files));
  $('gallery-input').addEventListener('change', e => handleSnapFiles(e.target.files));
  $('receipt-input')?.addEventListener('change', e => handleReceiptFile(e.target.files));

  $('site-label').textContent = SITES[currentSiteId].short;

  applyTheme();
  updateThemeButtons();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  $('gps-toggle')?.classList.toggle('on', gpsEnabled);
  $('haptic-toggle')?.classList.toggle('on', hapticEnabled);
  if (gpsEnabled) requestGPS();
  if ($('settings-site')) $('settings-site').textContent = SITES[currentSiteId].short;

  initPullToRefresh();
  updateNavActive('home');
  loadProjects();

  function warmAudio() {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = 0;
    osc.connect(g); g.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.001);
    document.removeEventListener('click', warmAudio);
    document.removeEventListener('touchend', warmAudio);
  }
  document.addEventListener('click', warmAudio, { once: true });
  document.addEventListener('touchend', warmAudio, { once: true });
});

updateQueueBar();
