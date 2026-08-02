const TIMEZONE = 'Australia/Melbourne';
const STORAGE_KEY = 'core-performance-sessions';
const IMPORT_FLAG = 'core-performance-imported-v1';
const SETTINGS_KEY = 'core-performance-settings';
const PLAN_KEY = 'core-performance-plan';
const DEFAULT_START_DATE = '2026-03-18';

let sessions = [];
let settings = { startDate: DEFAULT_START_DATE, completeAcknowledged: false };
let PLAN = {};
let editingProgram = false;
let view = 'log';
let expandedHistory = {};
let editingId = null;
let progressExercise = null;
let progressGroupKey = null;

const CANON_STOP_WORDS = new Set(['bb','barbell','banded','band','weighted','the','a','an','with','using','plate','loaded','machine','conventional']);
function canonicalKey(name){
  const words = (name||'').toLowerCase()
    .replace(/[^a-z0-9\s]/g,' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(w=>!CANON_STOP_WORDS.has(w))
    .map(w=>(w.length>3 && w.endsWith('s')) ? w.slice(0,-1) : w);
  return [...new Set(words)].sort().join(' ');
}
function groupedExerciseOptions(){
  const groupNameCounts = {};
  function addName(name){
    const key = canonicalKey(name);
    if(!key) return;
    groupNameCounts[key] = groupNameCounts[key] || {};
    groupNameCounts[key][name] = (groupNameCounts[key][name]||0) + 1;
  }
  Object.values(PLAN).forEach(d=>{ (d.exercises||[]).forEach(e=>addName(e.name)); });
  sessions.forEach(s=>(s.exercises||[]).forEach(e=>addName(e.name)));
  const options = Object.keys(groupNameCounts).map(key=>{
    const counts = groupNameCounts[key];
    const bestName = Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
    const total = Object.values(counts).reduce((a,c)=>a+c,0);
    return { key, label: bestName, count: total };
  });
  options.sort((a,b)=>a.label.localeCompare(b.label));
  return options;
}

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
  const capped = Math.min(week, 12);
  let phase, deload = false;
  if(capped <= 3) phase = 'Build';
  else if(capped === 4){ phase = 'Deload'; deload = true; }
  else if(capped <= 7) phase = 'Build';
  else if(capped === 8){ phase = 'Deload'; deload = true; }
  else if(capped <= 11) phase = 'Peak';
  else phase = 'Consolidate';
  if(week > 12) phase = 'Complete';
  return { week, phase, deload };
}
function renderHeader(){
  const { week, phase } = getWeekAndPhase();
  const phaseline = document.getElementById('phaseline');
  const isComplete = phase === 'Complete';
  phaseline.innerHTML = `
    <div><div class="eyebrow">Week</div><div class="week">${isComplete ? `${week} · Done` : `${Math.min(week,12)} / 12`}</div></div>
    ${isComplete
      ? `<button id="phaseBadgeBtn" class="phase complete" style="border:none;cursor:pointer;">${phase} &#9998;</button>`
      : `<div class="phase ${phase.toLowerCase()}">${phase}</div>`}
  `;
  const plates = document.getElementById('plates');
  plates.innerHTML = '';
  const deloadWeeks = [4,8];
  for(let i=1;i<=12;i++){
    let cls = 'plate';
    if(i <= week) cls += ' done';
    if(deloadWeeks.includes(i)) cls += ' deload-mark';
    if(i === Math.min(week,12) && phase !== 'Complete') cls += ' current';
    plates.innerHTML += `<div class="${cls}"></div>`;
  }
  const badgeBtn = document.getElementById('phaseBadgeBtn');
  if(badgeBtn) badgeBtn.onclick = ()=>openCompleteOverlay(week);

  if(isComplete && !settings.completeAcknowledged){
    openCompleteOverlay(week);
  }
}

function openCompleteOverlay(week){
  document.getElementById('completeOverlaySubtext').textContent =
    `You're on week ${week} — past the end of your 12-week block. Worth reviewing your program before starting the next one.`;
  const suggestedDate = (settings.startDate === DEFAULT_START_DATE) ? '2026-07-18' : todayISO();
  document.getElementById('newBlockDateInput').value = suggestedDate;
  document.getElementById('completeOverlay').classList.add('show');
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
  const existingDates = new Set(sessions.map(s=>s.date));
  const toAdd = (window.HISTORICAL_SESSIONS||[]).filter(s=>!existingDates.has(s.date));
  if(toAdd.length > 0){
    sessions = [...sessions, ...toAdd];
    saveData();
    showToast(`Restored ${toAdd.length} past session${toAdd.length!==1?'s':''}`);
  }
  try{ localStorage.setItem(IMPORT_FLAG, 'true'); }catch(e){}
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
let dismissedLoggedNotice = {};

const DRAFT_KEY = 'core-performance-draft';
function saveDraft(){
  try{ localStorage.setItem(DRAFT_KEY, JSON.stringify({ logState, editingId })); }catch(e){}
}
function loadDraft(){
  try{
    const raw = localStorage.getItem(DRAFT_KEY);
    if(!raw) return;
    const parsed = JSON.parse(raw);
    if(parsed && parsed.logState && parsed.logState.date){
      logState = parsed.logState;
      editingId = parsed.editingId || null;
    }
  }catch(e){}
}
function clearDraft(){
  try{ localStorage.removeItem(DRAFT_KEY); }catch(e){}
}
setInterval(()=>{ if(view === 'log') saveDraft(); }, 3000);
window.addEventListener('pagehide', ()=>{ if(view === 'log') saveDraft(); });
window.addEventListener('visibilitychange', ()=>{ if(document.visibilityState === 'hidden' && view === 'log') saveDraft(); });

function renderNav(){
  const tabs = [
    {id:'log', label:'Log', ic:'&#9998;'},
    {id:'schedule', label:'Schedule', ic:'&#128197;'},
    {id:'history', label:'History', ic:'&#128337;'},
    {id:'progress', label:'Progress', ic:'&#128200;'},
    {id:'biglifts', label:'Big lifts', ic:'&#127942;'},
    {id:'library', label:'Library', ic:'&#128218;'},
    {id:'cycle', label:'Cycle', ic:'&#128167;'},
    {id:'correlate', label:'Correlate', ic:'&#128260;'},
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
  else if(view === 'library') renderLibraryTab(main);
  else if(view === 'cycle') renderCycle(main);
  else if(view === 'correlate') renderCorrelate(main);
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
function getPhaseForDate(dateISO){
  const start = new Date(settings.startDate + 'T00:00:00');
  const now = new Date(dateISO + 'T00:00:00');
  const diffDays = Math.floor((now - start) / 86400000);
  let week = Math.floor(diffDays / 7) + 1;
  if(week < 1) week = 1;
  const capped = Math.min(week, 12);
  let phase, deload = false;
  if(capped <= 3) phase = 'Build';
  else if(capped === 4){ phase = 'Deload'; deload = true; }
  else if(capped <= 7) phase = 'Build';
  else if(capped === 8){ phase = 'Deload'; deload = true; }
  else if(capped <= 11) phase = 'Peak';
  else phase = 'Consolidate';
  if(week > 12) phase = 'Complete';
  return { week, phase, deload };
}
function renderSchedule(main){
  const today = todayISO();
  let html = `<div class="section-label">Next 14 days</div>`;
  for(let i=0; i<14; i++){
    const iso = addDaysISO(today, i);
    const dayName = weekdayForISO(iso);
    const day = PLAN[dayName];
    const { phase, deload } = getPhaseForDate(iso);
    const isToday = i === 0;
    const typeColor = day.type === 'lift' ? 'var(--brass)' : day.type === 'cardio' ? 'var(--steel)' : 'var(--text-faint)';
    let exList = '';
    if(day.type === 'lift'){
      exList = day.exercises.map(e=>`${e.name}${e.hero?' <span style="color:var(--rust);">·</span>':''}`).join(', ');
    } else {
      exList = day.desc;
    }
    html += `<div class="card" data-schedule-date="${iso}" data-schedule-day="${dayName}" style="${isToday?'border-color:var(--brass);':''}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
        <div>
          <div class="eyebrow" style="color:${isToday?'var(--brass)':'var(--text-faint)'};">${isToday?'TODAY · ':''}${dayName.toUpperCase()} · ${formatAU(iso)}</div>
          <div style="font-family:var(--font-display);font-weight:600;font-size:15px;color:${typeColor};">${day.label}</div>
        </div>
        ${deload ? '<span class="pill" style="background:var(--sage-dim);border-color:var(--sage-dim);color:var(--sage);">DELOAD</span>' : ''}
      </div>
      <div style="font-size:12px;color:var(--text-dim);line-height:1.5;margin-bottom:8px;">${exList}</div>
      <button class="scheduleLogBtn" data-date="${iso}" data-day="${dayName}" style="background:none;border:none;color:var(--brass);font-family:var(--font-mono);font-size:11px;letter-spacing:0.04em;padding:0;">LOG THIS SESSION →</button>
    </div>`;
  }
  main.innerHTML = html;
  main.querySelectorAll('.scheduleLogBtn').forEach(btn=>{
    btn.onclick = ()=>{
      const existing = sessions.find(s=>s.date===btn.dataset.date);
      if(existing){
        loadSessionForEditing(existing, btn.dataset.day);
      } else {
        editingId = null;
        logState.date = btn.dataset.date;
        resetLogForDay(btn.dataset.day);
      }
      view = 'log';
      renderAll();
    };
  });
}

// ---------- inject extra styles for Cycle/Correlate views ----------
(function injectCycleStyles(){
  const style = document.createElement('style');
  style.textContent = `
    .chiprow2{display:flex;flex-wrap:wrap;gap:6px;}
    .chip2{font-family:var(--font-body);font-size:12px;padding:6px 12px;border-radius:20px;
      background:var(--surface-2);color:var(--text-dim);border:1px solid var(--border);}
    .chip2.active{color:#1B1600;}
    .nrsgrid{display:flex;flex-wrap:wrap;gap:5px;}
    .nrsbtn{width:26px;height:26px;border-radius:6px;font-family:var(--font-mono);font-size:11px;
      background:var(--surface-2);color:var(--text-dim);border:1px solid var(--border);}
    .domainblock{margin-bottom:16px;}
    .domainlabel{font-family:var(--font-mono);font-size:11px;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:8px;}
    .checkline{display:flex;align-items:center;gap:8px;font-size:13px;background:none;border:none;padding:0;}
    .checkbox{width:16px;height:16px;border-radius:4px;border:1px solid var(--border);display:inline-flex;
      align-items:center;justify-content:center;flex-shrink:0;font-size:10px;}
    .promrow{display:flex;align-items:center;gap:10px;margin-bottom:6px;}
    .promrow span.nm{font-family:var(--font-mono);font-size:12px;width:90px;}
    .promrow input{width:64px;background:var(--surface-2);border:1px solid var(--border);color:var(--text);
      border-radius:6px;padding:6px 8px;font-family:var(--font-mono);font-size:12px;}
    .correlate-stat{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px;flex:1;}
    .correlate-stat .l{font-family:var(--font-mono);font-size:9px;color:var(--text-faint);text-transform:uppercase;}
    .correlate-stat .v{font-family:var(--font-mono);font-size:18px;font-weight:600;margin-top:2px;}
  `;
  document.head.appendChild(style);
})();

// ---------- Cycle tracking data ----------
const CYCLE_STORAGE_KEY = 'core-performance-cycle';
const FLOW_LEVELS = ['None','Spotting','Light','Medium','Heavy'];
const MENSTRUAL_SYMPTOMS = ['Dysmenorrhoea','Menorrhagia','Bloating','Fatigue','Headache/migraine','Breast tenderness','Mood lability','Nausea','Lumbopelvic pain','Sleep disruption','Cravings','Joint laxity (subjective)'];
const URINARY_SYMPTOMS = ['SUI','UUI','MUI','Urgency','Frequency (>8/day)','Nocturia','Hesitancy','Slow/intermittent stream','Incomplete emptying','Post-void dribble','Dysuria'];
const PROLAPSE_SYMPTOMS = ['Vaginal heaviness/dragging','Visible/palpable bulge','Anterior compartment','Apical/uterine','Posterior compartment','Worse end of day','Worse with load','Splinting required'];
const BOWEL_SYMPTOMS = ['Obstructed defecation','Straining','Digital splinting','Faecal urgency','Flatal incontinence','Faecal incontinence','Incomplete evacuation'];
const SEXUAL_SYMPTOMS = ['Superficial dyspareunia','Deep dyspareunia','Reduced sensation','Coital incontinence'];
const ABDOMINAL_WALL_SYMPTOMS = ['Coning/doming','IRD widening (subjective)','Loss of linea alba tension','LSCS scar pain','LSCS scar tethering','Scar numbness/hypersensitivity'];
const MSK_SYMPTOMS = ['Pelvic girdle pain','SIJ pain','Pubic symphysis pain','Lumbar pain','Levator tenderness','Levator overactivity','Hamstring origin pain'];
const SYMPTOM_DOMAINS = [
  { key:'urinary', label:'URINARY', items:URINARY_SYMPTOMS, color:'#5B8AA6' },
  { key:'prolapse', label:'PROLAPSE / POP', items:PROLAPSE_SYMPTOMS, color:'#9B7EDE' },
  { key:'bowel', label:'BOWEL / ANORECTAL', items:BOWEL_SYMPTOMS, color:'#6E9B6E' },
  { key:'sexual', label:'SEXUAL FUNCTION', items:SEXUAL_SYMPTOMS, color:'#C97F9A' },
  { key:'abdominal', label:'ABDOMINAL WALL / DRA / SCAR', items:ABDOMINAL_WALL_SYMPTOMS, color:'#C99A3D' },
  { key:'msk', label:'LUMBOPELVIC MSK', items:MSK_SYMPTOMS, color:'#B4574B' },
];
const CYCLE_PHASES = ['Auto','Menstrual','Follicular','Ovulatory','Early luteal','Late luteal'];
const ONSET_TIMING = ['Nil','During session','Immediate post (<1h)','Same day (1–12h)','24h post','48h post'];
const SETTLING = ['Settled within session','Settled <24h','Settled 24–48h','Ongoing >48h'];
const LOAD_TOLERANCE = ['Better than usual','As expected','Worse than usual'];
const BREATH_STRATEGIES = ['Exhale on exertion','Breath-hold / Valsalva','Continuous breathing','360 brace','Belt used','Band used'];
const PROM_INSTRUMENTS = [
  { name:'ICIQ-UI SF', max:21 }, { name:'PFDI-20', max:300 }, { name:'POPDI-6', max:100 },
  { name:'CRADI-8', max:100 }, { name:'UDI-6', max:100 }, { name:'PFIQ-7', max:300 }, { name:'APFQ', max:40 },
];

let cycleEntries = [];
let cycleState = {
  date: todayISO(), flow:'None', periodStart:false, phaseOverride:'Auto',
  bladderNotes:'', bowelNotes:'', cycleNotes:'', sexualNotes:'',
  provocation:'', breath:[], settling:'', tolerance:'',
  followUp24h:false, proms:{}, note:'',
};
let expandedCycle = {};
let showProms = false;
let correlateCategory = 'all';

function loadCycleData(){
  try{
    const raw = localStorage.getItem(CYCLE_STORAGE_KEY);
    if(raw) cycleEntries = JSON.parse(raw);
  }catch(e){ cycleEntries = []; }
}
function saveCycleData(){
  try{ localStorage.setItem(CYCLE_STORAGE_KEY, JSON.stringify(cycleEntries)); }catch(e){ showToast("Couldn't save entry"); }
}
function loadCycleStateForDate(dateStr){
  const found = cycleEntries.find(e=>e.date===dateStr);
  if(found){
    cycleState = {
      date: dateStr, flow: found.flow||'None', periodStart: !!found.periodStart,
      phaseOverride: found.phaseOverride||'Auto',
      bladderNotes: found.bladderNotes||'', bowelNotes: found.bowelNotes||'',
      cycleNotes: found.cycleNotes||'', sexualNotes: found.sexualNotes||'',
      settling: found.settling||'', tolerance: found.tolerance||'', followUp24h: !!found.followUp24h,
      provocation: found.provocation||'', breath: [...(found.breath||[])], proms: {...(found.proms||{})}, note: found.note||'',
    };
  } else {
    cycleState = { date: dateStr, flow:'None', periodStart:false, phaseOverride:'Auto', bladderNotes:'', bowelNotes:'', cycleNotes:'', sexualNotes:'', settling:'', tolerance:'', followUp24h:false, provocation:'', breath:[], proms:{}, note:'' };
  }
}
function derivePhase(cycleDay){
  if(cycleDay===null) return null;
  if(cycleDay<=5) return 'Menstrual';
  if(cycleDay<=12) return 'Follicular';
  if(cycleDay<=15) return 'Ovulatory';
  if(cycleDay<=22) return 'Early luteal';
  return 'Late luteal';
}
function getCycleDayFor(dateStr, entriesOverride){
  const entries = entriesOverride || cycleEntries;
  const starts = entries.filter(e=>e.periodStart && e.date<=dateStr).map(e=>e.date).sort();
  if(!starts.length) return null;
  const last = starts[starts.length-1];
  const ms = new Date(dateStr+'T00:00:00') - new Date(last+'T00:00:00');
  return Math.round(ms/86400000) + 1;
}

function chipHtml(cls, label, active, color, extra){
  const bg = active ? (color||'var(--brass)') : 'var(--surface-2)';
  const bd = active ? (color||'var(--brass)') : 'var(--border)';
  return `<button class="${cls}" style="background:${bg};border-color:${bd};" ${extra||''}>${escapeHtml(label)}</button>`;
}

function renderCycle(main){
  const liveEntries = cycleState.periodStart
    ? [...cycleEntries.filter(e=>e.date!==cycleState.date), {date:cycleState.date, periodStart:true}]
    : cycleEntries.map(e=> e.date===cycleState.date ? {...e, periodStart:false} : e);
  const cycleDay = getCycleDayFor(cycleState.date, liveEntries);
  const autoPhase = derivePhase(cycleDay);
  const effectivePhase = cycleState.phaseOverride === 'Auto' ? autoPhase : cycleState.phaseOverride;
  const sameDaySession = sessions.find(s=>s.date===cycleState.date) || null;

  let html = `<div class="field" style="margin-bottom:8px;"><label>Date</label><input type="date" id="cycleDateInput" value="${cycleState.date}"></div>
  <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;font-family:var(--font-mono);font-size:11px;">
    ${cycleDay!==null?`<span style="color:var(--brass);">CYCLE DAY ${cycleDay}</span>`:''}
    ${effectivePhase?`<span style="color:var(--steel);">· ${effectivePhase.toUpperCase()}</span>`:''}
    ${sameDaySession?`<span style="color:var(--text-faint);">· TRAINING: ${escapeHtml(sameDaySession.dayLabel).toUpperCase()}</span>`:''}
  </div>

  <div class="card">
    <div class="section-label">Quick log</div>
    <button id="nilSymptomsBtn" style="width:100%;padding:11px;border-radius:9px;border:1px solid var(--sage);background:none;color:var(--sage);font-size:13px;">&#10003; Nil symptoms today</button>
    <div style="font-size:11px;color:var(--text-faint);margin-top:8px;line-height:1.4;">Logs an asymptomatic day in one tap. Worth doing on good days — without them there's no denominator, and every session looks provocative.</div>
  </div>

  <div class="section-label">Flow</div>
  <div class="chiprow2" id="flowChips" style="margin-bottom:10px;">
    ${FLOW_LEVELS.map(f=>chipHtml('chip2 flowchip', f, cycleState.flow===f, 'var(--rust)', `data-val="${f}"`)).join('')}
  </div>
  <button id="periodStartBtn" class="checkline" style="margin-bottom:14px;color:${cycleState.periodStart?'var(--brass)':'var(--text-dim)'};">
    <span class="checkbox" style="background:${cycleState.periodStart?'var(--brass)':'none'};">${cycleState.periodStart?'&#10003;':''}</span> Day 1 of cycle
  </button>
  <div class="domainlabel" style="color:var(--text-faint);">PHASE ${autoPhase?`(auto: ${autoPhase})`:'(log a day 1 to auto-derive)'}</div>
  <div class="chiprow2" id="phaseChips" style="margin-bottom:16px;">
    ${CYCLE_PHASES.map(p=>chipHtml('chip2 phasechip', p, cycleState.phaseOverride===p, 'var(--steel)', `data-val="${p}"`)).join('')}
  </div>

  <div class="field" style="margin-bottom:14px;"><label>Bladder symptoms</label><textarea id="bladderNotesInput" rows="2" autocomplete="off" placeholder="Any bladder symptoms today…">${escapeHtml(cycleState.bladderNotes)}</textarea></div>
  <div class="field" style="margin-bottom:14px;"><label>Bowel symptoms</label><textarea id="bowelNotesInput" rows="2" autocomplete="off" placeholder="Any bowel symptoms today…">${escapeHtml(cycleState.bowelNotes)}</textarea></div>
  <div class="field" style="margin-bottom:14px;"><label>Cycle symptoms</label><textarea id="cycleNotesInput" rows="2" autocomplete="off" placeholder="Any cycle-related symptoms today…">${escapeHtml(cycleState.cycleNotes)}</textarea></div>
  <div class="field" style="margin-bottom:14px;"><label>Sexual symptoms</label><textarea id="sexualNotesInput" rows="2" autocomplete="off" placeholder="Any sexual function symptoms today…">${escapeHtml(cycleState.sexualNotes)}</textarea></div>
  <div class="field" style="margin-bottom:10px;"><label>Provocation / load context</label><input type="text" id="provocationInput" autocomplete="off" value="${escapeAttr(cycleState.provocation)}" placeholder="e.g. coning at 170kg banded hip thrust, set 3"></div>`;

  if(sameDaySession){
    html += `<div class="card" style="margin-bottom:14px;"><div class="domainlabel" style="color:var(--text-faint);">LOGGED THIS DAY</div>`;
    (sameDaySession.exercises||[]).forEach(ex=>{
      html += `<div style="font-size:12px;margin-bottom:2px;">${escapeHtml(ex.name)} <span style="color:var(--text-faint);font-family:var(--font-mono);font-size:11px;">${(ex.sets||[]).map(st=>`${fmtWeight(st.weight)}×${st.reps||'–'}`).join(', ')}</span></div>`;
    });
    html += `</div>`;
  }

  html += `<div class="field" style="margin:16px 0;"><label>Clinical notes</label><textarea id="cycleNoteInput" rows="3" placeholder="Objective findings, response to modification, plan…">${escapeHtml(cycleState.note)}</textarea></div>
  <button id="saveCycleBtn" class="savebtn" style="position:static;width:100%;margin-bottom:24px;">Save entry</button>
  <div class="section-label">Logged entries</div>`;

  const sorted = [...cycleEntries].sort((a,b)=>b.date.localeCompare(a.date));
  if(sorted.length===0){
    html += `<div class="emptystate" style="padding:16px 0;">Nothing logged yet.</div>`;
  } else {
    sorted.forEach(e=>{
      const open = !!expandedCycle[e.id];
      const filledCategories = ['bladderNotes','bowelNotes','cycleNotes','sexualNotes'].filter(k=>e[k] && e[k].trim()).length;
      html += `<div class="card">
        <button class="histhead cycleEntryHead" data-id="${e.id}">
          <div>
            <div class="histdate">${formatAU(e.date)}${e.cycleDay?` · CD${e.cycleDay}`:''}${e.resolvedPhase?` · ${e.resolvedPhase.toUpperCase()}`:''}</div>
            <div class="histlabel" style="color:${e.nilSymptoms?'var(--sage)':'var(--text)'};font-size:14px;">${e.nilSymptoms?'Nil symptoms':`${e.flow&&e.flow!=='None'?'Flow: '+e.flow:'No flow'}${filledCategories?` · ${filledCategories} note${filledCategories>1?'s':''}`:''}`}</div>
          </div>
          <span style="color:var(--text-faint);">${open?'&#9650;':'&#9660;'}</span>
        </button>`;
      if(open){
        html += `<div class="histbody show">`;
        if(e.bladderNotes) html += `<div style="margin-bottom:8px;"><div class="domainlabel" style="font-size:10px;">BLADDER</div><div style="font-size:13px;">${escapeHtml(e.bladderNotes)}</div></div>`;
        if(e.bowelNotes) html += `<div style="margin-bottom:8px;"><div class="domainlabel" style="font-size:10px;">BOWEL</div><div style="font-size:13px;">${escapeHtml(e.bowelNotes)}</div></div>`;
        if(e.cycleNotes) html += `<div style="margin-bottom:8px;"><div class="domainlabel" style="font-size:10px;">CYCLE</div><div style="font-size:13px;">${escapeHtml(e.cycleNotes)}</div></div>`;
        if(e.sexualNotes) html += `<div style="margin-bottom:8px;"><div class="domainlabel" style="font-size:10px;">SEXUAL</div><div style="font-size:13px;">${escapeHtml(e.sexualNotes)}</div></div>`;
        if(e.linkedSessionLabel) html += `<div style="font-family:var(--font-mono);font-size:11px;color:var(--text-faint);margin-bottom:8px;">Training that day: ${escapeHtml(e.linkedSessionLabel)}</div>`;
        if(e.note) html += `<div style="font-size:12px;color:var(--text-dim);margin-bottom:8px;">Notes: ${escapeHtml(e.note)}</div>`;
        html += `<div style="display:flex;gap:16px;margin-top:4px;">
          <button class="editCycleBtn" data-id="${e.id}" data-date="${e.date}" style="background:none;border:none;color:var(--brass);font-family:var(--font-mono);font-size:11px;">EDIT ENTRY</button>
          <button class="deleteCycleBtn" data-id="${e.id}" style="background:none;border:none;color:var(--rust);font-family:var(--font-mono);font-size:11px;">DELETE ENTRY</button>
        </div></div>`;
      }
      html += `</div>`;
    });
  }

  main.innerHTML = html;
  wireCycleView(main);
}

function wireCycleView(main){
  document.getElementById('cycleDateInput').onchange = e=>{ loadCycleStateForDate(e.target.value); renderCycle(main); };
  document.getElementById('nilSymptomsBtn').onclick = ()=>{
    const sameDaySession = sessions.find(s=>s.date===cycleState.date) || null;
    const cycleDay = getCycleDayFor(cycleState.date);
    saveCycleEntry({
      id:`cycle-${cycleState.date}`, date:cycleState.date, flow:cycleState.flow, periodStart:cycleState.periodStart,
      phaseOverride:cycleState.phaseOverride, resolvedPhase: cycleState.phaseOverride==='Auto'?derivePhase(cycleDay):cycleState.phaseOverride,
      cycleDay, bladderNotes:'', bowelNotes:'', cycleNotes:'', sexualNotes:'', settling:'', tolerance:'As expected',
      followUp24h:false, provocation:'', breath: cycleState.breath, proms:{}, note:'', nilSymptoms:true,
      linkedSessionLabel: sameDaySession?sameDaySession.dayLabel:null,
    });
    renderCycle(main);
  };
  main.querySelectorAll('.flowchip').forEach(b=>b.onclick=()=>{ cycleState.flow=b.dataset.val; renderCycle(main); });
  document.getElementById('periodStartBtn').onclick = ()=>{ cycleState.periodStart = !cycleState.periodStart; renderCycle(main); };
  main.querySelectorAll('.phasechip').forEach(b=>b.onclick=()=>{ cycleState.phaseOverride=b.dataset.val; renderCycle(main); });
  const bladderInput = document.getElementById('bladderNotesInput');
  if(bladderInput) bladderInput.oninput = e=>cycleState.bladderNotes = e.target.value;
  const bowelInput = document.getElementById('bowelNotesInput');
  if(bowelInput) bowelInput.oninput = e=>cycleState.bowelNotes = e.target.value;
  const cycleNotesEl = document.getElementById('cycleNotesInput');
  if(cycleNotesEl) cycleNotesEl.oninput = e=>cycleState.cycleNotes = e.target.value;
  const sexualInput = document.getElementById('sexualNotesInput');
  if(sexualInput) sexualInput.oninput = e=>cycleState.sexualNotes = e.target.value;
  const provInput = document.getElementById('provocationInput');
  if(provInput) provInput.oninput = e=>cycleState.provocation = e.target.value;
  document.getElementById('togglePromsBtn').onclick = ()=>{ showProms = !showProms; renderCycle(main); };
  main.querySelectorAll('.promInput').forEach(inp=>{ inp.oninput = e=>{ cycleState.proms[inp.dataset.name] = e.target.value; }; });
  const noteInput = document.getElementById('cycleNoteInput');
  if(noteInput) noteInput.oninput = e=>cycleState.note = e.target.value;
  document.getElementById('saveCycleBtn').onclick = ()=>{
    const sameDaySession = sessions.find(s=>s.date===cycleState.date) || null;
    const cycleDay = getCycleDayFor(cycleState.date);
    const effectivePhase = cycleState.phaseOverride==='Auto' ? derivePhase(cycleDay) : cycleState.phaseOverride;
    saveCycleEntry({
      id:`cycle-${cycleState.date}`, date:cycleState.date, flow:cycleState.flow, periodStart:cycleState.periodStart,
      phaseOverride:cycleState.phaseOverride, resolvedPhase: effectivePhase, cycleDay,
      bladderNotes: cycleState.bladderNotes.trim(), bowelNotes: cycleState.bowelNotes.trim(),
      cycleNotes: cycleState.cycleNotes.trim(), sexualNotes: cycleState.sexualNotes.trim(),
      provocation: cycleState.provocation.trim(), proms: cycleState.proms, note: cycleState.note.trim(),
      linkedSessionLabel: sameDaySession?sameDaySession.dayLabel:null,
    });
    renderCycle(main);
  };
  main.querySelectorAll('.cycleEntryHead').forEach(b=>{
    b.onclick = ()=>{ expandedCycle[b.dataset.id] = !expandedCycle[b.dataset.id]; renderCycle(main); };
  });
  main.querySelectorAll('.editCycleBtn').forEach(b=>{
    b.onclick = ()=>{
      loadCycleStateForDate(b.dataset.date);
      renderCycle(main);
      window.scrollTo({top:0, behavior:'smooth'});
      showToast('Loaded — edit above and Save entry');
    };
  });
  main.querySelectorAll('.deleteCycleBtn').forEach(b=>{
    b.onclick = ()=>{ cycleEntries = cycleEntries.filter(e=>e.id!==b.dataset.id); saveCycleData(); renderCycle(main); };
  });
}
function saveCycleEntry(entry){
  cycleEntries = [...cycleEntries.filter(e=>e.date!==entry.date), entry];
  saveCycleData();
  showToast('Cycle entry saved');
}

// ---------- Correlate view ----------
function heroLoadsForSession(session){
  if(!session) return null;
  const heroes = (session.exercises||[]).filter(ex=>ex.tier==='hero');
  if(!heroes.length) return null;
  return heroes.map(ex=>{
    const nums = (ex.sets||[]).map(s=>parseFloat(s.weight)).filter(n=>!isNaN(n));
    const top = nums.length ? Math.max(...nums) : null;
    return top!==null ? `${ex.name} ${top}kg` : ex.name;
  }).join(' · ');
}
function renderCorrelate(main){
  const CATEGORIES = [
    { key:'bladderNotes', label:'Bladder', color:'var(--steel)' },
    { key:'bowelNotes', label:'Bowel', color:'var(--sage)' },
    { key:'cycleNotes', label:'Cycle', color:'var(--rust)' },
    { key:'sexualNotes', label:'Sexual', color:'#C97F9A' },
  ];
  const rows = [...cycleEntries].sort((a,b)=>b.date.localeCompare(a.date))
    .map(e=>{
      const session = sessions.find(s=>s.date===e.date) || null;
      const notes = CATEGORIES.map(c=>({ cat:c, text: e[c.key] })).filter(n=>n.text && n.text.trim());
      return { entry:e, session, notes };
    })
    .filter(r=>r.notes.length>0 || r.entry.provocation)
    .filter(r=>correlateCategory==='all' || r.notes.some(n=>n.cat.key===correlateCategory));

  const totalLogged = cycleEntries.length;
  const symptomatic = cycleEntries.filter(e=>!e.nilSymptoms && CATEGORIES.some(c=>e[c.key] && e[c.key].trim())).length;
  const pct = totalLogged ? Math.round((symptomatic/totalLogged)*100) : null;

  let html = `<div style="display:flex;gap:10px;margin-bottom:16px;">
    <div class="correlate-stat"><div class="l">Days logged</div><div class="v">${totalLogged}</div></div>
    <div class="correlate-stat"><div class="l">Symptomatic</div><div class="v" style="color:var(--brass);">${symptomatic}${pct!==null?` <span style="font-size:11px;color:var(--text-faint);">· ${pct}%</span>`:''}</div></div>
  </div>
  <div class="section-label">Filter by category</div>
  <div class="chiprow2" id="correlateFilterChips" style="margin-bottom:16px;">
    ${chipHtml('chip2 corrFilterChip', 'All', correlateCategory==='all', 'var(--brass)', 'data-val="all"')}
    ${CATEGORIES.map(c=>chipHtml('chip2 corrFilterChip', c.label, correlateCategory===c.key, c.color, `data-val="${c.key}"`)).join('')}
  </div>`;

  if(rows.length===0){
    html += `<div class="emptystate">No symptom entries to correlate yet. Log symptoms in the Cycle tab and they'll appear here alongside whatever you trained that day.</div>`;
  } else {
    rows.forEach(r=>{
      const loads = heroLoadsForSession(r.session);
      html += `<div class="card">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
          <span style="font-family:var(--font-mono);font-size:11px;color:var(--brass);">${formatAU(r.entry.date)}${r.entry.cycleDay?` · CD${r.entry.cycleDay}`:''}</span>
          ${r.entry.resolvedPhase?`<span style="font-family:var(--font-mono);font-size:10px;color:var(--steel);">${r.entry.resolvedPhase.toUpperCase()}</span>`:''}
        </div>
        ${r.notes.map(n=>`<div style="margin-bottom:6px;"><div class="domainlabel" style="font-size:10px;color:${n.cat.color};">${n.cat.label.toUpperCase()}</div><div style="font-size:13px;">${escapeHtml(n.text)}</div></div>`).join('')}
        ${r.entry.provocation?`<div style="font-size:12px;margin-bottom:6px;">⚑ ${escapeHtml(r.entry.provocation)}</div>`:''}
        <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-top:4px;">
          <div class="domainlabel" style="font-size:10px;margin-bottom:2px;">TRAINING THAT DAY</div>
          ${r.session ? `<div style="font-size:12px;">${escapeHtml(r.session.dayLabel)}</div>${loads?`<div style="font-family:var(--font-mono);font-size:11px;color:var(--brass);margin-top:2px;">${escapeHtml(loads)}</div>`:''}` : `<div style="font-size:12px;color:var(--text-faint);">No session logged</div>`}
        </div>
        ${(r.entry.settling||r.entry.tolerance||r.entry.followUp24h)?`<div style="font-family:var(--font-mono);font-size:10px;margin-top:8px;color:${r.entry.tolerance==='Worse than usual'?'var(--rust)':'var(--text-faint)'};">${[r.entry.settling,r.entry.tolerance].filter(Boolean).join(' · ').toUpperCase()}${r.entry.followUp24h?'  ⚑ 24H REVIEW':''}</div>`:''}
        ${(r.entry.breath&&r.entry.breath.length)?`<div style="font-family:var(--font-mono);font-size:10px;color:var(--sage);margin-top:6px;">${r.entry.breath.join(' · ').toUpperCase()}</div>`:''}
      </div>`;
    });
  }
  main.innerHTML = html;
  main.querySelectorAll('.corrFilterChip').forEach(b=>b.onclick=()=>{ correlateCategory = b.dataset.val; renderCorrelate(main); });
}


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

  const existingForDate = editingId ? [] : sessions.filter(s=>s.date===logState.date);
  const showLoggedNotice = existingForDate.length > 0 && !dismissedLoggedNotice[logState.date];
  if(showLoggedNotice){
    main.innerHTML = html + `
      <div class="card" style="border-color:var(--sage);">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
          <span style="color:var(--sage);font-size:16px;">&#10003;</span>
          <span style="font-family:var(--font-display);font-weight:600;font-size:14px;">Workout logged for ${formatAU(logState.date)}</span>
        </div>
        ${existingForDate.map(s=>`
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-top:1px solid var(--border);">
            <div>
              <div style="font-size:13px;">${escapeHtml(s.dayLabel)}</div>
              <div style="font-size:11px;color:var(--text-faint);">${(s.exercises||[]).map(e=>e.name).join(', ') || (s.cardio ? s.cardio.type+' '+(s.cardio.distance||'')+'km' : '')}</div>
            </div>
            <button class="viewLoggedBtn" data-id="${s.id}" style="background:none;border:1px solid var(--border);color:var(--brass);border-radius:6px;padding:6px 10px;font-size:11px;font-family:var(--font-mono);flex-shrink:0;">EDIT</button>
          </div>
        `).join('')}
        <button id="logAnotherBtn" class="pill" style="width:100%;padding:11px;margin-top:12px;border-style:dashed;">+ Log another session for this day</button>
      </div>
    `;
    main.querySelectorAll('.viewLoggedBtn').forEach(b=>{
      b.onclick = ()=>{
        const s = sessions.find(x=>x.id===b.dataset.id);
        if(s) loadSessionForEditing(s);
        renderLog(main);
      };
    });
    document.getElementById('logAnotherBtn').onclick = ()=>{
      dismissedLoggedNotice[logState.date] = true;
      renderLog(main);
    };
    document.getElementById('logDate').onchange = e=>{
      logState.date = e.target.value;
      resetLogForDay(weekdayForISO(e.target.value));
      renderLog(main);
    };
    document.getElementById('logDay').onchange = e=>{ resetLogForDay(e.target.value); renderLog(main); };
    return;
  }

  if(day.type !== 'lift'){
    html += `<div class="card"><div class="section-label">${day.type==='cardio'?'Run':'Recovery'}</div><div style="font-size:13px;color:var(--text-dim);">${day.desc}</div></div>`;
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
  if(cancelBtn) cancelBtn.onclick = ()=>{ editingId = null; logState.date = todayISO(); resetLogForDay(todayDayName()); logState.warmup=''; logState.note=''; clearDraft(); renderLog(main); };
}

function getLastLoggedExercise(name){
  const sorted = [...sessions].sort((a,b)=>b.date.localeCompare(a.date));
  const key = canonicalKey(name);
  for(const s of sorted){
    const ex = (s.exercises||[]).find(e=>canonicalKey(e.name)===key);
    if(ex && ex.sets && ex.sets.length){
      return { date: s.date, sets: ex.sets };
    }
  }
  return null;
}
function parseTopRepTarget(target){
  if(!target) return null;
  const nums = (target.match(/\d+(\.\d+)?/g) || []).map(Number);
  return nums.length ? nums[nums.length-1] : null;
}
function suggestNextTarget(name, target){
  const last = getLastLoggedExercise(name);
  if(!last) return null;
  const weighted = last.sets.filter(s=>{
    const w = parseFloat(s.weight);
    return !isNaN(w) && s.weight && !String(s.weight).toLowerCase().includes('x');
  });
  if(weighted.length === 0) return { date: last.date, text: 'Logged bodyweight last time — no weight to project from.' };
  const topSet = weighted.reduce((a,b)=> parseFloat(b.weight) > parseFloat(a.weight) ? b : a);
  const topWeight = parseFloat(topSet.weight);
  const topReps = parseInt(topSet.reps) || 0;
  const targetTopReps = parseTopRepTarget(target);
  let suggestion;
  if(targetTopReps && topReps >= targetTopReps){
    const increment = topWeight >= 40 ? 2.5 : topWeight >= 10 ? 1.25 : 0.5;
    suggestion = `Try ${(topWeight+increment).toFixed(topWeight%1===0?0:2)}kg — hit the top of your rep range last time (${topWeight}kg × ${topSet.reps})`;
  } else {
    suggestion = `Aim for ${topWeight}kg again, push for more reps than last time's ${topSet.reps} (or hold at ${topWeight}kg × ${topSet.reps})`;
  }
  return { date: last.date, text: suggestion };
}

function renderExerciseCard(ex){
  let html = `<div class="card" data-ex-id="${ex.id}">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
      <div style="flex:1;">`;
  html += `<input class="ex-name-input" data-ex-id="${ex.id}" value="${escapeAttr(ex.name)}" placeholder="Exercise name" style="background:none;border:none;font-family:var(--font-display);font-weight:600;font-size:15px;color:var(--text);width:100%;padding:0;">`;
  if(!ex.custom && ex.target){
    html += `<div class="${ex.hero?'herobadge':'accbadge'}" style="display:inline-block;margin-top:4px;">${ex.target}${ex.hero?' · HERO':''}</div>`;
  }
  html += `</div><button class="removeExBtn" data-ex-id="${ex.id}" style="background:none;border:none;color:var(--text-faint);font-size:16px;">&times;</button></div>`;

  if(ex.name && ex.name.trim()){
    const suggestion = suggestNextTarget(ex.name, ex.target);
    if(suggestion){
      html += `<div style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:12px;color:var(--brass);line-height:1.4;">
        <span style="font-family:var(--font-mono);font-size:10px;color:var(--text-faint);text-transform:uppercase;letter-spacing:0.04em;">Last logged ${formatAU(suggestion.date)}</span><br>
        ${escapeHtml(suggestion.text)}
      </div>`;
    }
  }

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
  if(editingId){
    sessions = [session, ...sessions.filter(s=>s.id !== editingId)];
  } else {
    sessions = [session, ...sessions];
  }
  saveData();
  clearDraft();
  showToast(editingId ? 'Session updated' : 'Session saved');
  editingId = null;
  logState.date = todayISO(); resetLogForDay(todayDayName()); logState.warmup=''; logState.note='';
  view = 'history';
  renderAll();
}

// ---------- HISTORY VIEW ----------
function loadSessionForEditing(s, fallbackDayKey){
  editingId = s.id;
  logState.date = s.date;
  logState.dayKey = PLAN[s.dayKey] ? s.dayKey : (fallbackDayKey || todayDayName());
  logState.warmup = s.warmup || ''; logState.note = s.note || '';

  const fullTemplate = emptyExercisesFor(logState.dayKey);
  const savedByName = {};
  (s.exercises||[]).forEach(ex => { savedByName[ex.name] = ex; });
  const merged = fullTemplate.map(tmpl => {
    const saved = savedByName[tmpl.name];
    if(saved){
      delete savedByName[tmpl.name];
      return { ...tmpl, sets: (saved.sets||[]).map(st=>({id:uid(), weight:st.weight||'', reps:st.reps||'', rir:st.rir||'', note:st.note||''})) };
    }
    return tmpl;
  });
  Object.values(savedByName).forEach(ex=>{
    merged.push({ id:uid(), name:ex.name, target:'', hero: ex.tier==='hero', custom:true,
      sets:(ex.sets||[]).map(st=>({id:uid(), weight:st.weight||'', reps:st.reps||'', rir:st.rir||'', note:st.note||''})) });
  });
  logState.exercises = merged;
  logState.cardio = s.cardio ? {...s.cardio, active:true} : {active:false,type:'Run',distance:'',time:'',note:''};
}

let expandedGroups = {};
function isoWeekInfo(dateStr){
  const d = new Date(dateStr+'T00:00:00');
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = new Date(target.getFullYear(),0,4);
  const diff = target - firstThursday;
  const week = 1 + Math.round(diff / (7*24*3600*1000));
  return { isoYear: target.getFullYear(), week };
}
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function renderSessionCardHtml(s){
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
  return `<div class="card" style="margin-left:14px;">
    <button class="histhead" data-id="${s.id}">
      <div><div class="histdate">${formatAU(s.date)}</div><div class="histlabel">${escapeHtml(s.dayLabel)}</div></div>
      <span style="color:var(--text-faint);">${open?'&#9650;':'&#9660;'}</span>
    </button>
    <div class="histbody ${open?'show':''}">${body}</div>
  </div>`;
}

function groupHeaderHtml(key, label, count, level){
  const open = !!expandedGroups[key];
  const pad = level * 10;
  const size = level===0 ? '15px' : level===1 ? '14px' : '13px';
  return `<button class="grouphead" data-key="${key}" style="width:100%;display:flex;justify-content:space-between;align-items:center;background:var(--surface);border:1px solid var(--border);border-radius:9px;padding:10px 14px;margin-left:${pad}px;margin-bottom:6px;">
    <span style="font-family:var(--font-display);font-weight:600;font-size:${size};">${escapeHtml(label)}</span>
    <span style="display:flex;align-items:center;gap:8px;">
      <span class="eyebrow">${count} session${count!==1?'s':''}</span>
      <span style="color:var(--text-faint);">${open?'&#9650;':'&#9660;'}</span>
    </span>
  </button>`;
}

function renderHistory(main){
  const sorted = [...sessions].sort((a,b)=>b.date.localeCompare(a.date));
  const importBtn = `<button id="importNotesBtn" class="pill active" style="padding:6px 14px;margin-bottom:14px;">Import from notes</button>`;
  if(sorted.length === 0){ main.innerHTML = importBtn + `<div class="emptystate">No sessions yet. Head to Log to add your first one, or import old notes above.</div>`; wireImportButton(main); return; }

  // Build nested groups: year -> month -> isoWeek -> sessions
  const years = {};
  sorted.forEach(s=>{
    const y = s.date.slice(0,4);
    const monthIdx = parseInt(s.date.slice(5,7),10) - 1;
    const { week } = isoWeekInfo(s.date);
    years[y] = years[y] || {};
    years[y][monthIdx] = years[y][monthIdx] || {};
    years[y][monthIdx][week] = years[y][monthIdx][week] || [];
    years[y][monthIdx][week].push(s);
  });

  let html = importBtn;
  Object.keys(years).sort((a,b)=>b.localeCompare(a)).forEach(y=>{
    const yearKey = `y-${y}`;
    const yearCount = Object.values(years[y]).reduce((a,m)=>a+Object.values(m).reduce((a2,w)=>a2+w.length,0),0);
    html += groupHeaderHtml(yearKey, y, yearCount, 0);
    if(expandedGroups[yearKey]){
      Object.keys(years[y]).sort((a,b)=>b-a).forEach(m=>{
        const monthKey = `${yearKey}-m-${m}`;
        const monthCount = Object.values(years[y][m]).reduce((a,w)=>a+w.length,0);
        html += groupHeaderHtml(monthKey, MONTH_NAMES[m], monthCount, 1);
        if(expandedGroups[monthKey]){
          Object.keys(years[y][m]).sort((a,b)=>b-a).forEach(w=>{
            const weekKey = `${monthKey}-w-${w}`;
            const weekSessions = years[y][m][w];
            html += groupHeaderHtml(weekKey, `Week ${w}`, weekSessions.length, 2);
            if(expandedGroups[weekKey]){
              weekSessions.forEach(s=>{ html += renderSessionCardHtml(s); });
            }
          });
        }
      });
    }
  });

  main.innerHTML = html;
  main.querySelectorAll('.grouphead').forEach(b=>{
    b.onclick = ()=>{ expandedGroups[b.dataset.key] = !expandedGroups[b.dataset.key]; renderHistory(main); };
  });
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
      loadSessionForEditing(s);
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
    <div class="field" style="margin-bottom:12px;max-width:140px;"><label>Starting year</label><input type="number" id="importYearInput" autocomplete="off" value="${new Date().getFullYear()}"></div>
    <div style="font-size:11px;color:var(--text-faint);margin-bottom:10px;">If your notes cross into a new year (e.g. Oct through March), the year rolls forward automatically as the months move backward — no need to type it per session.</div>
    <textarea id="importTextarea" rows="12" placeholder="18/3
Bench press 60kg 8, 8, 6
Lat pulldown 70kg 10, 10

19/3: 5km run 24:30" style="width:100%;background:var(--surface-2);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:10px;font-family:var(--font-mono);font-size:13px;margin-bottom:12px;"></textarea>
    <div style="display:flex;gap:10px;">
      <button id="cancelImportBtn" style="flex:1;padding:11px;border-radius:9px;border:1px solid var(--border);background:var(--surface-2);color:var(--text);font-family:var(--font-display);font-weight:600;font-size:13px;">Cancel</button>
      <button id="parseImportBtn" style="flex:1;padding:11px;border-radius:9px;border:none;background:var(--brass);color:#0A1F1A;font-family:var(--font-display);font-weight:600;font-size:13px;">Parse notes</button>
    </div>
  `;
  document.getElementById('cancelImportBtn').onclick = ()=>renderHistory(main);
  document.getElementById('parseImportBtn').onclick = ()=>{
    const text = document.getElementById('importTextarea').value;
    const startYear = parseInt(document.getElementById('importYearInput').value) || new Date().getFullYear();
    importPreview = parseImportText(text, startYear);
    renderImportPreview(main);
  };
}
function parseImportText(text, startingYear){
  const blocks = text.split(/\n\s*\n/);
  const dateRe = /^(?:[A-Za-z]+\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*[:;]?\s*(.*)$/;
  const results = [];
  let inferredYear = startingYear || new Date().getFullYear();
  let lastMonth = null;
  let lastIso = null;
  blocks.forEach(block=>{
    const lines = block.split('\n').map(l=>l.trim()).filter(l=>l);
    if(lines.length === 0) return;
    const m = dateRe.exec(lines[0]);
    if(!m) return;
    const [, day, month, yr, rest] = m;
    const monthNum = parseInt(month);
    let year;
    if(yr){
      year = yr.length===2 ? 2000+parseInt(yr) : parseInt(yr);
    } else {
      if(lastMonth !== null && monthNum < lastMonth - 1){
        inferredYear += 1;
      }
      year = inferredYear;
    }
    lastMonth = monthNum;
    const d = new Date(year, monthNum-1, parseInt(day));
    if(isNaN(d.getTime())) return;
    const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const weekday = new Intl.DateTimeFormat('en-AU', { weekday:'long' }).format(d);
    const outOfOrder = lastIso && iso < lastIso;
    lastIso = iso;
    const contentLines = [];
    if(rest && rest.trim()) contentLines.push(rest.trim());
    contentLines.push(...lines.slice(1));
    const exercises = [];
    let cardio = null;
    contentLines.forEach(line=>{
      const low = line.toLowerCase();
      const looksCardio = /(run|walk|hike)/.test(low) && !/\d+\s*(kg|lb)/.test(low);
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
      warmup:'', note:'', exercises, cardio, skip:false, outOfOrder,
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
  const outOfOrderCount = importPreview.filter(s=>s.outOfOrder).length;
  let html = `<div class="section-label">Found ${importPreview.length} session${importPreview.length>1?'s':''}</div>
    <div style="font-size:12px;color:var(--text-dim);margin-bottom:12px;">Review below, untick any you don't want, then import. Dates that already have a session will be skipped automatically.</div>`;
  if(outOfOrderCount > 0){
    html += `<div style="background:var(--rust-dim);border:1px solid var(--rust-dim);border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:var(--rust);line-height:1.5;">
      ${outOfOrderCount} session${outOfOrderCount>1?'s are':' is'} flagged below with ⚠ — its date comes before the previous entry, which usually means a typo in the original text (e.g. a repeated or mistyped date). Worth double-checking those before importing.
    </div>`;
  }
  importPreview.forEach((s,i)=>{
    const already = existingDates.has(s.date);
    const summary = s.cardio ? `${s.cardio.type} ${s.cardio.distance||'?'}km` : (s.exercises.map(e=>e.name).join(', ') || 'No sets recognized');
    html += `<div class="card" style="${already?'opacity:0.5;':''}${s.outOfOrder?'border-color:var(--rust);':''}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <div class="histdate">${s.outOfOrder?'⚠ ':''}${formatAU(s.date)} · ${s.dayKey}</div>
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
    <button id="commitImportBtn" style="flex:1;padding:11px;border-radius:9px;border:none;background:var(--brass);color:#0A1F1A;font-family:var(--font-display);font-weight:600;font-size:13px;">Import ${includeCount}</button>
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
  const options = groupedExerciseOptions();
  if(!progressGroupKey || !options.some(o=>o.key===progressGroupKey)){
    const hipThrust = options.find(o=>o.key==='hip thrust');
    progressGroupKey = hipThrust ? hipThrust.key : (options[0] && options[0].key);
  }
  const data = sessions.filter(s=>(s.exercises||[]).some(e=>canonicalKey(e.name)===progressGroupKey))
    .map(s=>{ const ex = s.exercises.find(e=>canonicalKey(e.name)===progressGroupKey); return {date:s.date, weight: topWeight(ex)}; })
    .filter(d=>d.weight!==null).sort((a,b)=>a.date.localeCompare(b.date));
  const latest = data.length ? data[data.length-1].weight : null;
  const best = data.length ? Math.max(...data.map(d=>d.weight)) : null;

  main.innerHTML = `
    <div class="field" style="margin-bottom:14px;"><label>Lift</label>
      <select id="progressSelect">${options.map(o=>`<option value="${escapeAttr(o.key)}" ${o.key===progressGroupKey?'selected':''}>${escapeHtml(o.label)}</option>`).join('')}</select>
    </div>
    <div class="statgrid">
      <div class="stat"><div class="l">Latest top set</div><div class="v">${latest!==null?latest+'kg':'—'}</div></div>
      <div class="stat"><div class="l">Best logged</div><div class="v" style="color:var(--brass);">${best!==null?best+'kg':'—'}</div></div>
    </div>
    <div class="chartwrap" id="progressChart"></div>
  `;
  document.getElementById('progressSelect').onchange = e=>{ progressGroupKey = e.target.value; renderProgress(main); };
  renderLineChart(document.getElementById('progressChart'), data, 'var(--brass)', '#4CA893');
}

// ---------- BIG LIFTS VIEW ----------
function renderBigLifts(main){
  const heroGroups = new Map();
  Object.values(PLAN).forEach(d=>{ (d.exercises||[]).forEach(e=>{
    if(e.hero && e.name && e.name.trim()){
      const key = canonicalKey(e.name);
      if(key && !heroGroups.has(key)) heroGroups.set(key, e.name);
    }
  }); });
  main.innerHTML = `<div class="section-label">Your big lifts over time</div><div id="biglifts-body"></div>`;
  const body = document.getElementById('biglifts-body');
  if(heroGroups.size === 0){
    body.innerHTML = `<div class="emptystate">Mark an exercise as "Hero" in Edit Program to track its trend here.</div>`;
    return;
  }
  const palette = ['#C49A45','#6E93AC','#8A9A79','#C15C33','#9B7EDE','#C97F9A'];
  const sorted = [...sessions].sort((a,b)=>a.date.localeCompare(b.date));
  let i = 0;
  heroGroups.forEach((label, key)=>{
    const color = palette[i++ % palette.length];
    const data = sorted.map(s=>{
      const ex = (s.exercises||[]).find(e=>canonicalKey(e.name)===key);
      if(!ex) return null;
      const w = topWeight(ex);
      return w!==null ? {date:s.date, weight:w} : null;
    }).filter(Boolean);
    const first = data[0]?.weight, last = data[data.length-1]?.weight;
    const delta = (first!==undefined && last!==undefined) ? Math.round((last-first)*100)/100 : null;
    const div = document.createElement('div');
    div.className = 'chartwrap';
    div.innerHTML = `
      <div class="liftheader">
        <div><div class="liftname">${escapeHtml(label)}</div></div>
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

const EXERCISE_LIBRARY = {"Squat pattern":["Barbell Back Squat","Barbell Front Squat","Goblet Squat","Lunges","Bulgarian Split Squat","Hack Squats","Leg Press","Pendulum Squat","Glute cable step up","Smith Machine Back Squats","Deficit DB step back lunge","Sissy squats","Front heel elevated split squat","Smith Split Squats","DB Sumo squat","Heel elevated goblet squat","DB Static split squat","Supported Bulgarian split squat","Paused Back Squats","Machine Bulgarian Split Squat","Sissy squat holding on","DB heel elevated front squat","Smith deficit step back lunge","DB Curtsey lunge","Landmine Sumo Squat","Tap'n'go BB back squat","Contralateral front foot elevated glute bias split squat","Step forward DB lunge","Contralateral bulgarian split squat"],"Hinging":["Deadlift","BB Romanian Deadlift","Barbell Hip Thrust","Kas Glute Bridge","45 Degree Extension","DB Romanian Deadlift","Glute Ham Raise","Smith machine RDL","Machine RDL","b-stance DB RDL","Glute drive machine","Barbell Good Mornings","Single Leg Hip Thrust","B-Stance Barbell Hip thrust","Stiff Leg Deadlift","Single leg supported RDL","Reverse hyperextension","B-Stance BB Glute Bridge","Single Leg Cable RDL","DB Step Down","DB Stiff Leg Deadlift"],"Isolation (lower)":["Supine Bench Hamstring Curl","Seated Calf Raises","Seated Hamstring Curl Machine","Standing Calf Raise Machine","Leg Extensions","Glute medius cable kickback","Abduction machine","Cable abduction and adduction","Standing smith machine calf raises","Machine Adduction","Single Leg Leg Extensions","Single Leg Seated Hamstring Curls","Glute max kickback","Bench Adductions","Single leg swissball hamstring curls","Glute max kickback with bench support","Cuffed cable hamstring curls","Single leg supine hamstring curl","Standing single leg cable hamstring curls","Standing single leg machine hamstring curls","B-Stance goblet squats","Glute max Kickback Machine","Seated cable hip adductions with plate","Banded reverse nordic","Smith machine calf raise with plate","Single leg machine calf raises","Lying Hamstring Curls"],"Pulling":["Lat Focused Neutral Grip Pulldown","Bent over barbell row","Single arm DB Rows","Prone grip seated cable row","Upper back bench supported rows","Lat Pulldown Variations","Chest Supported T Bar Row","Hammer Strength Iso Pulldown","Half Kneeling Lat pulldown","Machine Pull-Ups","Upper Back Bench Supported DB Rows","High machine row","Smith Machine Bent Over Rows","Inverted rows","Neutral Grip Cable rows","Wide grip lat pulldowns","T-Bar Rows","T-Bar Rows (Chest supported)","Single Arm bench supported neutral grip pulldowns","Banded Pull-Ups","Chest Supported Neutral Grip machine rows","Bench supported DB Rear delt row","Machine overhand seated horizontal row","Dual bent over DB Rows","Seated neutral Grip Cable rows","Low row machine","Alternating dual DB Row","Single arm neutral grip Lat pulldown","Setup for bench supported DB Rows","Isolateral seated horizontal neutral grip row","Unilateral chest supported cable row"],"Upper pressing":["Barbell Bench Press","DB Flat Bench Press","DB Incline Bench Press","Mid-grip push up","Converging Chest Press Machine","Incline Smith Machine Chest Press","Machine Shoulder Press","Machine Pec Fly","DB Seated Shoulder Press","Seated Machine Chest Press","Barbell z-press","Close grip bench press","Barbell military press","Machine Assisted Dips","Standing Landmine press","Smith machine flat bench press","Half kneeling landmine press","Seated Cable chest press","Standing Machine Shoulder Press","Machine incline press","Plate loaded incline Press","High incline DB Bench Press","Plate loaded seated shoulder press machine","Smith machine shoulder press"],"Isolation (upper)":["Rear delt cable fly","Bicep Curls","Single Arm Lying DB Tricep Extensions","Straight arm cable pullovers","Cable Lateral Raise","Cross body Tricep Extensions","Straight Bar Cable Tricep Pushdowns","DB Lateral Raise","Rear delt machine fly","Machine Lateral Raise","Dual Cable Tricep Extension","Lying Incline Cuffed Lateral Raise","Cable facing away bicep curls","Single Arm Preacher Curl","Pec Dec Fly","Rope cable facepull","EZ Bar Skullcrusher","Supinating DB Curls","Cable Mid Pec Fly","DB rear delt fly","DB Y raises","Dual Cable side raises","DB Single Arm Side Raises","Straight Bar Cable Bicep Curls","Copenhagen planks","Deadball slams","Rope Cable pressdowns","Bench supported DB Side raises","Katana Extensions","DB hammer Curls","EZ Bar upright rows","Poliquin Raises","Pallof Press","DB Pec Fly","Swissball ab pike","Cable rope overhead tricep extensions","Cable rope ab crunches","Single arm supported cable crossbody tricep extensions","KB Pull Through","DB reverse fly","Single Arm Rear delt fly","Cable upright row","Machine Bicep Curl","Incline Bench DB Bicep Curls","Deadbug","Lying Leg Raises","Single arm side raises","Reverse crunch","High cable curl (straight bar)","Single Arm Overhead tricep extensions","Bench supported DB Rear Delt fly","Plate loaded crunches","EZ Bar Bicep Curls","Cable lateral raise with wrist height pulley","Abs V-Ups","Crucifix raise (D handle)","Crucifix raise (cuffs)","Machine tricep extensions","Decline bench situps","Cable rope tricep pressdowns","Seated DB lateral Raise","Captains chair leg raise","Single arm Katana extension","Alternating DB Front Raise","DB Skullcrusher","DB tricep extension cross-body supported","Single arm rear delt cable fly","Standing cable oblique twists","Decline reverse crunches","Side plank","Loaded Deadbug","Bench supported DB Front Raise","Cable Oblique Twist","Double loaded deadbug","Machine Preacher Curl","Cable rope Hammer Curls","Burpee","Mountain Climbers","Toe Tap","Standing DB Tricep Extension","Machine hammer curl","Single arm cable tricep extensions","Preloaded BB Preacher Curl","Dual Cuff cable side raises","Plank","Foam roller DB bicep curls"],"Mobility & warm-up":["Banded Around the Worlds","Bottom Under Press","Lat Stretch","Thoracic Extension","Half kneeling Thoracic Rotation","Spiderman","Knee Hug","Inchworm","Single Leg RDL","Ankle Mobility Knee Drive Lunge","90/90 hip mobility"]};

let libraryCategoryFilter = 'all';
function renderLibraryTab(main){
  const cats = Object.keys(EXERCISE_LIBRARY);
  const totalCount = cats.reduce((a,c)=>a+EXERCISE_LIBRARY[c].length, 0);
  let html = `<div class="section-label">Exercise library — ${totalCount} exercises</div>
  <input type="text" id="libTabSearchInput" autocomplete="off" placeholder="Search exercises…" style="width:100%;background:var(--surface-2);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:10px;font-size:14px;margin-bottom:12px;">
  <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;" id="libTabCatChips">
    <button class="libTabCatChip" data-cat="all" style="background:${libraryCategoryFilter==='all'?'var(--brass)':'var(--surface-2)'};color:${libraryCategoryFilter==='all'?'#0A1F1A':'var(--text-dim)'};border:1px solid var(--border);border-radius:20px;padding:6px 12px;font-size:12px;">All</button>
    ${cats.map(c=>`<button class="libTabCatChip" data-cat="${escapeAttr(c)}" style="background:${libraryCategoryFilter===c?'var(--brass)':'var(--surface-2)'};color:${libraryCategoryFilter===c?'#0A1F1A':'var(--text-dim)'};border:1px solid var(--border);border-radius:20px;padding:6px 12px;font-size:12px;">${escapeHtml(c)}</button>`).join('')}
  </div>
  <div id="libTabResults"></div>`;
  main.innerHTML = html;

  function renderResults(filter){
    const q = (filter||'').trim().toLowerCase();
    const resultsEl = document.getElementById('libTabResults');
    let rhtml = '';
    let shown = 0;
    cats.forEach(cat=>{
      if(libraryCategoryFilter !== 'all' && libraryCategoryFilter !== cat) return;
      const items = EXERCISE_LIBRARY[cat].filter(name=>!q || name.toLowerCase().includes(q));
      if(items.length === 0) return;
      shown += items.length;
      rhtml += `<div class="card">
        <div style="font-family:var(--font-mono);font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:var(--brass);margin-bottom:8px;">${escapeHtml(cat)} <span style="color:var(--text-faint);">· ${items.length}</span></div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${items.map(name=>`<span style="background:var(--surface-2);border:1px solid var(--border);color:var(--text);font-size:12px;padding:6px 12px;border-radius:20px;">${escapeHtml(name)}</span>`).join('')}
        </div>
      </div>`;
    });
    if(shown === 0) rhtml = `<div class="emptystate">No exercises match your search.</div>`;
    resultsEl.innerHTML = rhtml;
  }
  renderResults('');
  document.getElementById('libTabSearchInput').oninput = e=>renderResults(e.target.value);
  main.querySelectorAll('.libTabCatChip').forEach(b=>{
    b.onclick = ()=>{ libraryCategoryFilter = b.dataset.cat; renderLibraryTab(main); };
  });
}

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
  html += `<div class="section-label" style="margin-top:18px;">12-week structure</div><div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px;">`;
  PHASES.forEach(p=>{
    html += `<div class="card" style="flex:0 0 auto;padding:10px 14px;margin-bottom:0;"><div class="wk">WK ${p.weeks}</div><div class="ph" style="color:${p.label==='Deload'?'var(--steel)':'var(--text)'};">${p.label}</div></div>`;
  });
  html += `</div><div class="section-label">Progression rules</div>`;
  RULES.forEach((r,i)=>{
    html += `<div class="rulerow"><span class="n">${String(i+1).padStart(2,'0')}</span><span class="t">${r}</span></div>`;
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
document.getElementById('reviewProgramBtn').onclick = ()=>{
  document.getElementById('completeOverlay').classList.remove('show');
  settings.completeAcknowledged = true;
  saveSettings();
  view = 'program';
  renderAll();
};
document.getElementById('dismissCompleteBtn').onclick = ()=>{
  settings.completeAcknowledged = true;
  saveSettings();
  document.getElementById('completeOverlay').classList.remove('show');
};
document.getElementById('startNewBlockBtn').onclick = ()=>{
  const v = document.getElementById('newBlockDateInput').value;
  if(!v){ showToast('Pick a date first'); return; }
  settings.startDate = v;
  settings.completeAcknowledged = false;
  saveSettings();
  document.getElementById('completeOverlay').classList.remove('show');
  renderAll();
  showToast('New block started — week 1 begins ' + formatAU(v));
};

document.getElementById('cancelSettings').onclick = ()=>document.getElementById('settingsOverlay').classList.remove('show');
document.getElementById('saveSettings').onclick = ()=>{
  const v = document.getElementById('startDateInput').value;
  if(v){ settings.startDate = v; saveSettings(); renderAll(); showToast('Start date updated'); }
  document.getElementById('settingsOverlay').classList.remove('show');
};

document.getElementById('exportDataBtn').onclick = ()=>{
  const backup = {
    exportedAt: new Date().toISOString(),
    app: 'core-performance',
    sessions, cycleEntries, settings, PLAN,
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `core-performance-backup-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
  showToast('Backup downloaded');
};

document.getElementById('importDataBtn').onclick = ()=>{
  document.getElementById('importFileInput').click();
};
document.getElementById('importFileInput').onchange = (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const backup = JSON.parse(reader.result);
      if(!backup || !Array.isArray(backup.sessions)){ showToast('That file doesn\'t look like a valid backup'); return; }
      const existingDates = new Set(sessions.map(s=>s.date));
      const toAdd = backup.sessions.filter(s=>!existingDates.has(s.date));
      sessions = [...sessions, ...toAdd];
      saveData();
      if(Array.isArray(backup.cycleEntries)){
        const existingCycleDates = new Set(cycleEntries.map(c=>c.date));
        const cycleToAdd = backup.cycleEntries.filter(c=>!existingCycleDates.has(c.date));
        cycleEntries = [...cycleEntries, ...cycleToAdd];
        saveCycleData();
      }
      document.getElementById('settingsOverlay').classList.remove('show');
      renderAll();
      showToast(`Restored ${toAdd.length} session${toAdd.length!==1?'s':''} from backup`);
    }catch(err){
      showToast('Could not read that backup file');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
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
loadCycleData();
loadDraft();
renderAll();
