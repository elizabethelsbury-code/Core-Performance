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
    {id:'history', label:'History', ic:'&#128337;'},
    {id:'progress', label:'Progress', ic:'&#128200;'},
    {id:'biglifts', label:'Big lifts', ic:'&#127942;'},
    {id:'program', label:'Program', ic:'&#128203;'},
  ];
  document.getElementById('navbar').innerHTML = tabs.map(t=>
    `<button class="navbtn ${view===t.id?'active':''}" data-view="${t.id}"><span class="ic">${t.ic}</span>${t.label}</button>`
  ).join('');
  document.querySelectorAll('.navbtn').forEach(b=>{
    b.onclick = ()=>{ view = b.dataset.view; renderAll(); };
  });
}

function renderAll(){
  renderHeader();
  renderNav();
  const main = document.getElementById('mainContent');
  if(view === 'log') renderLog(main);
  else if(view === 'history') renderHistory(main);
  else if(view === 'progress') renderProgress(main);
  else if(view === 'biglifts') renderBigLifts(main);
  else if(view === 'program') renderProgram(main);
}

// ---------- LOG VIEW ----------
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

  html += `<div class="field" style="margin-bottom:14px;"><label>Warm-up</label><input type="text" id="logWarmup" placeholder="e.g. 6 min incline walk" value="${escapeAttr(logState.warmup)}"></div>`;

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
        <div class="field"><label>Distance (km)</label><input type="text" inputmode="decimal" id="cardioDist" value="${escapeAttr(logState.cardio.distance)}" placeholder="5.06"></div>
        <div class="field"><label>Time (mm:ss)</label><input type="text" id="cardioTime" value="${escapeAttr(logState.cardio.time)}" placeholder="25:13"></div>
      </div>
      <div class="field" style="margin-top:10px;"><label>Notes</label><input type="text" id="cardioNote" value="${escapeAttr(logState.cardio.note)}" placeholder="Effort, how it felt…"></div>
    </div>`;
  }

  html += `<div class="field" style="margin:14px 0;"><label>Session notes</label><textarea id="logNote" rows="2" placeholder="Niggles, form notes…">${escapeHtml(logState.note)}</textarea></div>`;

  main.innerHTML = html;
  document.getElementById('logDate').onchange = e=>{ logState.date = e.target.value; };
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
      <input class="w set-field" data-field="weight" placeholder="kg" value="${escapeAttr(s.weight)}">
      <span style="color:var(--text-faint);font-size:12px;">×</span>
      <input class="r set-field" data-field="reps" placeholder="reps" value="${escapeAttr(s.reps)}">
      <select class="set-field" data-field="rir">
        <option value="">RIR</option>
        ${['0-1','2-3','4-5','Failure'].map(r=>`<option value="${r}" ${s.rir===r?'selected':''}>${r}</option>`).join('')}
      </select>
      <input class="n set-field" data-field="note" placeholder="note" value="${escapeAttr(s.note)}">
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
renderAll();
