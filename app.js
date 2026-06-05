/* ===== State ===== */
let currentStep = 1;
const TOTAL_STEPS = 4;

const state = {
  date:'', weather:'', siteName:'', companyName:'', workerCount:1,
  workText:'',
  equipment:[], // [{name, count}]
  dangers:[],
  signatures:[]
};

/* ===== Init ===== */
async function isBrave() {
  try { return !!(navigator.brave && await navigator.brave.isBrave()); } catch { return false; }
}

document.addEventListener('DOMContentLoaded', async () => {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
  if (await isBrave()) {
    document.getElementById('brave-warning').style.display = 'block';
  }

  // 今日の日付
  const today = new Date();
  const ymd = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  document.getElementById('field-date').value = ymd;
  updateDayOfWeek();

  buildWeatherSelect();
  buildSiteSelect();
  buildEquipmentLists();
  showStep(1);
});

/* ===== 曜日 ===== */
function updateDayOfWeek() {
  const val = document.getElementById('field-date').value;
  const el = document.getElementById('day-of-week');
  if (!val) { el.textContent='－'; el.style.background='#94a3b8'; return; }
  const [y,m,d] = val.split('-').map(Number);
  const date = new Date(y,m-1,d);
  const days = ['日','月','火','水','木','金','土'];
  const colors = {0:'#c0392b',6:'#2563ab'};
  el.textContent = days[date.getDay()]+'曜';
  el.style.background = colors[date.getDay()]||'#0f4c81';
}

/* ===== 天気 ===== */
function buildWeatherSelect() {
  const sel = document.getElementById('field-weather');
  WEATHER_OPTIONS.forEach(w => { const o=document.createElement('option'); o.value=w; o.textContent=w; sel.appendChild(o); });
}

/* ===== 現場名 ===== */
function buildSiteSelect() {
  const sel = document.getElementById('field-site');
  SITE_NAMES.forEach(n => { const o=document.createElement('option'); o.value=n; o.textContent=n; sel.appendChild(o); });
  const other = document.createElement('option'); other.value='__other__'; other.textContent='その他（手入力）'; sel.appendChild(other);
}

function onSiteChange() {
  const val = document.getElementById('field-site').value;
  const otherInput = document.getElementById('field-site-other');
  otherInput.style.display = val==='__other__' ? 'block' : 'none';
}

/* ===== 重機・車両リスト ===== */
function buildEquipmentLists() {
  buildEquipList('backhoe-list', HEAVY_MACHINES, 'bh');
  buildEquipList('vehicle-list', VEHICLES, 'vh');

  // その他の台数プルダウン
  ['backhoe-other-count','vehicle-other-count'].forEach(id => {
    const sel = document.getElementById(id);
    UNIT_OPTIONS.forEach(n => { const o=document.createElement('option'); o.value=n; o.textContent=n+'台'; sel.appendChild(o); });
  });

  // その他チェックボックス
  buildOtherEquipItem('backhoe-list', 'backhoe-other-wrap', 'bh-other');
  buildOtherEquipItem('vehicle-list', 'vehicle-other-wrap', 'vh-other');
}

function buildEquipList(containerId, items, prefix) {
  const container = document.getElementById(containerId);
  items.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'equipment-item';
    div.id = `${prefix}-item-${i}`;

    const countSel = document.createElement('select');
    countSel.id = `${prefix}-count-${i}`;
    countSel.style.display = 'none';
    const defaultOpt = document.createElement('option');
    defaultOpt.value=''; defaultOpt.textContent='台数'; countSel.appendChild(defaultOpt);
    UNIT_OPTIONS.forEach(n => { const o=document.createElement('option'); o.value=n; o.textContent=n+'台'; countSel.appendChild(o); });

    div.innerHTML = `<input type="checkbox" id="${prefix}-cb-${i}"><label for="${prefix}-cb-${i}" style="margin:0;font-size:14px;font-weight:600;flex:1;">${item.name}</label>`;
    div.appendChild(countSel);

    div.querySelector('input').addEventListener('change', e => {
      div.classList.toggle('selected', e.target.checked);
      countSel.style.display = e.target.checked ? 'block' : 'none';
      if (!e.target.checked) countSel.value = '';
    });
    container.appendChild(div);
  });
}

function buildOtherEquipItem(listId, wrapId, cbId) {
  const container = document.getElementById(listId);
  const div = document.createElement('div');
  div.className = 'equipment-item';
  div.innerHTML = `<input type="checkbox" id="${cbId}"><label for="${cbId}" style="margin:0;font-size:14px;flex:1;">その他（手入力）</label>`;
  div.querySelector('input').addEventListener('change', e => {
    document.getElementById(wrapId).classList.toggle('visible', e.target.checked);
  });
  container.appendChild(div);
}

/* ===== Step Navigation ===== */
function showStep(step) {
  currentStep = step;
  document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`.step-panel[data-step="${step}"]`).classList.add('active');
  document.querySelectorAll('.step-dot').forEach((dot, idx) => {
    dot.classList.remove('active','done');
    if (idx+1===step) dot.classList.add('active');
    else if (idx+1<step) dot.classList.add('done');
  });
  document.querySelectorAll('.step-line').forEach((line,idx) => line.classList.toggle('done', idx+1<step));
  window.scrollTo({top:0,behavior:'smooth'});
}

async function goNext() {
  if (!validateStep(currentStep)) return;
  if (currentStep===2) { runAIAnalysis(); showStep(3); return; }
  if (currentStep===TOTAL_STEPS) { generatePDF(); return; }
  const prevStep = currentStep;
  showStep(currentStep + 1);
  // step4（署名）はstep4が表示されてからcanvas初期化（表示前だとwidth=0になる）
  if (prevStep === 3) await buildSignaturePads();
}

function goPrev() { if (currentStep>1) showStep(currentStep-1); }

/* ===== Validation ===== */
function validateStep(step) {
  if (step===1) {
    if (!document.getElementById('field-date').value) { showToast('日付を入力してください'); return false; }
    const site = getSiteName();
    if (!site) { showToast('現場名を選択または入力してください'); return false; }
    if (!document.getElementById('field-company').value.trim()) { showToast('会社名を入力してください'); return false; }
  }
  if (step===2) {
    if (!document.getElementById('field-work-input').value.trim()) { showToast('作業内容を入力してください'); return false; }
  }
  if (step===3) {
    if (!document.querySelectorAll('input[id^="danger-"]:checked').length) { showToast('危険のポイントを1つ以上選択してください'); return false; }
  }
  return true;
}

function getSiteName() {
  const sel = document.getElementById('field-site').value;
  if (sel==='__other__') return document.getElementById('field-site-other').value.trim();
  return sel;
}

/* ===== collectState ===== */
function collectState() {
  state.date = document.getElementById('field-date').value;
  state.weather = document.getElementById('field-weather').value;
  state.siteName = getSiteName();
  state.companyName = document.getElementById('field-company').value.trim();
  state.workerCount = parseInt(document.getElementById('field-workers').value)||1;
  state.workText = document.getElementById('field-work-input').value.trim();

  // 重機・車両収集
  state.equipment = [];
  // バックホウ
  HEAVY_MACHINES.forEach((item,i) => {
    const cb = document.getElementById(`bh-cb-${i}`);
    const cnt = document.getElementById(`bh-count-${i}`).value;
    if (cb?.checked && cnt) state.equipment.push({name:item.name, count:cnt+'台'});
  });
  const bhOther = document.getElementById('bh-other');
  if (bhOther?.checked) {
    const n = document.getElementById('backhoe-other-name').value.trim();
    const c = document.getElementById('backhoe-other-count').value;
    if (n && c) state.equipment.push({name:n, count:c+'台'});
  }
  // 車両
  VEHICLES.forEach((item,i) => {
    const cb = document.getElementById(`vh-cb-${i}`);
    const cnt = document.getElementById(`vh-count-${i}`).value;
    if (cb?.checked && cnt) state.equipment.push({name:item.name, count:cnt+'台'});
  });
  const vhOther = document.getElementById('vh-other');
  if (vhOther?.checked) {
    const n = document.getElementById('vehicle-other-name').value.trim();
    const c = document.getElementById('vehicle-other-count').value;
    if (n && c) state.equipment.push({name:n, count:c+'台'});
  }

  // 危険項目収集
  state.dangers = [];
  document.querySelectorAll('input[id^="danger-"]:checked').forEach(cb => {
    const i = parseInt(cb.id.replace('danger-',''));
    const item = DANGER_ITEMS[i];
    const measures = Array.from(document.querySelectorAll(`#danger-body-${i} .measure-item.selected .measure-text`)).map(el=>el.textContent.trim());
    const other = document.getElementById(`measure-other-${i}`)?.value.trim();
    if (other) measures.push(other);
    const riskBtn = document.querySelector(`#danger-body-${i} .risk-btn[class*="selected-"]`);
    state.dangers.push({ category:item.category, danger:item.danger, measures, risk: riskBtn?.textContent.trim()||'中' });
  });
}

/* ===== AI Analysis ===== */
function analyzeDangers(text) {
  const scores = new Array(DANGER_ITEMS.length).fill(0);
  KEYWORD_MAP.forEach(({idx,keywords}) => {
    keywords.forEach(kw => { if (text.includes(kw)) scores[idx]+=1; });
  });
  return scores.map((score,idx)=>({idx,score}));
}

async function runAIAnalysis() {
  const workText = document.getElementById('field-work-input').value.trim();
  // 重機テキストも分析に含める
  const equipText = HEAVY_MACHINES.map((m,i)=>document.getElementById(`bh-cb-${i}`)?.checked?m.name:'').join(' ')
    + VEHICLES.map((v,i)=>document.getElementById(`vh-cb-${i}`)?.checked?v.name:'').join(' ');
  const text = `水道工事 下水工事 掘削 道路 埋設 ${workText} ${equipText}`;

  document.getElementById('ai-analyzing').style.display='block';
  document.getElementById('ai-result').style.display='none';
  document.getElementById('step3-nav').style.display='none';

  const bar = document.getElementById('ai-progress-bar');
  let progress=0;
  const timer = setInterval(()=>{ progress=Math.min(progress+Math.random()*18,90); bar.style.width=progress+'%'; },120);
  await new Promise(r=>setTimeout(r,1600));
  clearInterval(timer); bar.style.width='100%';
  await new Promise(r=>setTimeout(r,300));

  const scored = analyzeDangers(text);
  const recommended = scored.filter(x=>x.score>0).sort((a,b)=>b.score-a.score).map(x=>x.idx);
  const others = scored.filter(x=>x.score===0).map(x=>x.idx);

  document.getElementById('recommend-container').innerHTML='';
  document.getElementById('other-container').innerHTML='';
  if (recommended.length===0) {
    document.getElementById('recommend-container').innerHTML='<p style="font-size:13px;color:#64748b;padding:10px;">下記からご選択ください。</p>';
  } else {
    recommended.forEach(i=>buildDangerCard(i,'recommend-container',false));
  }
  others.forEach(i=>buildDangerCard(i,'other-container',false));

  document.getElementById('ai-analyzing').style.display='none';
  document.getElementById('ai-result').style.display='block';
  document.getElementById('step3-nav').style.display='flex';
  updateDangerBadge();
  window.scrollTo({top:0,behavior:'smooth'});
}

function buildDangerCard(i, containerId, preChecked) {
  const item = DANGER_ITEMS[i];
  const container = document.getElementById(containerId);
  const div = document.createElement('div');
  div.className='danger-card'; div.id=`danger-card-${i}`;
  const measuresHTML = item.measures.map((m,mi)=>`
    <div class="measure-item" onclick="toggleMeasure(this)">
      <input type="checkbox" id="measure-${i}-${mi}">
      <span class="measure-text">${m}</span>
    </div>`).join('');
  div.innerHTML=`
    <div class="danger-header" onclick="toggleDangerCard(${i})">
      <input type="checkbox" id="danger-${i}" onclick="event.stopPropagation();onDangerToggle(${i},this)">
      <span class="danger-category">${item.category}</span>
      <span class="danger-text">${item.danger}</span>
    </div>
    <div class="danger-body" id="danger-body-${i}">
      <div style="font-size:12px;font-weight:600;color:#64748b;margin-bottom:6px;">対策を選択（複数可）</div>
      <div class="measures-list">${measuresHTML}</div>
      <textarea id="measure-other-${i}" placeholder="その他の対策を入力..." rows="2" style="margin-top:6px;font-size:13px;"></textarea>
      <div class="risk-level" style="margin-top:10px;">
        <label>リスクレベル</label>
        <div class="risk-btns">
          <button class="risk-btn" onclick="setRisk(${i},'大')" id="risk-${i}-高">大</button>
          <button class="risk-btn" onclick="setRisk(${i},'中')" id="risk-${i}-中">中</button>
          <button class="risk-btn" onclick="setRisk(${i},'小')" id="risk-${i}-小">小</button>
        </div>
      </div>
    </div>`;
  container.appendChild(div);
}

function toggleDangerCard(i) {
  const body=document.getElementById(`danger-body-${i}`);
  const cb=document.getElementById(`danger-${i}`);
  if(!cb.checked){cb.checked=true;onDangerToggle(i,cb);}
  body.classList.toggle('open');
}
function onDangerToggle(i,cb) {
  document.getElementById(`danger-body-${i}`).classList.toggle('open',cb.checked);
  updateDangerBadge();
}
function toggleMeasure(el) {
  const cb=el.querySelector('input[type=checkbox]'); cb.checked=!cb.checked; el.classList.toggle('selected',cb.checked);
}
function setRisk(i,level) {
  ['大','中','小'].forEach(l=>{const b=document.getElementById(`risk-${i}-${l==='大'?'高':l}`);if(b)b.className='risk-btn';});
  const colorMap={'大':'selected-high','中':'selected-mid','小':'selected-low'};
  const map={'大':'高','中':'中','小':'小'};
  const btn=document.getElementById(`risk-${i}-${map[level]}`);
  if(btn) btn.className=`risk-btn ${colorMap[level]}`;
}
function updateDangerBadge() {
  const count=document.querySelectorAll('input[id^="danger-"]:checked').length;
  const badge=document.getElementById('danger-badge');
  badge.textContent=count; badge.className='badge'+(count===0?' zero':'');
}

/* ===== Signature Pads ===== */
async function buildSignaturePads() {
  const count = parseInt(document.getElementById('field-workers').value)||1;
  const container = document.getElementById('sig-container');
  container.innerHTML='';
  document.getElementById('sig-count-info').textContent=`参加者 ${count} 名の署名欄。各自が署名してください。`;
  state.signatures=[];
  for(let i=0;i<count;i++){
    const card=document.createElement('div'); card.className='sig-card';
    card.innerHTML=`<div class="sig-card-header"><span class="sig-name-label">${i+1}番目の参加者</span><button class="sig-clear-btn" onclick="clearSig(${i})">消去</button></div>
      <div class="sig-canvas-wrapper"><canvas class="sig-canvas" id="sig-canvas-${i}"></canvas><div class="sig-hint">↑ ここに署名してください</div></div>`;
    container.appendChild(card);
  }
  // レンダリング完了を待ってからcanvasを初期化（iOS対策）
  await new Promise(r => setTimeout(r, 200));
  for(let i=0;i<count;i++){
    const canvas=document.getElementById(`sig-canvas-${i}`);
    const ratio=Math.max(window.devicePixelRatio||1,1);
    const w=canvas.parentElement?.offsetWidth-16||300;
    canvas.width=w*ratio; canvas.height=120*ratio;
    canvas.style.width=w+'px'; canvas.style.height='120px';
    canvas.getContext('2d').scale(ratio,ratio);
    const pad=new SignaturePad(canvas,{backgroundColor:'rgb(255,255,255)',penColor:'rgb(10,30,80)',minWidth:1,maxWidth:3});
    state.signatures.push({pad});
  }
}
function clearSig(i) { state.signatures[i]?.pad.clear(); }

/* ===== PDF Generation ===== */
async function generatePDF() {
  if (!validateStep(4)) return;
  const hasSig = state.signatures.some(s=>!s.pad.isEmpty());
  if (!hasSig) { showToast('少なくとも1名が署名してください'); return; }

  collectState();
  showLoading(true);
  await new Promise(r=>setTimeout(r,100));

  try {
    const [y,m,d] = state.date.split('-').map(Number);
    const dateObj = new Date(y,m-1,d);
    const dayNames = ['日','月','火','水','木','金','土'];
    const dayColors = {0:'#c0392b',6:'#2563ab'};
    const dayColor = dayColors[dateObj.getDay()]||'#0f4c81';
    const dateStr = `${y}年${m}月${d}日（${dayNames[dateObj.getDay()]}）`;
    const riskColorMap = {'大':'#c0392b','中':'#e67e22','小':'#27ae60'};

    const sigImgs = state.signatures.map(s=>(!s.pad.isEmpty())?s.pad.toDataURL('image/png'):'');

    const dangerRows = state.dangers.map(d=>{
      const rc=riskColorMap[d.risk]||'#888';
      const measures=d.measures.length>0?d.measures.map(m=>`<li>${m}</li>`).join(''):'<li style="color:#999">（対策未選択）</li>';
      return `<div style="border:1px solid #cbd5e1;border-radius:4px;margin-bottom:6px;overflow:hidden;">
        <div style="background:#fef2f2;padding:6px 10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="background:${rc};color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:3px;">${d.category}</span>
          <span style="font-size:13px;font-weight:600;flex:1;">${d.danger}</span>
          <span style="background:${rc};color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:3px;">リスク：${d.risk}</span>
        </div>
        <div style="padding:6px 12px;">
          <div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:3px;">【対策】</div>
          <ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.7;">${measures}</ul>
        </div></div>`;
    }).join('');

    const sigCells = sigImgs.map((img,i)=>`
      <div style="border:1px solid #cbd5e1;border-radius:4px;overflow:hidden;width:31%;margin:3px 1%;">
        <div style="background:#f0f4f8;font-size:11px;font-weight:600;color:#0f4c81;padding:3px 8px;">${i+1}番目の参加者</div>
        <div style="height:52px;background:#fff;display:flex;align-items:center;justify-content:center;">
          ${img?`<img src="${img}" style="max-width:100%;max-height:48px;object-fit:contain;">`:''}
        </div></div>`).join('');

    const equipRows = state.equipment.length>0
      ? state.equipment.map(e=>`<span style="display:inline-block;background:#f0f4f8;color:#374151;font-size:12px;padding:2px 8px;border-radius:3px;margin:2px;border:1px solid #cbd5e1;">${e.name}　${e.count}</span>`).join('')
      : '（なし）';

    const html=`<div id="pdf-report" style="width:794px;background:#fff;padding:18px 24px;font-family:'Hiragino Kaku Gothic ProN',sans-serif;font-size:13px;color:#1a202c;box-sizing:border-box;">
      <div style="background:#0f4c81;color:#fff;text-align:center;padding:10px;border-radius:6px 6px 0 0;font-size:17px;font-weight:700;">KY活動表（危険予知活動記録）－水道・下水工事</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:10px;">
        <colgroup><col style="width:13%"><col style="width:55%"><col style="width:13%"><col style="width:19%"></colgroup>
        <tr>
          <td style="background:#dce6f1;font-weight:700;color:#0f4c81;padding:6px 9px;border:1px solid #8096b4;">実施日</td>
          <td style="padding:6px 9px;border:1px solid #8096b4;">${dateStr}<span style="background:${dayColor};color:#fff;font-weight:700;font-size:12px;padding:1px 7px;border-radius:4px;margin-left:7px;">${dayNames[dateObj.getDay()]}曜</span></td>
          <td style="background:#dce6f1;font-weight:700;color:#0f4c81;padding:6px 9px;border:1px solid #8096b4;">天気</td>
          <td style="padding:6px 9px;border:1px solid #8096b4;">${state.weather||'—'}</td>
        </tr>
        <tr>
          <td style="background:#dce6f1;font-weight:700;color:#0f4c81;padding:6px 9px;border:1px solid #8096b4;">現場名</td>
          <td style="padding:6px 9px;border:1px solid #8096b4;">${state.siteName}</td>
          <td style="background:#dce6f1;font-weight:700;color:#0f4c81;padding:6px 9px;border:1px solid #8096b4;">参加人数</td>
          <td style="padding:6px 9px;border:1px solid #8096b4;font-weight:700;">${state.workerCount}名</td>
        </tr>
        <tr>
          <td style="background:#dce6f1;font-weight:700;color:#0f4c81;padding:6px 9px;border:1px solid #8096b4;">会社名</td>
          <td colspan="3" style="padding:6px 9px;border:1px solid #8096b4;">${state.companyName}</td>
        </tr>
      </table>
      <div style="background:#0f4c81;color:#fff;padding:6px 12px;border-radius:4px 4px 0 0;font-size:13px;font-weight:700;">■ 作業内容・使用重機車両</div>
      <div style="border:1px solid #8096b4;border-top:none;border-radius:0 0 4px 4px;padding:8px 12px;margin-bottom:10px;line-height:1.7;">
        <div style="margin-bottom:5px;"><span style="background:#64748b;color:#fff;font-size:11px;font-weight:700;padding:2px 9px;border-radius:3px;margin-right:8px;">作業内容</span><span style="font-size:18px;font-weight:700;color:#1e3a8a;">${state.workText}</span></div>
        <div><span style="background:#64748b;color:#fff;font-size:11px;font-weight:700;padding:2px 9px;border-radius:3px;margin-right:8px;">使用重機・車両</span>${equipRows}</div>
      </div>
      <div style="background:#0f4c81;color:#fff;padding:6px 12px;border-radius:4px 4px 0 0;font-size:13px;font-weight:700;margin-bottom:8px;">■ 危険のポイントと対策</div>
      ${dangerRows}
      <div style="background:#0f4c81;color:#fff;padding:6px 12px;border-radius:4px 4px 0 0;font-size:13px;font-weight:700;margin-top:8px;margin-bottom:8px;">■ 参加者署名</div>
      <div style="display:flex;flex-wrap:wrap;">${sigCells}</div>
      <div style="text-align:center;font-size:10px;color:#94a3b8;margin-top:10px;padding-top:8px;border-top:1px solid #e2e8f0;">作成日時：${new Date().toLocaleString('ja-JP')}　　KY活動表アプリ（水道・下水）</div>
    </div>`;

    const wrapper=document.createElement('div');
    wrapper.style.cssText='position:fixed;left:-9999px;top:0;z-index:-1;';
    wrapper.innerHTML=html; document.body.appendChild(wrapper);

    const canvas=await html2canvas(wrapper.querySelector('#pdf-report'),{scale:2,useCORS:true,backgroundColor:'#ffffff',logging:false});
    document.body.removeChild(wrapper);

    const {jsPDF}=window.jspdf;
    const pdfW=210,pageH=297;
    const contentH=Math.round((canvas.height/canvas.width)*pdfW);
    const finalH=Math.min(contentH,pageH);
    const doc=new jsPDF({orientation:'p',unit:'mm',format:'a4'});
    doc.addImage(canvas.toDataURL('image/jpeg',0.92),'JPEG',0,0,pdfW,finalH);

    const fn=`KY活動表_${state.date}_${state.companyName}.pdf`;
    const pdfBase64=doc.output('datauristring').split(',')[1];
    const binary=atob(pdfBase64);
    const bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
    const pdfBlob=new Blob([bytes],{type:'application/pdf'});

    showLoading(false);
    showStep(5);

    await uploadToGDrive(pdfBlob, fn);

    const dlBtn=document.getElementById('pdf-download-btn');
    if(dlBtn){dlBtn.style.display='flex';dlBtn.onclick=()=>doc.save(fn);}

  } catch(err) {
    showLoading(false);
    console.error(err);
    showToast('PDF生成に失敗しました: '+err.message);
  }
}

/* ===== Google Drive Upload ===== */
async function uploadToGDrive(pdfBlob, fileName) {
  const statusEl=document.getElementById('gdrive-status');
  const setStatus=(msg,color)=>{ if(statusEl){statusEl.textContent=msg;statusEl.style.color=color||'#0f4c81';} showToastLong(msg); };
  try {
    setStatus('📤 Google Driveにアップロード中...','#0f4c81');
    const pdfBase64=await new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(reader.result.split(',')[1]);
      reader.onerror=reject;
      reader.readAsDataURL(pdfBlob);
    });
    const res=await fetch('/api/upload-v2',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({pdfBase64,fileName,siteName:state.siteName,date:state.date}),
    });
    const resText=await res.text();
    if(!res.ok) throw new Error(`サーバーエラー(${res.status}): ${resText.slice(0,100)}`);
    const data=JSON.parse(resText);
    if(!data.success) throw new Error(data.error);
    setStatus(`✅ Google Driveに保存完了！\n📁 ${state.siteName}/${state.date}/`,'#27ae60');
  } catch(err) {
    console.error(err);
    setStatus(`❌ ${err.message}`,'#c0392b');
  }
}

function showToastLong(msg) {
  const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer=setTimeout(()=>t.classList.remove('show'),8000);
}

/* ===== UI Helpers ===== */
function showLoading(on) { document.getElementById('loading-overlay').classList.toggle('active',on); }
let toastTimer;
function showToast(msg) {
  const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('show'),3000);
}

/* ===== QR Code ===== */
let _qrInstance=null;
function openQR() {
  const url=location.href.replace(/\/$/,'');
  document.getElementById('qr-url-text').textContent=url;
  const container=document.getElementById('qr-container');
  container.innerHTML='';
  if(typeof QRCode!=='undefined') {
    new QRCode(container,{text:url,width:220,height:220,colorDark:'#0f4c81',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M});
  }
  document.getElementById('qr-modal-bg').classList.add('open');
}
function closeQR() { document.getElementById('qr-modal-bg').classList.remove('open'); }
function closeQROnBg(e) { if(e.target===document.getElementById('qr-modal-bg')) closeQR(); }

/* ===== Reset ===== */
function resetApp() {
  const today=new Date();
  document.getElementById('field-date').value=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  updateDayOfWeek();
  document.getElementById('field-weather').selectedIndex=0;
  document.getElementById('field-site').selectedIndex=0;
  document.getElementById('field-site-other').value='';
  document.getElementById('field-site-other').style.display='none';
  document.getElementById('field-company').value='';
  document.getElementById('field-workers').value=1;
  document.getElementById('field-work-input').value='';

  // 重機リセット
  document.querySelectorAll('[id^=bh-cb-],[id^=vh-cb-]').forEach(cb=>{cb.checked=false;});
  document.querySelectorAll('[id^=bh-count-],[id^=vh-count-]').forEach(sel=>{sel.value='';sel.style.display='none';});
  document.querySelectorAll('.equipment-item.selected').forEach(el=>el.classList.remove('selected'));
  document.getElementById('bh-other').checked=false;
  document.getElementById('vh-other').checked=false;
  document.getElementById('backhoe-other-wrap').classList.remove('visible');
  document.getElementById('vehicle-other-wrap').classList.remove('visible');
  document.getElementById('backhoe-other-name').value='';
  document.getElementById('vehicle-other-name').value='';

  // 危険項目リセット
  document.getElementById('recommend-container').innerHTML='';
  document.getElementById('other-container').innerHTML='';
  document.getElementById('ai-analyzing').style.display='none';
  document.getElementById('ai-result').style.display='none';
  document.getElementById('step3-nav').style.display='none';
  const badge=document.getElementById('danger-badge');
  if(badge){badge.textContent='0';badge.className='badge zero';}

  // 署名リセット
  document.getElementById('sig-container').innerHTML='';
  const dlBtn=document.getElementById('pdf-download-btn');
  if(dlBtn) dlBtn.style.display='none';
  const st=document.getElementById('gdrive-status');
  if(st) st.textContent='📤 Google Driveにアップロード中...';

  showStep(1);
}
