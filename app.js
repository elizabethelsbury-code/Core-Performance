const TIMEZONE = 'Australia/Melbourne';
const STORAGE_KEY = 'training-ledger-sessions';
const IMPORT_FLAG = 'training-ledger-imported-v1';
const SETTINGS_KEY = 'training-ledger-settings';
const PLAN_KEY = 'training-ledger-plan';
const DEFAULT_START_DATE = todayISO_fallback();

function todayISO_fallback(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

let sessions = [];
let settings = { startDate: DEFAULT_START_DATE };
let PLAN = {};
let view = 'log';
let expandedHistory = {};
let editingId = null;
let progressExercise = null;
let editingProgram = false;

function loadPlan(){
  try{
    const raw = localStorage.getItem(PLAN_KEY);
    if(raw){ PLAN = JSON.parse(raw); return; }
  }catch(e){}
  PLAN = JSON.parse(JSON.stringify(DEFAULT_PLAN));
}
function savePlan(){
  try{ localStorage.setItem(PLAN_KEY, JSON.stringify(PLAN)); }catch(e){ showToast("Couldn't save program"); }
}

function loadSettings(){
  try{
    const raw = localStorage.getItem(SETTINGS_KEY);
    if(raw) settings = { ...settings, ...JSON.parse(raw) };
    else saveSettings();
  }catch(e){}
}
function saveSettings(){
  try{ localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }catch(e){}
}
function getWeekAndPhase(){
  const start = new Date(settings.startDate + 'T00:00:00');
  const now = new Date(todayISO() + 'T00:00:00');
  const diffDays = Math.floor((now - start) / 86400000);
  let week = Math.floor(diffDays / 7) + 1;
  if(week < 1) week = 1;
  return { week };
}
function renderHeader(){
  const { week } = getWeekAndPhase();
  const phaseline = document.getElementById('phaseline');
  phaseline.innerHTML = `
    <div><div class="eyebrow">Week</div><div class="week">${week}</div></div>
  `;
  const plates = document.getElementById('plates');
  if(plates) plates.innerHTML = '';
}

function todayISO(){
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date());
  const y = parts.find(p=>p.type==='year').value, m = parts.find(p=>p.type==='month').value, d = parts.find(p=>p.type==='day').value;
  return `${y}-${m}-${d}`;
}
function todayDayName(){ return new Intl.DateTimeFormat('en-AU', { timeZone: TIMEZONE, weekday:'long' }).format(new Date()); }
function formatAU(iso){ if(!iso) return ''; const [y,m,d]=iso.split('-'); return `${d}/${m}/${y}`; }
function uid(){ return Math.random().toString(36).slice(2,10) + Date.now().toString(36); }

function loadData(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw) sessions = JSON.parse(raw);
  }catch(e){ sessions = []; }
  const imported = localStorage.getItem(IMPORT_FLAG);
  if(!imported){
    const existingDates = new Set(sessions.map(s=>s.date));
    const toAdd = window.HISTORICAL_SESSIONS.filter(s=>!existingDates.has(s.date));
    sessions = [...sessions, ...toAdd];
    saveData();
    localStorage.setItem(IMPORT_FLAG, 'true');
    showToast(`Loaded ${toAdd.length} past sessions`);
  }
}
function saveData(){
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions)); }catch(e){ showToast("Couldn't save — storage full?"); }
}

function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 1800);
}

function emptyExercisesFor(dayKey){
  const day = PLAN[dayKey];
  if(!day || day.type !== 'lift') return [];
  return (day.exercises||[]).map(e => ({ id: uid(), name: e.name, target: e.target, hero: !!e.hero, custom:false, sets: [] }));
}

// ---------- Log state ----------
let logState = {
  date: todayISO(),
  dayKey: todayDayName(),
  exercises: [],
  cardio: { active:false, type:'Run', distance:'', time:'', note:'' },
  warmup: '',
  note: '',
};
function resetLogForDay(dayKey){
  const day = PLAN[dayKey];
  logState.dayKey = dayKey;
  if(day && day.type === 'lift'){
    logState.exercises = emptyExercisesFor(dayKey);
    logState.cardio = { active:false, type:'Run', distance:'', time:'', note:'' };
  } else if(day && day.type === 'cardio'){
    logState.exercises = [];
    logState.cardio = { active:true, type:'Run', distance:'', time:'', note:'' };
  } else {
    logState.exercises = [];
    logState.cardio = { active:true, type:'Walk', distance:'', time:'', note:'' };
  }
}
resetLogForDay(logState.dayKey);

function renderNav(){
  const tabs = [
    {id:'log', label:'Log', ic:'&#9998;'},
    {id:'schedule', label:'Schedule', ic:'&#128197;'},
    {id:'history', label:'History', ic:'&#128337;'},
    {id:'progress', label:'Progress', ic:'&#128200;'},
    {id:'biglifts', label:'Big lifts', ic:'&#127942;'},
    {id:'program', label:'Program', ic:'&#128203;'},
  ];
  document.getElementById('navbar').innerHTML = `<div style="display:flex;overflow-x:auto;width:100%;">` + tabs.map(t=>
    `<button class="navbtn ${view===t.id?'active':''}" data-view="${t.id}" style="flex:0 0 auto;min-width:60px;"><span class="ic">${t.ic}</span>${t.label}</button>`
  ).join('') + `</div>`;
  document.querySelectorAll('.navbtn').forEach(b=>{
    b.onclick = ()=>{
      const target = b.dataset.view;
      if(target === 'log' && view !== 'log'){
        editingId = null;
        logState.date = todayISO();
        resetLogForDay(todayDayName());
        logState.warmup = '';
        logState.note = '';
      }
      view = target;
      renderAll();
    };
  });
}

function renderAll(){
  renderHeader();
  renderNav();
  const main = document.getElementById('mainContent');
  if(view === 'log') renderLog(main);
  else if(view === 'schedule') renderSchedule(main);
  else if(view === 'history') renderHistory(main);
  else if(view === 'progress') renderProgress(main);
  else if(view === 'biglifts') renderBigLifts(main);
  else if(view === 'program') renderProgram(main);
}

// ---------- SCHEDULE VIEW ----------
function addDaysISO(iso, n){
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function weekdayForISO(iso){
  return new Intl.DateTimeFormat('en-AU', { timeZone: TIMEZONE, weekday:'long' }).format(new Date(iso + 'T12:00:00'));
}
function renderSchedule(main){
  const today = todayISO();
  let html = `<div class="section-label">Next 14 days</div>`;
  for(let i=0; i<14; i++){
    const iso = addDaysISO(today, i);
    const dayName = weekdayForISO(iso);
    const day = PLAN[dayName];
    const isToday = i === 0;
    const typeColor = day.type === 'lift' ? 'var(--brass)' : day.type === 'cardio' ? 'var(--steel)' : 'var(--text-faint)';
    let exList = '';
    if(day.type === 'lift'){
      exList = (day.exercises||[]).map(e=>`${e.name}${e.hero?' <span style="color:var(--rust);">·</span>':''}`).join(', ');
    } else {
      exList = day.desc || '';
    }
    html += `<div class="card" data-schedule-date="${iso}" data-schedule-day="${dayName}" style="${isToday?'border-color:var(--brass);':''}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
        <div>
          <div class="eyebrow" style="color:${isToday?'var(--brass)':'var(--text-faint)'};">${isToday?'TODAY · ':''}${dayName.toUpperCase()} · ${formatAU(iso)}</div>
          <div style="font-family:var(--font-display);font-weight:600;font-size:15px;color:${typeColor};">${day.label}</div>
        </div>
      </div>
      <div style="font-size:12px;color:var(--text-dim);line-height:1.5;margin-bottom:8px;">${exList}</div>
      <button class="scheduleLogBtn" data-date="${iso}" data-day="${dayName}" style="background:none;border:none;color:var(--brass);font-family:var(--font-mono);font-size:11px;letter-spacing:0.04em;padding:0;">LOG THIS SESSION →</button>
    </div>`;
  }
  main.innerHTML = html;
  main.querySelectorAll('.scheduleLogBtn').forEach(btn=>{
    btn.onclick = ()=>{
      logState.date = btn.dataset.date;
      resetLogForDay(btn.dataset.day);
      view = 'log';
      renderAll();
    };
  });
}

// ---------- inject extra styles for Cycle/Correlate views ----------

function renderLog(main){
  const day = PLAN[logState.dayKey];
  let html = '';
  if(editingId){
    html += `<div class="card" style="border-color:var(--brass);display:flex;justify-content:space-between;align-items:center;">
      <span class="eyebrow" style="color:var(--brass);">Editing session</span>
      <button id="cancelEditBtn" style="background:none;border:none;color:var(--text-faint);font-family:var(--font-mono);font-size:11px;">Cancel</button>
    </div>`;
  }
  html += `<div class="row2" style="margin-bottom:14px;">
    <div class="field"><label>Date</label><input type="date" id="logDate" value="${logState.date}"></div>
    <div class="field"><label>Day</label>
      <select id="logDay">${DAY_ORDER.map(d=>`<option value="${d}" ${d===logState.dayKey?'selected':''}>${d} — ${PLAN[d].label}</option>`).join('')}</select>
    </div>
  </div>`;

  if(day.type !== 'lift'){
    html += `<div class="card"><div class="section-label">${day.type==='cardio'?'Run':'Recovery'}</div><div style="font-size:13px;color:var(--text-dim);">${escapeHtml(day.desc||'')}</div></div>`;
  }

  html += `<div class="field" style="margin-bottom:14px;"><label>Warm-up</label><input type="text" id="logWarmup" autocomplete="off" placeholder="Optional" value="${escapeAttr(logState.warmup)}"></div>`;

  if(day.type === 'lift'){
    html += `<div class="section-label">Exercises</div>`;
    logState.exercises.forEach(ex=>{ html += renderExerciseCard(ex); });
    html += `<button class="pill" id="addExerciseBtn" style="width:100%;padding:12px;margin-bottom:14px;border-style:dashed;">+ Add exercise</button>`;
  }

  html += `<div class="section-label" style="display:flex;justify-content:space-between;align-items:center;">
    <span>Run / walk</span>
    <button id="toggleCardioBtn" style="background:none;border:none;color:${logState.cardio.active?'var(--brass)':'var(--text-faint)'};font-family:var(--font-mono);font-size:11px;">${logState.cardio.active?'REMOVE':'+ ADD'}</button>
  </div>`;
  if(logState.cardio.active){
    html += `<div class="card">
      <div style="display:flex;gap:8px;margin-bottom:10px;">
        <button class="pill ${logState.cardio.type==='Run'?'active':''}" data-cardio-type="Run">RUN</button>
        <button class="pill ${logState.cardio.type==='Walk'?'active':''}" data-cardio-type="Walk">WALK</button>
      </div>
      <div class="row2">
        <div class="field"><label>Distance (km)</label><input type="text" inputmode="decimal" id="cardioDist" autocomplete="off" value="${escapeAttr(logState.cardio.distance)}" placeholder="km"></div>
        <div class="field"><label>Time (mm:ss)</label><input type="text" id="cardioTime" autocomplete="off" value="${escapeAttr(logState.cardio.time)}" placeholder="mm:ss"></div>
      </div>
      <div class="field" style="margin-top:10px;"><label>Notes</label><input type="text" id="cardioNote" autocomplete="off" value="${escapeAttr(logState.cardio.note)}" placeholder="Effort, how it felt…"></div>
    </div>`;
  }

  html += `<div class="field" style="margin:14px 0;"><label>Session notes</label><textarea id="logNote" rows="2" placeholder="Niggles, form notes…">${escapeHtml(logState.note)}</textarea></div>`;

  main.innerHTML = html;
  const dateInput = document.getElementById('logDate');
  const syncDateToDay = e=>{
    const v = e.target.value;
    if(!v || v === logState.date) return;
    logState.date = v;
    const matchingDay = weekdayForISO(v);
    resetLogForDay(matchingDay);
    renderLog(main);
  };
  dateInput.onchange = syncDateToDay;
  dateInput.oninput = syncDateToDay;
  document.getElementById('logDay').onchange = e=>{ resetLogForDay(e.target.value); renderLog(main); };
  document.getElementById('logWarmup').oninput = e=>{ logState.warmup = e.target.value; };
  const noteEl = document.getElementById('logNote'); if(noteEl) noteEl.oninput = e=>{ logState.note = e.target.value; };
  const addExBtn = document.getElementById('addExerciseBtn');
  if(addExBtn) addExBtn.onclick = ()=>{ logState.exercises.push({id:uid(), name:'', target:'', hero:false, custom:true, sets:[]}); renderLog(main); };
  document.getElementById('toggleCardioBtn').onclick = ()=>{ logState.cardio.active = !logState.cardio.active; renderLog(main); };
  document.querySelectorAll('[data-cardio-type]').forEach(b=>{ b.onclick = ()=>{ logState.cardio.type = b.dataset.cardioType; renderLog(main); }; });
  const cd = document.getElementById('cardioDist'); if(cd) cd.oninput = e=>logState.cardio.distance = e.target.value;
  const ct = document.getElementById('cardioTime'); if(ct) ct.oninput = e=>logState.cardio.time = e.target.value;
  const cn = document.getElementById('cardioNote'); if(cn) cn.oninput = e=>logState.cardio.note = e.target.value;
  wireExerciseCards(main);
  const cancelBtn = document.getElementById('cancelEditBtn');
  if(cancelBtn) cancelBtn.onclick = ()=>{ editingId = null; logState.date = todayISO(); resetLogForDay(todayDayName()); logState.warmup=''; logState.note=''; renderLog(main); };
}

function renderExerciseCard(ex){
  let html = `<div class="card" data-ex-id="${ex.id}">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
      <div style="flex:1;">`;
  if(ex.custom){
    html += `<input class="ex-name-input" data-ex-id="${ex.id}" value="${escapeAttr(ex.name)}" placeholder="Exercise name" style="background:none;border:none;font-family:var(--font-display);font-weight:600;font-size:15px;color:var(--text);width:100%;padding:0;">`;
  } else {
    html += `<div style="font-family:var(--font-display);font-weight:600;font-size:15px;">${escapeHtml(ex.name)}</div>`;
    html += `<div class="${ex.hero?'herobadge':'accbadge'}" style="display:inline-block;margin-top:4px;">${ex.target}${ex.hero?' · HERO':''}</div>`;
  }
  html += `</div><button class="removeExBtn" data-ex-id="${ex.id}" style="background:none;border:none;color:var(--text-faint);font-size:16px;">&times;</button></div>`;

  ex.sets.forEach((s,i)=>{
    html += `<div class="setrow" data-ex-id="${ex.id}" data-set-id="${s.id}">
      <span class="idx">${i+1}</span>
      <input class="w set-field" data-field="weight" autocomplete="off" placeholder="kg" value="${escapeAttr(s.weight)}">
      <span style="color:var(--text-faint);font-size:12px;">×</span>
      <input class="r set-field" data-field="reps" autocomplete="off" placeholder="reps" value="${escapeAttr(s.reps)}">
      <select class="set-field" data-field="rir">
        <option value="">RIR</option>
        ${['0-1','2-3','4-5','Failure'].map(r=>`<option value="${r}" ${s.rir===r?'selected':''}>${r}</option>`).join('')}
      </select>
      <input class="n set-field" data-field="note" autocomplete="off" placeholder="note" value="${escapeAttr(s.note)}">
      <button class="removeSetBtn">&times;</button>
    </div>`;
  });
  html += `<button class="addset" data-ex-id="${ex.id}">+ Add set</button></div>`;
  return html;
}

function wireExerciseCards(main){
  main.querySelectorAll('.ex-name-input').forEach(inp=>{
    inp.oninput = e=>{ const ex = logState.exercises.find(x=>x.id===inp.dataset.exId); if(ex) ex.name = e.target.value; };
  });
  main.querySelectorAll('.removeExBtn').forEach(btn=>{
    btn.onclick = ()=>{ logState.exercises = logState.exercises.filter(x=>x.id!==btn.dataset.exId); renderLog(main); };
  });
  main.querySelectorAll('.addset').forEach(btn=>{
    btn.onclick = ()=>{
      const ex = logState.exercises.find(x=>x.id===btn.dataset.exId);
      if(ex) ex.sets.push({id:uid(), weight:'', reps:'', rir:'', note:''});
      renderLog(main);
    };
  });
  main.querySelectorAll('.setrow').forEach(row=>{
    const exId = row.dataset.exId, setId = row.dataset.setId;
    row.querySelectorAll('.set-field').forEach(f=>{
      const ev = f.tagName === 'SELECT' ? 'onchange' : 'oninput';
      f[ev] = e=>{
        const ex = logState.exercises.find(x=>x.id===exId);
        const s = ex && ex.sets.find(x=>x.id===setId);
        if(s) s[f.dataset.field] = e.target.value;
      };
    });
    row.querySelector('.removeSetBtn').onclick = ()=>{
      const ex = logState.exercises.find(x=>x.id===exId);
      if(ex) ex.sets = ex.sets.filter(x=>x.id!==setId);
      renderLog(main);
    };
  });
}

function handleSave(){
  const loggedExercises = logState.exercises
    .filter(ex=>ex.name.trim() && ex.sets.some(s=>s.weight||s.reps))
    .map(ex=>({ name: ex.name.trim(), tier: ex.hero?'hero':'accessory',
      sets: ex.sets.filter(s=>s.weight||s.reps).map(s=>({weight:s.weight||'', reps:s.reps||'', rir:s.rir||'', note:s.note||''})) }));
  const hasCardio = logState.cardio.active && (logState.cardio.distance || logState.cardio.time);
  if(loggedExercises.length === 0 && !hasCardio){ showToast('Log at least one set or a run/walk first'); return; }
  const session = {
    id: editingId || uid(), date: logState.date, dayKey: logState.dayKey,
    dayLabel: PLAN[logState.dayKey]?.label || logState.dayKey,
    warmup: logState.warmup.trim(), note: logState.note.trim(),
    exercises: loggedExercises, cardio: hasCardio ? {...logState.cardio} : null,
  };
  sessions = [session, ...sessions.filter(s=>s.date !== logState.date && s.id !== editingId)];
  saveData();
  showToast(editingId ? 'Session updated' : 'Session saved');
  editingId = null;
  logState.date = todayISO(); resetLogForDay(todayDayName()); logState.warmup=''; logState.note='';
  view = 'history';
  renderAll();
}

// ---------- HISTORY VIEW ----------
function renderHistory(main){
  const sorted = [...sessions].sort((a,b)=>b.date.localeCompare(a.date));
  const importBtn = `<button id="importNotesBtn" class="pill active" style="padding:6px 14px;margin-bottom:14px;">Import from notes</button>`;
  if(sorted.length === 0){ main.innerHTML = importBtn + `<div class="emptystate">No sessions yet. Head to Log to add your first one, or import old notes above.</div>`; wireImportButton(main); return; }
  main.innerHTML = importBtn + sorted.map(s=>{
    const open = !!expandedHistory[s.id];
    let body = '';
    if(open){
      if(s.warmup) body += `<div style="font-size:12px;color:var(--text-dim);margin-bottom:8px;">Warm-up: ${escapeHtml(s.warmup)}</div>`;
      (s.exercises||[]).forEach(ex=>{
        body += `<div class="exname">${escapeHtml(ex.name)}</div><div class="chiprow">`;
        (ex.sets||[]).forEach(st=>{
          body += `<span class="chip">${fmtWeight(st.weight)} × ${st.reps||'–'}${st.rir?' · '+st.rir:''}</span>`;
        });
        body += `</div>`;
      });
      if(s.cardio) body += `<div style="font-family:var(--font-mono);font-size:12px;color:var(--steel);margin-bottom:8px;">${s.cardio.type}: ${s.cardio.distance||'–'}km ${s.cardio.time?'in '+s.cardio.time:''}</div>`;
      if(s.note) body += `<div style="font-size:12px;color:var(--text-dim);">Notes: ${escapeHtml(s.note)}</div>`;
      body += `<div class="histactions"><button class="editSessionBtn" data-id="${s.id}" style="color:var(--brass);">EDIT</button><button class="deleteSessionBtn" data-id="${s.id}" style="color:var(--rust);">DELETE</button></div>`;
    }
    return `<div class="card">
      <button class="histhead" data-id="${s.id}">
        <div><div class="histdate">${formatAU(s.date)}</div><div class="histlabel">${escapeHtml(s.dayLabel)}</div></div>
        <span style="color:var(--text-faint);">${open?'&#9650;':'&#9660;'}</span>
      </button>
      <div class="histbody ${open?'show':''}">${body}</div>
    </div>`;
  }).join('');
  main.querySelectorAll('.histhead').forEach(b=>{
    b.onclick = ()=>{ expandedHistory[b.dataset.id] = !expandedHistory[b.dataset.id]; renderHistory(main); };
  });
  main.querySelectorAll('.deleteSessionBtn').forEach(b=>{
    b.onclick = ()=>{ sessions = sessions.filter(s=>s.id!==b.dataset.id); saveData(); renderHistory(main); };
  });
  main.querySelectorAll('.editSessionBtn').forEach(b=>{
    b.onclick = ()=>{
      const s = sessions.find(x=>x.id===b.dataset.id);
      if(!s) return;
      editingId = s.id;
      logState.date = s.date;
      logState.dayKey = PLAN[s.dayKey] ? s.dayKey : todayDayName();
      logState.warmup = s.warmup || ''; logState.note = s.note || '';
      logState.exercises = (s.exercises||[]).map(ex=>({
        id:uid(), name:ex.name, target: (PLAN[logState.dayKey]?.exercises||[]).find(p=>p.name===ex.name)?.target || '',
        hero: ex.tier==='hero', custom: !(PLAN[logState.dayKey]?.exercises||[]).some(p=>p.name===ex.name),
        sets: (ex.sets||[]).map(st=>({id:uid(), weight:st.weight||'', reps:st.reps||'', rir:st.rir||'', note:st.note||''}))
      }));
      logState.cardio = s.cardio ? {...s.cardio, active:true} : {active:false,type:'Run',distance:'',time:'',note:''};
      view = 'log';
      renderAll();
      showToast('Editing session — save to update');
    };
  });
  wireImportButton(main);
}

// ---------- IMPORT FROM NOTES ----------
let importPreview = [];
function wireImportButton(main){
  const btn = document.getElementById('importNotesBtn');
  if(btn) btn.onclick = ()=>renderImportForm(main);
}
function renderImportForm(main){
  main.innerHTML = `
    <div class="section-label">Import from notes</div>
    <div style="font-size:12px;color:var(--text-dim);line-height:1.5;margin-bottom:12px;">
      Paste your training notes below. Start each session with a date on its own line (e.g. "18/3" or "18/3/26"), then list what you did underneath, one exercise per line. Separate sessions with a blank line.
    </div>
    <textarea id="importTextarea" rows="12" placeholder="18/3
Bench press 60kg 8, 8, 6
Lat pulldown 70kg 10, 10

19/3: 5km run 24:30" style="width:100%;background:var(--surface-2);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:10px;font-family:var(--font-mono);font-size:13px;margin-bottom:12px;"></textarea>
    <div style="display:flex;gap:10px;">
      <button id="cancelImportBtn" style="flex:1;padding:11px;border-radius:9px;border:1px solid var(--border);background:var(--surface-2);color:var(--text);font-family:var(--font-display);font-weight:600;font-size:13px;">Cancel</button>
      <button id="parseImportBtn" style="flex:1;padding:11px;border-radius:9px;border:none;background:var(--brass);color:#1B1600;font-family:var(--font-display);font-weight:600;font-size:13px;">Parse notes</button>
    </div>
  `;
  document.getElementById('cancelImportBtn').onclick = ()=>renderHistory(main);
  document.getElementById('parseImportBtn').onclick = ()=>{
    const text = document.getElementById('importTextarea').value;
    importPreview = parseImportText(text);
    renderImportPreview(main);
  };
}
function parseImportText(text){
  const blocks = text.split(/\n\s*\n/);
  const dateRe = /^(?:[A-Za-z]+\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*:?\s*(.*)$/;
  const results = [];
  const defaultYear = new Date().getFullYear();
  blocks.forEach(block=>{
    const lines = block.split('\n').map(l=>l.trim()).filter(l=>l);
    if(lines.length === 0) return;
    const m = dateRe.exec(lines[0]);
    if(!m) return;
    const [, day, month, yr, rest] = m;
    const year = yr ? (yr.length===2 ? 2000+parseInt(yr) : parseInt(yr)) : defaultYear;
    const d = new Date(year, parseInt(month)-1, parseInt(day));
    if(isNaN(d.getTime())) return;
    const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const weekday = new Intl.DateTimeFormat('en-AU', { weekday:'long' }).format(d);
    const contentLines = [];
    if(rest && rest.trim()) contentLines.push(rest.trim());
    contentLines.push(...lines.slice(1));
    const exercises = [];
    let cardio = null;
    contentLines.forEach(line=>{
      const low = line.toLowerCase();
      const looksCardio = /(run|walk)/.test(low) && !/\d+\s*(kg|lb)/.test(low);
      if(looksCardio && !cardio){
        const dm = /(\d+(?:\.\d+)?)\s*km/.exec(low);
        const tm = /(\d{1,2}:\d{2})/.exec(line);
        cardio = { active:true, type: low.includes('run')?'Run':'Walk', distance: dm?dm[1]:'', time: tm?tm[1]:'', note: line };
        return;
      }
      const ex = parseExerciseLine(line);
      if(ex) exercises.push(ex);
    });
    results.push({
      id: 'import-'+iso+'-'+uid(), date: iso, dayKey: weekday,
      dayLabel: PLAN[weekday] ? PLAN[weekday].label : weekday,
      warmup:'', note:'', exercises, cardio, skip:false,
    });
  });
  return results;
}
function parseExerciseLine(line){
  const numPattern = '\\d+(?:\\.\\d+)?';
  let name, rest;
  if(line.includes(':')){
    const idx = line.indexOf(':');
    name = line.slice(0, idx).replace(new RegExp(numPattern+'.*$'), '').trim().replace(/[-\s]+$/,'');
    rest = line.slice(idx+1).trim();
    if(!name) return null;
  } else {
    const m = line.match(/\d/);
    if(!m) return null;
    name = line.slice(0, m.index).trim().replace(/[-:\s]+$/,'');
    rest = line.slice(m.index);
    if(!name) return null;
  }
  const segments = rest.split(',').map(s=>s.trim()).filter(Boolean);
  const sets = [];
  let lastWeight = '';
  const weightRe = new RegExp(numPattern+'(?:x'+numPattern+')?\\s*(?:kg|lb)', 'i');
  const repsRe = new RegExp(numPattern+'(?:\\+'+numPattern+')?');
  segments.forEach(seg=>{
    const wm = weightRe.exec(seg);
    let weight = lastWeight, remainder = seg;
    if(wm){
      weight = wm[0].replace(/\s+/g,'');
      lastWeight = weight;
      remainder = (seg.slice(0,wm.index) + ' ' + seg.slice(wm.index+wm[0].length)).trim();
    }
    const rm = repsRe.exec(remainder);
    const reps = rm ? rm[0] : '';
    if(!reps && !wm) return;
    sets.push({ weight, reps, rir:'', note: seg });
  });
  if(sets.length === 0) return null;
  return { name, tier:'accessory', sets };
}
function renderImportPreview(main){
  if(importPreview.length === 0){
    main.innerHTML = `<div class="emptystate">Couldn't find any dated sessions in that text. Make sure each session starts with a date like "18/3" on its own line.</div>
      <button id="backToImportBtn" class="pill active" style="width:100%;padding:11px;margin-top:12px;">Try again</button>`;
    document.getElementById('backToImportBtn').onclick = ()=>renderImportForm(main);
    return;
  }
  const existingDates = new Set(sessions.map(s=>s.date));
  let html = `<div class="section-label">Found ${importPreview.length} session${importPreview.length>1?'s':''}</div>
    <div style="font-size:12px;color:var(--text-dim);margin-bottom:12px;">Review below, untick any you don't want, then import. Dates that already have a session will be skipped automatically.</div>`;
  importPreview.forEach((s,i)=>{
    const already = existingDates.has(s.date);
    const summary = s.cardio ? `${s.cardio.type} ${s.cardio.distance||'?'}km` : (s.exercises.map(e=>e.name).join(', ') || 'No sets recognized');
    html += `<div class="card" style="${already?'opacity:0.5;':''}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <div class="histdate">${formatAU(s.date)} · ${s.dayKey}</div>
          <div style="font-size:12px;color:var(--text-dim);margin-top:4px;">${escapeHtml(summary)}</div>
          ${already?'<div style="font-size:11px;color:var(--rust);margin-top:4px;">Already have a session this date — will be skipped</div>':''}
        </div>
        <button class="toggleImportBtn" data-idx="${i}" style="background:none;border:1px solid ${s.skip?'var(--border)':'var(--brass)'};color:${s.skip?'var(--text-faint)':'var(--brass)'};border-radius:6px;padding:5px 9px;font-size:10px;font-family:var(--font-mono);flex-shrink:0;">${s.skip?'SKIPPED':'INCLUDE'}</button>
      </div>
    </div>`;
  });
  const includeCount = importPreview.filter(s=>!s.skip && !existingDates.has(s.date)).length;
  html += `<div style="display:flex;gap:10px;margin-top:14px;">
    <button id="cancelImportBtn2" style="flex:1;padding:11px;border-radius:9px;border:1px solid var(--border);background:var(--surface-2);color:var(--text);font-family:var(--font-display);font-weight:600;font-size:13px;">Cancel</button>
    <button id="commitImportBtn" style="flex:1;padding:11px;border-radius:9px;border:none;background:var(--brass);color:#1B1600;font-family:var(--font-display);font-weight:600;font-size:13px;">Import ${includeCount}</button>
  </div>`;
  main.innerHTML = html;
  main.querySelectorAll('.toggleImportBtn').forEach(b=>{
    b.onclick = ()=>{ importPreview[b.dataset.idx].skip = !importPreview[b.dataset.idx].skip; renderImportPreview(main); };
  });
  document.getElementById('cancelImportBtn2').onclick = ()=>{ importPreview=[]; renderHistory(main); };
  document.getElementById('commitImportBtn').onclick = ()=>{
    const toAdd = importPreview.filter(s=>!s.skip && !existingDates.has(s.date));
    sessions = [...sessions, ...toAdd.map(s=>({ id:s.id, date:s.date, dayKey:s.dayKey, dayLabel:s.dayLabel, warmup:s.warmup, note:s.note, exercises:s.exercises, cardio:s.cardio }))];
    saveData();
    showToast(`Imported ${toAdd.length} session${toAdd.length!==1?'s':''}`);
    importPreview = [];
    renderHistory(main);
  };
}

function fmtWeight(w){
  const v = String(w==null?'':w).trim();
  if(!v) return '–';
  if(/[a-z]/i.test(v)) return v;
  return `${v}kg`;
}

// ---------- PROGRESS VIEW ----------
function allExerciseNames(){
  const names = new Set();
  Object.values(PLAN).forEach(d=>{ if(d.exercises) d.exercises.forEach(e=>names.add(e.name)); });
  sessions.forEach(s=>(s.exercises||[]).forEach(e=>names.add(e.name)));
  return Array.from(names).sort();
}
function topWeight(ex){
  const nums = (ex.sets||[]).map(s=>parseFloat(s.weight)).filter(n=>!isNaN(n));
  return nums.length ? Math.max(...nums) : null;
}
function renderProgress(main){
  const names = allExerciseNames();
  if(!progressExercise || !names.includes(progressExercise)) progressExercise = names.includes('Barbell hip thrust') ? 'Barbell hip thrust' : names[0];
  const data = sessions.filter(s=>(s.exercises||[]).some(e=>e.name===progressExercise))
    .map(s=>{ const ex = s.exercises.find(e=>e.name===progressExercise); return {date:s.date, weight: topWeight(ex)}; })
    .filter(d=>d.weight!==null).sort((a,b)=>a.date.localeCompare(b.date));
  const latest = data.length ? data[data.length-1].weight : null;
  const best = data.length ? Math.max(...data.map(d=>d.weight)) : null;

  main.innerHTML = `
    <div class="field" style="margin-bottom:14px;"><label>Lift</label>
      <select id="progressSelect">${names.map(n=>`<option value="${escapeAttr(n)}" ${n===progressExercise?'selected':''}>${escapeHtml(n)}</option>`).join('')}</select>
    </div>
    <div class="statgrid">
      <div class="stat"><div class="l">Latest top set</div><div class="v">${latest!==null?latest+'kg':'—'}</div></div>
      <div class="stat"><div class="l">Best logged</div><div class="v" style="color:var(--brass);">${best!==null?best+'kg':'—'}</div></div>
    </div>
    <div class="chartwrap" id="progressChart"></div>
  `;
  document.getElementById('progressSelect').onchange = e=>{ progressExercise = e.target.value; renderProgress(main); };
  renderLineChart(document.getElementById('progressChart'), data, 'var(--brass)', '#C49A45');
}

// ---------- BIG LIFTS VIEW ----------
function topWeightForSession(session, includeGroups, excludeAny){
  let best = null;
  for(const ex of (session.exercises||[])){
    const name = (ex.name||'').toLowerCase();
    const matches = includeGroups.every(group=>group.some(k=>name.includes(k)));
    const excluded = excludeAny.some(e=>name.includes(e));
    if(!matches || excluded) continue;
    for(const s of (ex.sets||[])){
      const w = s.weight || '';
      if(!w || w.toLowerCase().includes('x')) continue;
      const num = parseFloat(w);
      if(isNaN(num)) continue;
      if(best===null || num>best) best = num;
    }
  }
  return best;
}
function renderBigLifts(main){
  const heroNames = new Set();
  Object.values(PLAN).forEach(d=>{ (d.exercises||[]).forEach(e=>{ if(e.hero && e.name.trim()) heroNames.add(e.name); }); });
  main.innerHTML = `<div class="section-label">Your big lifts over time</div><div id="biglifts-body"></div>`;
  const body = document.getElementById('biglifts-body');
  if(heroNames.size === 0){
    body.innerHTML = `<div class="emptystate">Mark an exercise as "Hero" in Edit Program to track its trend here.</div>`;
    return;
  }
  const palette = ['#C49A45','#6E93AC','#8A9A79','#C15C33','#9B7EDE','#C97F9A'];
  const sorted = [...sessions].sort((a,b)=>a.date.localeCompare(b.date));
  Array.from(heroNames).forEach((name, i)=>{
    const color = palette[i % palette.length];
    const data = sorted.map(s=>{
      const ex = (s.exercises||[]).find(e=>e.name===name);
      if(!ex) return null;
      const nums = (ex.sets||[]).map(st=>parseFloat(st.weight)).filter(n=>!isNaN(n));
      return nums.length ? {date:s.date, weight: Math.max(...nums)} : null;
    }).filter(Boolean);
    const first = data[0]?.weight, last = data[data.length-1]?.weight;
    const delta = (first!==undefined && last!==undefined) ? Math.round((last-first)*100)/100 : null;
    const div = document.createElement('div');
    div.className = 'chartwrap';
    div.innerHTML = `
      <div class="liftheader">
        <div><div class="liftname">${escapeHtml(name)}</div></div>
        <div><div class="liftvalue" style="color:${color};">${last!==undefined?last+'kg':'—'}</div>
        ${delta!==null?`<div class="liftdelta" style="color:${delta>0?'var(--sage)':delta<0?'var(--rust)':'var(--text-faint)'};">${delta>0?'+':''}${delta}kg since ${formatAU(data[0].date)}</div>`:''}</div>
      </div>
      <div class="chart-slot"></div>
    `;
    body.appendChild(div);
    renderLineChart(div.querySelector('.chart-slot'), data, color, color, true);
  });
}

// ---------- SVG line chart ----------
function renderLineChart(container, data, colorVar, colorHex, small){
  if(!data || data.length < 2){
    container.innerHTML = `<div class="chartempty">${!data||data.length===0?'No sets logged for this lift yet':'Log one more session to see a trend'}</div>`;
    return;
  }
  const w = 600, h = small ? 140 : 220, padL = 36, padR = 10, padT = 14, padB = 22;
  const weights = data.map(d=>d.weight);
  const minW = Math.min(...weights), maxW = Math.max(...weights);
  const range = (maxW - minW) || 1;
  const yFor = v => padT + (1 - (v - minW + range*0.1) / (range*1.2)) * (h - padT - padB);
  const xFor = i => padL + (i/(data.length-1)) * (w - padL - padR);
  let path = data.map((d,i)=>`${i===0?'M':'L'} ${xFor(i).toFixed(1)} ${yFor(d.weight).toFixed(1)}`).join(' ');
  let dots = data.map((d,i)=>`<circle cx="${xFor(i).toFixed(1)}" cy="${yFor(d.weight).toFixed(1)}" r="3" fill="${colorHex}"/>`).join('');
  let gridlines = '';
  for(let i=0;i<=2;i++){
    const y = padT + i*(h-padT-padB)/2;
    gridlines += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w-padR}" y2="${y.toFixed(1)}" stroke="#333438" stroke-width="1" stroke-dasharray="3,3"/>`;
  }
  const firstLabel = formatAU(data[0].date).slice(0,5);
  const lastLabel = formatAU(data[data.length-1].date).slice(0,5);
  container.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    ${gridlines}
    <text x="${padL}" y="${padT-2}" fill="#67655F" font-size="9" font-family="IBM Plex Mono, monospace">${maxW}kg</text>
    <text x="${padL}" y="${h-padB+12}" fill="#67655F" font-size="9" font-family="IBM Plex Mono, monospace">${minW}kg</text>
    <path d="${path}" fill="none" stroke="${colorHex}" stroke-width="2"/>
    ${dots}
    <text x="${padL}" y="${h-4}" fill="#67655F" font-size="9" font-family="IBM Plex Mono, monospace">${firstLabel}</text>
    <text x="${w-padR}" y="${h-4}" fill="#67655F" font-size="9" font-family="IBM Plex Mono, monospace" text-anchor="end">${lastLabel}</text>
  </svg>`;
}

const EXERCISE_LIBRARY = {
  Chest: ['Barbell bench press','Incline barbell press','DB bench press','Incline DB press','DB chest fly','Cable chest fly','Push-ups','Dips'],
  Back: ['Deadlift','Pull-ups','Chin-ups','Lat pulldown','Barbell row','T-bar row','Single-arm DB row','Chest-supported row','Seated cable row','Face pulls'],
  Shoulders: ['Overhead press','DB shoulder press','Arnold press','Lateral raises','Front raises','Rear delt fly','Upright row'],
  Legs: ['Back squat','Front squat','Leg press','Romanian deadlift (RDL)','Bulgarian split squat','Walking lunges','Leg extension','Hamstring curl','Calf raises'],
  Glutes: ['Barbell hip thrust','Glute drive','Cable kickback','Glute bridge','Step-ups','Cable step-ups'],
  Arms: ['Barbell curl','DB curl','Hammer curl','Incline curl','Skull crushers','Overhead triceps extension','Rope pushdown','Close-grip bench press'],
  Core: ['Plank','Hanging leg raise','Cable crunch','Ab wheel rollout','Russian twist','Side plank'],
};

function renderExerciseLibrary(main, dayKey){
  const cats = Object.keys(EXERCISE_LIBRARY);
  let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
    <div class="section-label" style="margin:0;">Exercise library</div>
    <button id="closeLibraryBtn" style="background:none;border:none;color:var(--text-faint);font-family:var(--font-mono);font-size:11px;">Close</button>
  </div>
  <input type="text" id="libSearchInput" autocomplete="off" placeholder="Search exercises…" style="width:100%;background:var(--surface-2);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:10px;font-size:14px;margin-bottom:14px;">
  <div id="libResults"></div>`;
  main.innerHTML = html;
  function renderResults(filter){
    const q = (filter||'').trim().toLowerCase();
    const resultsEl = document.getElementById('libResults');
    let rhtml = '';
    cats.forEach(cat=>{
      const items = EXERCISE_LIBRARY[cat].filter(name=>!q || name.toLowerCase().includes(q));
      if(items.length === 0) return;
      rhtml += `<div style="font-family:var(--font-mono);font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-faint);margin-top:10px;margin-bottom:6px;">${cat.toUpperCase()}</div><div style="display:flex;flex-wrap:wrap;gap:6px;">`;
      items.forEach(name=>{
        rhtml += `<button class="libExerciseBtn" data-name="${escapeAttr(name)}" style="background:var(--surface-2);border:1px solid var(--border);color:var(--text-dim);font-size:12px;padding:6px 12px;border-radius:20px;">${escapeHtml(name)}</button>`;
      });
      rhtml += `</div>`;
    });
    if(!rhtml) rhtml = `<div class="emptystate">No matches — try a different search, or add it as a custom exercise.</div>`;
    resultsEl.innerHTML = rhtml;
    resultsEl.querySelectorAll('.libExerciseBtn').forEach(b=>{
      b.onclick = ()=>{
        PLAN[dayKey].exercises.push({ name: b.dataset.name, target:'', hero:false });
        savePlan();
        renderProgramEditor(main);
      };
    });
  }
  renderResults('');
  document.getElementById('closeLibraryBtn').onclick = ()=>renderProgramEditor(main);
  document.getElementById('libSearchInput').oninput = e=>renderResults(e.target.value);
}

// ---------- PROGRAM VIEW ----------
function renderProgram(main){
  let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
    <div class="section-label" style="margin:0;">Weekly split</div>
    <button id="editProgramBtn" class="pill active" style="padding:6px 14px;">Edit program</button>
  </div>`;
  DAY_ORDER.forEach(k=>{
    const d = PLAN[k];
    const sub = d.type==='lift' ? (d.exercises||[]).map(e=>e.name).filter(Boolean).join(', ') || 'No exercises added yet' : (d.desc||'');
    html += `<div class="progrow" style="margin-bottom:6px;align-items:flex-start;">
      <div><div class="wk">${k.toUpperCase()}</div><div class="ph">${escapeHtml(d.label)}</div>
      <div style="font-size:11px;color:var(--text-faint);margin-top:2px;max-width:220px;">${escapeHtml(sub)}</div>
      </div>
      <span class="pill" style="background:none;flex-shrink:0;">${d.type.toUpperCase()}</span>
    </div>`;
  });
  main.innerHTML = html;
  document.getElementById('editProgramBtn').onclick = ()=>{ editingProgram = true; renderProgramEditor(main); };
}

function renderProgramEditor(main){
  let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
    <div class="section-label" style="margin:0;">Edit program</div>
    <button id="doneEditingBtn" class="pill active" style="padding:6px 14px;">Done</button>
  </div>`;
  DAY_ORDER.forEach(k=>{
    const d = PLAN[k];
    html += `<div class="card">
      <div class="section-label">${k.toUpperCase()}</div>
      <div class="row2" style="margin-bottom:10px;">
        <div class="field"><label>Type</label>
          <select class="dayTypeSelect" data-day="${k}">
            <option value="rest" ${d.type==='rest'?'selected':''}>Rest</option>
            <option value="cardio" ${d.type==='cardio'?'selected':''}>Cardio</option>
            <option value="lift" ${d.type==='lift'?'selected':''}>Lift</option>
          </select>
        </div>
        <div class="field"><label>Label</label><input type="text" class="dayLabelInput" autocomplete="off" data-day="${k}" value="${escapeAttr(d.label)}"></div>
      </div>`;
    if(d.type !== 'lift'){
      html += `<div class="field"><label>Description</label><input type="text" class="dayDescInput" autocomplete="off" data-day="${k}" value="${escapeAttr(d.desc||'')}" placeholder="e.g. easy 5k, rest, mobility"></div>`;
    } else {
      html += `<div class="section-label" style="margin-top:10px;">Exercises</div>`;
      (d.exercises||[]).forEach((ex,i)=>{
        html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
          <input class="exNameEdit" autocomplete="off" data-day="${k}" data-exidx="${i}" value="${escapeAttr(ex.name)}" placeholder="Exercise name" style="flex:1;min-width:0;background:var(--surface-2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:7px 8px;font-size:13px;">
          <input class="exTargetEdit" autocomplete="off" data-day="${k}" data-exidx="${i}" value="${escapeAttr(ex.target||'')}" placeholder="3x8-10" style="width:66px;background:var(--surface-2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:7px 6px;font-size:12px;font-family:var(--font-mono);">
          <button class="heroToggleBtn" data-day="${k}" data-exidx="${i}" style="background:none;border:1px solid ${ex.hero?'var(--rust)':'var(--border)'};color:${ex.hero?'var(--rust)':'var(--text-faint)'};border-radius:6px;padding:6px 7px;font-size:10px;font-family:var(--font-mono);flex-shrink:0;">HERO</button>
          <button class="removeExEdit" data-day="${k}" data-exidx="${i}" style="background:none;border:none;color:var(--text-faint);font-size:15px;flex-shrink:0;">&times;</button>
        </div>`;
      });
      html += `<div style="display:flex;gap:14px;margin-top:2px;">
        <button class="addExEdit" data-day="${k}" style="background:none;border:none;color:var(--steel);font-family:var(--font-mono);font-size:11px;">+ Add custom</button>
        <button class="browseLibBtn" data-day="${k}" style="background:none;border:none;color:var(--brass);font-family:var(--font-mono);font-size:11px;">+ Browse library</button>
      </div>`;
    }
    html += `</div>`;
  });
  main.innerHTML = html;
  wireProgramEditor(main);
}

function wireProgramEditor(main){
  document.getElementById('doneEditingBtn').onclick = ()=>{ editingProgram=false; savePlan(); renderProgram(main); showToast('Program saved'); };
  main.querySelectorAll('.dayTypeSelect').forEach(sel=>{
    sel.onchange = e=>{
      const day = sel.dataset.day;
      PLAN[day].type = e.target.value;
      if(e.target.value==='lift' && !PLAN[day].exercises) PLAN[day].exercises = [];
      renderProgramEditor(main);
    };
  });
  main.querySelectorAll('.dayLabelInput').forEach(inp=>{ inp.oninput = e=>{ PLAN[inp.dataset.day].label = e.target.value; }; });
  main.querySelectorAll('.dayDescInput').forEach(inp=>{ inp.oninput = e=>{ PLAN[inp.dataset.day].desc = e.target.value; }; });
  main.querySelectorAll('.exNameEdit').forEach(inp=>{ inp.oninput = e=>{ PLAN[inp.dataset.day].exercises[inp.dataset.exidx].name = e.target.value; }; });
  main.querySelectorAll('.exTargetEdit').forEach(inp=>{ inp.oninput = e=>{ PLAN[inp.dataset.day].exercises[inp.dataset.exidx].target = e.target.value; }; });
  main.querySelectorAll('.heroToggleBtn').forEach(btn=>{
    btn.onclick = ()=>{
      const day = btn.dataset.day, idx = btn.dataset.exidx;
      PLAN[day].exercises[idx].hero = !PLAN[day].exercises[idx].hero;
      renderProgramEditor(main);
    };
  });
  main.querySelectorAll('.removeExEdit').forEach(btn=>{
    btn.onclick = ()=>{
      const day = btn.dataset.day, idx = parseInt(btn.dataset.exidx);
      PLAN[day].exercises.splice(idx,1);
      renderProgramEditor(main);
    };
  });
  main.querySelectorAll('.addExEdit').forEach(btn=>{
    btn.onclick = ()=>{
      const day = btn.dataset.day;
      if(!PLAN[day].exercises) PLAN[day].exercises=[];
      PLAN[day].exercises.push({name:'', target:'', hero:false});
      renderProgramEditor(main);
    };
  });
  main.querySelectorAll('.browseLibBtn').forEach(btn=>{
    btn.onclick = ()=>{
      const day = btn.dataset.day;
      if(!PLAN[day].exercises) PLAN[day].exercises=[];
      renderExerciseLibrary(main, day);
    };
  });
}

// ---------- utils ----------
function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttr(s){ return escapeHtml(s); }

// ---------- init ----------
document.getElementById('settingsBtn').onclick = ()=>{
  document.getElementById('startDateInput').value = settings.startDate;
  document.getElementById('settingsOverlay').classList.add('show');
};
document.getElementById('cancelSettings').onclick = ()=>document.getElementById('settingsOverlay').classList.remove('show');
document.getElementById('saveSettings').onclick = ()=>{
  const v = document.getElementById('startDateInput').value;
  if(v){ settings.startDate = v; saveSettings(); renderAll(); showToast('Start date updated'); }
  document.getElementById('settingsOverlay').classList.remove('show');
};
document.getElementById('confirmReset').onclick = ()=>{
  localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(IMPORT_FLAG);
  document.getElementById('settingsOverlay').classList.remove('show');
  loadData(); renderAll();
};

// persistent save bar (Log view only)
function ensureSaveBar(){
  let bar = document.getElementById('saveBar');
  if(!bar){
    bar = document.createElement('div');
    bar.id = 'saveBar'; bar.className = 'savebar';
    bar.innerHTML = `<button class="savebtn" id="saveBtn">Save session</button>`;
    document.body.appendChild(bar);
    document.getElementById('saveBtn').onclick = handleSave;
  }
  bar.style.display = view === 'log' ? 'block' : 'none';
}

const _origRenderAll = renderAll;
renderAll = function(){ _origRenderAll(); ensureSaveBar(); };

loadSettings();
loadPlan();
loadData();
renderAll();
