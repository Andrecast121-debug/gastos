
// Helper to conditionally include HTML snippets
function _h(cond, html) { return cond ? html : ''; }
function _hs(html) { return html || ''; }


// ══════════════════════════════════════════════════════════════
// CONFIG — cambia estos valores a los de tu repo
// ══════════════════════════════════════════════════════════════
const REPO_OWNER = 'Andrecast121-debug';
const REPO_NAME  = 'gastos';
const DATA_FILE  = 'data.json';
// ══════════════════════════════════════════════════════════════

const CATS = {
  despensa:        { label:'Despensa',         icon:'🛒', color:'var(--cat-despensa)' },
  salidas:         { label:'Salidas',           icon:'🍽', color:'var(--cat-salidas)' },
  entretenimiento: { label:'Entretenimiento',  icon:'🎬', color:'var(--cat-entretenimiento)' },
  fijos:           { label:'Fijos',             icon:'💳', color:'var(--cat-fijos)' },
  msi:             { label:'Compras MSI',       icon:'📦', color:'var(--cat-msi)' },
  otro:            { label:'Otro',              icon:'📌', color:'var(--cat-otro)' },
};

// ── CRYPTO ────────────────────────────────────────────────────
async function deriveKey(password) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name:'PBKDF2', salt: enc.encode('finanzas-ka-salt'), iterations:100000, hash:'SHA-256' },
    keyMaterial, { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']
  );
}

async function encryptData(data, password) {
  const key = await deriveKey(password);
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, enc.encode(JSON.stringify(data)));
  // pack iv + ciphertext as base64
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decryptData(b64, password) {
  const key  = await deriveKey(password);
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const iv    = bytes.slice(0, 12);
  const data  = bytes.slice(12);
  const dec   = await crypto.subtle.decrypt({ name:'AES-GCM', iv }, key, data);
  return JSON.parse(new TextDecoder().decode(dec));
}

// ── AUTH ──────────────────────────────────────────────────────
let currentUser = null;
let currentPAT  = null;
let currentPass = null;

// Check if PAT is stored — if not, show PAT field
function togglePassVis(inputId, btn) {
  const input = document.getElementById(inputId);
  if(!input) return;
  const isPass = input.type === 'password';
  input.type = isPass ? 'text' : 'password';
  btn.textContent = isPass ? '🙈' : '👁';
}

function checkLoginMode() {
  const storedPAT = localStorage.getItem('fka-pat');
  const patField  = document.getElementById('pat-field');
  const sub       = document.getElementById('login-sub');
  if(storedPAT) {
    patField.style.display = 'none';
    sub.textContent = 'Ingresa tu contraseña';
  } else {
    patField.style.display = 'block';
    sub.textContent = 'Primera vez — ingresa tu token y contraseña';
  }
}

async function doLogin() {
  const user = document.getElementById('login-user').value;
  const pass = document.getElementById('login-pass').value.trim();
  const errEl = document.getElementById('login-err');
  errEl.style.display = 'none';

  if(!pass) { errEl.textContent='Ingresa tu contraseña.'; errEl.style.display='block'; return; }

  // Get PAT: from field (first time) or from localStorage
  let pat = localStorage.getItem('fka-pat') || '';
  const patInput = document.getElementById('login-pat').value.trim();
  if(patInput) pat = patInput; // user typed a new one

  if(!pat) { errEl.textContent='Ingresa tu GitHub Token.'; errEl.style.display='block'; return; }

  const loginBtn = document.querySelector('.login-btn');
  loginBtn.textContent = 'Verificando…';
  loginBtn.disabled = true;

  try {
    const r = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`, {
      headers: { Authorization: `token ${pat}`, 'User-Agent': 'finanzas-ka' }
    });
    if(!r.ok) throw new Error('bad token');

    currentUser = user; currentPAT = pat; currentPass = pass;
    localStorage.setItem('fka-user', user);
    localStorage.setItem('fka-pat',  pat);
    localStorage.setItem('fka-pass', pass);
    errEl.style.display = 'none';
    showApp();
  } catch(e) {
    errEl.textContent = 'Token inválido o sin conexión. Verifica e intenta de nuevo.';
    errEl.style.display = 'block';
    // clear stored PAT so user can re-enter
    localStorage.removeItem('fka-pat');
    document.getElementById('pat-field').style.display = 'block';
  } finally {
    loginBtn.textContent = 'Entrar';
    loginBtn.disabled = false;
  }
}

function doLogout() {
  localStorage.removeItem('fka-user');
  localStorage.removeItem('fka-pat');
  localStorage.removeItem('fka-pass');
  currentUser = null; currentPAT = null; currentPass = null;
  document.getElementById('app-screen').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display   = 'block';
  document.getElementById('sync-user').textContent = currentUser === 'karla' ? '👩 Karla' : '👨 Andre';
  loadFromGitHub();
}

// ── SYNC ──────────────────────────────────────────────────────
let fileSHA = null;
let state = { fijos:[], gastos:[], compras:[] };
let saveTimeout = null;

function setSyncState(status, msg) {
  const dot = document.getElementById('sync-dot');
  const txt = document.getElementById('sync-msg');
  dot.className = 'sync-dot ' + status;
  txt.textContent = msg;
}

async function loadFromGitHub() {
  setSyncState('loading', 'Cargando datos…');
  try {
    const r = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${DATA_FILE}`,
      { headers: { Authorization: `token ${currentPAT}`, 'User-Agent': 'finanzas-ka' } }
    );
    if(r.status === 404) {
      fileSHA = null;
      state = { fijos:[], gastos:[], compras:[], ahorros:[], ahorro_meta:0 };
      setSyncState('ok', 'Listo — primera vez, datos vacíos');
    } else if(r.ok) {
      const json = await r.json();
      fileSHA = json.sha;
      const raw = atob(json.content.replace(/\n/g,''));
      // try decrypt; if it looks like plain JSON (legacy) parse directly
      let parsed;
      try {
        const trimmed = raw.trim();
        if(trimmed === '{}' || trimmed === '') {
          // empty/reset data.json — start fresh, no error
          parsed = { fijos:[], gastos:[], compras:[], ahorros:[], ahorro_meta:0 };
        } else if(trimmed.startsWith('{')) {
          parsed = JSON.parse(trimmed);
        } else {
          parsed = await decryptData(raw, currentPass);
        }
      } catch(decErr) {
        // could be wrong password OR corrupted JSON
        console.warn('Decrypt/parse error:', decErr.message);
        if(decErr.message && decErr.message.includes('JSON')) {
          // corrupted data — start fresh but warn
          setSyncState('err', 'Datos corruptos — iniciando vacío');
          parsed = { fijos:[], gastos:[], compras:[], ahorros:[], ahorro_meta:0 };
          fileSHA = json.sha; // keep SHA so we can overwrite
        } else {
          setSyncState('err', 'Contraseña incorrecta');
          document.getElementById('app-screen').style.display='none';
          document.getElementById('login-screen').style.display='flex';
          const errEl = document.getElementById('login-err');
          errEl.textContent = 'Contraseña incorrecta.';
          errEl.style.display='block';
          return;
        }
      }
      state = { fijos:[], gastos:[], compras:[], ahorros:[], ahorro_meta:0, ...parsed };
      setSyncState('ok', 'Sincronizado · ' + new Date().toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'}));
    } else {
      throw new Error('fetch failed');
    }
  } catch(e) {
    if(e.message !== 'fetch failed') throw e;
    setSyncState('err', 'Error al cargar — usando datos locales');
    const local = localStorage.getItem('fka-state');
    if(local) state = JSON.parse(local);
  }
  checkFijosReset();
  populateMonthSelect('resumen-mes');
  populateMonthSelect('gastos-mes');
  renderResumen();
}

async function saveToGitHub() {
  setSyncState('loading', 'Guardando…');
  localStorage.setItem('fka-state', JSON.stringify(state)); // local backup
  const encrypted = await encryptData(state, currentPass);
  const content = btoa(unescape(encodeURIComponent(encrypted)));
  const body = {
    message: `update by ${currentUser}`,
    content,
    ...(fileSHA ? { sha: fileSHA } : {})
  };
  try {
    const r = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${DATA_FILE}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `token ${currentPAT}`,
          'Content-Type': 'application/json',
          'User-Agent': 'finanzas-ka'
        },
        body: JSON.stringify(body)
      }
    );
    if(r.ok) {
      const json = await r.json();
      fileSHA = json.content ? json.content.sha : fileSHA;
      setSyncState('ok', 'Guardado · ' + new Date().toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'}));
    } else {
      const err = await r.json();
      // conflict — reload and retry
      if(r.status === 409 || r.status === 422) {
        setSyncState('err', 'Conflicto — recargando…');
        await loadFromGitHub();
      } else {
        throw new Error(err.message);
      }
    }
  } catch(e) {
    setSyncState('err', 'Error al guardar');
  }
}

function checkFijosReset() {
  const mesActual = new Date().toISOString().slice(0,7); // "2026-08"
  const ultimoMes = state.fijos_ultimo_mes || '';

  if(ultimoMes === mesActual) return; // ya se revisó este mes, nada que hacer

  // es un mes nuevo (o primera vez) — resetear liquidado de todos los fijos
  let huboReset = false;
  state.fijos.forEach(f => {
    if(f.liquidado) {
      f.liquidado = false;
      huboReset = true;
    }
  });
  if(huboReset) {
    setSyncState('loading', 'Nuevo mes — reiniciando fijos…');
  }

  state.fijos_ultimo_mes = mesActual;
  save();
}

function save() {
  localStorage.setItem('fka-state', JSON.stringify(state));
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveToGitHub, 400);
}

// ── NAV ───────────────────────────────────────────────────────
function showPage(id, e) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b=>b.classList.remove('active'));
  document.getElementById('page-'+id).classList.add('active');
  if(e && e.target) e.target.classList.add('active');
  if(id==='resumen')   renderResumen();
  if(id==='gastos')    renderGastos();
  if(id==='fijos')     renderFijos();
  if(id==='compras')   renderCompras();
  if(id==='historial') renderHistorial();
  if(id==='ahorro')    { renderAhorro(); const today=new Date().toISOString().split('T')[0]; setTimeout(()=>{ const el=document.getElementById('ah-fecha'); if(el) el.value=today; },50); }
}

function toggleForm(type) {
  const f = document.getElementById('form-'+type);
  const open = f.style.display !== 'none';
  f.style.display = open ? 'none' : 'block';
  if(!open) {
    const today = new Date().toISOString().split('T')[0];
    if(type==='gasto')  { document.getElementById('g-fecha').value = today; calcGastoSplit(); }
    if(type==='compra') { document.getElementById('comp-fecha').value = today; }
  }
}

// ── HELPERS ───────────────────────────────────────────────────
function fmt(n) { return '$'+(+n||0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function formatMonth(ym) {
  const [y,m] = ym.split('-');
  return ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][+m-1]+' '+y;
}
function allMonths() {
  const s = new Set();
  s.add(new Date().toISOString().slice(0,7));
  state.gastos.forEach(g=>s.add(g.fecha.slice(0,7)));
  return [...s].sort().reverse();
}
function populateMonthSelect(elId) {
  const sel = document.getElementById(elId);
  if(!sel) return;
  const cur = sel.value;
  const months = allMonths();
  sel.innerHTML = months.map(m=>`<option value="${m}">${formatMonth(m)}</option>`).join('');
  if(months.includes(cur)) sel.value = cur;
}

// ── FIJOS ─────────────────────────────────────────────────────
document.getElementById('fijo-pagador').addEventListener('change', function() {
  const v = this.value;
  document.getElementById('fijo-karla-wrap').style.display = v==='custom'?'block':'none';
  document.getElementById('fijo-andre-wrap').style.display = v==='custom'?'block':'none';
});
function calcAndre() { const t=+document.getElementById('fijo-monto').value||0; document.getElementById('fijo-andre').value=Math.max(0,t-(+document.getElementById('fijo-karla').value||0)).toFixed(2); }
function calcKarla() { const t=+document.getElementById('fijo-monto').value||0; document.getElementById('fijo-karla').value=Math.max(0,t-(+document.getElementById('fijo-andre').value||0)).toFixed(2); }

function addFijo() {
  const nombre=document.getElementById('fijo-nombre').value.trim();
  const monto=+document.getElementById('fijo-monto').value||0;
  const pagador=document.getElementById('fijo-pagador').value;
  const cat=document.getElementById('fijo-cat').value;
  if(!nombre||!monto) return alert('Llena nombre y monto.');
  let karla=0, andre=0;
  if(pagador==='karla')  karla=monto;
  else if(pagador==='andre') andre=monto;
  else if(pagador==='ambos') { karla=monto/2; andre=monto/2; }
  else { karla=+document.getElementById('fijo-karla').value||0; andre=+document.getElementById('fijo-andre').value||0; }
  const quien_pago_fijo = document.getElementById('fijo-quien-pago').value;
  state.fijos.push({id:Date.now(),nombre,monto,pagador,karla,andre,cat,quien_pago:quien_pago_fijo,liquidado:quien_pago_fijo==='compartido'});
  save(); renderFijos();
  document.getElementById('fijo-nombre').value=''; document.getElementById('fijo-monto').value='';
  document.getElementById('fijo-pagador').value='karla';
  document.getElementById('fijo-karla-wrap').style.display='none';
  document.getElementById('fijo-andre-wrap').style.display='none';
  toggleForm('fijo');
}
function deleteFijo(id) {
  if(!confirm('¿Eliminar este gasto fijo?')) return;
  state.fijos=state.fijos.filter(f=>f.id!==id); save(); renderFijos();
}
function toggleLiquidadoFijo(id) {
  const f = state.fijos.find(x=>x.id===id);
  if(!f) return;
  f.liquidado = !f.liquidado;
  save(); renderFijos(); renderResumen();
}
function renderFijos() {
  const el=document.getElementById('list-fijos');
  if(!state.fijos.length) { el.innerHTML='<div class="empty">Sin gastos fijos.</div>'; return; }
  const totalK=state.fijos.reduce((s,f)=>s+f.karla,0);
  const totalA=state.fijos.reduce((s,f)=>s+f.andre,0);
  const byCat={};
  state.fijos.forEach(f=>{ const k=f.cat||'fijos'; if(!byCat[k]) byCat[k]=[]; byCat[k].push(f); });
  const parts=[];
  parts.push('<div class="card" style="margin-bottom:14px"><div class="breakdown">');
  parts.push('<div class="breakdown-row"><span>Karla mensual</span><span class="amount" style="color:var(--karla)">'+fmt(totalK)+'</span></div>');
  parts.push('<div class="breakdown-row"><span>Andre mensual</span><span class="amount" style="color:var(--andre)">'+fmt(totalA)+'</span></div>');
  parts.push('<div class="total-row"><span>Total mensual</span><span style="color:var(--shared)">'+fmt(totalK+totalA)+'</span></div>');
  parts.push('</div></div>');
  Object.entries(byCat).forEach(function([cat,items]) {
    const cc=CATS[cat]||CATS.otro;
    const catTotal=items.reduce((s,f)=>s+f.monto,0);
    const pendCount=items.filter(f=>!f.liquidado&&f.quien_pago&&f.quien_pago!=='compartido').length;
    const uid='ff-'+cat;
    const metaTxt=items.length+' servicio'+(items.length!==1?'s':'')+(pendCount>0?' \u00b7 '+pendCount+' pendiente'+(pendCount!==1?'s':''):' \u00b7 \u2705 al corriente');
    const itemParts=[];
    items.forEach(function(f) {
      const fDeuda=(!f.liquidado&&f.quien_pago&&f.quien_pago!=='compartido')
        ?(f.quien_pago==='karla'&&f.andre>0?'Andre debe '+fmt(f.andre)
          :f.quien_pago==='andre'&&f.karla>0?'Karla debe '+fmt(f.karla):null):null;
      itemParts.push('<div class="entry'+(f.liquidado?' entry-liquidada':'')+'">');
      itemParts.push('<div class="entry-main">');
      itemParts.push('<div class="entry-name">'+f.nombre+(f.liquidado?' <span class="liq-badge">\u2713 Liquidado</span>':'')+'</div>');
      itemParts.push('<div class="entry-split">');
      if(f.quien_pago&&f.quien_pago!=='compartido') itemParts.push('<span class="pagador-tag '+f.quien_pago+'">Pag\u00f3 '+(f.quien_pago==='karla'?'Karla':'Andre')+'</span>');
      if(f.karla>0) itemParts.push('<span class="split-tag karla">K '+fmt(f.karla)+'</span>');
      if(f.andre>0) itemParts.push('<span class="split-tag andre">A '+fmt(f.andre)+'</span>');
      itemParts.push('</div>');
      if(fDeuda) itemParts.push('<div class="debe-tag">\uD83D\uDCB8 '+fDeuda+'</div>');
      itemParts.push('</div>');
      itemParts.push('<div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px">');
      itemParts.push('<div class="entry-amount" style="color:'+cc.color+'">'+fmt(f.monto)+'</div>');
      if(f.quien_pago&&f.quien_pago!=='compartido') itemParts.push('<button class="liq-btn'+(f.liquidado?' liq-done':'')+'" onclick="toggleLiquidadoFijo('+f.id+')">'+(f.liquidado?'\u21a9 Reabrir':'\u2713 Ya liqu\u00edd\u00e9')+'</button>');
      itemParts.push('</div>');
      itemParts.push('<button class="edit-btn" onclick="openEdit(\'fijo\','+f.id+')" title="Editar">\u270f\ufe0f</button>');
      itemParts.push('<button class="btn btn-danger" onclick="deleteFijo('+f.id+')">\u2715</button>');
      itemParts.push('</div>');
    });
    parts.push('<div class="cat-folder">');
    parts.push('<div class="cat-folder-header" onclick="toggleCatFolder(\''+uid+'\')">');
    parts.push('<div class="cat-folder-left">');
    parts.push('<div class="cat-folder-icon">'+cc.icon+'</div>');
    parts.push('<div class="cat-folder-info">');
    parts.push('<div class="cat-folder-name">'+cc.label+'</div>');
    parts.push('<div class="cat-folder-meta">'+metaTxt+'</div>');
    parts.push('</div></div>');
    parts.push('<div class="cat-folder-right">');
    parts.push('<span class="cat-folder-total" style="color:'+cc.color+'">'+fmt(catTotal)+'</span>');
    parts.push('<span class="cat-folder-chev" id="chev-'+uid+'">\u25bc</span>');
    parts.push('</div></div>');
    parts.push('<div class="cat-folder-body" id="'+uid+'">');
    parts.push(itemParts.join(''));
    parts.push('</div></div>');
  });
  el.innerHTML=parts.join('');
}

// ── GASTOS ────────────────────────────────────────────────────
function calcGastoSplit() {
  const t=+document.getElementById('g-total').value||0;
  const sp=document.getElementById('g-split').value;
  document.getElementById('g-k-wrap').style.display=sp==='custom'?'block':'none';
  document.getElementById('g-a-wrap').style.display=sp==='custom'?'block':'none';
  if(sp==='50/50') { document.getElementById('g-karla').value=(t/2).toFixed(2); document.getElementById('g-andre').value=(t/2).toFixed(2); }
  if(sp==='karla') { document.getElementById('g-karla').value=t; document.getElementById('g-andre').value=0; }
  if(sp==='andre') { document.getElementById('g-karla').value=0; document.getElementById('g-andre').value=t; }
}
function syncGastoAndre() { const t=+document.getElementById('g-total').value||0; document.getElementById('g-andre').value=Math.max(0,t-(+document.getElementById('g-karla').value||0)).toFixed(2); }
function syncGastoKarla() { const t=+document.getElementById('g-total').value||0; document.getElementById('g-karla').value=Math.max(0,t-(+document.getElementById('g-andre').value||0)).toFixed(2); }

function addGasto() {
  const nombre=document.getElementById('g-nombre').value.trim();
  const fecha=document.getElementById('g-fecha').value;
  const total=+document.getElementById('g-total').value||0;
  const cat=document.getElementById('g-cat').value;
  const notas=document.getElementById('g-notas').value.trim();
  if(!nombre||!fecha||!total) return alert('Llena descripción, fecha y monto.');
  const karla=+document.getElementById('g-karla').value||0;
  const andre=+document.getElementById('g-andre').value||0;
  const quien_pago=document.getElementById('g-quien-pago').value;
  state.gastos.push({id:Date.now(),nombre,fecha,total,karla,andre,cat,notas,quien_pago,liquidado:quien_pago==='compartido'});
  save(); renderGastos(); populateMonthSelect('resumen-mes'); populateMonthSelect('gastos-mes');
  document.getElementById('g-nombre').value=''; document.getElementById('g-total').value=''; document.getElementById('g-notas').value='';
  toggleForm('gasto');
}
function deleteGasto(id) {
  if(!confirm('¿Eliminar este gasto?')) return;
  state.gastos=state.gastos.filter(g=>g.id!==id); save(); renderGastos();
}
function toggleLiquidado(id) {
  const g = state.gastos.find(x=>x.id===id);
  if(!g) return;
  g.liquidado = !g.liquidado;
  save(); renderGastos(); renderResumen();
}
function renderGastos() {
  populateMonthSelect('gastos-mes');
  const mes=document.getElementById('gastos-mes').value;
  const items=state.gastos.filter(g=>g.fecha.startsWith(mes)).sort((a,b)=>b.fecha.localeCompare(a.fecha));
  const el=document.getElementById('list-gastos');
  if(!items.length) { el.innerHTML='<div class="empty">Sin gastos en este mes.</div>'; return; }
  const byCat={};
  items.forEach(g=>{ if(!byCat[g.cat]) byCat[g.cat]=[]; byCat[g.cat].push(g); });
  const totalK=items.reduce((s,g)=>s+g.karla,0);
  const totalA=items.reduce((s,g)=>s+g.andre,0);
  const parts=[];
  parts.push('<div class="card" style="margin-bottom:14px"><div class="breakdown">');
  parts.push('<div class="breakdown-row"><span>Karla este mes</span><span class="amount" style="color:var(--karla)">'+fmt(totalK)+'</span></div>');
  parts.push('<div class="breakdown-row"><span>Andre este mes</span><span class="amount" style="color:var(--andre)">'+fmt(totalA)+'</span></div>');
  parts.push('<div class="total-row"><span>Total</span><span style="color:var(--shared)">'+fmt(totalK+totalA)+'</span></div>');
  parts.push('</div></div>');
  Object.entries(byCat).forEach(function([cat,gs]) {
    const cc=CATS[cat]||CATS.otro;
    const catTotal=gs.reduce((s,g)=>s+g.total,0);
    const pendCount=gs.filter(g=>!g.liquidado&&g.quien_pago&&g.quien_pago!=='compartido').length;
    const uid='gf-'+cat+'-'+mes.replace('-','');
    const itemParts=[];
    gs.forEach(function(g) {
      const debeQuien=(!g.liquidado&&g.quien_pago&&g.quien_pago!=='compartido')
        ?(g.quien_pago==='karla'&&g.andre>0?'Andre le debe a Karla'
          :g.quien_pago==='andre'&&g.karla>0?'Karla le debe a Andre':null):null;
      itemParts.push('<div class="entry'+(g.liquidado?' entry-liquidada':'')+'">');
      itemParts.push('<div class="entry-main">');
      itemParts.push('<div class="entry-name">'+g.nombre+(g.liquidado?' <span class="liq-badge">\u2713 Liquidado</span>':'')+'</div>');
      itemParts.push('<div class="entry-sub">'+g.fecha+(g.notas?' \u00b7 '+g.notas:'')+'</div>');
      itemParts.push('<div class="entry-split">');
      if(g.quien_pago&&g.quien_pago!=='compartido') itemParts.push('<span class="pagador-tag '+g.quien_pago+'">Pag\u00f3 '+(g.quien_pago==='karla'?'Karla':'Andre')+'</span>');
      if(g.karla>0) itemParts.push('<span class="split-tag karla">K '+fmt(g.karla)+'</span>');
      if(g.andre>0) itemParts.push('<span class="split-tag andre">A '+fmt(g.andre)+'</span>');
      itemParts.push('</div>');
      if(debeQuien) itemParts.push('<div class="debe-tag">\uD83D\uDCB8 '+debeQuien+': '+fmt(g.quien_pago==='karla'?g.andre:g.karla)+'</div>');
      itemParts.push('</div>');
      itemParts.push('<div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px">');
      itemParts.push('<div class="entry-amount" style="color:'+cc.color+'">'+fmt(g.total)+'</div>');
      if(g.quien_pago&&g.quien_pago!=='compartido') itemParts.push('<button class="liq-btn'+(g.liquidado?' liq-done':'')+'" onclick="toggleLiquidado('+g.id+')">'+(g.liquidado?'\u21a9 Reabrir':'\u2713 Ya liqu\u00edd\u00e9')+'</button>');
      itemParts.push('</div>');
      itemParts.push('<button class="edit-btn" onclick="openEdit(\'gasto\','+g.id+')" title="Editar">\u270f\ufe0f</button>');
      itemParts.push('<button class="btn btn-danger" onclick="deleteGasto('+g.id+')">\u2715</button>');
      itemParts.push('</div>');
    });
    parts.push('<div class="cat-folder">');
    parts.push('<div class="cat-folder-header" onclick="toggleCatFolder(\''+uid+'\')">');
    parts.push('<div class="cat-folder-left">');
    parts.push('<div class="cat-folder-icon">'+cc.icon+'</div>');
    parts.push('<div class="cat-folder-info">');
    parts.push('<div class="cat-folder-name">'+cc.label+'</div>');
    parts.push('<div class="cat-folder-meta">'+gs.length+' gasto'+(gs.length!==1?'s':'')+(pendCount>0?' \u00b7 '+pendCount+' pendiente'+(pendCount!==1?'s':''):'')+'</div>');
    parts.push('</div></div>');
    parts.push('<div class="cat-folder-right">');
    parts.push('<span class="cat-folder-total" style="color:'+cc.color+'">'+fmt(catTotal)+'</span>');
    parts.push('<span class="cat-folder-chev" id="chev-'+uid+'">\u25bc</span>');
    parts.push('</div></div>');
    parts.push('<div class="cat-folder-body" id="'+uid+'">');
    parts.push(itemParts.join(''));
    parts.push('</div></div>');
  });
  el.innerHTML=parts.join('');
}

function toggleCatFolder(uid) {
  const body=document.getElementById(uid);
  const chev=document.getElementById('chev-'+uid);
  if(!body) return;
  body.classList.toggle('open');
  if(chev) chev.classList.toggle('open');
}

// ── COMPRAS MSI ───────────────────────────────────────────────
function calcMensualidad() {
  const t=+document.getElementById('comp-total').value||0;
  const m=+document.getElementById('comp-meses').value||12;
  document.getElementById('comp-mens').value=t>0?fmt(t/m)+' / mes':'—';
}
function addCompra() {
  const nombre=document.getElementById('comp-nombre').value.trim();
  const fecha=document.getElementById('comp-fecha').value;
  const total=+document.getElementById('comp-total').value||0;
  const meses=+document.getElementById('comp-meses').value;
  const tarjeta=document.getElementById('comp-tarjeta').value.trim();
  const quien=document.getElementById('comp-quien').value;
  const split=document.getElementById('comp-split').value;
  const notas=document.getElementById('comp-notas').value.trim();
  if(!nombre||!fecha||!total) return alert('Llena nombre, fecha y precio.');
  const mensualidad=total/meses;
  let karla=0, andre=0;
  if(split==='50/50') { karla=mensualidad/2; andre=mensualidad/2; }
  else if(quien==='karla') { karla=mensualidad; andre=0; }
  else if(quien==='andre') { karla=0; andre=mensualidad; }
  else if(quien==='ambos') { karla=mensualidad/2; andre=mensualidad/2; }
  const end=new Date(fecha); end.setMonth(end.getMonth()+meses);
  state.compras.push({id:Date.now(),nombre,fecha,total,meses,mensualidad,tarjeta,quien,split,notas,karla,andre,end:end.toISOString().slice(0,7)});
  save(); renderCompras();
  document.getElementById('comp-nombre').value=''; document.getElementById('comp-total').value='';
  document.getElementById('comp-tarjeta').value=''; document.getElementById('comp-notas').value='';
  document.getElementById('comp-mens').value='—';
  toggleForm('compra');
}
function deleteCompra(id) {
  if(!confirm('¿Eliminar esta compra?')) return;
  state.compras=state.compras.filter(c=>c.id!==id); save(); renderCompras();
}
function pagarMes(id) {
  const comp = state.compras.find(x=>x.id===id);
  if(!comp) return;
  // if split 50/50, track each person separately
  if(comp.split==='50/50' || (comp.karla>0 && comp.andre>0)) {
    // figure out who is logged in to know whose button this is
    // we use a shared pagados counter but track by halves
    // simplest: one button click = one half-payment recorded
    const pagados = (comp.pagados||0);
    if(pagados >= comp.meses*2) return; // both halves of all months paid
    comp.pagados = pagados + 1;
  } else {
    const pagados = (comp.pagados||0);
    if(pagados >= comp.meses) return;
    comp.pagados = pagados + 1;
  }
  save(); renderCompras();
}
function despagarMes(id) {
  const comp = state.compras.find(x=>x.id===id);
  if(!comp || !comp.pagados) return;
  comp.pagados = comp.pagados - 1;
  save(); renderCompras();
}
function renderCompras() {
  const el=document.getElementById('list-compras');
  if(!state.compras.length) { el.innerHTML='<div class="empty">Sin compras a meses registradas.</div>'; return; }

  function rItem(c) {
    const isSplit = c.split==='50/50' || (c.karla>0 && c.andre>0);
    const pagados_raw = c.pagados || 0;
    // for split: every 2 clicks = 1 full month paid
    const pagados     = isSplit ? Math.floor(pagados_raw/2) : pagados_raw;
    const halfPending = isSplit ? (pagados_raw % 2 === 1) : false; // one person paid, other hasn't
    const pendientes  = c.meses - pagados;
    const pct         = Math.round(pagados_raw / (isSplit ? c.meses*2 : c.meses) * 100);
    const pagado_total = pagados_raw * (isSplit ? c.mensualidad/2 : c.mensualidad);
    const restante    = c.total - pagado_total;
    const terminado   = isSplit ? pagados_raw >= c.meses*2 : pagados_raw >= c.meses;

    // progress bar color: yellow → green as it fills
    const barColor = terminado ? 'var(--green)' : 'var(--cat-msi)';

    // pip dots (max 24 shown, then just numbers)
    let pipsHtml = '';
    if(c.meses <= 24) {
      pipsHtml = '<div class="msi-pips">';
      for(let i=0;i<c.meses;i++) {
        const halvesForThisMonth = isSplit ? Math.min(2, Math.max(0, pagados_raw - i*2)) : (i<pagados_raw?1:0);
        const pipClass = isSplit
          ? (halvesForThisMonth>=2?'paid':halvesForThisMonth===1?'half':'')
          : (i<pagados_raw?'paid':'');
        pipsHtml += `<div class="msi-pip ${pipClass}"></div>${''}` + '';
      }
      pipsHtml += '</div>';
    }

    return `<div class="msi-card ${terminado?'terminado':''}">
      <div class="msi-card-header">
        <div class="msi-card-left">
          <div class="msi-nombre">${c.nombre}</div>
          <div class="msi-sub">${c.tarjeta||''}${c.tarjeta&&c.notas?' · ':''}${c.notas||''}</div>
          <div class="entry-split" style="margin-top:5px">
            <span class="pill ${c.quien==='ambos'?'ambos':c.quien}">${c.quien==='ambos'?'Compartido':c.quien==='karla'?'Karla':'Andre'}</span>
            ${c.karla>0?`<span class="split-tag karla">K ${fmt(c.karla)}/mes</span>`:''}
            ${c.andre>0?`<span class="split-tag andre">A ${fmt(c.andre)}/mes</span>`:''}
          </div>
        </div>
        <div class="msi-card-right">
          <div class="msi-mensualidad">${fmt(c.mensualidad)}<span style="font-size:11px;color:var(--muted)">/mes</span></div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">${fmt(c.total)} total</div>
        </div>
      </div>

      <div class="msi-progress-section">
        <div class="msi-progress-labels">
          <span>${terminado?'✅ Liquidado':halfPending?'⏳ Falta una mitad…':`${pendientes} mes${pendientes!==1?'es':''} restante${pendientes!==1?'s':''}`}</span>
          <span style="color:${barColor};font-weight:700">${pagados}/${c.meses} <span style="color:var(--muted);font-weight:400">(${pct}%)</span></span>
        </div>
        <div class="msi-bar-track">
          <div class="msi-bar-fill" style="width:${pct}%;background:${barColor}"></div>
        </div>
        ${pipsHtml}
        <div class="msi-amounts">
          <span style="color:var(--green)">Pagado: ${fmt(pagado_total)}</span>
          ${halfPending?'<span style=\"color:var(--yellow)\">⚠ Falta mitad del mes actual</span>':''}
          ${!terminado&&!halfPending?`<span style="color:var(--cat-msi)">Falta: ${fmt(restante)}</span>`:''}
        </div>
      </div>

      <div class="msi-actions">
        ${!terminado
          ? `<button class="msi-pay-btn" onclick="pagarMes(${c.id})">✓ Ya pagué este mes</button>${''}` + ''
          : `<span style="color:var(--green);font-size:13px;font-weight:600">🎉 ¡Terminado!</span>`}
        <div style="display:flex;gap:6px">
          ${pagados>0?`<button class="btn btn-sm" style="background:var(--surface);border:1px solid var(--border);font-size:11px" onclick="despagarMes(${c.id})" title="Deshacer último pago">↩</button>`:''}
          <button class="btn btn-danger" onclick="deleteCompra(${c.id})">✕</button>
        <button class="edit-btn" onclick="openEdit('compra',${c.id})" title="Editar">✏️</button>
        </div>
      </div>
    </div>${''}` + '';
  }

  const active = state.compras.filter(c=>{
    const isSplit = c.split==='50/50'||(c.karla>0&&c.andre>0);
    return (c.pagados||0) < (isSplit?c.meses*2:c.meses);
  });
  const done = state.compras.filter(c=>{
    const isSplit = c.split==='50/50'||(c.karla>0&&c.andre>0);
    return (c.pagados||0) >= (isSplit?c.meses*2:c.meses);
  });

  // summary of active
  const totalMensual = active.reduce((s,c)=>s+c.mensualidad,0);
  const totalRestante = active.reduce((s,c)=>s+(c.total-(c.pagados||0)*c.mensualidad),0);

  let summaryHtml = '';
  if(active.length) {
    summaryHtml = `<div class="card" style="margin-bottom:14px"><div class="breakdown">
      <div class="breakdown-row"><span>Mensualidad total activa</span><span class="amount" style="color:var(--cat-msi)">${fmt(totalMensual)}/mes</span></div>
      <div class="breakdown-row"><span>Total por pagar</span><span class="amount" style="color:var(--yellow)">${fmt(totalRestante)}</span></div>
    </div></div>${''}` + '';
  }

  el.innerHTML = summaryHtml +
    (active.length?`<div class="section-header"><h2>Activas (${active.length})</h2></div>${active.map(rItem).join('')}`:'') +
    (done.length?`<div class="section-header" style="margin-top:20px"><h2 style="color:var(--muted)">Liquidadas (${done.length})</h2></div>${done.map(rItem).join('')}`:'');
}

// ── RESUMEN ───────────────────────────────────────────────────
function getMonthCats(ym) {
  const byCat={};
  const add=(cat,total,karla,andre,item)=>{
    if(!byCat[cat]) byCat[cat]={total:0,karla:0,andre:0,items:[]};
    byCat[cat].total+=total; byCat[cat].karla+=karla; byCat[cat].andre+=andre;
    byCat[cat].items.push(item);
  };
  state.gastos.filter(g=>g.fecha.startsWith(ym)).forEach(g=>add(g.cat,g.total,g.karla,g.andre,g));
  state.fijos.forEach(f=>{
    // el total del gasto fijo siempre es real,
    // pero quien lo pagó físicamente asume todo de su bolsillo hasta que el otro liquide
    let realK = f.karla, realA = f.andre;
    if(f.quien_pago === 'karla') { realK = f.monto; realA = 0; }
    else if(f.quien_pago === 'andre') { realK = 0; realA = f.monto; }
    add(f.cat||'fijos', f.monto, realK, realA, {...f,_fijo:true});
  });
  state.compras.filter(c=>c.fecha.slice(0,7)<=ym&&c.end>=ym).forEach(c=>add('msi',c.mensualidad,c.karla,c.andre,{...c,_msi:true}));
  return byCat;
}
function renderResumen() {
  populateMonthSelect('resumen-mes');
  const mes=document.getElementById('resumen-mes').value;
  const byCat=getMonthCats(mes);
  const total=Object.values(byCat).reduce((s,c)=>s+c.total,0);
  const totalK=Object.values(byCat).reduce((s,c)=>s+c.karla,0);
  const totalA=Object.values(byCat).reduce((s,c)=>s+c.andre,0);
  document.getElementById('summary-stats').innerHTML=`
    <div class="stat"><div class="stat-label">Karla</div><div class="stat-val" style="color:var(--karla)">${fmt(totalK)}</div></div>
    <div class="stat"><div class="stat-label">Andre</div><div class="stat-val" style="color:var(--andre)">${fmt(totalA)}</div></div>
    <div class="stat"><div class="stat-label">Total</div><div class="stat-val" style="color:var(--shared)">${fmt(total)}</div></div>${''}` + '';
  if(!Object.keys(byCat).length) {
    document.getElementById('resumen-breakdown').innerHTML='<div class="empty" style="padding:20px">Sin datos este mes.</div>';
    return;
  }
  const sorted=Object.entries(byCat).sort((a,b)=>b[1].total-a[1].total);
  let rows='';
  sorted.forEach(([cat,d])=>{
    const c=CATS[cat]||CATS.otro;
    const pct=total>0?Math.round(d.total/total*100):0;
    rows+=`<div class="breakdown-row">
      <span>${c.icon} ${c.label}</span>
      <span style="display:flex;align-items:center;gap:8px">
        <span style="font-size:11px;color:var(--muted)">${pct}%</span>
        <span class="amount" style="color:${c.color}">${fmt(d.total)}</span>
      </span>
    </div>${''}` + '';
  });
  document.getElementById('resumen-breakdown').innerHTML=`<div class="breakdown">${rows}<div class="total-row"><span>Total</span><span style="color:var(--shared)">${fmt(total)}</span></div></div>${''}` + '';

  // ── BALANCE: quién le debe cuánto a quién ──
  // gastos variables pendientes
  const pendientes = state.gastos.filter(g => !g.liquidado && g.quien_pago && g.quien_pago !== 'compartido');
  // fijos pendientes (paga uno pero el otro tiene parte)
  const fijosPend  = state.fijos.filter(f => !f.liquidado && f.quien_pago && f.quien_pago !== 'compartido'
    && ((f.quien_pago==='karla' && f.andre>0) || (f.quien_pago==='andre' && f.karla>0)));

  let karla_debe = 0, andre_debe = 0;
  pendientes.forEach(g => {
    if(g.quien_pago === 'andre' && g.karla > 0) karla_debe += g.karla;
    if(g.quien_pago === 'karla' && g.andre > 0) andre_debe += g.andre;
  });
  fijosPend.forEach(f => {
    if(f.quien_pago === 'andre' && f.karla > 0) karla_debe += f.karla;
    if(f.quien_pago === 'karla' && f.andre > 0) andre_debe += f.andre;
  });
  const totalPend = pendientes.length + fijosPend.length;
  const neto = karla_debe - andre_debe;

  // ── dos tarjetas: Karla→Andre y Andre→Karla ──
  function makeCard(deudor, acreedor, monto, colorClass, amountColor, payColor, payBorderColor) {
    if(monto <= 0) {
      return `<div class="balance-card balance-ok">
        <div class="balance-icon">✅</div>
        <div class="balance-text">
          <div class="balance-ok-msg">${deudor} no le debe nada a ${acreedor}</div>
        </div>
      </div>${''}` + '';
    }
    const pendK = deudor==='Karla' ? karla_debe : andre_debe;
    const quien = deudor==='Karla' ? 'karla' : 'andre';
    return `<div class="balance-card ${colorClass}">
      <div class="balance-icon">💸</div>
      <div class="balance-text">
        <div class="balance-title">${deudor} le debe a ${acreedor}</div>
        <div class="balance-amount" style="color:${amountColor}">${fmt(monto)}</div>
        <div class="balance-sub">${totalPend} pendiente${totalPend!==1?'s':''}</div>
      </div>
      <div class="balance-btns">
        <button class="balance-pay-btn" style="background:${payColor}15;border-color:${payColor}40;color:${payColor}" onclick="liquidarTodo('${quien}')">✓ ${deudor} pagó todo</button>
        <button class="balance-pay-btn" style="background:#fbbf2415;border-color:#fbbf2440;color:var(--yellow)" onclick="openParcial('${quien}',${monto})">Abonar parte…</button>
      </div>
    </div>${''}` + '';
  }

  const cardKarla = makeCard('Karla','Andre', karla_debe, 'balance-debe-k', 'var(--karla)', '#f472b6', '#f472b6');
  const cardAndre = makeCard('Andre','Karla', andre_debe, 'balance-debe-a', 'var(--andre)', '#60a5fa', '#60a5fa');

  document.getElementById('balance-banner').innerHTML = `
    <div class="balance-carousel" id="balance-carousel" onscroll="updateBalanceDots()">
      ${cardKarla}
      ${cardAndre}
    </div>
    <div class="balance-dots">
      <div class="balance-dot active" id="bdot-0"></div>
      <div class="balance-dot" id="bdot-1"></div>
    </div>${''}` + '';

  // lista de pendientes detallada
  let pendHtml = '';
  const mesGastos = state.gastos.filter(g=>!g.liquidado&&g.quien_pago&&g.quien_pago!=='compartido'&&g.fecha.startsWith(mes));
  const todosPend = totalPend > 0;
  if(todosPend) {
    let rows = '';
    // gastos del mes
    mesGastos.forEach(g=>{
      const debeAmt = g.quien_pago==='karla'?g.andre:g.karla;
      const deudor  = g.quien_pago==='karla'?'Andre':'Karla';
      rows += `<div class="pend-item">
        <div class="pend-main">
          <div class="pend-nombre">${g.nombre}</div>
          <div class="pend-sub">${g.fecha} · Pagó ${g.quien_pago==='karla'?'Karla':'Andre'}</div>
        </div>
        <div class="pend-right">
          <div class="pend-debe">${deudor} debe ${fmt(debeAmt)}</div>
          <button class="liq-btn" onclick="toggleLiquidado(${g.id});renderResumen()">✓ Liquidar</button>
        </div>
      </div>${''}` + '';
    });
    // fijos pendientes (siempre visibles, son recurrentes)
    fijosPend.forEach(f=>{
      const debeAmt = f.quien_pago==='karla'?f.andre:f.karla;
      const deudor  = f.quien_pago==='karla'?'Andre':'Karla';
      rows += `<div class="pend-item">
        <div class="pend-main">
          <div class="pend-nombre">${f.nombre} <span style="font-size:10px;color:var(--muted)">(fijo)</span></div>
          <div class="pend-sub">Mensual · Pagó ${f.quien_pago==='karla'?'Karla':'Andre'}</div>
        </div>
        <div class="pend-right">
          <div class="pend-debe">${deudor} debe ${fmt(debeAmt)}</div>
          <button class="liq-btn" onclick="toggleLiquidadoFijo(${f.id});renderResumen()">✓ Liquidar</button>
        </div>
      </div>${''}` + '';
    });
    if(rows) {
      pendHtml = `<div class="card" style="margin-top:14px">
        <div class="card-title">Pendientes de liquidar</div>
        ${rows}
      </div>${''}` + '';
    }
  }
  document.getElementById('pendientes-section').innerHTML = pendHtml;

  // ── CARRUSEL: todos los pendientes sin importar mes ──
  const mesGastosPend = state.gastos.filter(g =>
    !g.liquidado && g.quien_pago && g.quien_pago !== 'compartido'
  );
  const mesFijosPend = state.fijos.filter(f =>
    !f.liquidado && f.quien_pago && f.quien_pago !== 'compartido' &&
    ((f.quien_pago==='karla'&&f.andre>0)||(f.quien_pago==='andre'&&f.karla>0))
  );

  // lo que Karla debe este mes (gastos donde Andre pagó + fijos donde Andre pagó)
  const pendK_gastos = mesGastosPend.filter(g=>g.quien_pago==='andre'&&g.karla>0);
  const pendK_fijos  = mesFijosPend.filter(f=>f.quien_pago==='andre'&&f.karla>0);
  const pendK_total  = pendK_gastos.reduce((s,g)=>s+(g.karla-(g.abonado||0)),0)
                     + pendK_fijos.reduce((s,f)=>s+f.karla,0);

  // lo que Andre debe este mes (gastos donde Karla pagó + fijos donde Karla pagó)
  const pendA_gastos = mesGastosPend.filter(g=>g.quien_pago==='karla'&&g.andre>0);
  const pendA_fijos  = mesFijosPend.filter(f=>f.quien_pago==='karla'&&f.andre>0);
  const pendA_total  = pendA_gastos.reduce((s,g)=>s+(g.andre-(g.abonado||0)),0)
                     + pendA_fijos.reduce((s,f)=>s+f.andre,0);

  const pendTotal = pendK_total + pendA_total;

  function makePendCard(label, amount, color, items) {
    const parts = [];
    parts.push('<div class="pend-card">');
    parts.push('<div class="pend-card-label">'+label+'</div>');
    parts.push('<div class="pend-card-amount" style="color:'+color+'">'+fmt(amount)+'</div>');
    const subTxt = amount>0
      ? items.length+' concepto'+(items.length!==1?'s':'')+' pendiente'+(items.length!==1?'s':'')
      : 'Sin pendientes';
    parts.push('<div class="pend-card-sub">'+subTxt+'</div>');
    if(amount > 0) {
      parts.push('<div class="pend-card-rows">');
      const sorted = [...items].sort((a,b)=>(a._mes||'0').localeCompare(b._mes||'0'));
      sorted.forEach(function(it) {
        const mesLabel = it._fijo ? '(fijo mensual)' : formatMonth(it._mes);
        const quienLabel = it._quien ? ' · '+it._quien : '';
        parts.push('<div class="pend-card-row">');
        parts.push('<div style="display:flex;flex-direction:column;gap:1px;min-width:0">');
        parts.push('<span class="pend-card-row-name">'+it.nombre+quienLabel+'</span>');
        parts.push('<span style="font-size:10px;color:var(--muted)">'+mesLabel+'</span>');
        parts.push('</div>');
        parts.push('<span class="pend-card-row-amt" style="color:'+color+'">'+fmt(it._amt)+'</span>');
        parts.push('</div>');
      });
      parts.push('</div>');
    }
    parts.push('</div>');
    return parts.join('');
  }

  const itemsK = [
    ...pendK_gastos.map(g=>({nombre:g.nombre, _amt:g.karla-(g.abonado||0), _mes:g.fecha.slice(0,7)})),
    ...pendK_fijos.map(f=>({nombre:f.nombre, _amt:f.karla, _mes:null, _fijo:true}))
  ];
  const itemsA = [
    ...pendA_gastos.map(g=>({nombre:g.nombre, _amt:g.andre-(g.abonado||0), _mes:g.fecha.slice(0,7)})),
    ...pendA_fijos.map(f=>({nombre:f.nombre, _amt:f.andre, _mes:null, _fijo:true}))
  ];
  const itemsTotal = [
    ...itemsK.map(i=>({...i, _quien:'Karla'})),
    ...itemsA.map(i=>({...i, _quien:'Andre'}))
  ];

  const cardK     = makePendCard('💗 Karla debe',  pendK_total, 'var(--karla)', itemsK);
  const cardA     = makePendCard('💙 Andre debe',  pendA_total, 'var(--andre)', itemsA);
  const cardTotal = makePendCard('📊 Total pendiente', pendTotal, 'var(--shared)', itemsTotal);

  const pendMesHtml = `
    <div class="pend-carousel-wrap">
      <div class="pend-carousel-title">Pendiente de liquidar</div>
      <div class="pend-carousel" id="pend-carousel" onscroll="updatePendDots()">
        ${cardK}${cardA}${cardTotal}
      </div>
      <div class="pend-dots">
        <div class="pend-dot active" id="pdot-0"></div>
        <div class="pend-dot" id="pdot-1"></div>
        <div class="pend-dot" id="pdot-2"></div>
      </div>
    </div>${''}` + '';

  document.getElementById('pendientes-mes-section').innerHTML = pendMesHtml;
}

function updatePendDots() {
  const el = document.getElementById('pend-carousel');
  if(!el) return;
  const idx = Math.round(el.scrollLeft / el.offsetWidth);
  document.querySelectorAll('.pend-dot').forEach((d,i)=>d.classList.toggle('active',i===idx));
}

function updateBalanceDots() {
  const el = document.getElementById('balance-carousel');
  if(!el) return;
  const idx = Math.round(el.scrollLeft / el.offsetWidth);
  document.querySelectorAll('.balance-dot').forEach((d,i) => d.classList.toggle('active', i===idx));
}

function liquidarTodo(quienPago) {
  state.gastos.forEach(g => {
    if(!g.liquidado && g.quien_pago && g.quien_pago !== 'compartido') {
      if(quienPago === 'karla' && g.quien_pago === 'andre' && g.karla > 0) { g.liquidado = true; g.abonado = g.karla; }
      if(quienPago === 'andre' && g.quien_pago === 'karla' && g.andre > 0) { g.liquidado = true; g.abonado = g.andre; }
    }
  });
  state.fijos.forEach(f => {
    if(!f.liquidado && f.quien_pago && f.quien_pago !== 'compartido') {
      if(quienPago === 'karla' && f.quien_pago === 'andre' && f.karla > 0) f.liquidado = true;
      if(quienPago === 'andre' && f.quien_pago === 'karla' && f.andre > 0) f.liquidado = true;
    }
  });
  save(); renderResumen();
  if(document.getElementById('page-gastos').classList.contains('active')) renderGastos();
  if(document.getElementById('page-fijos').classList.contains('active')) renderFijos();
}

// ── PAGO PARCIAL ──────────────────────────────────────────────
let _parcialDeudor = null;
let _parcialTotal  = 0;

function openParcial(deudor, total) {
  _parcialDeudor = deudor;
  _parcialTotal  = total;
  // show oldest pending first
  const pendientes = getPendientesDeudor(deudor).sort((a,b)=>a.fecha.localeCompare(b.fecha));
  let listHtml = pendientes.slice(0,5).map(g=>{
    const debe = deudor==='karla' ? g.karla : g.andre;
    const abonado = g.abonado||0;
    const restante = debe - abonado;
    return `<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid var(--border)">
      <span>${g.nombre} <span style="color:var(--muted)">${g.fecha}</span></span>
      <span style="color:var(--yellow);font-weight:700">${fmt(restante)}</span>
    </div>${''}` + '';
  }).join('');
  document.getElementById('parcial-info').innerHTML = `
    <div style="margin-bottom:8px">Total pendiente: <b>${fmt(total)}</b></div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:6px">Se abonará empezando por los gastos más viejos:</div>
    ${listHtml}`;
  document.getElementById('parcial-monto').value = '';
  openModal('modal-parcial');
}

function getPendientesDeudor(deudor) {
  const gastos = state.gastos.filter(g => {
    if(g.liquidado) return false;
    if(!g.quien_pago || g.quien_pago === 'compartido') return false;
    if(deudor === 'karla') return g.quien_pago === 'andre' && g.karla > 0;
    if(deudor === 'andre') return g.quien_pago === 'karla' && g.andre > 0;
    return false;
  });
  const fijos = state.fijos.filter(f => {
    if(f.liquidado) return false;
    if(!f.quien_pago || f.quien_pago === 'compartido') return false;
    if(deudor === 'karla') return f.quien_pago === 'andre' && f.karla > 0;
    if(deudor === 'andre') return f.quien_pago === 'karla' && f.andre > 0;
    return false;
  }).map(f => ({...f, fecha: new Date().toISOString().split('T')[0], total: deudor==='karla'?f.karla:f.andre}));
  return [...gastos, ...fijos];
}

function confirmarParcial() {
  let restante = +document.getElementById('parcial-monto').value || 0;
  if(restante <= 0) return alert('Ingresa un monto mayor a 0.');
  if(restante > _parcialTotal) return alert(`No puedes abonar más de ${fmt(_parcialTotal)}.`);

  // sort oldest first
  const pendientes = getPendientesDeudor(_parcialDeudor).sort((a,b)=>a.fecha.localeCompare(b.fecha));

  for(const g of pendientes) {
    if(restante <= 0) break;
    const debe = _parcialDeudor === 'karla' ? g.karla : g.andre;
    const yaAbonado = g.abonado || 0;
    const porPagar = debe - yaAbonado;
    if(porPagar <= 0) continue;

    if(restante >= porPagar) {
      // paga este gasto completo
      g.liquidado = true;
      g.abonado = debe;
      restante -= porPagar;
    } else {
      // pago parcial de este gasto
      g.abonado = yaAbonado + restante;
      restante = 0;
    }
  }

  save();
  closeModal('modal-parcial');
  renderResumen();
  if(document.getElementById('page-gastos').classList.contains('active')) renderGastos();
}

// ── MODAL GENÉRICO ────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ── EDICIÓN GENÉRICA ──────────────────────────────────────────
let _editType = null;
let _editId   = null;

function openEdit(type, id) {
  _editType = type;
  _editId   = id;
  const modal = document.getElementById('modal-edit');
  const fieldsEl = document.getElementById('modal-edit-fields');
  const titleEl  = document.getElementById('modal-edit-title');

  if(type === 'gasto') {
    const g = state.gastos.find(x=>x.id===id);
    if(!g) return;
    titleEl.textContent = 'Editar gasto';
    fieldsEl.innerHTML = `
      <div class="modal-field"><label>Descripción</label><input id="ed-nombre" value="${g.nombre}"></div>
      <div class="modal-field"><label>Fecha</label><input id="ed-fecha" type="date" value="${g.fecha}"></div>
      <div class="modal-field"><label>Total $</label><input id="ed-total" type="number" value="${g.total}"></div>
      <div class="modal-field"><label>Categoría</label>
        <select id="ed-cat">
          ${Object.entries(CATS).filter(([k])=>k!=='msi').map(([k,v])=>`<option value="${k}" ${g.cat===k?'selected':''}>${v.icon} ${v.label}</option>`).join('')}
        </select>
      </div>
      <div class="modal-field"><label>¿Quién pagó en físico?</label>
        <select id="ed-quien-pago">
          <option value="karla" ${g.quien_pago==='karla'?'selected':''}>Karla</option>
          <option value="andre" ${g.quien_pago==='andre'?'selected':''}>Andre</option>
          <option value="compartido" ${g.quien_pago==='compartido'?'selected':''}>Compartido</option>
        </select>
      </div>
      <div class="modal-field"><label>Notas</label><input id="ed-notas" value="${g.notas||''}"></div>${''}` + '';
  } else if(type === 'fijo') {
    const f = state.fijos.find(x=>x.id===id);
    if(!f) return;
    titleEl.textContent = 'Editar gasto fijo';
    const fPagador = f.pagador||'karla';
    fieldsEl.innerHTML = `
      <div class="modal-field"><label>Nombre</label><input id="ed-nombre" value="${f.nombre}"></div>
      <div class="modal-field"><label>Monto $</label><input id="ed-total" type="number" value="${f.monto}" oninput="previewFijoSplit()"></div>
      <div class="modal-field"><label>¿Quién paga?</label>
        <select id="ed-pagador" onchange="previewFijoSplit()">
          <option value="karla"  ${fPagador==='karla'? 'selected':''}>Karla (paga completo)</option>
          <option value="andre"  ${fPagador==='andre'? 'selected':''}>Andre (paga completo)</option>
          <option value="ambos"  ${fPagador==='ambos'? 'selected':''}>Ambos (50/50)</option>
          <option value="custom" ${fPagador==='custom'?'selected':''}>Personalizado</option>
        </select>
      </div>
      <div class="modal-field" id="ed-k-wrap" style="display:${fPagador==='custom'?'block':'none'}">
        <label>Parte Karla $</label>
        <input id="ed-karla" type="number" value="${f.karla||0}" oninput="previewFijoSplitCustom('karla')">
      </div>
      <div class="modal-field" id="ed-a-wrap" style="display:${fPagador==='custom'?'block':'none'}">
        <label>Parte Andre $</label>
        <input id="ed-andre" type="number" value="${f.andre||0}" oninput="previewFijoSplitCustom('andre')">
      </div>
      <div id="ed-split-preview" style="font-size:12px;color:var(--muted);margin-top:4px"></div>
      <div class="modal-field" style="margin-top:8px"><label>¿Quién lo paga físicamente?</label>
        <select id="ed-quien-pago">
          <option value="karla"       \${(f.quien_pago||'karla')==='karla'?'selected':''}>Karla</option>
          <option value="andre"       \${(f.quien_pago||'')==='andre'?'selected':''}>Andre</option>
          <option value="compartido"  \${(f.quien_pago||'')==='compartido'?'selected':''}>Cada quien lo suyo</option>
        </select>
      </div>
      <div class="modal-field" style="margin-top:8px"><label>Categoría</label>
        <select id="ed-cat">
          <option value="entretenimiento" ${f.cat==='entretenimiento'?'selected':''}>🎬 Entretenimiento</option>
          <option value="fijos" ${f.cat==='fijos'?'selected':''}>💳 Fijo general</option>
          <option value="otro" ${f.cat==='otro'?'selected':''}>📌 Otro</option>
        </select>
      </div>${''}` + '';
    previewFijoSplit();
  } else if(type === 'compra') {
    const cp = state.compras.find(x=>x.id===id);
    if(!cp) return;
    titleEl.textContent = 'Editar compra MSI';
    fieldsEl.innerHTML = `
      <div class="modal-field"><label>Nombre</label><input id="ed-nombre" value="${cp.nombre}"></div>
      <div class="modal-field"><label>Fecha de compra</label><input id="ed-fecha" type="date" value="${cp.fecha}"></div>
      <div class="modal-field"><label>Tarjeta</label><input id="ed-tarjeta" value="${cp.tarjeta||''}"></div>
      <div class="modal-field"><label>Notas</label><input id="ed-notas" value="${cp.notas||''}"></div>${''}` + '';
  } else if(type === 'ahorro') {
    const a = (state.ahorros||[]).find(x=>x.id===id);
    if(!a) return;
    titleEl.textContent = 'Editar aportación';
    fieldsEl.innerHTML = `
      <div class="modal-field"><label>Descripción</label><input id="ed-nombre" value="${a.nombre}"></div>
      <div class="modal-field"><label>Fecha</label><input id="ed-fecha" type="date" value="${a.fecha}"></div>
      <div class="modal-field"><label>Monto $</label><input id="ed-total" type="number" value="${a.monto}"></div>
      <div class="modal-field"><label>¿Quién aportó?</label>
        <select id="ed-quien">
          <option value="ambos" ${a.quien==='ambos'?'selected':''}>Ambos</option>
          <option value="karla" ${a.quien==='karla'?'selected':''}>Karla</option>
          <option value="andre" ${a.quien==='andre'?'selected':''}>Andre</option>
        </select>
      </div>
      <div class="modal-field"><label>Notas</label><input id="ed-notas" value="${a.notas||''}"></div>${''}` + '';
  }
  openModal('modal-edit');
}

function previewFijoSplit() {
  const pagador = document.getElementById('ed-pagador');
  const kWrap   = document.getElementById('ed-k-wrap');
  const aWrap   = document.getElementById('ed-a-wrap');
  const preview = document.getElementById('ed-split-preview');
  if(!pagador) return;
  const val   = pagador.value;
  const monto = +document.getElementById('ed-total').value || 0;
  kWrap.style.display = val==='custom' ? 'block' : 'none';
  aWrap.style.display = val==='custom' ? 'block' : 'none';
  let k=0, a=0;
  if(val==='karla')  { k=monto; a=0; }
  else if(val==='andre')  { k=0; a=monto; }
  else if(val==='ambos')  { k=monto/2; a=monto/2; }
  else { k=+document.getElementById('ed-karla').value||0; a=+document.getElementById('ed-andre').value||0; }
  if(preview && val!=='custom') preview.textContent = monto>0 ? `Karla: ${fmt(k)}  /  Andre: ${fmt(a)}` : '';
}
function previewFijoSplitCustom(who) {
  const monto = +document.getElementById('ed-total').value||0;
  const preview = document.getElementById('ed-split-preview');
  if(who==='karla') {
    const k = +document.getElementById('ed-karla').value||0;
    document.getElementById('ed-andre').value = Math.max(0,monto-k).toFixed(2);
  } else {
    const a = +document.getElementById('ed-andre').value||0;
    document.getElementById('ed-karla').value = Math.max(0,monto-a).toFixed(2);
  }
  if(preview) {
    const k=+document.getElementById('ed-karla').value||0;
    const a=+document.getElementById('ed-andre').value||0;
    preview.textContent = `Karla: ${fmt(k)}  /  Andre: ${fmt(a)}`;
  }
}

function saveEdit() {
  const v = id => { const el=document.getElementById(id); return el?el.value:null; };
  const n = id => { const el=document.getElementById(id); return el?+el.value||0:0; };

  if(_editType === 'gasto') {
    const g = state.gastos.find(x=>x.id===_editId);
    if(!g) return;
    const oldTotal = g.total;
    g.nombre     = v('ed-nombre') || g.nombre;
    g.fecha      = v('ed-fecha')  || g.fecha;
    g.cat        = v('ed-cat')    || g.cat;
    g.notas      = v('ed-notas')  || '';
    g.quien_pago = v('ed-quien-pago') || g.quien_pago;
    const newTotal = n('ed-total') || oldTotal;
    if(newTotal !== oldTotal) {
      const ratio = newTotal / oldTotal;
      g.total  = newTotal;
      g.karla  = +(g.karla * ratio).toFixed(2);
      g.andre  = +(g.andre * ratio).toFixed(2);
    }
    if(g.quien_pago === 'compartido') g.liquidado = true;
    else g.liquidado = false; // ensure not locked as liquidado
    console.log('gasto after edit:', JSON.stringify({id:g.id,nombre:g.nombre,quien_pago:g.quien_pago,karla:g.karla,andre:g.andre,liquidado:g.liquidado}));
  } else if(_editType === 'fijo') {
    const f = state.fijos.find(x=>x.id===_editId);
    if(!f) return;
    f.nombre   = v('ed-nombre') || f.nombre;
    f.cat      = v('ed-cat')    || f.cat;
    const newMonto     = n('ed-total') || f.monto;
    const newPagador   = v('ed-pagador') || f.pagador || 'karla';
    const newQuienPago = v('ed-quien-pago') || f.quien_pago || 'compartido';
    f.monto     = newMonto;
    f.pagador   = newPagador;
    f.quien_pago = newQuienPago;
    f.liquidado  = newQuienPago === 'compartido';
    if(newPagador === 'karla')  { f.karla = newMonto; f.andre = 0; }
    else if(newPagador === 'andre')  { f.karla = 0; f.andre = newMonto; }
    else if(newPagador === 'ambos')  { f.karla = +(newMonto/2).toFixed(2); f.andre = +(newMonto/2).toFixed(2); }
    else if(newPagador === 'custom') {
      f.karla = n('ed-karla');
      f.andre = n('ed-andre');
    }
  } else if(_editType === 'compra') {
    const cp = state.compras.find(x=>x.id===_editId);
    if(!cp) return;
    cp.nombre  = v('ed-nombre')  || cp.nombre;
    cp.fecha   = v('ed-fecha')   || cp.fecha;
    cp.tarjeta = v('ed-tarjeta') || cp.tarjeta;
    cp.notas   = v('ed-notas')   || '';
  } else if(_editType === 'ahorro') {
    const a = (state.ahorros||[]).find(x=>x.id===_editId);
    if(!a) return;
    a.nombre = v('ed-nombre') || a.nombre;
    a.fecha  = v('ed-fecha')  || a.fecha;
    a.monto  = n('ed-total')  || a.monto;
    a.quien  = v('ed-quien')  || a.quien;
    a.notas  = v('ed-notas')  || '';
  }

  save();
  closeModal('modal-edit');
  if(_editType==='gasto')   renderGastos();
  if(_editType==='fijo')    renderFijos();
  if(_editType==='compra')  renderCompras();
  if(_editType==='ahorro')  renderAhorro();
  renderResumen();
}

// close modals clicking overlay — wait for DOM
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.modal-overlay').forEach(el => {
    el.addEventListener('click', e => { if(e.target===el) el.classList.remove('open'); });
  });
});

// ── HISTORIAL ─────────────────────────────────────────────────
function allHistMonths() {
  const s=new Set();
  // solo meses con datos reales — sin generar meses vacíos del pasado
  state.gastos.forEach(g=>s.add(g.fecha.slice(0,7)));
  state.compras.forEach(c=>s.add(c.fecha.slice(0,7)));
  state.fijos.forEach(()=>s.add(new Date().toISOString().slice(0,7))); // fijos solo en mes actual
  return [...s].sort().reverse();
}
function renderHistorial() {
  const el = document.getElementById('historial-content');
  const months = allHistMonths();
  const allData = months
    .map(ym => { const byCat=getMonthCats(ym); const total=Object.values(byCat).reduce((s,c)=>s+c.total,0); return {ym,byCat,total}; })
    .filter(d => d.total > 0);

  if(!allData.length) {
    el.innerHTML=`<div class="hist-empty"><div style="font-size:32px;margin-bottom:12px">📊</div><strong>Aquí verás tu historial</strong><br>Conforme agreguen gastos aparecerán agrupados por año y mes.<br><span style="font-size:12px;margin-top:8px;display:block">Empieza desde Gastos o Fijos.</span></div>${''}` + '';
    return;
  }

  // ── stats globales (todos los meses) ──
  const maxTotal = Math.max(...allData.map(d=>d.total), 1);
  const best  = allData.reduce((a,b)=>a.total<b.total?a:b);
  const worst = allData.reduce((a,b)=>a.total>b.total?a:b);
  const avg   = allData.reduce((s,d)=>s+d.total,0) / allData.length;
  const catTotals = {};
  allData.forEach(d=>Object.entries(d.byCat).forEach(([cat,v])=>{ catTotals[cat]=(catTotals[cat]||0)+v.total; }));
  const topCat = Object.entries(catTotals).sort((a,b)=>b[1]-a[1])[0];
  const topCatInfo = topCat ? CATS[topCat[0]]||CATS.otro : null;

  let html = `<div class="hist-top-stats">
    <div class="stat"><div class="stat-label">Mes más alto</div><div class="stat-val" style="color:var(--red);font-size:17px">${fmt(worst.total)}</div><div style="font-size:11px;color:var(--muted);margin-top:3px">${formatMonth(worst.ym)}</div></div>
    <div class="stat"><div class="stat-label">Mes más bajo</div><div class="stat-val" style="color:var(--green);font-size:17px">${fmt(best.total)}</div><div style="font-size:11px;color:var(--muted);margin-top:3px">${formatMonth(best.ym)}</div></div>
    <div class="stat"><div class="stat-label">Promedio mensual</div><div class="stat-val" style="color:var(--shared);font-size:17px">${fmt(avg)}</div></div>
    ${topCatInfo?`<div class="stat"><div class="stat-label">Mayor categoría</div><div class="stat-val" style="color:${topCatInfo.color};font-size:17px">${topCatInfo.icon}</div><div style="font-size:11px;color:var(--muted);margin-top:3px">${topCatInfo.label}</div></div>`:''}
  </div>${''}` + '';

  // ── agrupar por año ──
  const byYear = {};
  allData.forEach(d => {
    const yr = d.ym.slice(0,4);
    if(!byYear[yr]) byYear[yr] = [];
    byYear[yr].push(d);
  });

  const currentYear = new Date().getFullYear().toString();

  Object.keys(byYear).sort().reverse().forEach(yr => {
    const yearData = byYear[yr];
    const yearTotal = yearData.reduce((s,d)=>s+d.total, 0);
    const yearAvg   = yearTotal / yearData.length;
    const isCurrentYear = yr === currentYear;

    // year folder header
    html += `<div class="year-folder">
      <div class="year-header" onclick="toggleYear('${yr}')">
        <div class="year-header-left">
          <span class="year-icon">${isCurrentYear?'📂':'🗂️'}</span>
          <div>
            <div class="year-title">${yr}</div>
            <div class="year-sub">${yearData.length} mes${yearData.length!==1?'es':''} · Promedio ${fmt(yearAvg)}/mes</div>
          </div>
        </div>
        <div class="year-header-right">
          <span class="year-total">${fmt(yearTotal)}</span>
          <span class="hist-chevron ${isCurrentYear?'open':''}" id="yr-chev-${yr}">▼</span>
        </div>
      </div>
      <div class="year-body ${isCurrentYear?'open':''}" id="yr-body-${yr}">`;

    // months inside this year
    yearData.forEach((d, idx) => {
      const uid  = 'h'+d.ym.replace('-','');
      const prev = yearData[idx+1];
      let trendHtml = '';
      if(prev && prev.total > 0) {
        const diff = d.total - prev.total;
        const pct  = Math.abs(Math.round(diff/prev.total*100));
        if(diff > 500)       trendHtml = `<span class="trend-badge trend-up">▲ ${pct}%</span>${''}` + '';
        else if(diff < -500) trendHtml = `<span class="trend-badge trend-down">▼ ${pct}%</span>${''}` + '';
        else                 trendHtml = `<span class="trend-badge trend-eq">─ estable</span>${''}` + '';
      }

      const sortedCats = Object.entries(d.byCat).sort((a,b)=>b[1].total-a[1].total);
      const barsHtml   = sortedCats.map(([cat,cv])=>{
        const cc = CATS[cat]||CATS.otro;
        const w  = maxTotal>0 ? Math.round(cv.total/maxTotal*100) : 0;
        return `<div class="hbar-row"><span class="hbar-icon">${cc.icon}</span><div class="hbar-track"><div class="hbar-fill" style="width:${w}%;background:${cc.color}"></div></div><span class="hbar-amt" style="color:${cc.color}">${fmt(cv.total)}</span></div>${''}` + '';
      }).join('');

      let detHtml = '';
      sortedCats.forEach(([cat,cv])=>{
        const cc = CATS[cat]||CATS.otro;
        if(!(cv.items||[]).length) return;
        detHtml += `<div class="hist-detail-section">
          <div class="hist-detail-title"><span>${cc.icon}</span>${cc.label} — <span style="color:${cc.color}">${fmt(cv.total)}</span></div>
          ${cv.items.map(it=>`<div class="hist-item"><span>${it.nombre}${it._fijo?' <span style="font-size:10px;color:var(--muted)">(fijo)</span>':''}</span><span style="font-weight:600;color:${cc.color}">${fmt(it._msi?it.mensualidad:it.total)}</span></div>`).join('')}
        </div>${''}` + '';
      });

      html += `<div class="hist-month">
        <div class="hist-header" onclick="toggleHist('${uid}')">
          <div class="hist-header-left"><div class="hist-month-name">${formatMonth(d.ym)}</div><div class="hist-meta">${trendHtml}</div></div>
          <div class="hist-header-right"><span class="hist-total">${fmt(d.total)}</span><span class="hist-chevron" id="chev-${uid}">▼</span></div>
        </div>
        <div class="hist-bars">${barsHtml}</div>
        <div class="hist-detail" id="${uid}">${detHtml||'<div style="color:var(--muted);font-size:13px;padding:8px 0">Sin detalle.</div>'}</div>
      </div>${''}` + '';
    });

    html += '</div></div>'; // close year-body + year-folder
  });

  el.innerHTML = html;
}

function toggleYear(yr) {
  const body = document.getElementById('yr-body-'+yr);
  const chev = document.getElementById('yr-chev-'+yr);
  body.classList.toggle('open');
  chev.classList.toggle('open');
}
function toggleHist(uid) {
  const det=document.getElementById(uid), chev=document.getElementById('chev-'+uid);
  det.classList.toggle('open',!det.classList.contains('open'));
  chev.classList.toggle('open',!chev.classList.contains('open'));
}

// ── AHORRO ────────────────────────────────────────────────────
function renderAhorro() {
  const el = document.getElementById('ahorro-content');
  const ahorros = state.ahorros || [];
  const meta = state.ahorro_meta || 0;
  const total = ahorros.reduce((s,a) => s + a.monto, 0);
  const totalK = ahorros.reduce((s,a) => s + (a.quien==='karla'?a.monto:a.quien==='ambos'?a.monto/2:0), 0);
  const totalA = ahorros.reduce((s,a) => s + (a.quien==='andre'?a.monto:a.quien==='ambos'?a.monto/2:0), 0);
  const pct = meta > 0 ? Math.min(100, Math.round(total / meta * 100)) : 0;

  let heroHtml = `<div class="ahorro-hero">
    <div class="ahorro-meta-label">Total ahorrado</div>
    <div class="ahorro-total">${fmt(total)}</div>
    <div class="ahorro-meta-grid">
      <div class="ahorro-meta-item"><div style="font-size:11px;color:var(--muted);margin-bottom:3px">Karla</div><div class="ahorro-meta-val" style="color:var(--karla)">${fmt(totalK)}</div></div>
      <div class="ahorro-meta-item"><div style="font-size:11px;color:var(--muted);margin-bottom:3px">Andre</div><div class="ahorro-meta-val" style="color:var(--andre)">${fmt(totalA)}</div></div>
    </div>
    ${meta > 0 ? `<div class="ahorro-progress-wrap">
      <div class="ahorro-progress-label"><span>Meta: ${fmt(meta)}</span><span style="color:var(--green);font-weight:700">${pct}%</span></div>
      <div class="ahorro-progress-track"><div class="ahorro-progress-fill" style="width:${pct}%"></div></div>
      ${total >= meta ? '<div style="margin-top:8px;font-size:13px;color:var(--green);font-weight:700">🎉 ¡Meta alcanzada!</div>' : `<div style="margin-top:6px;font-size:12px;color:var(--muted)">Faltan ${fmt(meta - total)}</div>`}
    </div>` : ''}
  </div>${''}` + '';

  // meta goal editor
  let goalHtml = `<div class="ahorro-goal-form">
    <label>🎯 Meta de ahorro:</label>
    <input id="ahorro-meta-input" type="number" placeholder="0.00" value="${meta||''}" oninput="updateMeta()">
    <span style="font-size:12px;color:var(--muted)">Deja vacío si no tienes meta</span>
  </div>${''}` + '';

  // add form
  let formHtml = `<div class="add-toggle" onclick="toggleForm('ahorro')">＋ Agregar aportación</div>
  <div class="card add-form" id="form-ahorro" style="display:none">
    <div class="card-title">Nueva aportación</div>
    <div class="form-grid">
      <div class="form-group">
        <label>Descripción</label>
        <input id="ah-nombre" placeholder="ej. quincena, extra, regalo…">
      </div>
      <div class="form-group">
        <label>Fecha</label>
        <input id="ah-fecha" type="date">
      </div>
      <div class="form-group">
        <label>Monto $</label>
        <input id="ah-monto" type="number" placeholder="0.00">
      </div>
      <div class="form-group">
        <label>¿Quién aporta?</label>
        <select id="ah-quien">
          <option value="ambos">Ambos (juntos)</option>
          <option value="karla">Karla</option>
          <option value="andre">Andre</option>
        </select>
      </div>
      <div class="form-group span2">
        <label>Notas (opcional)</label>
        <input id="ah-notas" placeholder="opcional">
      </div>
    </div>
    <div class="form-actions">
      <button class="btn btn-primary" onclick="addAhorro()">Guardar</button>
      <button class="btn btn-sm" style="background:var(--surface);border:1px solid var(--border)" onclick="toggleForm('ahorro')">Cancelar</button>
    </div>
  </div>${''}` + '';

  // list
  let listHtml = '';
  if(!ahorros.length) {
    listHtml = '<div class="empty">Sin aportaciones aún. ¡Agrega la primera!</div>';
  } else {
    const sorted = [...ahorros].sort((a,b) => b.fecha.localeCompare(a.fecha));
    // group by month
    const byMonth = {};
    sorted.forEach(a => {
      const ym = a.fecha.slice(0,7);
      if(!byMonth[ym]) byMonth[ym] = [];
      byMonth[ym].push(a);
    });
    Object.entries(byMonth).forEach(([ym, items]) => {
      const mTotal = items.reduce((s,a) => s + a.monto, 0);
      listHtml += `<div class="section-header" style="margin-top:16px">
        <h2>${formatMonth(ym)}</h2>
        <span style="font-weight:700;color:var(--green)">${fmt(mTotal)}</span>
      </div>${''}` + '';
      items.forEach(a => {
        const whoLabel = a.quien==='ambos'?'Ambos':a.quien==='karla'?'Karla':'Andre';
        listHtml += `<div class="ahorro-entry">
          <div class="ahorro-entry-main">
            <div class="ahorro-entry-name">${a.nombre}</div>
            <div class="ahorro-entry-sub">${a.fecha}${a.notas?' · '+a.notas:''}</div>
          </div>
          <span class="ahorro-who ${a.quien}">${whoLabel}</span>
          <div class="ahorro-entry-amt">+${fmt(a.monto)}</div>
          <button class="edit-btn" onclick="openEdit('ahorro',${a.id})" title="Editar">✏️</button>
          <button class="btn btn-danger" onclick="deleteAhorro(${a.id})">✕</button>
        </div>${''}` + '';
      });
    });
  }

  el.innerHTML = heroHtml + goalHtml + formHtml + listHtml;
  // restore meta input focus state
}

function updateMeta() {
  const val = +document.getElementById('ahorro-meta-input').value || 0;
  if(!state.ahorros) state.ahorros = [];
  state.ahorro_meta = val;
  save();
  // re-render hero only (avoid losing focus)
  renderAhorroHero();
}

function renderAhorroHero() {
  const ahorros = state.ahorros || [];
  const meta = state.ahorro_meta || 0;
  const total = ahorros.reduce((s,a) => s + a.monto, 0);
  const totalK = ahorros.reduce((s,a) => s + (a.quien==='karla'?a.monto:a.quien==='ambos'?a.monto/2:0), 0);
  const totalA = ahorros.reduce((s,a) => s + (a.quien==='andre'?a.monto:a.quien==='ambos'?a.monto/2:0), 0);
  const pct = meta > 0 ? Math.min(100, Math.round(total / meta * 100)) : 0;
  const hero = document.querySelector('.ahorro-hero');
  if(hero) hero.innerHTML = `
    <div class="ahorro-meta-label">Total ahorrado</div>
    <div class="ahorro-total">${fmt(total)}</div>
    <div class="ahorro-meta-grid">
      <div class="ahorro-meta-item"><div style="font-size:11px;color:var(--muted);margin-bottom:3px">Karla</div><div class="ahorro-meta-val" style="color:var(--karla)">${fmt(totalK)}</div></div>
      <div class="ahorro-meta-item"><div style="font-size:11px;color:var(--muted);margin-bottom:3px">Andre</div><div class="ahorro-meta-val" style="color:var(--andre)">${fmt(totalA)}</div></div>
    </div>
    ${meta > 0 ? `<div class="ahorro-progress-wrap">
      <div class="ahorro-progress-label"><span>Meta: ${fmt(meta)}</span><span style="color:var(--green);font-weight:700">${pct}%</span></div>
      <div class="ahorro-progress-track"><div class="ahorro-progress-fill" style="width:${pct}%"></div></div>
      ${total >= meta ? '<div style="margin-top:8px;font-size:13px;color:var(--green);font-weight:700">🎉 ¡Meta alcanzada!</div>' : `<div style="margin-top:6px;font-size:12px;color:var(--muted)">Faltan ${fmt(meta - total)}</div>`}
    </div>` : ''}`;
}

function addAhorro() {
  const nombre = document.getElementById('ah-nombre').value.trim();
  const fecha  = document.getElementById('ah-fecha').value;
  const monto  = +document.getElementById('ah-monto').value || 0;
  const quien  = document.getElementById('ah-quien').value;
  const notas  = document.getElementById('ah-notas').value.trim();
  if(!nombre || !fecha || !monto) return alert('Llena descripción, fecha y monto.');
  if(!state.ahorros) state.ahorros = [];
  state.ahorros.push({ id:Date.now(), nombre, fecha, monto, quien, notas });
  save(); renderAhorro();
  document.getElementById('ah-nombre').value = '';
  document.getElementById('ah-monto').value  = '';
  document.getElementById('ah-notas').value  = '';
  toggleForm('ahorro');
}

function deleteAhorro(id) {
  if(!confirm('¿Eliminar esta aportación?')) return;
  state.ahorros = (state.ahorros||[]).filter(a => a.id !== id);
  save(); renderAhorro();
}

// ── INIT ──────────────────────────────────────────────────────
// Init — wrapped so all functions are defined before running
window.addEventListener('DOMContentLoaded', () => {
  checkLoginMode();
  const savedUser = localStorage.getItem('fka-user');
  const savedPAT  = localStorage.getItem('fka-pat');
  const savedPass = localStorage.getItem('fka-pass');
  if(savedUser && savedPass) {
    currentUser = savedUser;
    currentPAT  = savedPAT || '';
    currentPass = savedPass;
    document.getElementById('login-user').value = savedUser;
    document.getElementById('login-pass').value = savedPass;
    if(savedPAT) {
      doLogin();
    }
  }
});

// ── SWIPE PARA CAMBIAR PESTAÑA (móvil) ──────────────────────
(function() {
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTarget = null;

  document.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchStartTarget = e.target;
  }, { passive: true });

  document.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;

    // ignore if mostly vertical
    if(Math.abs(dy) > Math.abs(dx)) return;
    // ignore short swipes
    if(Math.abs(dx) < 60) return;

    // ignore if touch started inside a carousel or scrollable element
    const carousels = [
      document.getElementById('balance-carousel'),
      document.getElementById('pend-carousel'),
    ];
    for(const car of carousels) {
      if(car && car.contains(touchStartTarget)) return;
    }
    // also ignore year-body and hist-detail (scrollable lists)
    if(touchStartTarget.closest('.year-body, .hist-detail, .cat-folder-body')) return;

    // navigate
    const navBtns = [...document.querySelectorAll('nav button')];
    const activeBtn = document.querySelector('nav button.active');
    if(!activeBtn) return;
    const idx = navBtns.indexOf(activeBtn);
    let next = dx < 0 ? idx + 1 : idx - 1; // swipe left = next, right = prev
    if(next < 0) next = navBtns.length - 1;
    if(next >= navBtns.length) next = 0;
    navBtns[next].click();
  }, { passive: true });
})();

// ── KEYBOARD NAV (flechas izquierda/derecha = cambiar pestaña) ──
const PAGES = ['resumen','gastos','fijos','compras','historial','ahorro'];
document.addEventListener('keydown', e => {
  // skip if typing in an input/select
  if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;
  // skip if a modal is open
  if(document.querySelector('.modal-overlay.open')) return;

  if(e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const activeBtn = document.querySelector('nav button.active');
    if(!activeBtn) return;
    const navBtns = [...document.querySelectorAll('nav button')];
    const idx = navBtns.indexOf(activeBtn);
    let next = e.key === 'ArrowRight' ? idx + 1 : idx - 1;
    if(next < 0) next = navBtns.length - 1;
    if(next >= navBtns.length) next = 0;
    navBtns[next].click();
    e.preventDefault();
  }
});

// ── MOUSE DRAG FOR CAROUSELS ──
function addDragScroll(el) {
  if(!el) return;
  let isDown = false, startX = 0, scrollLeft = 0;
  el.addEventListener('mousedown', e => {
    isDown = true;
    el.style.cursor = 'grabbing';
    startX = e.pageX - el.offsetLeft;
    scrollLeft = el.scrollLeft;
    e.preventDefault();
  });
  el.addEventListener('mouseleave', () => { isDown = false; el.style.cursor = 'grab'; });
  el.addEventListener('mouseup',    () => { isDown = false; el.style.cursor = 'grab'; });
  el.addEventListener('mousemove',  e => {
    if(!isDown) return;
    const x    = e.pageX - el.offsetLeft;
    const walk = (x - startX) * 1.2;
    el.scrollLeft = scrollLeft - walk;
  });
  el.style.cursor = 'grab';
}

// attach drag to carousels whenever they're rendered
// use a MutationObserver so it catches dynamically created carousels
const _dragObserver = new MutationObserver(() => {
  ['balance-carousel','pend-carousel'].forEach(id => {
    const el = document.getElementById(id);
    if(el && !el._dragAttached) {
      addDragScroll(el);
      el._dragAttached = true;
    }
  });
});
_dragObserver.observe(document.body, { childList: true, subtree: true });
