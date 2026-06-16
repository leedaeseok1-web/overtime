const KRW = n => (Math.round(n)||0).toLocaleString('ko-KR') + '원';
const today = new Date();
const ym = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
const KEY = 'dh_overtime_pro_v120';
const AUTH_KEY = 'dh_overtime_auth_v120';
const SUPABASE_URL = 'https://ybqsvjgsqyeenuybmjbe.supabase.co';
const SUPABASE_KEY = 'sb_publishable_snDyQo7ZgxlcxcJKm29JNQ_k7NjzRG1';
const SUPABASE_REST = SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';
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
let authState = { session:null, user:null, profile:null, profiles:[] };

function normalizeLoginId(v){ v=String(v||'').trim(); return v.includes('@') ? v : `${v}@dh.local`; }
function roleName(role){ return role==='admin'?'관리자':role==='viewer'?'조회전용':'일반사용자'; }
function getStoredSession(){ try{return JSON.parse(localStorage.getItem(AUTH_KEY)||'null')}catch(e){return null} }
function storeSession(session){ authState.session=session||null; localStorage.setItem(AUTH_KEY, JSON.stringify(session||null)); }
function authHeaders(extra={}){ return {apikey:SUPABASE_KEY,'Content-Type':'application/json',...extra}; }
async function authRequest(path, options={}){ const res=await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {...options, headers:authHeaders(options.headers||{})}); const txt=await res.text(); let data=null; try{data=txt?JSON.parse(txt):null}catch(e){data=txt} if(!res.ok) throw new Error((data&&data.msg)||(data&&data.error_description)||(data&&data.message)||txt||res.statusText); return data; }
async function login(email,password){ const data=await authRequest('token?grant_type=password',{method:'POST',body:JSON.stringify({email:normalizeLoginId(email),password})}); storeSession(data); authState.user=data.user; await ensureProfile(); hideAuth(); await loadCloudData(); renderAll(); applyRoleAccess(); }
async function getCurrentUser(){ const sess=getStoredSession(); if(!sess||!sess.access_token) return null; authState.session=sess; try{ const data=await authRequest('user',{method:'GET',headers:{Authorization:`Bearer ${sess.access_token}`}}); authState.user=data; await ensureProfile(); hideAuth(); return data; }catch(e){ localStorage.removeItem(AUTH_KEY); authState={session:null,user:null,profile:null,profiles:[]}; showAuth(); return null; } }
async function signOut(){ localStorage.removeItem(AUTH_KEY); authState={session:null,user:null,profile:null,profiles:[]}; const cur=$('topUserLabel'); if(cur) cur.textContent='👤 로그인 필요'; const pbtn=$('profileBtn'); if(pbtn) pbtn.style.display='none'; showAuth(); }
async function signUpByAdmin(loginId,password,name,role){
  const email = normalizeLoginId(loginId);
  const displayName = (name || loginId || email.split('@')[0]).trim();
  const data = await authRequest('signup',{
    method:'POST',
    body:JSON.stringify({
      email,
      password,
      data:{ display_name: displayName, role }
    })
  });
  const uid = data?.user?.id || data?.id || data?.session?.user?.id;
  if(!uid){
    // Supabase 설정에 따라 Auth 계정은 생성되지만 응답에 UID가 비어있을 수 있음.
    // 이 경우 supabase_auth_extra.sql의 Auth 트리거가 user_profiles를 자동 생성한다.
    await loadProfiles();
    return data;
  }
  await cloudRequest('user_profiles',{
    method:'POST',
    headers:{Prefer:'return=minimal'},
    body:JSON.stringify({id:uid,display_name:displayName,role})
  }).catch(async()=>{
    await cloudRequest(`user_profiles?id=eq.${encodeURIComponent(uid)}`,{
      method:'PATCH',
      headers:{Prefer:'return:minimal'},
      body:JSON.stringify({display_name:displayName,role})
    });
  });
  await loadProfiles();
  return data;
}
async function ensureProfile(){ if(!authState.user) return; try{ let rows=await cloudSelect(`user_profiles?select=*&id=eq.${encodeURIComponent(authState.user.id)}&limit=1`); if(!rows||!rows.length){ const all=await cloudSelect('user_profiles?select=id&limit=1').catch(()=>[]); const role=(!all||!all.length)?'admin':'user'; await cloudRequest('user_profiles',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({id:authState.user.id,display_name:(authState.user.email||'').split('@')[0],role})}); rows=await cloudSelect(`user_profiles?select=*&id=eq.${encodeURIComponent(authState.user.id)}&limit=1`); } authState.profile=rows&&rows[0]; await loadProfiles(); }catch(e){ console.warn('profile load failed',e); authState.profile={id:authState.user.id,display_name:(authState.user.email||'사용자'),role:'user'}; } }
async function loadProfiles(){ authState.profiles=await cloudSelect('user_profiles?select=*&order=created_at.asc').catch(()=>[]); }
async function updateProfileRole(id,role){ await cloudRequest(`user_profiles?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({role})}); await loadProfiles(); renderUsers(); }
async function deleteUserAccount(id){
  if(!isAdmin()){ alert('관리자만 삭제할 수 있습니다.'); return; }
  if(authState.user && String(id)===String(authState.user.id)){ alert('현재 로그인된 본인 계정은 삭제할 수 없습니다.'); return; }
  const target=(authState.profiles||[]).find(u=>String(u.id)===String(id));
  if(!confirm(`${target?.display_name||'사용자'} 계정을 삭제할까요?`)) return;
  try{
    await cloudRequest('rpc/delete_user_account',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({target_uid:id})});
  }catch(e){
    console.warn('Auth 계정 삭제 RPC 실패, 프로필만 삭제 시도', e);
    await cloudRequest(`user_profiles?id=eq.${encodeURIComponent(id)}`,{method:'DELETE'});
    alert('Auth 삭제 함수가 없어 사용자목록에서만 제거했습니다. Supabase SQL을 실행하면 Auth 계정까지 삭제됩니다.');
  }
  await loadProfiles(); renderUsers();
}
async function updateMyProfile(displayName,password){
  if(!authState.user || !authState.session) throw new Error('로그인이 필요합니다.');
  const patch={display_name:displayName||''};
  await cloudRequest(`user_profiles?id=eq.${encodeURIComponent(authState.user.id)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(patch)});
  if(password){
    await authRequest('user',{method:'PUT',headers:{Authorization:`Bearer ${authState.session.access_token}`},body:JSON.stringify({password})});
  }
  await ensureProfile();
  applyRoleAccess();
}
function renderProfile(){
  if(!$('profileEmail')) return;
  $('profileEmail').value = authState.user?.email || '';
  $('profileName').value = authState.profile?.display_name || '';
  $('profilePassword').value = '';
  $('profilePassword2').value = '';
}
function showAuth(){ const o=$('authOverlay'); if(o) o.classList.add('show'); }
function hideAuth(){ const o=$('authOverlay'); if(o) o.classList.remove('show'); }
function currentRole(){ return authState.profile?.role || 'viewer'; }
function isAdmin(){ return currentRole()==='admin'; }
function applyRoleAccess(){
  const role=currentRole();
  const admin=isAdmin();
  const name=authState.profile?.display_name || (authState.user?.email||'').replace('@dh.local','') || '사용자';
  const cur=$('topUserLabel');
  if(cur) cur.textContent=`👤 ${name} · ${roleName(role)}`;
  const pbtn=$('profileBtn');
  if(pbtn) pbtn.style.display = authState.user ? '' : 'none';

  // 일반사용자/조회전용은 조회만 가능: 등록/관리/설정/사용자관리 숨김
  document.querySelectorAll('[data-admin-only], .nav[data-page="register"], .nav[data-page="employees"], .nav[data-page="settings"], .nav[data-page="users"], [data-go="register"], [data-go="settings"]').forEach(el=>{
    el.style.display = admin ? '' : 'none';
  });
  document.querySelectorAll('.rateBox').forEach(el=>{ el.style.display = admin ? '' : 'none'; });

  // 관리자 외 계정이 제한 화면에 있으면 대시보드로 이동
  if(!admin && ['register','employees','settings','users'].some(id=>$(id)?.classList.contains('show'))){
    showPage('dashboard');
  }
}

const save = () => localStorage.setItem(KEY, JSON.stringify(state));
const cloudHeaders = (extra={}) => ({
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${(authState.session&&authState.session.access_token)||SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  ...extra
});
async function cloudRequest(path, options={}){
  const res = await fetch(`${SUPABASE_REST}/${path}`, { ...options, headers: cloudHeaders(options.headers||{}) });
  if(!res.ok){
    const msg = await res.text().catch(()=>res.statusText);
    throw new Error(msg || res.statusText);
  }
  if(res.status === 204) return null;
  return await res.json().catch(()=>null);
}
async function cloudSelect(path){ return await cloudRequest(path, {method:'GET'}); }
function empFromDb(r){ return {id:String(r.id), name:r.name||'', position:r.position||'', payType:r.pay_type||'normal', active:r.active!==false}; }
function recFromDb(r){ return {id:String(r.id), date:r.work_date, type:r.work_type, site:r.site||'', workName:r.work_content||'', startTime:r.start_time||'18:00', endTime:r.end_time||'22:00', fullDay:!!r.is_full_day, participants:(r.participants||[]).map(String), note:r.note||''}; }
async function loadCloudData(){
  try{
    const [emps, recs, settingsRows, holidayRows] = await Promise.all([
      cloudSelect('employees?select=*&order=sort_order.asc,created_at.asc'),
      cloudSelect('overtimes?select=*&order=work_date.asc,created_at.asc'),
      cloudSelect('settings?select=*&id=eq.1&limit=1'),
      cloudSelect('holidays?select=*&order=holiday_date.asc')
    ]);
    state.employees = (emps||[]).map(empFromDb);
    state.records = (recs||[]).map(recFromDb);
    if(settingsRows && settingsRows[0]){
      const st=settingsRows[0];
      state.settings.normalRate=st.normal_rate ?? state.settings.normalRate;
      state.settings.halfRate=st.half_rate ?? state.settings.halfRate;
      state.settings.holidayFixed=st.holiday_full_day_amount ?? state.settings.holidayFixed;
      state.settings.minuteCarry=st.carry_minutes ?? state.settings.minuteCarry;
    }
    if(Array.isArray(holidayRows) && holidayRows.length) state.settings.holidays = holidayRows.map(h=>h.holiday_date);
    save();
  }catch(err){
    console.warn('Supabase 동기화 실패, 로컬 데이터로 실행합니다.', err);
    console.warn('Supabase 연결 실패: 테이블/RLS/Auth 설정을 확인해주세요.');
  }
}
async function insertEmployeeCloud(obj){
  const full={name:obj.name, position:obj.position||'', pay_type:obj.payType, active:true, sort_order:state.employees.length+1};
  try{ return (await cloudRequest('employees', {method:'POST', headers:{Prefer:'return=representation'}, body:JSON.stringify(full)}))[0]; }
  catch(e){ const simple={name:obj.name, pay_type:obj.payType, active:true, sort_order:state.employees.length+1}; return (await cloudRequest('employees', {method:'POST', headers:{Prefer:'return=representation'}, body:JSON.stringify(simple)}))[0]; }
}
async function updateEmployeeCloud(id,obj){
  const full={name:obj.name, position:obj.position||'', pay_type:obj.payType, active:obj.active!==false};
  try{ return (await cloudRequest(`employees?id=eq.${encodeURIComponent(id)}`, {method:'PATCH', headers:{Prefer:'return=representation'}, body:JSON.stringify(full)}))[0]; }
  catch(e){ const simple={name:obj.name, pay_type:obj.payType, active:obj.active!==false}; return (await cloudRequest(`employees?id=eq.${encodeURIComponent(id)}`, {method:'PATCH', headers:{Prefer:'return=representation'}, body:JSON.stringify(simple)}))[0]; }
}
async function deleteEmployeeCloud(id){ await cloudRequest(`employees?id=eq.${encodeURIComponent(id)}`, {method:'DELETE'}); }
function recordPayload(r){ return {work_date:r.date, work_type:r.type, site:r.site||'', work_content:r.workName||'', start_time:r.startTime, end_time:r.endTime, is_full_day:!!r.fullDay, participants:(r.participants||[]).map(String), note:r.note||''}; }
async function insertRecordCloud(r){ return (await cloudRequest('overtimes', {method:'POST', headers:{Prefer:'return=representation'}, body:JSON.stringify(recordPayload(r))}))[0]; }
async function updateRecordCloud(id,r){ return (await cloudRequest(`overtimes?id=eq.${encodeURIComponent(id)}`, {method:'PATCH', headers:{Prefer:'return=representation'}, body:JSON.stringify(recordPayload(r))}))[0]; }
async function deleteRecordCloud(id){ await cloudRequest(`overtimes?id=eq.${encodeURIComponent(id)}`, {method:'DELETE'}); }
async function saveSettingsCloud(){
  await cloudRequest('settings?id=eq.1', {method:'PATCH', headers:{Prefer:'return=minimal'}, body:JSON.stringify({normal_rate:state.settings.normalRate, half_rate:state.settings.halfRate, holiday_full_day_amount:state.settings.holidayFixed, carry_minutes:state.settings.minuteCarry, updated_at:new Date().toISOString()})});
  await cloudRequest('holidays', {method:'DELETE'});
  if(state.settings.holidays.length){
    await cloudRequest('holidays', {method:'POST', headers:{Prefer:'return=minimal'}, body:JSON.stringify(state.settings.holidays.map(d=>({holiday_date:d, name:'공휴일'})))});
  }
}

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
  Object.entries(remainders).forEach(([rate,min])=>{
    const h=Math.floor(min/60); const rem=min%60;
    if(h) carryPay+=h*Number(rate);
    if(min) carryText.push(`지급 ${h}시간\n잔여 ${rem}분`);
  });
  return {base, carryPay, total:base+carryPay, carryText:carryText.join('\n')||'잔여분 없음'};
}
function monthlyGrandTotal(){ return state.employees.filter(e=>e.active).reduce((s,e)=>s+employeeMonthSettlement(e).total,0); }
function recordTotal(r){ return r.participants.reduce((sum,id)=>{const emp=state.employees.find(e=>String(e.id)===String(id)); return sum+(emp?calcPay(r,emp):0)},0); }
function monthRecords(){ const m=$('globalMonth').value; return state.records.filter(r=>r.date.startsWith(m)).sort((a,b)=>a.date.localeCompare(b.date)); }
function renderAll(){
  [renderTypes, renderParticipants, renderDashboard, renderStatement, renderCalendar, renderEmployeeList, renderEmployeeSummary, renderSiteSummary, renderSettings, renderUsers, updateCalc, applyRoleAccess].forEach(fn=>{
    try{ fn(); }catch(e){ console.warn('render skipped:', fn.name, e); }
  });
}
function renderTypes(){ const box=$('typeChips'); box.innerHTML=''; state.settings.workTypes.forEach(t=>{const b=document.createElement('button');b.type='button';b.className='chip '+(t===selectedType?'active':'');b.textContent=t;b.onclick=()=>{selectedType=t;renderTypes()};box.appendChild(b)}); }
function renderParticipants(){ const box=$('participantBox'); box.innerHTML=''; state.employees.filter(e=>e.active).forEach(e=>{const label=document.createElement('label');label.className='person';label.innerHTML=`<input type="checkbox" value="${e.id}" class="part"> <span>${e.name} <small>${e.payType==='half'?'평일절반':''}</small></span>`;box.appendChild(label)}); document.querySelectorAll('.part').forEach(c=>c.onchange=updateCalc); }
function currentFormRecord(){
  const full = $('fullDayWork') && $('fullDayWork').checked;
  const st = full ? '08:00' : (parseTimeInput($('startTime').value) || $('startTime').value);
  const et = full ? '17:00' : (parseTimeInput($('endTime').value) || $('endTime').value);
  return {date:$('date').value,site:$('site').value,type:selectedType,workName:$('workName').value,startTime:st,endTime:et,note:$('note').value,fullDay:!!full,participants:[...document.querySelectorAll('.part:checked')].map(c=>String(c.value))};
}
function updateCalc(){ setFullDayTimes(); const r=currentFormRecord(); const box=$('calcPreview'); if(!parseTimeInput(r.startTime)||!parseTimeInput(r.endTime)){box.innerHTML='<p class="muted">시간은 18:00 또는 1800 형식으로 입력해주세요.</p>';return} if(!r.date||!r.startTime||!r.endTime||!r.participants.length){box.innerHTML='<p class="muted">날짜, 시간, 참석자를 선택하면 자동계산됩니다.</p>';return} let total=0; box.innerHTML=r.participants.map(id=>{const e=state.employees.find(x=>String(x.id)===String(id)); if(!e) return ''; const pay=calcPay(r,e); total+=pay; return `<div class="calcRow"><span>${e.name}</span><strong>${KRW(pay)}</strong></div>`}).join('')+`<div class="calcRow"><span>합계</span><strong>${KRW(total)}</strong></div>`; }
['date','startTime','endTime'].forEach(id=>$(id).addEventListener('change',()=>{ if(id!=='date') normalizeTimeInput(id); updateFullDayVisibility(); autoTypeByDateTime(); updateCalc(); }));
['startTime','endTime'].forEach(id=>$(id).addEventListener('blur',()=>{ normalizeTimeInput(id); autoTypeByDateTime(); updateCalc(); }));
if($('fullDayWork')) $('fullDayWork').addEventListener('change',()=>{ setFullDayTimes(); autoTypeByDateTime(); updateCalc(); });
$('overtimeForm').onsubmit=async e=>{e.preventDefault(); if(!isAdmin()){alert('특근 등록은 관리자만 가능합니다. 일반사용자는 조회만 가능합니다.'); return;} setFullDayTimes(); normalizeTimeInput('startTime'); normalizeTimeInput('endTime'); const r=currentFormRecord(); if(!parseTimeInput(r.startTime)||!parseTimeInput(r.endTime)){alert('시간 형식을 확인해주세요. 예: 18:00 또는 1800');return} if(!r.participants.length){alert('참석자를 선택해주세요.');return} try{ const edit=$('editId').value; if(edit){ const row=await updateRecordCloud(edit,r); const i=state.records.findIndex(x=>String(x.id)===String(edit)); state.records[i]=recFromDb(row); } else { const row=await insertRecordCloud(r); state.records.push(recFromDb(row)); } save(); await loadCloudData().catch(()=>{}); clearForm(); renderAll(); applyRoleAccess(); alert('저장되었습니다.'); }catch(err){ console.error(err); alert('DB 저장 실패: Supabase 테이블/RLS 설정을 확인해주세요.'); } };
function clearForm(){ $('overtimeForm').reset(); $('date').value=new Date().toISOString().slice(0,10); $('startTime').value='18:00'; $('endTime').value='22:00'; if($('fullDayWork')) $('fullDayWork').checked=false; $('editId').value=''; document.querySelectorAll('.part').forEach(c=>c.checked=false); updateFullDayVisibility(); autoTypeByDateTime(); updateCalc(); }
$('clearForm').onclick=clearForm; $('selectAllEmployees').onclick=()=>{const all=[...document.querySelectorAll('.part')]; const any=all.some(c=>!c.checked); all.forEach(c=>c.checked=any); updateCalc();};
function renderDashboard(){ const rec=monthRecords(); const total=monthlyGrandTotal(); const people=new Set(rec.flatMap(r=>r.participants)); $('dashTotal').textContent=KRW(total); $('dashCount').textContent=rec.length+'건'; $('dashPeople').textContent=people.size+'명'; if($('dashHoliday')) $('dashHoliday').textContent=rec.filter(r=>r.type==='휴일근무').length+'건'; $('recentList').innerHTML=rec.slice(-6).reverse().map(r=>`<div class="recentRow"><span>${r.date.slice(5)} (${['일','월','화','수','목','금','토'][new Date(r.date+'T00:00').getDay()]})</span><span class="badge ${r.type}">${r.type}</span><span>${r.site}</span><span>${r.workName||''}</span><strong class="money">${KRW(recordTotal(r))}</strong></div>`).join('')||'<p class="muted">등록된 내역이 없습니다.</p>'; }
function renderStatement(){
  const rec=monthRecords();
  const emps=state.employees.filter(e=>e.active);
  $('statementTitle').textContent=$('globalMonth').value.replace('-','년 ')+'월 특근명세서';
  const manageHead = isAdmin() ? '<th class="manageCol">관리</th>' : '';
  let html='<thead><tr><th class="dateCol">날짜</th><th class="typeCol">구분</th><th class="siteCol">현장명</th><th class="workCol">작업내용</th><th class="timeCol">시간</th><th class="amountCol">금액</th>'+emps.map(e=>`<th class="empCol">${e.name}</th>`).join('')+manageHead+'</tr></thead><tbody>';
  rec.forEach(r=>{
    const dayClass=isHoliday(r.date)?'holidayDate':'';
    html+=`<tr><td class="dateCol ${dayClass}">${r.date.slice(5)}</td><td class="typeCol">${r.type}</td><td class="siteCol">${r.site}</td><td class="workCol nameCell">${r.workName||''}</td><td class="timeCol">${r.startTime}~${r.endTime}</td><td class="amountCol">${KRW(recordTotal(r))}</td>`+
      emps.map(e=>`<td class="empCol">${r.participants.includes(e.id)?'<span class="markCircle">○</span>':''}</td>`).join('')+
      (isAdmin()?`<td class="manageCol"><button class="ghost small" onclick="editRecord('${r.id}')">수정</button> <button class="ghost small danger" onclick="deleteRecord('${r.id}')">삭제</button></td>`:'')+`</tr>`;
  });
  const noteItems = rec.filter(r=>String(r.note||'').trim()).map(r=>`${r.date.slice(5)} ${r.note.trim()}`);
  const noteColspan = 6 + emps.length + (isAdmin()?1:0);
  const notesRow = noteItems.length ? `<tr class="noteRow"><th>특이사항</th><td colspan="${noteColspan-1}">${noteItems.join('<br>')}</td></tr>` : '';
  const manageFoot = isAdmin() ? '<th></th>' : '';
  html+='</tbody><tfoot><tr><th colspan="6">직원별 합계</th>'+emps.map(e=>`<th class="empCol">${KRW(employeeMonthSettlement(e).total)}</th>`).join('')+manageFoot+'</tr>'+
    (state.settings.minuteCarry?'<tr><th colspan="6">분단위 이월정산</th>'+emps.map(e=>`<th class="empCol carryCell"><small>${employeeMonthSettlement(e).carryText}</small></th>`).join('')+manageFoot+'</tr>':'')+notesRow+'</tfoot>';
  $('statementTable').innerHTML=html;
}
window.editRecord=id=>{ if(!isAdmin()){alert('수정은 관리자만 가능합니다.');return} const r=state.records.find(x=>String(x.id)===String(id)); showPage('register'); $('editId').value=r.id; $('date').value=r.date; $('site').value=r.site; $('workName').value=r.workName; $('startTime').value=r.startTime; $('endTime').value=r.endTime; $('note').value=r.note; if($('fullDayWork')) $('fullDayWork').checked=!!r.fullDay; updateFullDayVisibility(); selectedType=r.type; renderTypes(); document.querySelectorAll('.part').forEach(c=>c.checked=r.participants.map(String).includes(String(c.value))); updateCalc(); };
window.deleteRecord=async id=>{ if(!isAdmin()){alert('삭제는 관리자만 가능합니다.');return} if(confirm('삭제할까요?')){try{await deleteRecordCloud(id)}catch(e){console.warn(e)} state.records=state.records.filter(r=>String(r.id)!==String(id)); save(); renderAll();} };
function buildCalendarHtml(){ const m=$('globalMonth').value; const [y,mo]=m.split('-').map(Number); const first=new Date(y,mo-1,1); const last=new Date(y,mo,0).getDate(); const names=['일','월','화','수','목','금','토']; let html=names.map((n,i)=>`<div class="dayName ${i===0?'sun':i===6?'sat':''}">${n}</div>`).join(''); for(let i=0;i<first.getDay();i++) html+='<div class="day empty"></div>'; for(let d=1;d<=last;d++){ const ds=`${m}-${String(d).padStart(2,'0')}`; const wd=new Date(ds+'T00:00').getDay(); const holiday=state.settings.holidays.includes(ds); const classes=['day']; if(wd===0) classes.push('sun'); if(wd===6) classes.push('sat'); if(holiday) classes.push('holiday'); const rec=state.records.filter(r=>r.date===ds); html+=`<div class="${classes.join(' ')}"><div class="num">${d}</div>${holiday?'<small class="holidayLabel">공휴일</small>':''}${rec.map(r=>`<span class="eventPill ${r.type}">${r.type} ${rec.length>1?'':KRW(recordTotal(r))}</span>`).join('')}</div>`; } return html; }
function renderCalendar(){ const m=$('globalMonth').value; const [y,mo]=m.split('-').map(Number); if($('calendarTitle')) $('calendarTitle').textContent=`${y}년 ${mo}월 특근캘린더`; if($('miniCalendarTitle')) $('miniCalendarTitle').textContent=`${y}년 ${mo}월`; const html=buildCalendarHtml(); if($('calendarGrid')) $('calendarGrid').innerHTML=html; if($('calendarGridFull')) $('calendarGridFull').innerHTML=html; }
function renderEmployeeList(){ $('employeeList').innerHTML=state.employees.map(e=>`<div class="listItem"><div><strong>${e.name}</strong> <span class="badge">${e.payType==='half'?'평일절반':'일반'}</span><br><small>${e.position||''}</small></div><div class="itemBtns"><button class="ghost small" onclick="editEmployee('${e.id}')">수정</button><button class="ghost small danger" onclick="removeEmployee('${e.id}')">삭제</button></div></div>`).join(''); }
$('employeeForm').onsubmit=async e=>{e.preventDefault(); if(currentRole()!=='admin'){alert('직원관리는 관리자만 가능합니다.');return} const edit=$('empEditId').value; const obj={name:$('empName').value,position:$('empPosition').value,payType:$('empPayType').value,active:true}; try{ if(edit){const row=await updateEmployeeCloud(edit,obj); Object.assign(state.employees.find(x=>String(x.id)===String(edit)), empFromDb(row));} else {const row=await insertEmployeeCloud(obj); state.employees.push(empFromDb(row));} save(); $('employeeForm').reset(); $('empEditId').value=''; renderAll(); }catch(err){ console.error(err); alert('직원 저장 실패: Supabase 연결/RLS 설정을 확인해주세요.'); } };
window.editEmployee=id=>{const e=state.employees.find(x=>String(x.id)===String(id)); $('empEditId').value=e.id; $('empName').value=e.name; $('empPosition').value=e.position; $('empPayType').value=e.payType;};
window.removeEmployee=async id=>{if(currentRole()!=='admin'){alert('직원관리는 관리자만 가능합니다.');return} if(confirm('직원을 삭제할까요? 기존 기록의 참석 표시는 유지되지 않을 수 있습니다.')){try{await deleteEmployeeCloud(id); state.employees=state.employees.filter(e=>String(e.id)!==String(id)); save(); renderAll();}catch(err){console.error(err); alert('직원 삭제 실패: Supabase 연결/RLS 설정을 확인해주세요.');}}};
$('empClear').onclick=()=>{$('employeeForm').reset();$('empEditId').value=''};
function renderEmployeeSummary(){
  const sel=$('employeeFilter');
  const old=sel.value;
  sel.innerHTML=state.employees.map(e=>`<option value="${e.id}">${e.name}</option>`).join('');
  if(old) sel.value=old;
  const emp=state.employees.find(e=>String(e.id)===String(sel.value))||state.employees[0];
  if(!emp){ $('employeeDetail').innerHTML='<p class="muted">등록된 직원이 없습니다.</p>'; return; }
  const rec=monthRecords().filter(r=>r.participants.map(String).includes(String(emp.id)));
  let html=`<h3>${emp.name}</h3><div class="tableWrap employeeSummaryTableWrap"><table class="miniTable employeeSummaryTable"><thead><tr><th>날짜</th><th>구분</th><th>현장명</th><th>작업내용</th><th>시간</th><th>금액</th></tr></thead><tbody>`;
  if(rec.length){
    html += rec.map(r=>`<tr><td class="${isHoliday(r.date)?'holidayDate':''}">${r.date.slice(5)}</td><td>${r.type}</td><td>${r.site||''}</td><td class="nameCell">${r.workName||''}</td><td>${r.startTime}~${r.endTime}</td><td class="money">${KRW(calcPay(r,emp))}</td></tr>`).join('');
  }else{
    html += '<tr><td colspan="6" class="muted">해당 월 내역이 없습니다.</td></tr>';
  }
  const settle=employeeMonthSettlement(emp);
  html += `</tbody><tfoot><tr><th colspan="5">분단위 이월정산</th><th class="carryCell"><small>${settle.carryText}</small></th></tr><tr><th colspan="5">합계</th><th>${KRW(settle.total)}</th></tr></tfoot></table></div>`;
  $('employeeDetail').innerHTML=html;
}
$('employeeFilter').onchange=renderEmployeeSummary;

function renderUsers(){
  const box=$('userList'); if(!box) return;
  if(currentRole()!=='admin'){ box.innerHTML='<p class="muted">관리자만 확인 가능합니다.</p>'; return; }
  if(!authState.profiles || !authState.profiles.length){ box.innerHTML='<p class="muted">등록된 사용자가 없습니다.</p>'; return; }
  box.innerHTML=authState.profiles.map(u=>`<div class="listItem userListItem"><div><strong>${u.display_name||'사용자'}</strong><br><small>${roleName(u.role)}</small></div><div class="userActions"><select class="roleSelect" data-id="${u.id}"><option value="admin" ${u.role==='admin'?'selected':''}>관리자</option><option value="user" ${u.role==='user'?'selected':''}>일반사용자</option><option value="viewer" ${u.role==='viewer'?'selected':''}>조회전용</option></select><button type="button" class="danger deleteUserBtn" data-id="${u.id}">삭제</button></div></div>`).join('');
  document.querySelectorAll('.roleSelect').forEach(sel=>sel.onchange=async()=>{ if(confirm('권한을 변경할까요?')) await updateProfileRole(sel.dataset.id, sel.value); });
  document.querySelectorAll('.deleteUserBtn').forEach(btn=>btn.onclick=async()=>{ await deleteUserAccount(btn.dataset.id); });
}
const loginForm=$('loginForm');
if(loginForm) loginForm.onsubmit=async e=>{e.preventDefault(); const msg=$('authMsg'); msg.textContent='로그인 중...'; try{ await login($('loginEmail').value,$('loginPassword').value); msg.textContent=''; }catch(err){ msg.textContent='로그인 실패: '+err.message; }};
if($('logoutBtn')) $('logoutBtn').onclick=()=>{ if(confirm('로그아웃할까요?')) signOut(); };
if($('profileBtn')) $('profileBtn').onclick=()=>{ renderProfile(); showPage('profile'); };
const profileForm=$('profileForm');
if(profileForm) profileForm.onsubmit=async e=>{
  e.preventDefault();
  const pw=$('profilePassword').value.trim();
  const pw2=$('profilePassword2').value.trim();
  if(pw || pw2){
    if(pw.length<6){ alert('비밀번호는 6자리 이상 입력해주세요.'); return; }
    if(pw!==pw2){ alert('비밀번호 확인이 일치하지 않습니다.'); return; }
  }
  try{ await updateMyProfile($('profileName').value.trim(), pw); alert('정보가 수정되었습니다.'); renderProfile(); renderUsers(); showPage('dashboard'); }
  catch(err){ alert('정보수정 실패: '+err.message); }
};
const userCreateForm=$('userCreateForm');
if(userCreateForm) userCreateForm.onsubmit=async e=>{ e.preventDefault(); if(currentRole()!=='admin'){alert('관리자만 가능합니다.');return} try{ await signUpByAdmin($('newUserId').value,$('newUserPassword').value,$('newUserName').value,$('newUserRole').value); $('userCreateForm').reset(); await loadProfiles(); renderUsers(); alert('계정을 생성했습니다.'); }catch(err){ alert('계정 생성 실패: '+err.message); } };

function renderSiteSummary(){ const map={}; monthRecords().forEach(r=>{map[r.site]=map[r.site]||{count:0,total:0,types:{}};map[r.site].count++;map[r.site].total+=recordTotal(r);map[r.site].types[r.type]=(map[r.site].types[r.type]||0)+1}); $('siteSummaryList').innerHTML=Object.entries(map).map(([site,v])=>`<div class="listItem"><div><strong>${site}</strong><br><small>${Object.entries(v.types).map(([k,c])=>`${k} ${c}건`).join(' · ')}</small></div><strong>${KRW(v.total)}</strong></div>`).join('')||'집계 내역이 없습니다.'; }
function renderSettings(){ $('normalRate').value=state.settings.normalRate; $('halfRate').value=state.settings.halfRate; $('holidayFixed').value=state.settings.holidayFixed; $('minuteCarry').checked=state.settings.minuteCarry!==false; $('holidays').value=state.settings.holidays.join('\n'); if($('holidayAuto')) $('holidayAuto').checked=state.settings.holidayAuto!==false; $('workTypes').value=state.settings.workTypes.join(','); }
$('settingsForm').onsubmit=async e=>{e.preventDefault(); if(currentRole()!=='admin'){alert('설정은 관리자만 가능합니다.');return} state.settings.normalRate=Number($('normalRate').value); state.settings.halfRate=Number($('halfRate').value); state.settings.holidayFixed=Number($('holidayFixed').value); state.settings.minuteCarry=$('minuteCarry').checked; state.settings.holidays=$('holidays').value.split(/\s+/).filter(Boolean); state.settings.workTypes=$('workTypes').value.split(',').map(x=>x.trim()).filter(Boolean).filter(x=>['야간특근','휴일근무'].includes(x)); if(!state.settings.workTypes.length) state.settings.workTypes=['야간특근','휴일근무']; autoTypeByDateTime(); try{await saveSettingsCloud();}catch(err){console.warn(err); alert('설정은 로컬 저장되었습니다. Supabase 설정 저장은 실패했습니다.');} save(); renderAll(); alert('설정 저장되었습니다.');};
function showPage(id){ if(id==='profile') renderProfile(); if(!isAdmin() && ['register','employees','settings','users'].includes(id)){alert('관리자만 접근 가능합니다. 일반사용자는 조회만 가능합니다.'); id='dashboard';} document.querySelectorAll('.page').forEach(p=>p.classList.remove('show')); $(id).classList.add('show'); document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n.dataset.page===id)); window.scrollTo({top:0,behavior:'smooth'}); }
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
  const noteItems = rec.filter(r=>String(r.note||'').trim()).map(r=>`${r.date.slice(5)} ${r.note.trim()}`);
  if(noteItems.length){
    table += `<tr class="noteRow"><th>특이사항</th><td colspan="${5+emps.length}">${noteItems.join('<br>')}</td></tr>`;
  }
  table += '</tbody></table>';
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:'Malgun Gothic',Arial,sans-serif} table{border-collapse:collapse;font-size:10pt} th,td{border:1px solid #111;text-align:center;vertical-align:middle;padding:4px;white-space:nowrap} th{background:#eef2f8;font-weight:bold}.title{font-size:16pt;text-align:left;border:0;background:#fff;padding:10px}.sum th,.carry th{background:#eef2f8}.carry th{font-size:8pt}.holidayDate{background:#fde9e7;color:#d60000;font-weight:bold}.noteRow th,.noteRow td{background:#fff7e6;text-align:left;white-space:normal;font-size:10pt}
  </style></head><body>${table}</body></html>`;
  const blob=new Blob(['\ufeff'+html],{type:'application/vnd.ms-excel;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=$('globalMonth').value+'_특근명세서.xls';
  a.click();
}
$('exportCsv').onclick=exportExcelStatement;

$('resetDemo').onclick=()=>{if(confirm('이 기기의 임시 저장값만 초기화하고 Supabase 데이터를 다시 불러올까요?')){localStorage.removeItem(KEY);location.reload();}};
showAuth(); getCurrentUser().then(async user=>{ if(user){ await loadCloudData(); clearForm(); renderAll(); applyRoleAccess(); } else { clearForm(); renderAll(); } });

// v1.11 mobile drawer behavior
(function(){
  const hamb=document.querySelector('.hamb');
  const backdrop=document.querySelector('.mobileBackdrop');
  function closeDrawer(){ document.body.classList.remove('drawerOpen'); }
  if(hamb) hamb.addEventListener('click',()=>document.body.classList.toggle('drawerOpen'));
  if(backdrop) backdrop.addEventListener('click',closeDrawer);
  document.querySelectorAll('.sidebar .nav, .mobileBottomNav .nav').forEach(btn=>btn.addEventListener('click',closeDrawer));
})();
