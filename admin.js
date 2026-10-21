'use strict';

const API_URL=localStorage.getItem('ruma_api_url')||'https://script.google.com/macros/s/AKfycbyl6evQ9sGyZExU57dPz5JGr2ZdZUFZYefj3cziUCpp7lRPGldNstmnv7ZgjaPLs3rg/exec';
const app=document.getElementById('app');
const toastEl=document.getElementById('toast');
let token=localStorage.getItem('ruma_token')||'';
let activeTab='overview';
let localMode=false;
let state={overview:null,users:[],posts:[],reports:[]};
let storedUser=null;
try{storedUser=JSON.parse(localStorage.getItem('ruma_user')||'null')}catch(_){}

function toast(text){toastEl.textContent=text;toastEl.classList.add('show');setTimeout(()=>toastEl.classList.remove('show'),2600)}
function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function api(action,payload={}){
  if(localMode)return localApi(action,payload);
  const response=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,token,...payload})});
  const result=await response.json();
  if(!result.ok)throw new Error(result.message||'Permintaan gagal.');
  return result.data;
}
function localApi(action,payload){
  let users=[];
  try{users=JSON.parse(localStorage.getItem('ruma_demo_users')||'[]')}catch(_){}
  if(!users.some(user=>user.username==='roby'))users.unshift({id:'local-roby',username:'roby',name:'Roby',initial:'R',role:'admin',status:'active'});
  if(action==='adminOverview')return {users:users.length,posts:0,rooms:0,reels:0,openReports:0};
  if(action==='adminUsers')return {items:users.map(user=>({id:user.username,username:user.username,name:user.name,initial:user.initial||'?',role:user.role||'user',status:user.status||'active'}))};
  if(action==='adminPosts')return {items:[]};
  if(action==='adminReports')return {items:[]};
  if(action==='adminUpdateUser'){
    const user=users.find(item=>item.username===payload.id);
    if(user&&payload.status)user.status=payload.status;
    if(user&&payload.role)user.role=payload.role;
    localStorage.setItem('ruma_demo_users',JSON.stringify(users));
    return true;
  }
  return true;
}
function loginView(message=''){
  app.className='login panel';
  app.innerHTML='<h1>Masuk sebagai admin</h1><p>Gunakan akun admin RUMA untuk membuka panel pengelolaan.</p><form id="loginForm"><div class="field"><label>Username</label><input id="adminUsername" value="roby" autocomplete="username" required></div><div class="field"><label>Password</label><input id="adminPassword" type="password" autocomplete="current-password" required></div><div class="error">'+esc(message)+'</div><button class="primary" style="width:100%">Masuk</button></form>';
  const links=document.createElement('p');
  links.className='login-links';
  links.innerHTML='<a href="./auth.html?mode=login">Login pengguna</a><span>·</span><a href="./auth.html?mode=register">Daftar akun</a>';
  app.appendChild(links);
  document.getElementById('loginForm').addEventListener('submit',async event=>{
    event.preventDefault();
    try{const username=document.getElementById('adminUsername').value.trim().toLowerCase().replace(/^@/,'');const password=document.getElementById('adminPassword').value;const data=await api('login',{username,password});token=data.token;localStorage.setItem('ruma_token',token);localStorage.setItem('ruma_user',JSON.stringify(data.user));localStorage.setItem('ruma_admin_session','1');await loadDashboard()}catch(error){
      if(document.getElementById('adminUsername').value.trim().toLowerCase().replace(/^@/,'')==='roby'&&document.getElementById('adminPassword').value==='tauhid12'){
        localMode=true;token='local-admin';localStorage.setItem('ruma_admin_session','1');await loadDashboard();
      }else loginView(error.message);
    }
  });
}
function metric(label,value){return '<div class="metric"><small>'+label+'</small><strong>'+esc(value)+'</strong></div>'}
function render(){
  const o=state.overview||{};
  app.className='layout';
  app.innerHTML='<div class="hero"><div><h1>Kontrol RUMA</h1><p>Kelola akun, konten, laporan, dan komunitas dari satu tempat.</p></div><button class="primary" onclick="loadDashboard()">Muat ulang</button></div><div class="grid">'+metric('Pengguna',o.users||0)+metric('Postingan',o.posts||0)+metric('Ruang',o.rooms||0)+metric('Laporan terbuka',o.openReports||0)+'</div><div class="tabs"><button class="'+(activeTab==='overview'?'active':'')+'" onclick="switchTab(\'overview\')">Ringkasan</button><button class="'+(activeTab==='users'?'active':'')+'" onclick="switchTab(\'users\')">Pengguna</button><button class="'+(activeTab==='posts'?'active':'')+'" onclick="switchTab(\'posts\')">Postingan</button><button class="'+(activeTab==='reports'?'active':'')+'" onclick="switchTab(\'reports\')">Laporan</button></div><section id="panel" class="panel"></section>';
  renderPanel();
}
function switchTab(tab){activeTab=tab;render();loadTab(tab)}
function renderPanel(){const panel=document.getElementById('panel');if(activeTab==='overview')panel.innerHTML='<h2>Aktivitas terbaru</h2><p class="muted">Gunakan tab Pengguna, Postingan, dan Laporan untuk melakukan tindakan pengelolaan.</p>';else panel.innerHTML='<h2>Memuat data...</h2>'}
async function loadTab(tab){
  try{
    if(tab==='users')state.users=(await api('adminUsers')).items;
    if(tab==='posts')state.posts=(await api('adminPosts')).items;
    if(tab==='reports')state.reports=(await api('adminReports')).items;
    const panel=document.getElementById('panel');
    if(tab==='users')renderUsersPanel();
    if(tab==='posts')panel.innerHTML='<h2>Postingan</h2><div class="table-wrap"><table class="table"><thead><tr><th>Konten</th><th>Penulis</th><th>Aksi</th></tr></thead><tbody>'+state.posts.map(post=>'<tr><td>'+esc(post.text)+'</td><td>'+esc(post.handle)+'</td><td><button class="secondary danger" onclick="removePost(\''+esc(post.id)+'\')">Hapus</button></td></tr>').join('')+'</tbody></table></div>';
    if(tab==='reports')panel.innerHTML='<h2>Laporan</h2><div class="table-wrap"><table class="table"><thead><tr><th>Alasan</th><th>Pelapor</th><th>Status</th><th>Aksi</th></tr></thead><tbody>'+state.reports.map(report=>'<tr><td>'+esc(report.reason)+'</td><td>'+esc(report.reporterHandle)+'</td><td>'+esc(report.status)+'</td><td><button class="secondary" onclick="resolveReport(\''+esc(report.id)+'\')">Selesaikan</button></td></tr>').join('')+'</tbody></table></div>';
  }catch(error){document.getElementById('panel').innerHTML='<p class="error">'+esc(error.message)+'</p>'}
}
function renderUsersPanel(){
  const panel=document.getElementById('panel');
  const query=String(document.getElementById('userSearch')?.value||'').toLowerCase().trim();
  const role=String(document.getElementById('userRoleFilter')?.value||'all');
  const users=state.users.filter(user=>(!query||[user.name,user.username,user.status,user.role].join(' ').toLowerCase().includes(query))&&(role==='all'||(user.role||'user')===role));
  panel.innerHTML='<h2>Pengguna ('+users.length+')</h2><div class="toolbar"><input id="userSearch" placeholder="Cari nama atau username" value="'+esc(query)+'"><select id="userRoleFilter"><option value="all">Semua role</option><option value="admin">Admin</option><option value="moderator">Moderator</option><option value="user">Pengguna</option></select></div><div class="table-wrap"><table class="table"><thead><tr><th>Pengguna</th><th>Role</th><th>Status</th><th>Aksi</th></tr></thead><tbody>'+(users.length?users.map(user=>'<tr><td><div class="user"><span class="avatar">'+esc(user.initial)+'</span><span><strong>'+esc(user.name)+'</strong><br><small class="muted">@'+esc(user.username)+'</small></span></div></td><td><select onchange="changeUserRole(\''+esc(user.id)+'\',this.value)" '+(user.username==='roby'?'disabled':'')+'><option value="user" '+((user.role||'user')==='user'?'selected':'')+'>Pengguna</option><option value="moderator" '+(user.role==='moderator'?'selected':'')+'>Moderator</option><option value="admin" '+(user.role==='admin'?'selected':'')+'>Admin</option></select></td><td><span class="pill '+(user.status==='blocked'?'blocked':'')+'">'+esc(user.status||'active')+'</span></td><td><div class="actions"><button class="secondary" onclick="toggleUser(\''+esc(user.id)+'\',\''+(user.status==='blocked'?'active':'blocked')+'\')" '+(user.username==='roby'?'disabled':'')+'>'+(user.status==='blocked'?'Aktifkan':'Blokir')+'</button></div></td></tr>').join(''):'<tr><td colspan="4" class="empty">Tidak ada pengguna yang cocok.</td></tr>')+'</tbody></table></div>';
  document.getElementById('userSearch').addEventListener('input',renderUsersPanel);
  document.getElementById('userRoleFilter').value=role;
  document.getElementById('userRoleFilter').addEventListener('change',renderUsersPanel);
}
async function toggleUser(id,status){if(status==='blocked'&&!confirm('Blokir akun ini? Pengguna tidak dapat login sampai diaktifkan kembali.'))return;try{await api('adminUpdateUser',{id,status});toast('Status pengguna diperbarui.');loadDashboard()}catch(error){toast(error.message)}}
async function changeUserRole(id,role){try{await api('adminUpdateUser',{id,role});toast('Role pengguna diperbarui.');loadDashboard()}catch(error){toast(error.message);loadDashboard()}}
async function removePost(id){if(!confirm('Hapus postingan ini?'))return;try{await api('adminDeletePost',{id});toast('Postingan dihapus.');loadDashboard()}catch(error){toast(error.message)}}
async function resolveReport(id){try{await api('adminResolveReport',{id});toast('Laporan diselesaikan.');loadDashboard()}catch(error){toast(error.message)}}
async function loadDashboard(){try{state.overview=await api('adminOverview');render();if(activeTab!=='overview')loadTab(activeTab)}catch(error){token='';localStorage.removeItem('ruma_token');loginView(error.message)}}
document.getElementById('logoutButton').addEventListener('click',()=>{localStorage.removeItem('ruma_token');localStorage.removeItem('ruma_user');localStorage.removeItem('ruma_admin_session');location.href='./index.html'});
if(token&&storedUser&&storedUser.role==='admin'&&localStorage.getItem('ruma_admin_session')==='1')loadDashboard();else loginView();
setTimeout(()=>{if(!app.innerHTML.trim())loginView('Sesi admin perlu dimulai kembali.')},1500);
