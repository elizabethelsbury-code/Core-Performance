const TIMEZONE = 'Australia/Melbourne';
const STORAGE_KEY = 'core-performance-sessions';
const IMPORT_FLAG = 'core-performance-imported-v1';
const SETTINGS_KEY = 'core-performance-settings';
const DEFAULT_START_DATE = '2026-03-18';

let sessions = [];
let settings = { startDate: DEFAULT_START_DATE };
let view = 'log';
let expandedHistory = {};
let editingId = null;
let progressExercise = null;

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
  phaseline.innerHTML = `
    <div><div class="eyebrow">Week</div><div class="week">${phase==='Complete' ? `${week} · Done` : `${Math.min(week,12)} / 12`}</div></div>
    <div class="phase ${phase.toLowerCase()}">${phase}</div>
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
  return day.exercises.map(e => ({ id: uid(), name: e.name, target: e.target, hero: !!e.hero, custom:false, sets: [] }));
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
    {id:'cycle', label:'Cycle', ic:'&#128167;'},
    {id:'correlate', label:'Correlate', ic:'&#128260;'},
    {id:'program', label:'Program', ic:'&#128203;'},
  ];
  document.getElementById('navbar').innerHTML = `<div style="display:flex;overflow-x:auto;width:100%;">` + tabs.map(t=>
    `<button class="navbtn ${view===t.id?'active':''}" data-view="${t.id}" style="flex:0 0 auto;min-width:60px;"><span class="ic">${t.ic}</span>${t.label}</button>`
  ).join('') + `</div>`;
  document.querySelectorAll('.navbtn').forEach(b=>{
    b.onclick = ()=>{ view = b.dataset.view; renderAll(); };
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
      logState.date = btn.dataset.date;
      resetLogForDay(btn.dataset.day);
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
  mSymptoms:[], domains:{}, nrs:{}, timing:{}, settling:'', tolerance:'',
  followUp24h:false, provocation:'', breath:[], proms:{}, note:'',
};
let expandedCycle = {};
let showProms = false;
let correlateFilter = 'all';
let correlateDelayedOnly = false;

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
      phaseOverride: found.phaseOverride||'Auto', mSymptoms: found.menstrualSymptoms||[],
      domains: found.domains||{}, nrs: found.nrs||{}, timing: found.timing||{},
      settling: found.settling||'', tolerance: found.tolerance||'', followUp24h: !!found.followUp24h,
      provocation: found.provocation||'', breath: found.breath||[], proms: found.proms||{}, note: found.note||'',
    };
  } else {
    cycleState = { date: dateStr, flow:'None', periodStart:false, phaseOverride:'Auto', mSymptoms:[], domains:{}, nrs:{}, timing:{}, settling:'', tolerance:'', followUp24h:false, provocation:'', breath:[], proms:{}, note:'' };
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
function getCycleDayFor(dateStr){
  const starts = cycleEntries.filter(e=>e.periodStart && e.date<=dateStr).map(e=>e.date).sort();
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
  const cycleDay = getCycleDayFor(cycleState.date);
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

  <div class="domainblock">
    <div class="domainlabel" style="color:var(--text-faint);">MENSTRUAL</div>
    <div class="chiprow2" id="mSymptomChips">
      ${MENSTRUAL_SYMPTOMS.map(s=>chipHtml('chip2 msymptomchip', s, cycleState.mSymptoms.includes(s), null, `data-val="${escapeAttr(s)}"`)).join('')}
    </div>
  </div>`;

  SYMPTOM_DOMAINS.forEach(d=>{
    const selected = cycleState.domains[d.key] || [];
    html += `<div class="domainblock">
      <div class="domainlabel" style="color:var(--text-faint);">${d.label}</div>
      <div class="chiprow2 domainchips" data-domain="${d.key}">
        ${d.items.map(s=>chipHtml('chip2 domainchip', s, selected.includes(s), d.color, `data-domain="${d.key}" data-val="${escapeAttr(s)}"`)).join('')}
      </div>`;
    if(selected.length > 0){
      const nrsVal = cycleState.nrs[d.key];
      html += `<div style="margin-top:10px;">
        <div class="domainlabel" style="color:var(--text-faint);font-size:10px;">NRS (0–10)</div>
        <div class="nrsgrid" data-nrs-domain="${d.key}">
          ${[0,1,2,3,4,5,6,7,8,9,10].map(n=>`<button class="nrsbtn" data-domain="${d.key}" data-val="${n}" style="${nrsVal===n?`background:${d.color};color:#1B1600;border-color:${d.color};`:''}">${n}</button>`).join('')}
        </div>
        <div class="domainlabel" style="color:var(--text-faint);font-size:10px;margin-top:10px;">ONSET RELATIVE TO SESSION</div>
        <div class="chiprow2" data-timing-domain="${d.key}">
          ${ONSET_TIMING.map(t=>chipHtml('chip2 timingchip', t, cycleState.timing[d.key]===t, d.color, `data-domain="${d.key}" data-val="${escapeAttr(t)}"`)).join('')}
        </div>
      </div>`;
    }
    html += `</div>`;
  });

  html += `<div class="field" style="margin-bottom:10px;"><label>Provocation / load context</label><input type="text" id="provocationInput" value="${escapeAttr(cycleState.provocation)}" placeholder="e.g. coning at 170kg banded hip thrust, set 3"></div>`;
  if(sameDaySession){
    html += `<div class="card" style="margin-bottom:14px;"><div class="domainlabel" style="color:var(--text-faint);">LOGGED THIS DAY</div>`;
    (sameDaySession.exercises||[]).forEach(ex=>{
      html += `<div style="font-size:12px;margin-bottom:2px;">${escapeHtml(ex.name)} <span style="color:var(--text-faint);font-family:var(--font-mono);font-size:11px;">${(ex.sets||[]).map(st=>`${fmtWeight(st.weight)}×${st.reps||'–'}`).join(', ')}</span></div>`;
    });
    html += `</div>`;
  }
  html += `<div class="domainlabel" style="color:var(--text-faint);">BREATH / IAP STRATEGY</div>
  <div class="chiprow2" id="breathChips" style="margin-bottom:16px;">
    ${BREATH_STRATEGIES.map(b=>chipHtml('chip2 breathchip', b, cycleState.breath.includes(b), 'var(--sage)', `data-val="${escapeAttr(b)}"`)).join('')}
  </div>

  <div class="domainlabel" style="color:var(--text-faint);">SETTLING</div>
  <div class="chiprow2" id="settlingChips" style="margin-bottom:14px;">
    ${SETTLING.map(s=>chipHtml('chip2 settlingchip', s, cycleState.settling===s, 'var(--steel)', `data-val="${escapeAttr(s)}"`)).join('')}
  </div>
  <div class="domainlabel" style="color:var(--text-faint);">TOLERANCE VS BASELINE</div>
  <div class="chiprow2" id="toleranceChips" style="margin-bottom:14px;">
    ${LOAD_TOLERANCE.map(t=>chipHtml('chip2 tolerancechip', t, cycleState.tolerance===t, t==='Worse than usual'?'var(--rust)':t==='Better than usual'?'var(--sage)':'var(--text-faint)', `data-val="${escapeAttr(t)}"`)).join('')}
  </div>
  <button id="followUpBtn" class="checkline" style="margin-bottom:18px;color:${cycleState.followUp24h?'var(--brass)':'var(--text-dim)'};">
    <span class="checkbox" style="background:${cycleState.followUp24h?'var(--brass)':'none'};">${cycleState.followUp24h?'&#10003;':''}</span> Flag for 24h review
  </button>

  <button id="togglePromsBtn" style="display:flex;justify-content:space-between;width:100%;background:none;border:none;color:var(--text);padding:0;margin-bottom:8px;">
    <span class="section-label" style="margin:0;">Outcome measures (periodic)</span><span>${showProms?'&#9650;':'&#9660;'}</span>
  </button>`;
  if(showProms){
    html += `<div style="font-size:11px;color:var(--text-dim);margin-bottom:10px;">Enter your own scored totals — the instruments themselves aren't reproduced here.</div>`;
    PROM_INSTRUMENTS.forEach(p=>{
      html += `<div class="promrow"><span class="nm">${p.name}</span><input type="text" inputmode="decimal" class="promInput" data-name="${escapeAttr(p.name)}" value="${escapeAttr(cycleState.proms[p.name]||'')}" placeholder="—"><span style="font-family:var(--font-mono);font-size:11px;color:var(--text-faint);">/ ${p.max}</span></div>`;
    });
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
      const domainCount = Object.values(e.domains||{}).reduce((a,v)=>a+(v?v.length:0),0);
      html += `<div class="card">
        <button class="histhead cycleEntryHead" data-id="${e.id}">
          <div>
            <div class="histdate">${formatAU(e.date)}${e.cycleDay?` · CD${e.cycleDay}`:''}${e.resolvedPhase?` · ${e.resolvedPhase.toUpperCase()}`:''}</div>
            <div class="histlabel" style="color:${e.nilSymptoms?'var(--sage)':'var(--text)'};font-size:14px;">${e.nilSymptoms?'Nil symptoms':`${e.flow&&e.flow!=='None'?'Flow: '+e.flow:'No flow'}${domainCount?` · ${domainCount} symptom${domainCount>1?'s':''}`:''}`}</div>
          </div>
          <span style="color:var(--text-faint);">${open?'&#9650;':'&#9660;'}</span>
        </button>`;
      if(open){
        html += `<div class="histbody show">`;
        if(e.menstrualSymptoms && e.menstrualSymptoms.length){
          html += `<div style="margin-bottom:8px;"><div class="domainlabel" style="font-size:10px;">MENSTRUAL</div><div style="font-size:13px;">${e.menstrualSymptoms.join(', ')}</div></div>`;
        }
        SYMPTOM_DOMAINS.forEach(d=>{
          const list = (e.domains && e.domains[d.key]) || [];
          if(!list.length) return;
          const score = e.nrs ? e.nrs[d.key] : null;
          const t = e.timing ? e.timing[d.key] : null;
          html += `<div style="margin-bottom:8px;"><div class="domainlabel" style="font-size:10px;">${d.label}${score!=null?` · NRS ${score}/10`:''}${t?` · ${t.toUpperCase()}`:''}</div><div style="font-size:13px;color:${d.color};">${list.join(', ')}</div></div>`;
        });
        if(e.settling || e.tolerance || e.followUp24h){
          html += `<div style="margin-bottom:8px;"><div class="domainlabel" style="font-size:10px;">LOAD RESPONSE</div><div style="font-size:13px;color:${e.tolerance==='Worse than usual'?'var(--rust)':'var(--text)'};">${[e.settling,e.tolerance].filter(Boolean).join(' · ')}${e.followUp24h?'  &#9873; 24h review':''}</div></div>`;
        }
        if(e.provocation) html += `<div style="margin-bottom:8px;"><div class="domainlabel" style="font-size:10px;">PROVOCATION</div><div style="font-size:13px;">${escapeHtml(e.provocation)}</div></div>`;
        if(e.breath && e.breath.length) html += `<div style="margin-bottom:8px;"><div class="domainlabel" style="font-size:10px;">BREATH / IAP</div><div style="font-size:13px;color:var(--sage);">${e.breath.join(', ')}</div></div>`;
        const promEntries = e.proms ? Object.entries(e.proms).filter(([,v])=>v!=='' && v!=null) : [];
        if(promEntries.length) html += `<div style="margin-bottom:8px;"><div class="domainlabel" style="font-size:10px;">OUTCOME MEASURES</div><div style="font-family:var(--font-mono);font-size:12px;">${promEntries.map(([k,v])=>`${k} ${v}`).join('  ·  ')}</div></div>`;
        if(e.linkedSessionLabel) html += `<div style="font-family:var(--font-mono);font-size:11px;color:var(--text-faint);margin-bottom:8px;">Training that day: ${escapeHtml(e.linkedSessionLabel)}</div>`;
        if(e.note) html += `<div style="font-size:12px;color:var(--text-dim);margin-bottom:8px;">Notes: ${escapeHtml(e.note)}</div>`;
        html += `<button class="deleteCycleBtn" data-id="${e.id}" style="background:none;border:none;color:var(--rust);font-family:var(--font-mono);font-size:11px;">DELETE ENTRY</button></div>`;
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
      cycleDay, menstrualSymptoms:[], domains:{}, nrs:{}, timing:{}, settling:'', tolerance:'As expected',
      followUp24h:false, provocation:'', breath: cycleState.breath, proms:{}, note:'', nilSymptoms:true,
      linkedSessionLabel: sameDaySession?sameDaySession.dayLabel:null,
    });
    renderCycle(main);
  };
  main.querySelectorAll('.flowchip').forEach(b=>b.onclick=()=>{ cycleState.flow=b.dataset.val; renderCycle(main); });
  document.getElementById('periodStartBtn').onclick = ()=>{ cycleState.periodStart = !cycleState.periodStart; renderCycle(main); };
  main.querySelectorAll('.phasechip').forEach(b=>b.onclick=()=>{ cycleState.phaseOverride=b.dataset.val; renderCycle(main); });
  main.querySelectorAll('.msymptomchip').forEach(b=>b.onclick=()=>{
    const v = b.dataset.val;
    cycleState.mSymptoms = cycleState.mSymptoms.includes(v) ? cycleState.mSymptoms.filter(x=>x!==v) : [...cycleState.mSymptoms, v];
    renderCycle(main);
  });
  main.querySelectorAll('.domainchip').forEach(b=>b.onclick=()=>{
    const dom = b.dataset.domain, v = b.dataset.val;
    const cur = cycleState.domains[dom] || [];
    cycleState.domains[dom] = cur.includes(v) ? cur.filter(x=>x!==v) : [...cur, v];
    renderCycle(main);
  });
  main.querySelectorAll('.nrsbtn').forEach(b=>b.onclick=()=>{
    const dom = b.dataset.domain, v = parseInt(b.dataset.val);
    cycleState.nrs[dom] = cycleState.nrs[dom]===v ? null : v;
    renderCycle(main);
  });
  main.querySelectorAll('.timingchip').forEach(b=>b.onclick=()=>{
    const dom = b.dataset.domain, v = b.dataset.val;
    cycleState.timing[dom] = cycleState.timing[dom]===v ? '' : v;
    renderCycle(main);
  });
  const provInput = document.getElementById('provocationInput');
  if(provInput) provInput.oninput = e=>cycleState.provocation = e.target.value;
  main.querySelectorAll('.breathchip').forEach(b=>b.onclick=()=>{
    const v = b.dataset.val;
    cycleState.breath = cycleState.breath.includes(v) ? cycleState.breath.filter(x=>x!==v) : [...cycleState.breath, v];
    renderCycle(main);
  });
  main.querySelectorAll('.settlingchip').forEach(b=>b.onclick=()=>{ cycleState.settling = cycleState.settling===b.dataset.val ? '' : b.dataset.val; renderCycle(main); });
  main.querySelectorAll('.tolerancechip').forEach(b=>b.onclick=()=>{ cycleState.tolerance = cycleState.tolerance===b.dataset.val ? '' : b.dataset.val; renderCycle(main); });
  document.getElementById('followUpBtn').onclick = ()=>{ cycleState.followUp24h = !cycleState.followUp24h; renderCycle(main); };
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
      menstrualSymptoms: cycleState.mSymptoms, domains: cycleState.domains, nrs: cycleState.nrs, timing: cycleState.timing,
      settling: cycleState.settling, tolerance: cycleState.tolerance, followUp24h: cycleState.followUp24h,
      provocation: cycleState.provocation.trim(), breath: cycleState.breath, proms: cycleState.proms, note: cycleState.note.trim(),
      linkedSessionLabel: sameDaySession?sameDaySession.dayLabel:null,
    });
    renderCycle(main);
  };
  main.querySelectorAll('.cycleEntryHead').forEach(b=>{
    b.onclick = ()=>{ expandedCycle[b.dataset.id] = !expandedCycle[b.dataset.id]; renderCycle(main); };
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
  const rows = [...cycleEntries].sort((a,b)=>b.date.localeCompare(a.date))
    .map(e=>{
      const session = sessions.find(s=>s.date===e.date) || null;
      const flat = [];
      SYMPTOM_DOMAINS.forEach(d=>{ (e.domains&&e.domains[d.key]||[]).forEach(s=>flat.push({domain:d, symptom:s})); });
      return { entry:e, session, flat };
    })
    .filter(r=>r.flat.length>0 || r.entry.provocation)
    .filter(r=>correlateFilter==='all' || r.flat.some(f=>f.domain.key===correlateFilter))
    .filter(r=>{
      if(!correlateDelayedOnly) return true;
      const t = Object.values(r.entry.timing||{});
      return t.some(v=>v==='24h post'||v==='48h post'||v==='Same day (1–12h)');
    });

  const totalLogged = cycleEntries.length;
  const symptomatic = cycleEntries.filter(e=>!e.nilSymptoms && Object.values(e.domains||{}).some(v=>v&&v.length)).length;
  const delayed = cycleEntries.filter(e=>Object.values(e.timing||{}).some(v=>v==='24h post'||v==='48h post'||v==='Same day (1–12h)')).length;
  const pct = totalLogged ? Math.round((symptomatic/totalLogged)*100) : null;

  let html = `<div style="display:flex;gap:10px;margin-bottom:16px;">
    <div class="correlate-stat"><div class="l">Days logged</div><div class="v">${totalLogged}</div></div>
    <div class="correlate-stat"><div class="l">Symptomatic</div><div class="v" style="color:var(--brass);">${symptomatic}${pct!==null?` <span style="font-size:11px;color:var(--text-faint);">· ${pct}%</span>`:''}</div></div>
    <div class="correlate-stat"><div class="l">Delayed</div><div class="v" style="color:var(--rust);">${delayed}</div></div>
  </div>
  <div class="section-label">Filter by domain</div>
  <div class="chiprow2" id="correlateFilterChips" style="margin-bottom:10px;">
    ${chipHtml('chip2 corrFilterChip', 'All', correlateFilter==='all', 'var(--brass)', 'data-val="all"')}
    ${SYMPTOM_DOMAINS.map(d=>chipHtml('chip2 corrFilterChip', d.label.split(' ')[0], correlateFilter===d.key, d.color, `data-val="${d.key}"`)).join('')}
  </div>
  <div style="margin-bottom:16px;">${chipHtml('chip2 corrDelayedChip', 'Delayed onset only', correlateDelayedOnly, 'var(--rust)', '')}</div>`;

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
        <div class="chiprow2" style="margin-bottom:8px;">
          ${r.flat.map(f=>`<span class="chip" style="color:${f.domain.color};">${escapeHtml(f.symptom)}${r.entry.nrs&&r.entry.nrs[f.domain.key]!=null?` ${r.entry.nrs[f.domain.key]}/10`:''}${r.entry.timing&&r.entry.timing[f.domain.key]?` · ${r.entry.timing[f.domain.key]}`:''}</span>`).join('')}
        </div>
        ${r.entry.provocation?`<div style="font-size:12px;margin-bottom:6px;">&#9873; ${escapeHtml(r.entry.provocation)}</div>`:''}
        <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-top:4px;">
          <div class="domainlabel" style="font-size:10px;margin-bottom:2px;">TRAINING THAT DAY</div>
          ${r.session ? `<div style="font-size:12px;">${escapeHtml(r.session.dayLabel)}</div>${loads?`<div style="font-family:var(--font-mono);font-size:11px;color:var(--brass);margin-top:2px;">${escapeHtml(loads)}</div>`:''}` : `<div style="font-size:12px;color:var(--text-faint);">No session logged</div>`}
        </div>
        ${(r.entry.settling||r.entry.tolerance||r.entry.followUp24h)?`<div style="font-family:var(--font-mono);font-size:10px;margin-top:8px;color:${r.entry.tolerance==='Worse than usual'?'var(--rust)':'var(--text-faint)'};">${[r.entry.settling,r.entry.tolerance].filter(Boolean).join(' · ').toUpperCase()}${r.entry.followUp24h?'  &#9873; 24H REVIEW':''}</div>`:''}
        ${(r.entry.breath&&r.entry.breath.length)?`<div style="font-family:var(--font-mono);font-size:10px;color:var(--sage);margin-top:6px;">${r.entry.breath.join(' · ').toUpperCase()}</div>`:''}
      </div>`;
    });
  }
  main.innerHTML = html;
  main.querySelectorAll('.corrFilterChip').forEach(b=>b.onclick=()=>{ correlateFilter = b.dataset.val; renderCorrelate(main); });
  const delayedChip = main.querySelector('.corrDelayedChip');
  if(delayedChip) delayedChip.onclick = ()=>{ correlateDelayedOnly = !correlateDelayedOnly; renderCorrelate(main); };
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
  document.getElementById('logDate').onchange = e=>{
    logState.date = e.target.value;
    const matchingDay = weekdayForISO(e.target.value);
    resetLogForDay(matchingDay);
    renderLog(main);
  };
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
  if(sorted.length === 0){ main.innerHTML = `<div class="emptystate">No sessions yet. Head to Log to add your first one.</div>`; return; }
  main.innerHTML = sorted.map(s=>{
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
  const sorted = [...sessions].sort((a,b)=>a.date.localeCompare(b.date));
  main.innerHTML = `<div class="section-label">Your big lifts over time</div><div id="biglifts-body"></div>`;
  const body = document.getElementById('biglifts-body');
  BIG_LIFT_DEFS.forEach(lift=>{
    const data = sorted.map(s=>({date:s.date, weight: topWeightForSession(s, lift.include, lift.exclude)})).filter(d=>d.weight!==null);
    const first = data[0]?.weight, last = data[data.length-1]?.weight;
    const delta = (first!==undefined && last!==undefined) ? Math.round((last-first)*100)/100 : null;
    const div = document.createElement('div');
    div.className = 'chartwrap';
    div.innerHTML = `
      <div class="liftheader">
        <div><div class="liftname">${lift.key}</div></div>
        <div><div class="liftvalue" style="color:${lift.color};">${last!==undefined?last+'kg':'—'}</div>
        ${delta!==null?`<div class="liftdelta" style="color:${delta>0?'var(--sage)':delta<0?'var(--rust)':'var(--text-faint)'};">${delta>0?'+':''}${delta}kg since ${formatAU(data[0].date)}</div>`:''}</div>
      </div>
      <div class="chart-slot"></div>
    `;
    body.appendChild(div);
    renderLineChart(div.querySelector('.chart-slot'), data, lift.color, lift.color.startsWith('var')?'#C49A45':lift.color, true);
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

// ---------- PROGRAM VIEW ----------
function renderProgram(main){
  let html = `<div class="section-label">Weekly split</div>`;
  DAY_ORDER.forEach(k=>{
    const d = PLAN[k];
    html += `<div class="progrow" style="margin-bottom:6px;">
      <div><div class="wk">${k.toUpperCase()}</div><div class="ph">${d.label}</div></div>
      <span class="pill" style="background:none;">${d.type.toUpperCase()}</span>
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
loadData();
loadCycleData();
renderAll();
