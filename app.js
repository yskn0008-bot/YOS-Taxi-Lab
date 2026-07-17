'use strict';

const STORAGE_KEY = 'yos-taxi-ops-v1';
const SETTINGS_KEY = 'yos-taxi-settings-v1';
const DEFAULT_SETTINGS = { targetSales: 38000, vehicle: '521', plannedStart: '17:30', plannedEnd: '03:30', areas: '那覇・浦添・宜野湾・豊見城・北谷' };
const STATUS = {
  before: { title: '営業前', badge: '準備', detail: '安全確認をして営業を開始します。', color: '#ffb323' },
  available: { title: '空車・待機', badge: '営業中', detail: '乗車または配車を待っています。', color: '#48d17d' },
  occupied: { title: '乗車中', badge: '実車', detail: '安全運転を最優先。降車後に記録します。', color: '#74a7ff' },
  break: { title: '休憩中', badge: '休憩', detail: '休憩時間を自動計測しています。', color: '#ffb323' },
  ended: { title: '営業終了', badge: '終了', detail: '本日の記録をYOSへ共有してください。', color: '#a2a2ad' }
};

const $ = (id) => document.getElementById(id);
const nowIso = () => new Date().toISOString();
const businessDate = (date = new Date()) => {
  const d = new Date(date);
  if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  return new Intl.DateTimeFormat('ja-JP', { year:'numeric', month:'2-digit', day:'2-digit' }).format(d).replaceAll('/','-');
};
const timeText = (iso) => iso ? new Intl.DateTimeFormat('ja-JP', { hour:'2-digit', minute:'2-digit', second:'2-digit' }).format(new Date(iso)) : '';
const money = (n) => new Intl.NumberFormat('ja-JP', { style:'currency', currency:'JPY', maximumFractionDigits:0 }).format(Number(n || 0));
const escapeHtml = (value='') => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
const durationMs = (start, end = nowIso()) => start ? Math.max(0, new Date(end) - new Date(start)) : 0;
const durationLabel = (ms) => `${Math.floor(ms/3600000)}時間${Math.floor((ms%3600000)/60000)}分`;

function blankState() {
  return { schemaVersion: 1, businessDate: businessDate(), status: 'before', shiftStart: null, shiftEnd: null, activeRide: null, breakStart: null, events: [], updatedAt: nowIso() };
}
function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!parsed || parsed.businessDate !== businessDate()) return blankState();
    return { ...blankState(), ...parsed };
  } catch { return blankState(); }
}
function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
let state = loadState();
let settings = loadSettings();

function save() { state.updatedAt = nowIso(); localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); render(); }
function event(type, details = {}) {
  state.events.unshift({ id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`, type, at: nowIso(), status: state.status, ...details });
}
function sumBreakMs() {
  const completed = state.events.filter(e => e.type === '休憩終了').reduce((sum,e) => sum + Number(e.durationMs || 0), 0);
  return completed + (state.status === 'break' ? durationMs(state.breakStart) : 0);
}
function rides() { return state.events.filter(e => e.type === '降車'); }
function totalSales() { return rides().reduce((sum,e) => sum + Number(e.fare || 0) + Number(e.tip || 0), 0); }
function workingMs() { return state.shiftStart ? durationMs(state.shiftStart, state.shiftEnd || nowIso()) : 0; }
function hourlySales() { const hours = Math.max((workingMs() - sumBreakMs()) / 3600000, 0); return hours > 0 ? totalSales()/hours : 0; }

function render() {
  const meta = STATUS[state.status] || STATUS.before;
  $('statusTitle').textContent = meta.title; $('statusBadge').textContent = meta.badge; $('statusDetail').textContent = meta.detail; $('statusDot').style.background = meta.color;
  $('salesKpi').textContent = money(totalSales()); $('ridesKpi').textContent = String(rides().length); $('avgKpi').textContent = money(rides().length ? totalSales()/rides().length : 0); $('hourlyKpi').textContent = money(hourlySales());
  $('shiftButton').textContent = state.status === 'before' ? '営業開始' : '営業中';
  $('shiftButton').disabled = state.status !== 'before'; $('rideButton').disabled = state.status !== 'available'; $('dropoffButton').disabled = state.status !== 'occupied'; $('breakButton').disabled = !['available','break'].includes(state.status); $('breakButton').textContent = state.status === 'break' ? '休憩終了' : '休憩開始'; $('endButton').disabled = ['before','occupied','break','ended'].includes(state.status);
  $('eventCount').textContent = `${state.events.length}件`;
  $('logList').innerHTML = state.events.length ? state.events.slice(0,30).map(e => `<article class="log-item"><b>${escapeHtml(e.type)} ・ ${timeText(e.at)}</b><p>${escapeHtml(describeEvent(e))}</p></article>`).join('') : '<div class="empty">まだ記録はありません</div>';
}
function describeEvent(e) {
  if (e.type === '降車') return `${e.pickup || '乗車地不明'} → ${e.dropoff || '降車地不明'} / ${money(Number(e.fare||0)+Number(e.tip||0))} / ${e.payment || ''} / ${e.dispatch || ''}`;
  if (e.type === '乗車') return `${e.pickup || '場所未入力'} / ${e.dispatch || ''}${e.memo ? ` / ${e.memo}` : ''}`;
  if (e.type === '休憩終了') return durationLabel(e.durationMs || 0);
  return e.memo || e.location || '';
}

function updateClock() {
  const d = new Date(); $('clockTime').textContent = new Intl.DateTimeFormat('ja-JP',{hour:'2-digit',minute:'2-digit'}).format(d); $('clockDate').textContent = new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric',weekday:'short'}).format(d);
  if (state.shiftStart && state.status !== 'ended') render();
}
setInterval(updateClock, 30000); updateClock();

async function currentLocation() {
  if (!navigator.geolocation) return '';
  return new Promise(resolve => navigator.geolocation.getCurrentPosition(p => resolve(`${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`), () => resolve(''), { enableHighAccuracy:false, timeout:6000, maximumAge:300000 }));
}

$('shiftButton').addEventListener('click', async () => {
  const ok = confirm(`安全確認後に営業を開始します。\n車両：${settings.vehicle}\n目標：${money(settings.targetSales)}`); if (!ok) return;
  state.shiftStart = nowIso(); state.status = 'available'; event('営業開始', { location: await currentLocation(), memo: `車両${settings.vehicle}・目標${settings.targetSales}円` }); save();
});
$('rideButton').addEventListener('click', async () => { $('pickup').value = ''; $('rideMemo').value=''; $('rideDialog').showModal(); const loc = await currentLocation(); if (!$('pickup').value && loc) $('pickup').placeholder = `現在地 ${loc}`; });
$('confirmRide').addEventListener('click', () => {
  const at = nowIso(); state.activeRide = { start: at, pickup: $('pickup').value.trim(), dispatch: $('dispatch').value, memo: $('rideMemo').value.trim() }; state.status = 'occupied'; event('乗車', state.activeRide); save();
});
$('dropoffButton').addEventListener('click', () => { $('dropoff').value=''; $('fare').value=''; $('distance').value=''; $('tip').value=''; $('dropMemo').value=''; $('dropoffDialog').showModal(); });
$('confirmDropoff').addEventListener('click', (ev) => {
  const fare = Number($('fare').value || 0); if (fare < 0 || !Number.isFinite(fare)) { ev.preventDefault(); alert('運賃を確認してください'); return; }
  const ride = state.activeRide || {}; const end = nowIso(); event('降車', { start: ride.start, end, pickup: ride.pickup, dropoff: $('dropoff').value.trim(), dispatch: ride.dispatch, fare, payment: $('payment').value, distance: Number($('distance').value || 0), tip: Number($('tip').value || 0), durationMs: durationMs(ride.start,end), memo: $('dropMemo').value.trim() || ride.memo || '' }); state.activeRide = null; state.status = 'available'; save();
});
$('breakButton').addEventListener('click', () => {
  if (state.status === 'available') { state.breakStart = nowIso(); state.status='break'; event('休憩開始'); }
  else if (state.status === 'break') { const end=nowIso(); event('休憩終了',{start:state.breakStart,end,durationMs:durationMs(state.breakStart,end)}); state.breakStart=null; state.status='available'; }
  save();
});
$('memoButton').addEventListener('click', () => { $('memoText').value=''; $('memoDialog').showModal(); });
$('confirmMemo').addEventListener('click', () => { const memo=$('memoText').value.trim(); if(memo){event('メモ',{memo});save();} });
$('endButton').addEventListener('click', () => {
  if (!confirm(`営業を終了します。\n売上：${money(totalSales())}\n乗車：${rides().length}回`)) return;
  state.shiftEnd = nowIso(); state.status='ended'; event('営業終了',{memo:`売上${totalSales()}円・${rides().length}回・休憩${durationLabel(sumBreakMs())}`}); save(); shareSummary();
});
$('settingsButton').addEventListener('click', () => { $('targetSales').value=settings.targetSales; $('vehicle').value=settings.vehicle; $('plannedStart').value=settings.plannedStart; $('plannedEnd').value=settings.plannedEnd; $('areas').value=settings.areas; $('settingsDialog').showModal(); });
$('saveSettings').addEventListener('click', () => { settings={targetSales:Number($('targetSales').value||0),vehicle:$('vehicle').value.trim(),plannedStart:$('plannedStart').value,plannedEnd:$('plannedEnd').value,areas:$('areas').value.trim()}; localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings)); render(); });

function summaryText() {
  const rs = rides(); const cash = rs.filter(r=>r.payment==='現金').reduce((s,r)=>s+Number(r.fare||0)+Number(r.tip||0),0); const go = rs.filter(r=>r.dispatch==='GO').reduce((s,r)=>s+Number(r.fare||0)+Number(r.tip||0),0);
  return [`【YOS Taxi 営業報告】`,`営業日：${state.businessDate}`,`車両：${settings.vehicle}`,`状態：${STATUS[state.status]?.title || state.status}`,`営業開始：${timeText(state.shiftStart) || '未記録'}`,`営業終了：${timeText(state.shiftEnd) || '営業中'}`,`売上：${totalSales()}円`,`乗車回数：${rs.length}回`,`平均単価：${Math.round(rs.length?totalSales()/rs.length:0)}円`,`営業時間：${durationLabel(workingMs())}`,`休憩時間：${durationLabel(sumBreakMs())}`,`営業時給：${Math.round(hourlySales())}円`,`現金売上：${cash}円`,`GO売上：${go}円`,`今日の目標：${settings.targetSales}円`,`目標差：${totalSales()-settings.targetSales}円`,`次：ProjectY運行データへ保存し、紙日報写真を確認する`].join('\n');
}
async function shareSummary() { const text=summaryText(); if(navigator.share){try{await navigator.share({title:'YOS Taxi 営業報告',text});return;}catch{}} await navigator.clipboard.writeText(text); alert('営業報告をコピーしました。YOSへ貼り付けてください。'); }
$('shareButton').addEventListener('click', shareSummary);
function csvEscape(v){const s=String(v??'');return /[",\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s}
function eventRows(){return [...state.events].reverse().map(e=>[e.at,state.businessDate,e.type,e.start||e.at,e.end||'',e.pickup||'',e.dropoff||'',e.fare||'',e.payment||'',e.dispatch||'',e.distance||'',e.emptyTime||'',e.durationMs&&e.type==='休憩終了'?Math.round(e.durationMs/60000):'',e.memo||'',e.status||state.status])}
function download(name,content,type){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
$('csvButton').addEventListener('click',()=>{const header=['記録日時','営業日','種別','開始時刻','終了時刻','乗車地','降車地','売上','支払方法','配車アプリ','実車距離','空車時間','休憩時間','メモ','営業状態'];download(`yos-taxi-${state.businessDate}.csv`,[header,...eventRows()].map(r=>r.map(csvEscape).join(',')).join('\n'),'text/csv;charset=utf-8')});
$('backupButton').addEventListener('click',()=>download(`yos-taxi-${state.businessDate}.json`,JSON.stringify({state,settings},null,2),'application/json'));
$('resetButton').addEventListener('click',()=>{if(confirm('本日の端末内データを初期化します。バックアップ済みですか？')){state=blankState();save();}});

window.addEventListener('storage',()=>{state=loadState();settings=loadSettings();render()});
if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(()=>{}));
render();
