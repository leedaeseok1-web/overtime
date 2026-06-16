const KRW = n => (Math.round(n)||0).toLocaleString('ko-KR') + '원';
const today = new Date();
const ym = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
const KEY = 'dh_overtime_pro_v19';
const defaultData = {
  settings:{
    normalRate:20000,
    halfRate:10000,
    holidayFixed:150000,
    minuteCarry:true,
    holidayAuto:true,
    // 주말은 자동 빨간날 처리. 법정공휴일은 기본값으로 넣어두고, 설정에서 추가/수정 가능.
    holidays:['2026-01-01','2026-02-16','2026-02-17','2026-02-18','2026-03-01','2026-03-02','2026-05-05','2026-05-24','2026-06-03','2026-06-06','2026-08-15','2026-08-17','2026-09-24','2026-09-25','2026-09-26','2026-10-03','2026-10-05','2026-10-09','2026-12-25'],
    workTypes:['야간특근','휴일근무']
  },
  employees:[],
  records:[]
};
let state = JSON.parse(localStorage.getItem(KEY) || 'null') || defaultData;
let selectedType = state.settings.workTypes[0];
const save = () => localStorage.setItem(KEY, JSON.stringify(state));
const $ = id => document.getElementById(id);
$('globalMonth').value = ym;
function parseTimeInput(v){
  if(!v) return '';
  let raw = String(v).trim().replace(/\s+/g,'');
  let pm = raw.includes('오후') || /pm/i.test(raw);
  let am = raw.includes('오전') || /am/i.test(raw);
  raw = raw.replace(/오전|오후|AM|PM|am|pm/g,'');
  let h, m=0;
  if(raw.includes(':')){
    const parts = raw.split(':'); h = Number(parts[0]); m = Number(parts[1]||0);
  }else{
    const digits = raw.replace(/[^0-9]/g,'');
    if(!digits) return '';
    if(digits.length <= 2){ h = Number(digits); m = 0; }
    else { h = Number(digits.slice(0,-2)); m = Number(digits.slice(-2)); }
  }
  if(!Number.isFinite(h) || !Number.isFinite(m)) return '';
  if(pm && h < 12) h += 12;
  if(am && h === 12) h = 0;
  if(h < 0 || h > 23 || m < 0 || m > 59) return '';
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
function normalizeTimeInput(id){
  const el=$(id); const t=parseTimeInput(el.value);
  if(t) el.value=t;
  return t;
}
function setFullDayTimes(){
  if($('fullDayWork') && $('fullDayWork').checked){ $('startTime').value='08:00'; $('endTime').value='17:00'; }
}
function updateFullDayVisibility(){
  const line=document.querySelector('.fullDayLine'); if(!line || !$('date')) return;
  const holiday=$('date').value && isHoliday($('date').value);
  line.style.display=holiday ? 'flex' : 'none';
  if(!holiday && $('fullDayWork')) $('fullDayWork').checked=false;
  if($('fullDayWork') && $('fullDayWork').checked) setFullDayTimes();
}

function isHoliday(dateStr){ const d=new Date(dateStr+'T00:00'); const weekend=d.getDay()===0||d.getDay()===6; return weekend || state.settings.holidays.includes(dateStr); }
function isWeekendOrHoliday(dateStr){ return isHoliday(dateStr); }
function autoTypeByDateTime(){
  const date = $('date').value;
  const start = $('startTime').value;
  if(!date || !start) return;
  if(isWeekendOrHoliday(date)){
    selectedType='휴일근무';
  }else if(toMin(start) >= 17*60){
    selectedType='야간특근';
  }else{
    selectedType='야간특근';
  }
  renderTypes();
}

function hoursBetween(s,e){ let [sh,sm]=s.split(':').map(Number), [eh,em]=e.split(':').map(Number); let a=sh*60+sm,b=eh*60+em; if(b<a)b+=1440; return (b-a)/60; }
function minutesBetween(s,e){ let a=toMin(s), b=toMin(e); if(b<a)b+=1440; return b-a; }
function toMin(t){ const [h,m]=t.split(':').map(Number); return h*60+m; }
function overlapMinutes(s,e,os,oe){ let a=toMin(s), b=toMin(e); if(b<a)b+=1440; return Math.max(0,Math.min(b,oe)-Math.max(a,os)); }
function overlapHours(s,e,os,oe){ return overlapMinutes(s,e,os,oe)/60; }
function rateFor(record, emp){ return (!isHoliday(record.date) && emp.payType==='half') ? state.settings.halfRate : state.settings.normalRate; }
function minutePay(mins, rate){ if(!state.settings.minuteCarry) return (mins/60)*rate; return Math.floor(mins/60)*rate; }
function payParts(record, emp){
  const holiday=isHoliday(record.date);
  if(holiday){
    const fixed=overlapMinutes(record.startTime,record.endTime,8*60,17*60)>0 ? state.settings.holidayFixed : 0;
    const afterMins=overlapMinutes(record.startTime,record.endTime,17*60,24*60);
    const rate=state.settings.normalRate;
    return {base:fixed+minutePay(afterMins,rate), remainders:{[rate]: state.settings.minuteCarry ? afterMins%60 : 0}};
  }
  const mins=minutesBetween(record.startTime,record.endTime);
  const rate=rateFor(record,emp);
  return {base:minutePay(mins,rate), remainders:{[rate]: state.settings.minuteCarry ? mins%60 : 0}};
}
function calcPay(record, emp){ return payParts(record,emp).base; }
function employeeMonthSettlement(emp){
  const remainders={}; let base=0;
  monthRecords().filter(r=>r.participants.includes(emp.id)).forEach(r=>{
    const p=payParts(r,emp); base+=p.base;
    Object.entries(p.remainders).forEach(([rate,min])=>remainders[rate]=(remainders[rate]||0)+min);
  });
  let carryPay=0, carryText=[];
  Object.entries(remainders).forEach(([rate,min])=>{ const h=Math.floor(min/60); const rem=min%60; if(h) carryPay+=h*Number(rate); if(min) carryText.push(`${h}시간 지급 / 잔여 ${rem}분`); });
  return {base, carryPay, total:base+carryPay, carryText:carryText.join(' · ')||'잔여분 없음'};
}
function monthlyGrandTotal(){ return state.employees.filter(e=>e.active).reduce((s,e)=>s+employeeMonthSettlement(e).total,0); }
function recordTotal(r){ return r.participants.reduce((sum,id)=>{const emp=state.employees.find(e=>e.id===id); return sum+(emp?calcPay(r,emp):0)},0); }
function monthRecords(){ const m=$('globalMonth').value; return state.records.filter(r=>r.date.startsWith(m)).sort((a,b)=>a.date.localeCompare(b.date)); }
function renderAll(){ renderTypes(); renderParticipants(); renderDashboard(); renderStatement(); renderCalendar(); renderEmployeeList(); renderEmployeeSummary(); renderSiteSummary(); renderSettings(); updateCalc(); }
function renderTypes(){ const box=$('typeChips'); box.innerHTML=''; state.settings.workTypes.forEach(t=>{const b=document.createElement('button');b.type='button';b.className='chip '+(t===selectedType?'active':'');b.textContent=t;b.onclick=()=>{selectedType=t;renderTypes()};box.appendChild(b)}); }
function renderParticipants(){ const box=$('participantBox'); box.innerHTML=''; state.employees.filter(e=>e.active).forEach(e=>{const label=document.createElement('label');label.className='person';label.innerHTML=`<input type="checkbox" value="${e.id}" class="part"> <span>${e.name} <small>${e.payType==='half'?'평일절반':''}</small></span>`;box.appendChild(label)}); document.querySelectorAll('.part').forEach(c=>c.onchange=updateCalc); }
function currentFormRecord(){
  const full = $('fullDayWork') && $('fullDayWork').checked;
  const st = full ? '08:00' : (parseTimeInput($('startTime').value) || $('startTime').value);
  const et = full ? '17:00' : (parseTimeInput($('endTime').value) || $('endTime').value);
  return {date:$('date').value,site:$('site').value,type:selectedType,workName:$('workName').value,startTime:st,endTime:et,note:$('note').value,fullDay:!!full,participants:[...document.querySelectorAll('.part:checked')].map(c=>Number(c.value))};
}
function updateCalc(){ setFullDayTimes(); const r=currentFormRecord(); const box=$('calcPreview'); if(!parseTimeInput(r.startTime)||!parseTimeInput(r.endTime)){box.innerHTML='<p class="muted">시간은 18:00 또는 1800 형식으로 입력해주세요.</p>';return} if(!r.date||!r.startTime||!r.endTime||!r.participants.length){box.innerHTML='<p class="muted">날짜, 시간, 참석자를 선택하면 자동계산됩니다.</p>';return} let total=0; box.innerHTML=r.participants.map(id=>{const e=state.employees.find(x=>x.id===id); const pay=calcPay(r,e); total+=pay; return `<div class="calcRow"><span>${e.name}</span><strong>${KRW(pay)}</strong></div>`}).join('')+`<div class="calcRow"><span>합계</span><strong>${KRW(total)}</strong></div>`; }
['date','startTime','endTime'].forEach(id=>$(id).addEventListener('change',()=>{ if(id!=='date') normalizeTimeInput(id); updateFullDayVisibility(); autoTypeByDateTime(); updateCalc(); }));
['startTime','endTime'].forEach(id=>$(id).addEventListener('blur',()=>{ normalizeTimeInput(id); autoTypeByDateTime(); updateCalc(); }));
if($('fullDayWork')) $('fullDayWork').addEventListener('change',()=>{ setFullDayTimes(); autoTypeByDateTime(); updateCalc(); });
$('overtimeForm').onsubmit=e=>{e.preventDefault(); setFullDayTimes(); normalizeTimeInput('startTime'); normalizeTimeInput('endTime'); const r=currentFormRecord(); if(!parseTimeInput(r.startTime)||!parseTimeInput(r.endTime)){alert('시간 형식을 확인해주세요. 예: 18:00 또는 1800');return} if(!r.participants.length){alert('참석자를 선택해주세요.');return} const edit=$('editId').value; if(edit){ const i=state.records.findIndex(x=>x.id==edit); state.records[i]={...state.records[i],...r}; } else { state.records.push({...r,id:Date.now()}); } save(); clearForm(); renderAll(); alert('저장되었습니다.'); };
function clearForm(){ $('overtimeForm').reset(); $('date').value=new Date().toISOString().slice(0,10); $('startTime').value='18:00'; $('endTime').value='22:00'; if($('fullDayWork')) $('fullDayWork').checked=false; $('editId').value=''; document.querySelectorAll('.part').forEach(c=>c.checked=false); updateFullDayVisibility(); autoTypeByDateTime(); updateCalc(); }
$('clearForm').onclick=clearForm; $('selectAllEmployees').onclick=()=>{const all=[...document.querySelectorAll('.part')]; const any=all.some(c=>!c.checked); all.forEach(c=>c.checked=any); updateCalc();};
function renderDashboard(){ const rec=monthRecords(); const total=monthlyGrandTotal(); const people=new Set(rec.flatMap(r=>r.participants)); $('dashTotal').textContent=KRW(total); $('dashCount').textContent=rec.length+'건'; $('dashPeople').textContent=people.size+'명'; if($('dashHoliday')) $('dashHoliday').textContent=rec.filter(r=>r.type==='휴일근무').length+'건'; $('recentList').innerHTML=rec.slice(-6).reverse().map(r=>`<div class="recentRow"><span>${r.date.slice(5)} (${['일','월','화','수','목','금','토'][new Date(r.date+'T00:00').getDay()]})</span><span class="badge ${r.type}">${r.type}</span><span>${r.site}</span><span>${r.workName||''}</span><strong class="money">${KRW(recordTotal(r))}</strong></div>`).join('')||'<p class="muted">등록된 내역이 없습니다.</p>'; }
function renderStatement(){
  const rec=monthRecords();
  const emps=state.employees.filter(e=>e.active);
  $('statementTitle').textContent=$('globalMonth').value.replace('-','년 ')+'월 특근명세서';
  let html='<thead><tr><th class="dateCol">날짜</th><th class="typeCol">구분</th><th class="siteCol">현장명</th><th class="workCol">작업내용</th><th class="timeCol">시간</th><th class="amountCol">금액</th>'+emps.map(e=>`<th class="empCol">${e.name}</th>`).join('')+'<th class="manageCol">관리</th></tr></thead><tbody>';
  rec.forEach(r=>{
    const dayClass=isHoliday(r.date)?'holidayDate':'';
    html+=`<tr><td class="dateCol ${dayClass}">${r.date.slice(5)}</td><td class="typeCol">${r.type}</td><td class="siteCol">${r.site}</td><td class="workCol nameCell">${r.workName||''}</td><td class="timeCol">${r.startTime}~${r.endTime}</td><td class="amountCol">${KRW(recordTotal(r))}</td>`+
      emps.map(e=>`<td class="empCol">${r.participants.includes(e.id)?'○':''}</td>`).join('')+
      `<td class="manageCol"><button class="ghost small" onclick="editRecord(${r.id})">수정</button> <button class="ghost small danger" onclick="deleteRecord(${r.id})">삭제</button></td></tr>`;
  });
  html+='</tbody><tfoot><tr><th colspan="6">직원별 합계</th>'+emps.map(e=>`<th class="empCol">${KRW(employeeMonthSettlement(e).total)}</th>`).join('')+'<th></th></tr>'+
    (state.settings.minuteCarry?'<tr><th colspan="6">분단위 이월정산</th>'+emps.map(e=>`<th class="empCol"><small>${employeeMonthSettlement(e).carryText}</small></th>`).join('')+'<th></th></tr>':'')+'</tfoot>';
  $('statementTable').innerHTML=html;
}
window.editRecord=id=>{ const r=state.records.find(x=>x.id===id); showPage('register'); $('editId').value=r.id; $('date').value=r.date; $('site').value=r.site; $('workName').value=r.workName; $('startTime').value=r.startTime; $('endTime').value=r.endTime; $('note').value=r.note; if($('fullDayWork')) $('fullDayWork').checked=!!r.fullDay; updateFullDayVisibility(); selectedType=r.type; renderTypes(); document.querySelectorAll('.part').forEach(c=>c.checked=r.participants.includes(Number(c.value))); updateCalc(); };
window.deleteRecord=id=>{ if(confirm('삭제할까요?')){state.records=state.records.filter(r=>r.id!==id); save(); renderAll();} };
function buildCalendarHtml(){ const m=$('globalMonth').value; const [y,mo]=m.split('-').map(Number); const first=new Date(y,mo-1,1); const last=new Date(y,mo,0).getDate(); const names=['일','월','화','수','목','금','토']; let html=names.map((n,i)=>`<div class="dayName ${i===0?'sun':i===6?'sat':''}">${n}</div>`).join(''); for(let i=0;i<first.getDay();i++) html+='<div class="day empty"></div>'; for(let d=1;d<=last;d++){ const ds=`${m}-${String(d).padStart(2,'0')}`; const wd=new Date(ds+'T00:00').getDay(); const holiday=state.settings.holidays.includes(ds); const classes=['day']; if(wd===0) classes.push('sun'); if(wd===6) classes.push('sat'); if(holiday) classes.push('holiday'); const rec=state.records.filter(r=>r.date===ds); html+=`<div class="${classes.join(' ')}"><div class="num">${d}</div>${holiday?'<small class="holidayLabel">공휴일</small>':''}${rec.map(r=>`<span class="eventPill ${r.type}">${r.type} ${rec.length>1?'':KRW(recordTotal(r))}</span>`).join('')}</div>`; } return html; }
function renderCalendar(){ const m=$('globalMonth').value; const [y,mo]=m.split('-').map(Number); if($('calendarTitle')) $('calendarTitle').textContent=`${y}년 ${mo}월 특근캘린더`; if($('miniCalendarTitle')) $('miniCalendarTitle').textContent=`${y}년 ${mo}월`; const html=buildCalendarHtml(); if($('calendarGrid')) $('calendarGrid').innerHTML=html; if($('calendarGridFull')) $('calendarGridFull').innerHTML=html; }
function renderEmployeeList(){ $('employeeList').innerHTML=state.employees.map(e=>`<div class="listItem"><div><strong>${e.name}</strong> <span class="badge">${e.payType==='half'?'평일절반':'일반'}</span><br><small>${e.position||''}</small></div><div class="itemBtns"><button class="ghost small" onclick="editEmployee(${e.id})">수정</button><button class="ghost small danger" onclick="removeEmployee(${e.id})">삭제</button></div></div>`).join(''); }
$('employeeForm').onsubmit=e=>{e.preventDefault(); const edit=$('empEditId').value; const obj={name:$('empName').value,position:$('empPosition').value,payType:$('empPayType').value,active:true}; if(edit){Object.assign(state.employees.find(x=>x.id==edit),obj)} else state.employees.push({...obj,id:Date.now()}); save(); $('employeeForm').reset(); $('empEditId').value=''; renderAll();};
window.editEmployee=id=>{const e=state.employees.find(x=>x.id===id); $('empEditId').value=e.id; $('empName').value=e.name; $('empPosition').value=e.position; $('empPayType').value=e.payType;};
window.removeEmployee=id=>{if(confirm('직원을 삭제할까요? 기존 기록의 참석 표시는 유지되지 않을 수 있습니다.')){state.employees=state.employees.filter(e=>e.id!==id); save(); renderAll();}};
$('empClear').onclick=()=>{$('employeeForm').reset();$('empEditId').value=''};
function renderEmployeeSummary(){ const sel=$('employeeFilter'); const old=sel.value; sel.innerHTML=state.employees.map(e=>`<option value="${e.id}">${e.name}</option>`).join(''); if(old)sel.value=old; const emp=state.employees.find(e=>e.id==sel.value)||state.employees[0]; if(!emp){ $('employeeDetail').innerHTML='<p class="muted">등록된 직원이 없습니다.</p>'; return; } const rec=monthRecords().filter(r=>r.participants.includes(emp.id)); $('employeeDetail').innerHTML=`<h3>${emp.name}</h3>`+rec.map(r=>`<div class="listItem"><span>${r.date.slice(5)} ${r.type} ${r.site}</span><strong>${KRW(calcPay(r,emp))}</strong></div>`).join('')+`<div class="listItem"><span>분단위 이월정산</span><small>${employeeMonthSettlement(emp).carryText}</small></div><div class="listItem"><strong>합계</strong><strong>${KRW(employeeMonthSettlement(emp).total)}</strong></div>`; }
$('employeeFilter').onchange=renderEmployeeSummary;
function renderSiteSummary(){ const map={}; monthRecords().forEach(r=>{map[r.site]=map[r.site]||{count:0,total:0,types:{}};map[r.site].count++;map[r.site].total+=recordTotal(r);map[r.site].types[r.type]=(map[r.site].types[r.type]||0)+1}); $('siteSummaryList').innerHTML=Object.entries(map).map(([site,v])=>`<div class="listItem"><div><strong>${site}</strong><br><small>${Object.entries(v.types).map(([k,c])=>`${k} ${c}건`).join(' · ')}</small></div><strong>${KRW(v.total)}</strong></div>`).join('')||'집계 내역이 없습니다.'; }
function renderSettings(){ $('normalRate').value=state.settings.normalRate; $('halfRate').value=state.settings.halfRate; $('holidayFixed').value=state.settings.holidayFixed; $('minuteCarry').checked=state.settings.minuteCarry!==false; $('holidays').value=state.settings.holidays.join('\n'); if($('holidayAuto')) $('holidayAuto').checked=state.settings.holidayAuto!==false; $('workTypes').value=state.settings.workTypes.join(','); }
$('settingsForm').onsubmit=e=>{e.preventDefault(); state.settings.normalRate=Number($('normalRate').value); state.settings.halfRate=Number($('halfRate').value); state.settings.holidayFixed=Number($('holidayFixed').value); state.settings.minuteCarry=$('minuteCarry').checked; state.settings.holidays=$('holidays').value.split(/\s+/).filter(Boolean); state.settings.workTypes=$('workTypes').value.split(',').map(x=>x.trim()).filter(Boolean).filter(x=>['야간특근','휴일근무'].includes(x)); if(!state.settings.workTypes.length) state.settings.workTypes=['야간특근','휴일근무']; autoTypeByDateTime(); save(); renderAll(); alert('설정 저장되었습니다.');};
function showPage(id){ document.querySelectorAll('.page').forEach(p=>p.classList.remove('show')); $(id).classList.add('show'); document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n.dataset.page===id)); window.scrollTo({top:0,behavior:'smooth'}); }
document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>showPage(b.dataset.page)); document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>showPage(b.dataset.go)); $('globalMonth').onchange=renderAll; $('printStatement').onclick=()=>window.print();
function setMonthOffset(offset){
  const input=$('globalMonth');
  const [y,m]=input.value.split('-').map(Number);
  const d=new Date(y,m-1+offset,1);
  input.value=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  renderAll();
}
function setThisMonth(){
  const now=new Date();
  $('globalMonth').value=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  renderAll();
}
document.querySelectorAll('.monthPrev').forEach(b=>b.addEventListener('click',()=>setMonthOffset(-1)));
document.querySelectorAll('.monthNext').forEach(b=>b.addEventListener('click',()=>setMonthOffset(1)));
document.querySelectorAll('.goToday').forEach(b=>b.addEventListener('click',setThisMonth));


function exportExcelStatement(){
  const rec=monthRecords();
  const emps=state.employees.filter(e=>e.active);
  const ymText=$('globalMonth').value.replace('-','년 ')+'월 특근명세서';
  const colgroup = '<col style="width:70px"><col style="width:72px"><col style="width:72px"><col style="width:80px"><col style="width:86px"><col style="width:78px">' + emps.map(()=>'<col style="width:72px">').join('');
  let table = `<table><colgroup>${colgroup}</colgroup><thead><tr><th colspan="${6+emps.length}" class="title">${ymText}</th></tr><tr><th>날짜</th><th>구분</th><th>현장명</th><th>작업내용</th><th>시간</th><th>금액</th>${emps.map(e=>`<th>${e.name}</th>`).join('')}</tr></thead><tbody>`;
  rec.forEach(r=>{
    table += `<tr><td class="${isHoliday(r.date)?'holidayDate':''}">${r.date.slice(5)}</td><td>${r.type}</td><td>${r.site}</td><td>${r.workName||''}</td><td>${r.startTime}~${r.endTime}</td><td>${KRW(recordTotal(r))}</td>${emps.map(e=>`<td>${r.participants.includes(e.id)?'○':''}</td>`).join('')}</tr>`;
  });
  table += `<tr class="sum"><th colspan="6">직원별 합계</th>${emps.map(e=>`<th>${KRW(employeeMonthSettlement(e).total)}</th>`).join('')}</tr>`;
  if(state.settings.minuteCarry){
    table += `<tr class="carry"><th colspan="6">분단위 이월정산</th>${emps.map(e=>`<th>${employeeMonthSettlement(e).carryText}</th>`).join('')}</tr>`;
  }
  table += '</tbody></table>';
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:'Malgun Gothic',Arial,sans-serif} table{border-collapse:collapse;font-size:10pt} th,td{border:1px solid #111;text-align:center;vertical-align:middle;padding:4px;white-space:nowrap} th{background:#eef2f8;font-weight:bold}.title{font-size:16pt;text-align:left;border:0;background:#fff;padding:10px}.sum th,.carry th{background:#eef2f8}.carry th{font-size:8pt}.holidayDate{background:#fde9e7;color:#d60000;font-weight:bold}
  </style></head><body>${table}</body></html>`;
  const blob=new Blob(['\ufeff'+html],{type:'application/vnd.ms-excel;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=$('globalMonth').value+'_특근명세서.xls';
  a.click();
}
$('exportCsv').onclick=exportExcelStatement;

$('resetDemo').onclick=()=>{if(confirm('저장된 데이터를 초기 샘플로 되돌릴까요?')){localStorage.removeItem(KEY);location.reload();}};
clearForm(); renderAll();
