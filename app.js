'use strict';
const API_URL='https://script.google.com/macros/s/AKfycbyl6evQ9sGyZExU57dPz5JGr2ZdZUFZYefj3cziUCpp7lRPGldNstmnv7ZgjaPLs3rg/exec';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ls={get(k){try{return localStorage.getItem(k)}catch(_){return null}},set(k,v){try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch(_){}}};
let token=ls.get('ruma_token')||'',U=null;try{U=JSON.parse(ls.get('ruma_user')||'null')}catch(_){}
const GIFTS=[['🌹','Mawar',10],['❤️','Hati',25],['☕','Kopi',50],['⭐','Bintang',100],['💎','Berlian',250],['🚀','Roket',500],['👑','Mahkota',800],['🎉','Perayaan',120]];
const st={view:'home',sort:'rekomendasi',q:'',tag:'',posts:[],next:null,rf:'semua',reels:[],ri:0,gift:'Mawar',open:{},cm:{},access:'public',pending:null,prof:null};

async function api(action,p={}){
  const r=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,token,...p}),redirect:'follow'});
  const j=await r.json();
  if(!j.ok){if(j.code==='UNAUTH'&&token)setUser(null,'');throw Object.assign(new Error(j.message||'Gagal'),{code:j.code})}
  return j.data;
}
function setUser(u,t){U=u;token=t??token;ls.set('ruma_token',token||null);ls.set('ruma_user',u?JSON.stringify(u):null);topUser()}
function toast(m){const t=$('toast');t.textContent=m;t.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('show'),2600)}
function modal(h){$('mc').innerHTML=h;$('mb').classList.add('open')}
function closeM(){$('mb').classList.remove('open')}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeM()});
const ago=ms=>{const s=Math.max(1,(Date.now()-ms)/1000|0);return s<60?'Baru saja':s<3600?(s/60|0)+' menit lalu':s<86400?(s/3600|0)+' jam lalu':(s/86400|0)+' hari lalu'};
const fmtText=t=>esc(t).replace(/(^|\s)#([\p{L}\d_]+)/gu,(_,s,g)=>`${s}<span class="tag" onclick="tagGo('${g}')">#${g}</span>`).replace(/\n/g,'<br>');
const av=p=>`<button class="avatar" style="background:${esc(p.color||'#e8efff')};color:${esc(p.ink||'#2859a8')}" onclick="openProfile('${esc(p.handle)}')">${esc(p.initial||(p.name||'?')[0])}</button>`;
const empty=(a,b)=>`<div class="empty"><strong>${a}</strong>${b}</div>`;
const fail=e=>{toast(e.message);if(e.code==='UNAUTH')authForm()};
function need(){if(U)return true;authForm();return false}

/* ---------- Auth ---------- */
function topUser(){
  $('topUser').innerHTML=U?`<button class="avatar" onclick="me()" aria-label="Profil saya">${esc(U.initial)}</button>`:`<button class="primary" onclick="authForm()">Masuk</button>`;
}
function authForm(mode='login'){
  const reg=mode==='register';
  modal(`<div class="mh"><h2>${reg?'Daftar ke RUMA':'Masuk ke RUMA'}</h2><button class="close" onclick="closeM()">×</button></div>
  <form onsubmit="submitAuth(event,${reg})">
    ${reg?'<div class="field"><label>Nama</label><input id="aN" maxlength="40" required></div>':''}
    <div class="field"><label>Username</label><input id="aU" maxlength="20" autocapitalize="none" required placeholder="huruf kecil, angka, _"></div>
    <div class="field"><label>Password</label><input id="aP" type="password" minlength="${reg?8:1}" maxlength="72" required placeholder="${reg?'Minimal 8 karakter':''}"></div>
    <button class="primary" style="width:100%" id="aB">${reg?'Daftar':'Masuk'}</button>
  </form>
  <p class="muted small" style="text-align:center;margin-top:14px">${reg?'Sudah punya akun?':'Belum punya akun?'} <a href="#" class="tag" onclick="authForm('${reg?'login':'register'}');return false">${reg?'Masuk':'Daftar'}</a></p>`);
}
async function submitAuth(e,reg){
  e.preventDefault();$('aB').disabled=true;
  try{
    const p={username:$('aU').value.trim(),password:$('aP').value};if(reg)p.name=$('aN').value.trim();
    const d=await api(reg?'register':'login',p);
    setUser(d.user,d.token);closeM();toast('Selamat datang, '+d.user.name+'!');load();side();
  }catch(err){toast(err.message);$('aB').disabled=false}
}
function logout(){setUser(null,'');closeM();toast('Kamu sudah keluar.');load()}

/* ---------- Navigasi ---------- */
const TITLES={home:['Beranda','＋ Topik'],explore:['Jelajahi','＋ Topik'],saved:['Tersimpan','＋ Topik'],rooms:['Jelajahi Ruang','＋ Ruang'],creator:['Creator Studio','Muat ulang'],room:['Ruang','← Ruang']};
function nav(){
  document.querySelectorAll('[data-v]').forEach(b=>b.classList.toggle('on',b.dataset.v===st.view||(st.view==='room'&&b.dataset.v==='rooms')));
  document.querySelectorAll('.navitem').forEach(b=>b.classList.toggle('active',b.dataset.v===st.view||(st.view==='room'&&b.dataset.v==='rooms')));
}
function go(v,o={}){
  Object.assign(st,{view:v,q:'',tag:''},o);$('si').value='';
  const t=TITLES[v];$('pt').textContent=t[0];$('ha').textContent=t[1];
  $('ha').onclick=v==='rooms'?roomForm:v==='creator'?load:v==='room'?()=>go('rooms'):focusComp;
  nav();load();scrollTo({top:0,behavior:'smooth'});
}
function load(){
  const v=st.view;
  if(v==='rooms')return loadRooms();
  if(v==='creator')return loadCreator();
  if(v==='room')return;
  feedShell();
}
function focusComp(){
  if(!['home','explore'].includes(st.view))return go('home');
  if(st.sort==='video')setSort('rekomendasi');
  const c=$('postInput');if(c){c.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>c.focus(),200)}
}

/* ---------- Feed ---------- */
function feedShell(){
  const main=['home','explore'].includes(st.view);
  $('body').innerHTML=`${main?`<div class="tabs">${[['rekomendasi','Untuk Kamu'],['terbaru','Terbaru'],['video','▶ Video']].map(t=>`<button class="tab ${st.sort===t[0]?'on':''}" onclick="setSort('${t[0]}')">${t[1]}</button>`).join('')}</div>`:''}
  ${main&&st.sort!=='video'?composer():''}<div id="plist">${empty('Memuat…','')}</div><div id="more"></div>`;
  if(main&&st.sort==='video')return loadReels();
  loadFeed();
}
function composer(){
  if(!U)return `<section class="card empty" style="padding:20px"><strong>Gabung percakapan</strong>Masuk untuk menulis topik, berkomentar, dan membuat Ruang.<br><br><button class="primary" onclick="authForm()">Masuk / Daftar</button></section>`;
  return `<section class="card composer"><div class="composer-top"><div class="avatar" style="background:${esc(U.color)};color:${esc(U.ink)}">${esc(U.initial)}</div>
  <textarea id="postInput" maxlength="700" placeholder="Apa yang ingin kamu diskusikan? Tambahkan #hashtag..." oninput="$('pb').disabled=!this.value.trim()"></textarea></div>
  <div class="composer-bottom"><div><button class="tool" onclick="addHash()">＃ Hashtag</button><button class="tool" onclick="toast('Unggah media akan tersedia nanti.')">▧ Media</button></div><button class="primary" id="pb" disabled onclick="publish()">Terbitkan</button></div></section>`;
}
function addHash(){const i=$('postInput');i.value+=(i.value&&!/\s$/.test(i.value)?' ':'')+'#';i.focus();$('pb').disabled=false}
function setSort(s){st.sort=s;feedShell()}
async function loadFeed(more){
  try{
    const filter=st.view==='saved'?'saved':'all';
    if(filter==='saved'&&!U){$('plist').innerHTML=empty('Masuk dulu','Postingan tersimpan akan muncul di sini.');return}
    const r=await api('feed',{sort:st.sort,q:st.q,tag:st.tag,filter,cursor:more?st.next:0});
    st.posts=more?st.posts.concat(r.items):r.items;st.next=r.next;drawPosts();
  }catch(e){$('plist').innerHTML=empty('Gagal memuat',esc(e.message))}
}
function postHTML(p){
  const c=st.cm[p.id]||[];
  return `<article class="card" id="p-${p.id}"><div class="post-head">${av(p)}<div class="pm"><div><button class="pname" onclick="openProfile('${esc(p.handle)}')">${esc(p.name)}</button><span class="handle">${esc(p.handle)}</span></div><div class="ptime">${ago(p.createdAt)} · ${esc(p.topic)}</div></div>${p.mine?`<button class="tool" onclick="delPost('${p.id}')">Hapus</button>`:''}</div>
  <div class="ptext">${fmtText(p.text)}</div>
  <div class="actions"><button class="action ${p.liked?'liked':''}" onclick="act('toggleLike','${p.id}')">♡ ${p.likes}</button>
  <button class="action" onclick="toggleC('${p.id}')">▢ ${p.commentsCount||'Komentar'}</button>
  <button class="action ${p.reposted?'reposted':''}" onclick="act('toggleRepost','${p.id}')">⟳ ${p.reposts}</button>
  <button class="action ${p.saved?'saved':''}" onclick="act('toggleSave','${p.id}')">▣ ${p.saved?'Tersimpan':'Simpan'}</button>
  <button class="action" onclick="share('${p.id}')">↗</button></div>
  ${st.open[p.id]?`<div class="cm">${c.map(x=>`<p><strong>${esc(x.name)}</strong> ${esc(x.text)}</p>`).join('')||'Belum ada komentar.'}<form class="cf" onsubmit="addC(event,'${p.id}')"><input maxlength="240" placeholder="Tulis komentar..." required><button>Kirim</button></form></div>`:''}</article>`;
}
function adHTML(){
  return `<article class="ad-card"><span class="ad-label">IKLAN · BERSPONSOR</span>
  <div class="ad-creative"><strong>Kenalkan bisnismu di RUMA</strong><p>Jangkau komunitas yang relevan dengan promosi yang transparan.</p></div>
  <button class="secondary" onclick="toast('Slot iklan demo — belum terhubung ke pengiklan.')">Pelajari selengkapnya ↗</button></article>`;
}
function drawPosts(){
  $('plist').innerHTML=st.posts.length?st.posts.map((p,i)=>postHTML(p)+(i===1&&st.view!=='saved'?adHTML():'')).join(''):empty('Belum ada postingan yang cocok','Coba kata kunci lain atau mulai diskusi baru.');
  $('more').innerHTML=st.next!=null?`<button class="secondary" style="width:100%" onclick="loadFeed(true)">Muat lebih banyak</button>`:'';
}
async function publish(){
  if(!need())return;const i=$('postInput'),text=i.value.trim();if(!text)return;$('pb').disabled=true;
  try{const p=await api('createPost',{text});st.posts.unshift(p);i.value='';drawPosts();trends();toast('Postingan diterbitkan.')}
  catch(e){fail(e);$('pb').disabled=false}
}
async function act(a,id){
  if(!need())return;
  try{
    const r=await api(a,{id}),p=st.posts.find(x=>x.id===id);if(!p)return;
    if(a==='toggleLike'){p.liked=r.on;p.likes=r.count}
    if(a==='toggleRepost'){p.reposted=r.on;p.reposts=r.count;toast(r.on?'Postingan direpost.':'Repost dibatalkan.')}
    if(a==='toggleSave'){p.saved=r.on;toast(r.on?'Postingan disimpan.':'Dihapus dari simpanan.');if(st.view==='saved'&&!r.on)st.posts=st.posts.filter(x=>x.id!==id)}
    drawPosts();
  }catch(e){fail(e)}
}
async function delPost(id){
  if(!confirm('Hapus postingan ini?'))return;
  try{await api('deletePost',{id});st.posts=st.posts.filter(x=>x.id!==id);drawPosts();trends();toast('Postingan dihapus.')}catch(e){fail(e)}
}
async function toggleC(id){
  st.open[id]=!st.open[id];
  if(st.open[id]&&!st.cm[id]){try{st.cm[id]=await api('comments',{postId:id})}catch(e){toast(e.message)}}
  drawPosts();
}
async function addC(e,id){
  e.preventDefault();if(!need())return;
  const i=e.target.querySelector('input'),text=i.value.trim();if(!text)return;
  try{const c=await api('addComment',{postId:id,text});(st.cm[id]=st.cm[id]||[]).push(c);const p=st.posts.find(x=>x.id===id);if(p)p.commentsCount++;drawPosts();toast('Komentar ditambahkan.')}
  catch(err){fail(err)}
}
function share(id){
  const url=location.href.split('#')[0]+'#post-'+id;
  if(navigator.share)navigator.share({title:'Postingan RUMA',url}).catch(()=>{});
  else if(navigator.clipboard)navigator.clipboard.writeText(url).then(()=>toast('Tautan disalin.')).catch(()=>toast(url));
  else toast(url);
}
function tagGo(t){if(!['home','explore'].includes(st.view))st.view='explore';st.tag=t;st.q='';$('si').value='#'+t;go2()}
function go2(){const t=TITLES.explore;$('pt').textContent=t[0];st.view=st.view==='home'?'explore':st.view;nav();feedShell()}

/* ---------- Sidebar ---------- */
async function trends(){
  try{const r=await api('trends');$('trends').innerHTML=r.map((t,i)=>`<button class="trend" onclick="tagGo('${esc(t.tag.slice(1))}')"><small>${i+1} · Topik populer</small><strong>${esc(t.tag)}</strong><span>${t.count} postingan</span></button>`).join('')||'<span class="muted small">Belum ada topik.</span>'}catch(_){}
}
async function side(){
  trends();
  try{const r=await api('people');$('people').innerHTML=r.map(p=>`<div class="people">${av(p)}<div><strong>${esc(p.name)}</strong><small>${esc(p.handle)}</small></div><button class="follow ${p.following?'on':''}" onclick="follow('${esc(p.handle)}',this)">${p.following?'Mengikuti':'Ikuti'}</button></div>`).join('')}catch(_){}
}
async function follow(handle,btn){
  if(!need())return;
  try{
    const r=await api('toggleFollow',{handle});
    if(btn){btn.classList.toggle('on',r.on);btn.textContent=r.on?'Mengikuti':'Ikuti'}
    if(st.prof&&st.prof.handle===handle){st.prof.isFollowing=r.on;const b=$('pf');if(b){b.classList.toggle('on',r.on);b.textContent=r.on?'Mengikuti':'＋ Ikuti'}}
    toast(r.on?'Kamu mulai mengikuti akun ini.':'Kamu berhenti mengikuti akun ini.');
  }catch(e){fail(e)}
}

/* ---------- Profil ---------- */
function me(){if(!need())return;openProfile(U.handle)}
async function openProfile(handle){
  try{
    const [p,f]=await Promise.all([api('profile',{handle}),api('feed',{filter:'user',handle,limit:10})]);
    const u=p.user,self=U&&U.id===u.id;st.prof={handle,isFollowing:p.isFollowing};
    modal(`<div class="mh"><h2>Profil pengguna</h2><button class="close" onclick="closeM()">×</button></div>
    <div style="display:flex;align-items:center;gap:12px;justify-content:space-between"><div style="display:flex;align-items:center;gap:12px"><div class="avatar" style="width:58px;height:58px;font-size:18px;background:${esc(u.color)};color:${esc(u.ink)}">${esc(u.initial)}</div><div><strong>${esc(u.name)}</strong><div class="muted small">${esc(u.handle)}</div></div></div>
    ${self?`<button class="secondary" onclick="editProfile()">Ubah</button>`:`<button class="follow ${p.isFollowing?'on':''}" id="pf" onclick="follow('${esc(handle)}')">${p.isFollowing?'Mengikuti':'＋ Ikuti'}</button>`}</div>
    <p class="muted" style="font-size:13px;line-height:1.6">${esc(u.bio||'Anggota RUMA yang senang berbagi cerita dan berdiskusi.')}</p>
    <div class="muted small" style="display:flex;gap:16px;margin-bottom:8px"><span><b style="color:var(--ink)">${p.posts}</b> postingan</span><span><b style="color:var(--ink)">${u.followers}</b> pengikut</span><span><b style="color:var(--ink)">${u.following}</b> mengikuti</span></div>
    <div class="ptabs">${[['posts','Postingan'],['liked','Disukai'],['reposted','Repost'],['videos','Video']].filter(t=>self||['posts','videos'].includes(t[0])).map((t,i)=>`<button class="${i?'':'on'}" onclick="profTab('${t[0]}','${esc(handle)}',this)">${t[1]}</button>`).join('')}</div><div id="pc">${profList(f.items)}</div>
    ${self?`<button class="secondary" style="width:100%;margin-top:14px" onclick="logout()">Keluar</button>`:''}`);
  }catch(e){toast(e.message)}
}
const profList=a=>a.map(x=>`<div class="wl"><span>${esc(x.text.slice(0,120))}</span><strong>♡ ${x.likes}</strong></div>`).join('')||'<p class="muted small">Belum ada konten pada kategori ini.</p>';
async function profTab(tab,handle,btn){
  document.querySelectorAll('.ptabs button').forEach(b=>b.classList.toggle('on',b===btn));
  $('pc').innerHTML='<p class="muted small">Memuat…</p>';
  try{
    if(tab==='videos'){
      const r=await api('reels',{limit:50}),l=r.items.filter(x=>x.handle===handle);
      $('pc').innerHTML=l.map(x=>`<div class="wl"><span>${esc(x.caption)}</span><strong>▶</strong></div>`).join('')||'<p class="muted small">Belum ada video.</p>';
      return;
    }
    const r=await api('feed',{filter:tab==='posts'?'user':tab,handle,limit:20});
    $('pc').innerHTML=profList(r.items);
  }catch(e){$('pc').innerHTML='<p class="muted small">'+esc(e.message)+'</p>'}
}
function editProfile(){
  modal(`<div class="mh"><h2>Ubah profil</h2><button class="close" onclick="closeM()">×</button></div>
  <form onsubmit="saveProfile(event)"><div class="field"><label>Nama</label><input id="eN" maxlength="40" value="${esc(U.name)}" required></div>
  <div class="field"><label>Bio</label><textarea id="eB" maxlength="160">${esc(U.bio||'')}</textarea></div><button class="primary" style="width:100%">Simpan</button></form>`);
}
async function saveProfile(e){
  e.preventDefault();
  try{const u=await api('updateProfile',{name:$('eN').value,bio:$('eB').value});setUser(u);toast('Profil diperbarui.');openProfile(u.handle)}catch(err){fail(err)}
}

/* ---------- Ruang ---------- */
async function loadRooms(){
  const F=[['semua','Semua Ruang'],['verified','✓ Terverifikasi'],['public','Publik'],['private','Privat'],['mine','Ruang saya']];
  $('body').innerHTML=`<div class="tabs">${F.map(f=>`<button class="tab ${st.rf===f[0]?'on':''}" onclick="st.rf='${f[0]}';loadRooms()">${f[1]}</button>`).join('')}</div><div id="rl">${empty('Memuat…','')}</div>`;
  try{
    const r=await api('rooms',{filter:st.rf,q:st.q});
    $('rl').innerHTML=r.items.map(roomCard).join('')||empty('Ruang tidak ditemukan','Coba kata kunci lain atau buat Ruang baru.');
  }catch(e){$('rl').innerHTML=empty('Gagal memuat',esc(e.message))}
}
function roomCard(r){
  return `<article class="card"><div class="rtop"><div class="ricon">${esc(r.emoji)}</div><div><div class="rt">${esc(r.name)} ${r.verified?'<span class="ver">✓ TERVERIFIKASI</span>':''}</div><div class="muted small">${esc(r.category)} · <span class="pill">${r.access==='private'?'🔒 Privat':'🌐 Publik'}</span></div></div></div>
  <p class="rd">${esc(r.description)}</p><div class="rf"><span class="muted small">${r.members.toLocaleString('id-ID')} anggota</span><button class="${r.joined?'secondary':'primary'}" onclick="enterRoom('${r.id}')">${r.joined?'Buka Ruang':r.access==='private'?'🔒 Masuk':'Lihat Ruang'}</button></div></article>`;
}
async function enterRoom(id,q){
  try{
    const d=await api('room',{id,q:q||''});
    if(d.locked){
      if(!need())return;st.pending=id;
      return modal(`<div class="mh"><h2>Ruang privat</h2><button class="close" onclick="closeM()">×</button></div><p class="muted small">Masukkan password untuk mengakses “${esc(d.room.name)}”.</p>
      <form onsubmit="unlock(event)"><div class="field"><label>Password</label><input id="rpw" type="password" required></div><button class="primary" style="width:100%">Buka Ruang</button></form>`);
    }
    closeM();st.view='room';st.room=d.room;nav();
    $('pt').textContent=d.room.name;$('ha').textContent='← Ruang';$('ha').onclick=()=>go('rooms');
    drawRoom(d);if(!q)scrollTo({top:0,behavior:'smooth'});
  }catch(e){fail(e)}
}
async function unlock(e){
  e.preventDefault();
  try{await api('joinRoom',{id:st.pending,password:$('rpw').value});toast('Password benar. Ruang terbuka.');enterRoom(st.pending)}catch(err){toast(err.message)}
}
function drawRoom(d){
  const r=d.room,body=$('body'),keep=document.getElementById('rsi');
  body.innerHTML=`<article class="card"><div class="rtop"><div class="ricon">${esc(r.emoji)}</div><div><div class="rt">${esc(r.name)}</div><div class="muted small">${esc(r.category)} · ${r.members} anggota</div></div></div><p class="rd">${esc(r.description)}</p>
  <div style="display:flex;gap:8px"><button class="secondary" style="flex:1" onclick="toggleJoin('${r.id}',${r.joined})">${r.joined?'Keluar':'＋ Bergabung'}</button><button class="secondary" style="flex:1" onclick="shareRoom('${r.id}')">Bagikan</button></div></article>
  <div class="rc"><input id="rpi" maxlength="500" placeholder="Mulai diskusi..."><button class="primary" onclick="roomPost('${r.id}')">Kirim</button></div>
  <div class="rc"><input id="rsi" type="search" placeholder="Cari kata atau #hashtag dalam Ruang..." value="${esc(st.rq||'')}" oninput="clearTimeout(st.rt);st.rt=setTimeout(()=>{st.rq=this.value;enterRoom('${r.id}',this.value)},350)"></div>
  <div>${d.posts.map(p=>`<article class="rp"><strong>${esc(p.name)}</strong> <span class="muted small">${esc(p.handle)} · ${ago(p.createdAt)}</span><p>${fmtText(p.text)}</p><button class="action ${p.liked?'liked':''}" onclick="likeRP('${p.id}','${r.id}')">♡ ${p.likes}</button></article>`).join('')||empty('Belum ada diskusi','Jadilah orang pertama yang memulai percakapan.')}</div>`;
  if(keep&&st.rq){const n=$('rsi');n.focus();n.setSelectionRange(n.value.length,n.value.length)}
}
async function toggleJoin(id,joined){
  if(!need())return;
  try{await api(joined?'leaveRoom':'joinRoom',{id});toast(joined?'Kamu keluar dari Ruang.':'Kamu bergabung ke Ruang.');enterRoom(id)}catch(e){fail(e)}
}
async function roomPost(id){
  if(!need())return;const i=$('rpi'),text=i.value.trim();if(!text)return toast('Tulis pesan terlebih dahulu.');
  try{await api('createRoomPost',{roomId:id,text});toast('Diskusi ditambahkan.');enterRoom(id)}catch(e){fail(e)}
}
async function likeRP(id,room){if(!need())return;try{await api('likeRoomPost',{id});enterRoom(room,st.rq)}catch(e){fail(e)}}
function shareRoom(id){const url=location.href.split('#')[0]+'#ruang-'+id;navigator.clipboard?navigator.clipboard.writeText(url).then(()=>toast('Tautan Ruang disalin.')).catch(()=>toast(url)):toast(url)}
function roomForm(){
  if(!need())return;st.access='public';
  modal(`<div class="mh"><h2>Buat Ruang baru</h2><button class="close" onclick="closeM()">×</button></div>
  <form onsubmit="createRoom(event)"><div class="field"><label>Nama Ruang</label><input id="rn" maxlength="60" required placeholder="Contoh: Teknologi Indonesia"></div>
  <div class="field"><label>Deskripsi</label><textarea id="rd" maxlength="240" required placeholder="Ruang ini membahas apa?"></textarea></div>
  <div class="field"><label>Kategori</label><select id="rc">${['Umum','Teknologi','Pendidikan','Karier','Bisnis','Hobi','Sosial'].map(c=>`<option>${c}</option>`).join('')}</select></div>
  <div class="field"><label>Jenis akses</label><div class="cg"><button type="button" class="choice on" id="aPub" onclick="setAcc('public')">🌐 <b>Publik</b><br>Semua orang bisa bergabung.</button><button type="button" class="choice" id="aPri" onclick="setAcc('private')">🔒 <b>Privat</b><br>Butuh password.</button></div></div>
  <div class="field hidden" id="rpf"><label>Password Ruang</label><input id="rpw2" type="password" minlength="4" maxlength="64" placeholder="Minimal 4 karakter"></div>
  <div class="field"><label>Ikon</label><select id="re">${['💬','💻','📚','🎨','🌱','🚀'].map(c=>`<option>${c}</option>`).join('')}</select></div><button class="primary" style="width:100%">Buat Ruang</button></form>`);
}
function setAcc(a){st.access=a;$('aPub').classList.toggle('on',a==='public');$('aPri').classList.toggle('on',a==='private');$('rpf').classList.toggle('hidden',a!=='private');$('rpw2').required=a==='private'}
async function createRoom(e){
  e.preventDefault();
  try{await api('createRoom',{name:$('rn').value,description:$('rd').value,category:$('rc').value,emoji:$('re').value,access:st.access,password:$('rpw2').value});
    closeM();st.rf='mine';go('rooms');toast('Ruang berhasil dibuat.')}catch(err){fail(err)}
}

/* ---------- Video & Gift ---------- */
async function loadReels(){
  $('plist').innerHTML=empty('Memuat video…','');
  try{const r=await api('reels',{limit:30});st.reels=r.items;st.ri=0;drawReel()}catch(e){$('plist').innerHTML=empty('Gagal memuat',esc(e.message))}
}
function drawReel(){
  const r=st.reels[st.ri];
  if(!r){$('plist').innerHTML=empty('Belum ada video','');return}
  $('plist').innerHTML=`<div class="reels"><div class="rs"><article class="reel"><div class="rart">${r.emoji}</div>
  <div class="rcn"><div style="display:flex;align-items:center;gap:7px;margin-bottom:9px;font-weight:800;font-size:12px">${esc(r.user)} <span style="opacity:.7;font-weight:500">${esc(r.handle)}</span><button class="follow" onclick="follow('${esc(r.handle)}')">Ikuti</button></div>${fmtText(r.caption)}<div style="font-size:11px;margin-top:6px">${esc(r.audio)}</div></div>
  <div class="rside"><button class="ra" onclick="reelAct('toggleReelLike','liked')">${r.liked?'❤️':'♡'}<span>${r.likes.toLocaleString('id-ID')}</span></button>
  <button class="ra" onclick="gift()">🎁<span>Gift</span></button><button class="ra" onclick="reelAct('toggleReelSave','saved')">${r.saved?'▣':'▢'}<span>Simpan</span></button><button class="ra" onclick="shareReel()">↗<span>Bagikan</span></button></div></article></div>
  <div class="rbtn"><button onclick="nextReel(-1)">↑ Sebelumnya</button><button onclick="nextReel(1)">↓ Berikutnya</button><button onclick="toast('Unggah video akan tersedia nanti.')">＋ Buat video</button></div></div>`;
}
function shareReel(){
  const url=location.href.split('#')[0]+'#video-'+st.reels[st.ri].handle;
  navigator.clipboard?navigator.clipboard.writeText(url).then(()=>toast('Tautan video disalin.')).catch(()=>toast(url)):toast(url);
}
function nextReel(s){st.ri=(st.ri+s+st.reels.length)%st.reels.length;drawReel()}
async function reelAct(a,f){
  if(!need())return;const r=st.reels[st.ri];
  try{const d=await api(a,{id:r.id});r[f]=d.on;if(d.count!=null)r.likes=d.count;drawReel();if(f==='saved')toast(d.on?'Video disimpan.':'Dihapus dari simpanan.')}catch(e){fail(e)}
}
function gift(){
  if(!need())return;const r=st.reels[st.ri];
  modal(`<div class="mh"><h2>Kirim gift ke ${esc(r.user)}</h2><button class="close" onclick="closeM()">×</button></div><p class="muted small">Gift dan saldo hanya simulasi.</p>
  <div class="gg">${GIFTS.map(g=>`<button class="go ${st.gift===g[1]?'on':''}" onclick="st.gift='${g[1]}';gift()"><b>${g[0]}</b>${g[1]}<br><span class="muted">${g[2]} koin</span></button>`).join('')}</div>
  <div class="wl"><span>Saldo koin demo</span><strong>${(U.coins||0).toLocaleString('id-ID')} koin</strong></div><button class="primary" style="width:100%;margin-top:14px" onclick="sendGift()">Kirim gift terpilih</button>`);
}
async function sendGift(){
  try{const d=await api('sendGift',{reelId:st.reels[st.ri].id,gift:st.gift});U.coins=d.coins;setUser(U);closeM();toast('Gift terkirim! Ini simulasi demo.')}catch(e){toast(e.message)}
}

/* ---------- Creator Studio ---------- */
async function loadCreator(){
  if(!U){$('body').innerHTML=empty('Masuk dulu','Creator Studio menampilkan performa kontenmu.');return}
  $('body').innerHTML=empty('Memuat…','');
  try{
    const d=await api('creator'),n=v=>v.toLocaleString('id-ID');
    $('body').innerHTML=`<div class="grid3"><div class="tile">♡<strong>${n(d.likes)}</strong><span>Total suka</span></div><div class="tile">✦<strong>Rp ${n(d.profit)}</strong><span>Estimasi profit demo</span></div><div class="tile">🎁<strong>${n(d.giftsReceived)}</strong><span>Gift diterima</span></div></div>
    <section class="card"><h2 class="st">Dompet kreator</h2><div class="wl"><span>Saldo koin demo</span><strong>${n(d.coins)} koin</strong></div><div class="wl"><span>Status monetisasi</span><span class="pill">Simulasi demo</span></div><p class="muted small">Angka ini simulasi. Belum ada saldo uang atau transaksi sungguhan.</p></section>
    <section class="card"><h2 class="st">Postingan dan performa</h2>${d.posts.map(p=>`<div class="wl"><span>${esc(p.text)}</span><strong>♡ ${p.likes}</strong></div>`).join('')||'<p class="muted small">Terbitkan postingan untuk melihat performanya.</p>'}</section>`;
  }catch(e){$('body').innerHTML=empty('Gagal memuat',esc(e.message))}
}

/* ---------- Pencarian & start ---------- */
$('si').addEventListener('input',e=>{
  clearTimeout(st.t);const v=e.target.value.trim();
  st.t=setTimeout(()=>{
    st.q=v;st.tag='';
    if(st.view==='rooms')return loadRooms();
    if(st.view==='room')return;
    if(v&&st.view==='home')st.view='explore';
    if(!v&&st.view==='explore')st.view='home';
    $('pt').textContent=v?'Hasil pencarian':TITLES[st.view][0];nav();
    if(st.sort==='video')st.sort='rekomendasi';feedShell();
  },350);
});
let touchY=0;
$('body').addEventListener('touchstart',e=>{touchY=e.changedTouches[0].screenY},{passive:true});
$('body').addEventListener('touchend',e=>{
  if(!e.target.closest('.reel'))return;
  const d=touchY-e.changedTouches[0].screenY;
  if(Math.abs(d)>45)nextReel(d>0?1:-1);
},{passive:true});

topUser();nav();feedShell();side();
if(token)api('me').then(u=>setUser(u)).catch(()=>{});