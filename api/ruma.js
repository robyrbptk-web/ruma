'use strict';

/**
 * RUMA API — Vercel Serverless Function
 *
 * Satu endpoint POST /api/ruma yang mempertahankan protokol lama
 * ({ action, token, ...payload } → { ok, data | message, code }) sehingga
 * frontend RUMA yang sudah ada tetap berjalan.
 *
 * Data disimpan di Supabase Postgres, media di Supabase Storage, dan
 * login/register dilindungi Cloudflare Turnstile.
 */

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { hashPassword, verifyPassword, needsPasswordUpgrade } = require('../lib/password');

const CONFIG = {
  supabaseUrl: String(process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
  serviceKey: String(process.env.SUPABASE_SERVICE_ROLE_KEY || ''),
  bucket: String(process.env.SUPABASE_MEDIA_BUCKET || 'ruma-media'),
  turnstileSecret: String(process.env.TURNSTILE_SECRET_KEY || ''),
  turnstileHostnames: String(process.env.TURNSTILE_HOSTNAMES || '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)
};

const GIFT_COSTS = {
  Mawar: 10,
  Hati: 25,
  Kopi: 50,
  Bintang: 100,
  Berlian: 250,
  Roket: 500,
  Mahkota: 800,
  Perayaan: 120
};

const MAX_TEXT = 5000;
const MAX_CAPTION = 700;
const MAX_NAME = 40;
const MAX_BIO = 300;
const MAX_URL = 2048;
const MAX_SESSIONS_PER_USER = 5;
const MAX_LEGACY_UPLOAD_BYTES = 3 * 1024 * 1024;

let cachedClient = null;

/* ============================== INFRASTRUCTURE ============================= */

function appError(message, code) {
  const error = new Error(message);
  error.ruma = true;
  error.code = code || 'SERVER_ERROR';
  return error;
}

function databaseError(error) {
  console.error('[ruma] database error:', error);
  return appError('Terjadi kesalahan pada database RUMA. Coba lagi.', 'DB_ERROR');
}

function storageError(error) {
  console.error('[ruma] storage error:', error);
  return appError('Media gagal diproses di penyimpanan RUMA. Coba lagi.', 'STORAGE_ERROR');
}

function supabase() {
  if (!CONFIG.supabaseUrl || !CONFIG.serviceKey) {
    throw appError(
      'Backend RUMA belum dikonfigurasi. Isi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di environment Vercel.',
      'CONFIG'
    );
  }
  if (!cachedClient) {
    cachedClient = createClient(CONFIG.supabaseUrl, CONFIG.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
  }
  return cachedClient;
}

function unwrap(result) {
  if (result && result.error) throw databaseError(result.error);
  return result ? result.data : null;
}

async function countRows(table, apply) {
  let query = supabase().from(table).select('*', { count: 'exact', head: true });
  if (apply) query = apply(query);
  const { count, error } = await query;
  if (error) throw databaseError(error);
  return count || 0;
}

// PostgREST menerima daftar nilai lewat query string. Dipecah agar URL tidak
// melebihi batas saat feed berisi ratusan postingan.
async function selectIn(table, columns, column, values) {
  const output = [];
  for (let index = 0; index < values.length; index += 100) {
    const chunk = values.slice(index, index + 100);
    if (!chunk.length) continue;
    const { data, error } = await supabase().from(table).select(columns).in(column, chunk);
    if (error) throw databaseError(error);
    if (data) output.push(...data);
  }
  return output;
}

function randomId(prefix) {
  return prefix + '_' + Date.now().toString(36) + crypto.randomBytes(5).toString('hex');
}

function normalizeUsername(value) {
  return String(value == null ? '' : value).toLowerCase().trim().replace(/^@/, '');
}

function normalizeHandle(value) {
  return '@' + normalizeUsername(value);
}

function clampText(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function safeUrl(value) {
  const url = clampText(value, MAX_URL);
  if (!url) return '';
  return /^https?:\/\//i.test(url) ? url : '';
}

function escapeLike(value) {
  return String(value == null ? '' : value).replace(/[\\%_*]/g, match => '\\' + match);
}

function asBoolean(value) {
  const normalized = String(value == null ? '' : value).toLowerCase();
  return normalized === 'true' || normalized === '1' || value === true;
}

function asNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/* ============================== TURNSTILE ================================== */

async function verifyTurnstile(turnstileToken, req) {
  if (!CONFIG.turnstileSecret) {
    // Tanpa secret, verifikasi dilewati agar pengembangan lokal tetap jalan.
    // Produksi WAJIB mengisi TURNSTILE_SECRET_KEY.
    return { skipped: true };
  }

  const token = String(turnstileToken || '').trim();
  if (!token) {
    throw appError('Selesaikan verifikasi keamanan Cloudflare Turnstile terlebih dahulu.', 'TURNSTILE');
  }

  const form = new URLSearchParams();
  form.set('secret', CONFIG.turnstileSecret);
  form.set('response', token);

  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (forwarded) form.set('remoteip', forwarded);

  let payload = {};
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) {
      console.error('[ruma] turnstile http status:', response.status);
      throw appError('Verifikasi Cloudflare Turnstile sedang bermasalah. Coba lagi.', 'TURNSTILE');
    }
    payload = await response.json();
  } catch (error) {
    if (error && error.code === 'TURNSTILE') throw error;
    console.error('[ruma] turnstile request failed:', error);
    throw appError('Verifikasi Cloudflare Turnstile tidak dapat dihubungi. Coba lagi.', 'TURNSTILE');
  }

  if (!payload || payload.success !== true) {
    console.warn('[ruma] turnstile rejected:', payload && payload['error-codes']);
    throw appError('Verifikasi Cloudflare Turnstile gagal. Muat ulang halaman lalu coba lagi.', 'TURNSTILE');
  }

  if (CONFIG.turnstileHostnames.length) {
    const hostname = String(payload.hostname || '').toLowerCase();
    if (CONFIG.turnstileHostnames.indexOf(hostname) < 0) {
      console.warn('[ruma] turnstile hostname mismatch:', hostname);
      throw appError('Verifikasi Cloudflare Turnstile tidak valid untuk domain ini.', 'TURNSTILE');
    }
  }

  return payload;
}

/* ============================== USER HELPERS =============================== */

async function getUserById(id) {
  if (!id) return null;
  const { data, error } = await supabase().from('users').select('*').eq('id', String(id)).maybeSingle();
  if (error) throw databaseError(error);
  return data || null;
}

async function getUserByUsername(username) {
  const normalized = normalizeUsername(username);
  if (!normalized) return null;
  const { data, error } = await supabase()
    .from('users')
    .select('*')
    .eq('username', normalized)
    .maybeSingle();
  if (error) throw databaseError(error);
  return data || null;
}

async function getUserByHandle(handle) {
  return getUserByUsername(String(handle == null ? '' : handle).replace(/^@/, ''));
}

async function getUserByToken(token) {
  const value = String(token || '').trim();
  if (!value) return null;
  const { data: session, error } = await supabase()
    .from('sessions')
    .select('user_id')
    .eq('token', value)
    .maybeSingle();
  if (error) throw databaseError(error);
  if (!session) return null;
  const user = await getUserById(session.user_id);
  if (!user || user.status === 'blocked') return null;
  return user;
}

async function requireUser(token) {
  const user = await getUserByToken(token);
  if (!user) throw appError('Sesi telah berakhir. Silakan login kembali.', 'UNAUTH');
  return user;
}

async function userCounts(userId) {
  const [followers, following] = await Promise.all([
    countRows('follows', query => query.eq('target_id', userId)),
    countRows('follows', query => query.eq('follower_id', userId))
  ]);
  return { followers, following };
}

function userDTO(user, counts) {
  const countsValue = counts || { followers: 0, following: 0 };
  return {
    id: String(user.id),
    username: String(user.username),
    handle: '@' + String(user.username),
    name: String(user.name || user.username || 'Pengguna RUMA'),
    initial: String(user.name || user.username || '?').charAt(0).toUpperCase(),
    bio: String(user.bio || ''),
    color: String(user.color || '#e8efff'),
    ink: String(user.ink || '#2859a8'),
    coins: user.coins == null ? 1250 : Number(user.coins) || 0,
    followers: countsValue.followers || 0,
    following: countsValue.following || 0,
    role: String(user.role || 'user'),
    status: String(user.status || 'active'),
    avatarUrl: String(user.avatar_url || ''),
    bannerUrl: String(user.banner_url || ''),
    verified: user.verified === true || String(user.username).toLowerCase() === 'roby'
  };
}

async function usersMap(users) {
  const map = new Map();
  (users || []).forEach(user => map.set(String(user.id), user));
  return map;
}

async function allUsers() {
  const { data, error } = await supabase().from('users').select('*');
  if (error) throw databaseError(error);
  return data || [];
}

async function createSession(userId) {
  const token = 'TK_' + crypto.randomBytes(24).toString('hex');
  const now = Date.now();

  const { data: existing, error } = await supabase()
    .from('sessions')
    .select('token')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) throw databaseError(error);

  const sessions = existing || [];
  const excess = sessions.length - (MAX_SESSIONS_PER_USER - 1);
  if (excess > 0) {
    const remove = sessions.slice(0, excess).map(row => row.token);
    const { error: removeError } = await supabase().from('sessions').delete().in('token', remove);
    if (removeError) throw databaseError(removeError);
  }

  const { error: insertError } = await supabase()
    .from('sessions')
    .insert({ token, user_id: userId, created_at: now });
  if (insertError) throw databaseError(insertError);
  return token;
}

async function createNotification(userId, type, actor, entityId, message) {
  if (!userId || !actor || String(userId) === String(actor.id)) return;
  try {
    const { error } = await supabase().from('notifications').insert({
      id: randomId('N'),
      user_id: String(userId),
      type: String(type || 'activity'),
      actor_id: String(actor.id),
      entity_id: String(entityId || ''),
      message: String(message || ''),
      is_read: false,
      created_at: Date.now()
    });
    if (error) console.error('[ruma] notification insert failed:', error);
  } catch (error) {
    // Notifikasi tidak boleh menggagalkan aksi utama (like, komentar, dsb.).
    console.error('[ruma] notification failed:', error);
  }
}

/* ============================== AUTH ACTIONS =============================== */

async function handleLogin(body, req) {
  const username = normalizeUsername(body.username);
  const password = String(body.password || '');
  if (!username || !password) throw appError('Username dan password wajib diisi.', 'AUTH');

  await verifyTurnstile(body.turnstileToken, req);

  const user = await getUserByUsername(username);
  if (!user || !verifyPassword(user.password_hash, password)) {
    throw appError('Username atau password salah.', 'AUTH');
  }
  if (user.status === 'blocked') throw appError('Akun ini diblokir.', 'BLOCKED');

  if (needsPasswordUpgrade(user.password_hash)) {
    const { error } = await supabase()
      .from('users')
      .update({ password_hash: hashPassword(password) })
      .eq('id', user.id);
    if (error) console.error('[ruma] password upgrade failed:', error);
  }

  const token = await createSession(user.id);
  return { user: userDTO(user, await userCounts(user.id)), token };
}

async function handleRegister(body, req) {
  const username = normalizeUsername(body.username);
  const password = String(body.password || '');
  const name = clampText(body.name || username, MAX_NAME);

  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    throw appError('Username hanya boleh mengandung huruf kecil, angka, _ (3-20 karakter).', 'VALIDATION');
  }
  if (password.length < 8) throw appError('Password minimal 8 karakter.', 'VALIDATION');
  if (password.length > 200) throw appError('Password terlalu panjang.', 'VALIDATION');
  if (name.length < 2) throw appError('Nama lengkap minimal 2 karakter.', 'VALIDATION');

  await verifyTurnstile(body.turnstileToken, req);

  if (await getUserByUsername(username)) throw appError('Username sudah digunakan.', 'CONFLICT');

  const palette = [
    ['#e8efff', '#2859a8'],
    ['#fbe7e5', '#9e4540'],
    ['#e2f4e9', '#237449'],
    ['#eee7ff', '#6844aa']
  ][Math.floor(Math.random() * 4)];

  const id = 'U_' + crypto.randomUUID();
  const createdAt = Date.now();
  const row = {
    id,
    username,
    password_hash: hashPassword(password),
    name,
    bio: 'Anggota RUMA yang senang berbagi cerita.',
    color: palette[0],
    ink: palette[1],
    coins: 1250,
    role: 'user',
    status: 'active',
    avatar_url: '',
    banner_url: '',
    verified: false,
    created_at: createdAt
  };

  const { error } = await supabase().from('users').insert(row);
  if (error) {
    if (String(error.code) === '23505') throw appError('Username sudah digunakan.', 'CONFLICT');
    throw databaseError(error);
  }

  const token = await createSession(id);
  return { user: userDTO(row, { followers: 0, following: 0 }), token };
}

async function handleChangePassword(body, user) {
  const current = String(body.currentPassword || '');
  const next = String(body.nextPassword || '');
  if (!verifyPassword(user.password_hash, current)) {
    throw appError('Kata sandi saat ini salah.', 'AUTH');
  }
  if (next.length < 8) throw appError('Kata sandi baru minimal 8 karakter.', 'VALIDATION');
  if (next.length > 200) throw appError('Kata sandi baru terlalu panjang.', 'VALIDATION');

  const { error } = await supabase()
    .from('users')
    .update({ password_hash: hashPassword(next) })
    .eq('id', user.id);
  if (error) throw databaseError(error);

  // Cabut sesi perangkat lain; perangkat yang mengganti tetap masuk.
  const keep = String(body.token || '');
  let query = supabase().from('sessions').delete().eq('user_id', user.id);
  if (keep) query = query.neq('token', keep);
  const { error: sessionError } = await query;
  if (sessionError) throw databaseError(sessionError);
  return true;
}

async function handleLogout(body, user) {
  const { error } = await supabase().from('sessions').delete().eq('token', String(body.token || '')).eq('user_id', user.id);
  if (error) throw databaseError(error);
  return true;
}

/* ============================== FEED & POSTS =============================== */

async function postOwnerMap(posts) {
  const ids = Array.from(new Set((posts || []).map(post => String(post.user_id))));
  if (!ids.length) return new Map();
  const users = await selectIn('users', '*', 'id', ids);
  return usersMap(users);
}

function commentDTO(comment, owners) {
  const author = owners.get(String(comment.user_id)) || null;
  return {
    id: String(comment.id),
    userId: String(comment.user_id),
    name: String(author ? author.name : 'Pengguna RUMA'),
    handle: String(author ? '@' + author.username : ''),
    text: String(comment.text || ''),
    createdAt: asNumber(comment.created_at, 0)
  };
}

async function buildFeed(posts, user, owners) {
  if (!posts.length) return { items: [], next: null };
  const ids = posts.map(post => String(post.id));

  const [likes, saves, reposts, comments] = await Promise.all([
    selectIn('likes', 'post_id,user_id', 'post_id', ids),
    selectIn('saves', 'post_id,user_id', 'post_id', ids),
    selectIn('reposts', 'post_id,user_id', 'post_id', ids),
    selectIn('comments', '*', 'post_id', ids)
  ]);

  const likeCount = new Map();
  const likeMine = new Set();
  const saveMine = new Set();
  const repostCount = new Map();
  const repostMine = new Set();
  const commentGroups = new Map();

  likes.forEach(row => {
    likeCount.set(String(row.post_id), (likeCount.get(String(row.post_id)) || 0) + 1);
    if (user && String(row.user_id) === String(user.id)) likeMine.add(String(row.post_id));
  });
  saves.forEach(row => {
    if (user && String(row.user_id) === String(user.id)) saveMine.add(String(row.post_id));
  });
  reposts.forEach(row => {
    repostCount.set(String(row.post_id), (repostCount.get(String(row.post_id)) || 0) + 1);
    if (user && String(row.user_id) === String(user.id)) repostMine.add(String(row.post_id));
  });
  comments.forEach(row => {
    const key = String(row.post_id);
    if (!commentGroups.has(key)) commentGroups.set(key, []);
    commentGroups.get(key).push(row);
  });

  const items = posts.map(post => {
    const owner = owners.get(String(post.user_id)) || null;
    const id = String(post.id);
    const postComments = (commentGroups.get(id) || [])
      .slice()
      .sort((a, b) => asNumber(a.created_at, 0) - asNumber(b.created_at, 0))
      .map(row => commentDTO(row, owners));

    return {
      id,
      name: String(owner ? owner.name : 'Pengguna RUMA'),
      handle: String(owner ? '@' + owner.username : ''),
      initial: String((owner ? owner.name || owner.username : '?') || '?').charAt(0).toUpperCase(),
      color: String(owner && owner.color ? owner.color : '#e8efff'),
      ink: String(owner && owner.ink ? owner.ink : '#2859a8'),
      avatarUrl: String(owner ? owner.avatar_url || '' : ''),
      bannerUrl: String(owner ? owner.banner_url || '' : ''),
      verified: !!(owner && (owner.verified === true || String(owner.username).toLowerCase() === 'roby')),
      topic: String(post.topic || 'Diskusi'),
      text: String(post.text || ''),
      createdAt: asNumber(post.created_at, 0),
      likes: likeCount.get(id) || 0,
      liked: likeMine.has(id),
      reposts: repostCount.get(id) || 0,
      reposted: repostMine.has(id),
      saved: saveMine.has(id),
      commentsCount: postComments.length,
      comments: postComments,
      mine: !!(user && String(post.user_id) === String(user.id)),
      mediaUrl: String(post.media_url || ''),
      mediaType: String(post.media_type || ''),
      mediaName: String(post.media_name || '')
    };
  });

  return { items, next: null };
}

async function getFeed(body, user) {
  const owners = await usersMap(await allUsers());
  let query = supabase().from('posts').select('*').order('created_at', { ascending: false }).limit(300);
  const filter = String(body.filter || '');

  if (filter === 'saved') {
    if (!user) return { items: [], next: null };
    const saved = unwrap(await supabase().from('saves').select('post_id').eq('user_id', user.id));
    const ids = (saved || []).map(row => String(row.post_id));
    if (!ids.length) return { items: [], next: null };
    query = query.in('id', ids);
  } else if (filter === 'user' && body.handle) {
    const target = await getUserByHandle(body.handle);
    if (!target) return { items: [], next: null };
    query = query.eq('user_id', target.id);
  } else if (filter === 'liked' && body.handle) {
    const target = await getUserByHandle(body.handle);
    if (!target) return { items: [], next: null };
    const liked = unwrap(await supabase().from('likes').select('post_id').eq('user_id', target.id));
    const ids = (liked || []).map(row => String(row.post_id));
    if (!ids.length) return { items: [], next: null };
    query = query.in('id', ids);
  }

  if (body.q) {
    const term = String(body.q).toLowerCase().trim();
    const sanitized = term.replace(/[,()*%]/g, ' ').replace(/\s+/g, ' ').trim();
    if (sanitized) {
      const matchingIds = Array.from(owners.values())
        .filter(owner => (String(owner.name || '') + ' ' + String(owner.username || '')).toLowerCase().includes(term))
        .slice(0, 80)
        .map(owner => String(owner.id));
      const filters = ['text.ilike.%' + sanitized + '%', 'topic.ilike.%' + sanitized + '%'];
      if (matchingIds.length) filters.push('user_id.in.(' + matchingIds.join(',') + ')');
      query = query.or(filters.join(','));
    }
  } else if (body.tag) {
    query = query.ilike('text', '%#' + escapeLike(body.tag) + '%');
  }

  const posts = unwrap(await query) || [];
  return buildFeed(posts, user, owners);
}

async function createPost(body, user) {
  const text = clampText(body.text, MAX_TEXT);
  if (!text) throw appError('Teks postingan tidak boleh kosong.', 'VALIDATION');

  const tags = text.match(/#([\p{L}\d_]+)/gu) || [];
  const topic = tags.length ? tags[0].slice(1) : 'Diskusi Umum';
  const id = randomId('P');
  const createdAt = Date.now();
  const mediaUrl = safeUrl(body.mediaUrl);
  const mediaType = clampText(body.mediaType, 80);
  const mediaName = clampText(body.mediaName, 160);

  const row = {
    id,
    user_id: user.id,
    topic,
    text,
    media_url: mediaUrl,
    media_type: mediaType,
    media_name: mediaName,
    created_at: createdAt
  };
  const { error } = await supabase().from('posts').insert(row);
  if (error) throw databaseError(error);

  return {
    id,
    name: String(user.name),
    handle: '@' + String(user.username),
    initial: String(user.name || user.username || '?').charAt(0).toUpperCase(),
    color: String(user.color || '#e8efff'),
    ink: String(user.ink || '#2859a8'),
    avatarUrl: String(user.avatar_url || ''),
    bannerUrl: String(user.banner_url || ''),
    verified: user.verified === true || String(user.username).toLowerCase() === 'roby',
    topic,
    text,
    createdAt,
    mediaUrl,
    mediaType,
    mediaName,
    likes: 0,
    liked: false,
    reposts: 0,
    reposted: false,
    saved: false,
    commentsCount: 0,
    comments: [],
    mine: true
  };
}

async function deleteOwnPost(body, user) {
  const id = String(body.id || '');
  if (!id) throw appError('Postingan tidak valid.', 'VALIDATION');
  const { data, error } = await supabase()
    .from('posts')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id');
  if (error) throw databaseError(error);
  if (!data || !data.length) {
    throw appError('Postingan tidak ditemukan atau tidak memiliki hak akses.', 'NOT_FOUND');
  }
  return true;
}

async function toggleRelation(table, keyColumn, keyValue, user) {
  const key = String(keyValue || '');
  if (!key) throw appError('Data tidak valid.', 'VALIDATION');

  const { data: existing, error: findError } = await supabase()
    .from(table)
    .select(keyColumn)
    .eq(keyColumn, key)
    .eq('user_id', user.id)
    .maybeSingle();
  if (findError) throw databaseError(findError);

  let on;
  if (existing) {
    const { error } = await supabase().from(table).delete().eq(keyColumn, key).eq('user_id', user.id);
    if (error) throw databaseError(error);
    on = false;
  } else {
    const { error } = await supabase().from(table).insert({ [keyColumn]: key, user_id: user.id });
    if (error) throw databaseError(error);
    on = true;
  }

  const count = await countRows(table, query => query.eq(keyColumn, key));
  return { on, count };
}

async function getNotificationTarget(userId, type, entityId, message, actor) {
  await createNotification(userId, type, actor, entityId, message);
}

async function toggleLike(body, user) {
  const result = await toggleRelation('likes', 'post_id', body.id, user);
  if (result.on) {
    const { data: post } = await supabase().from('posts').select('user_id').eq('id', String(body.id)).maybeSingle();
    if (post) {
      await getNotificationTarget(post.user_id, 'like', body.id, user.name + ' menyukai postinganmu.', user);
    }
  }
  return result;
}

async function toggleRepost(body, user) {
  const result = await toggleRelation('reposts', 'post_id', body.id, user);
  if (result.on) {
    const { data: post } = await supabase().from('posts').select('user_id').eq('id', String(body.id)).maybeSingle();
    if (post) {
      await getNotificationTarget(post.user_id, 'repost', body.id, user.name + ' merepost postinganmu.', user);
    }
  }
  return result;
}

/* ================================ COMMENTS ================================= */

async function getComments(body) {
  const postId = String(body.postId || '');
  if (!postId) return [];
  const rows = unwrap(
    await supabase().from('comments').select('*').eq('post_id', postId).order('created_at', { ascending: true })
  ) || [];
  const owners = await postOwnerMap(rows.map(row => ({ user_id: row.user_id })));
  return rows.map(row => commentDTO(row, owners));
}

async function addComment(body, user) {
  const text = clampText(body.text, MAX_TEXT);
  const postId = String(body.postId || '');
  if (!text) throw appError('Komentar tidak boleh kosong.', 'VALIDATION');
  if (!postId) throw appError('Postingan tidak valid.', 'VALIDATION');

  const { data: post, error: postError } = await supabase()
    .from('posts')
    .select('id,user_id')
    .eq('id', postId)
    .maybeSingle();
  if (postError) throw databaseError(postError);
  if (!post) throw appError('Postingan tidak ditemukan.', 'NOT_FOUND');

  const row = {
    id: randomId('C'),
    post_id: postId,
    user_id: user.id,
    text,
    created_at: Date.now()
  };
  const { error } = await supabase().from('comments').insert(row);
  if (error) throw databaseError(error);

  await createNotification(post.user_id, 'comment', user, postId, user.name + ' mengomentari postinganmu.');

  return {
    id: row.id,
    userId: String(user.id),
    name: String(user.name),
    handle: '@' + String(user.username),
    text,
    createdAt: row.created_at
  };
}

/* ================================= FOLLOW ================================== */

async function getFollowingHandles(user) {
  const rows = unwrap(await supabase().from('follows').select('target_id').eq('follower_id', user.id)) || [];
  const ids = rows.map(row => String(row.target_id));
  if (!ids.length) return [];
  const users = await selectIn('users', 'id,username', 'id', ids);
  const map = await usersMap(users);
  return ids.map(id => {
    const target = map.get(id);
    return target ? '@' + String(target.username) : '';
  }).filter(Boolean);
}

async function toggleFollow(body, user) {
  const target = await getUserByHandle(body.handle);
  if (!target) throw appError('Akun tujuan tidak valid.', 'NOT_FOUND');
  if (String(target.id) === String(user.id)) throw appError('Kamu tidak dapat mengikuti akunmu sendiri.', 'VALIDATION');

  const { data: existing, error } = await supabase()
    .from('follows')
    .select('follower_id')
    .eq('follower_id', user.id)
    .eq('target_id', target.id)
    .maybeSingle();
  if (error) throw databaseError(error);

  if (existing) {
    const { error: deleteError } = await supabase()
      .from('follows')
      .delete()
      .eq('follower_id', user.id)
      .eq('target_id', target.id);
    if (deleteError) throw databaseError(deleteError);
    return { on: false };
  }

  const { error: insertError } = await supabase()
    .from('follows')
    .insert({ follower_id: user.id, target_id: target.id });
  if (insertError) throw databaseError(insertError);

  await createNotification(target.id, 'follow', user, '@' + target.username, user.name + ' mulai mengikutimu.');
  return { on: true };
}

/* ================================ PROFILE ================================== */

async function getProfile(body, user) {
  const target = body.handle ? await getUserByHandle(body.handle) : user;
  if (!target) throw appError('Pengguna tidak ditemukan.', 'NOT_FOUND');

  const [posts, counts, follow] = await Promise.all([
    countRows('posts', query => query.eq('user_id', target.id)),
    userCounts(target.id),
    user
      ? supabase()
          .from('follows')
          .select('target_id')
          .eq('follower_id', user.id)
          .eq('target_id', target.id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null })
  ]);
  if (follow.error) throw databaseError(follow.error);

  return {
    user: userDTO(target, counts),
    posts,
    isFollowing: !!follow.data
  };
}

async function updateProfile(body, user) {
  const sent = key => Object.prototype.hasOwnProperty.call(body, key);
  const name = clampText(sent('name') ? body.name : user.name, MAX_NAME);
  const bio = clampText(sent('bio') ? body.bio : user.bio, MAX_BIO);
  const avatarUrl = safeUrl(sent('avatarUrl') ? body.avatarUrl : user.avatar_url);
  const bannerUrl = safeUrl(sent('bannerUrl') ? body.bannerUrl : user.banner_url);
  const username = normalizeUsername(sent('username') ? body.username : user.username);

  if (!name) throw appError('Nama tidak boleh kosong.', 'VALIDATION');
  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    throw appError('Username hanya boleh 3-20 karakter: huruf kecil, angka, atau _.', 'VALIDATION');
  }

  if (username !== String(user.username).toLowerCase()) {
    const existing = await getUserByUsername(username);
    if (existing && String(existing.id) !== String(user.id)) {
      throw appError('Username sudah digunakan.', 'CONFLICT');
    }
  }

  const patch = {
    name,
    username,
    bio,
    avatar_url: avatarUrl,
    banner_url: bannerUrl
  };
  const { error } = await supabase().from('users').update(patch).eq('id', user.id);
  if (error) throw databaseError(error);

  const updated = { ...user, ...patch };
  return userDTO(updated, await userCounts(user.id));
}

async function getTrends() {
  const posts = unwrap(
    await supabase().from('posts').select('text').order('created_at', { ascending: false }).limit(1000)
  ) || [];

  const counts = new Map();
  posts.forEach(post => {
    const matches = String(post.text || '').match(/#([\p{L}\d_]+)/gu) || [];
    matches.forEach(tag => counts.set(tag, (counts.get(tag) || 0) + 1));
  });

  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

async function getPeople(body, user) {
  const query = String((body && body.q) || '').trim().toLowerCase().replace(/^@/, '');
  const users = await allUsers();

  let followingSet = new Set();
  if (user) {
    const rows = unwrap(await supabase().from('follows').select('target_id').eq('follower_id', user.id)) || [];
    followingSet = new Set(rows.map(row => String(row.target_id)));
  }

  return users
    .filter(candidate => !user || String(candidate.id) !== String(user.id))
    .filter(candidate => !query || (String(candidate.name || '') + ' ' + String(candidate.username || '')).toLowerCase().includes(query))
    .slice(0, query ? 30 : 10)
    .map(candidate => ({
      name: String(candidate.name || candidate.username),
      handle: '@' + String(candidate.username),
      initial: String(candidate.name || candidate.username || '?').charAt(0).toUpperCase(),
      color: String(candidate.color || '#e8efff'),
      ink: String(candidate.ink || '#2859a8'),
      avatarUrl: String(candidate.avatar_url || ''),
      bannerUrl: String(candidate.banner_url || ''),
      verified: candidate.verified === true || String(candidate.username).toLowerCase() === 'roby',
      following: followingSet.has(String(candidate.id))
    }));
}

/* ================================== ROOMS ================================== */

async function getRooms(body, user) {
  const [rooms, members, users] = await Promise.all([
    supabase().from('rooms').select('*').order('created_at', { ascending: false }),
    supabase().from('room_members').select('room_id,user_id'),
    allUsers()
  ]);
  const roomRows = unwrap(rooms) || [];
  const memberRows = unwrap(members) || [];
  const ownerMap = await usersMap(users);

  const memberCounts = new Map();
  const joinedSet = new Set();
  memberRows.forEach(row => {
    const roomId = String(row.room_id);
    memberCounts.set(roomId, (memberCounts.get(roomId) || 0) + 1);
    if (user && String(row.user_id) === String(user.id)) joinedSet.add(roomId);
  });

  const filter = String(body.filter || '');
  const search = String(body.q || '').toLowerCase().trim();
  const myHandle = user ? normalizeHandle(user.username) : '';

  let filtered = roomRows;
  if (filter === 'private') filtered = filtered.filter(room => room.access === 'private');
  if (filter === 'public') filtered = filtered.filter(room => room.access === 'public');
  if (filter === 'mine' && user) {
    filtered = filtered.filter(room => String(room.owner_id) === String(user.id));
  }
  if (search) {
    filtered = filtered.filter(room =>
      (String(room.name || '') + ' ' + String(room.description || '') + ' ' + String(room.category || ''))
        .toLowerCase()
        .includes(search)
    );
  }

  const items = filtered.map(room => {
    const owner = ownerMap.get(String(room.owner_id)) || null;
    const isOwner = user ? String(room.owner_id) === String(user.id) : false;
    const id = String(room.id);
    return {
      id,
      name: String(room.name || ''),
      description: String(room.description || ''),
      category: String(room.category || 'Umum'),
      emoji: String(room.emoji || '💬'),
      access: String(room.access || 'public'),
      verified: room.verified === true,
      ownerHandle: owner ? '@' + String(owner.username) : myHandle,
      mine: isOwner,
      members: memberCounts.get(id) || 1,
      joined: joinedSet.has(id) || isOwner
    };
  });

  return { items };
}

async function getRoomDetail(body, user) {
  const id = String(body.id || '');
  if (!id) throw appError('Ruang tidak valid.', 'VALIDATION');

  const { data: room, error } = await supabase().from('rooms').select('*').eq('id', id).maybeSingle();
  if (error) throw databaseError(error);
  if (!room) throw appError('Ruang tidak ditemukan.', 'NOT_FOUND');

  const [members, users] = await Promise.all([
    supabase().from('room_members').select('user_id').eq('room_id', id),
    allUsers()
  ]);
  const memberRows = unwrap(members) || [];
  const ownerMap = await usersMap(users);
  const owner = ownerMap.get(String(room.owner_id)) || null;

  const isJoined = !!user && memberRows.some(row => String(row.user_id) === String(user.id));
  const isOwner = !!user && String(room.owner_id) === String(user.id);

  if (room.access === 'private' && !isJoined && !isOwner) {
    return {
      locked: true,
      room: { id: String(room.id), name: String(room.name), emoji: String(room.emoji), access: String(room.access) }
    };
  }

  let postQuery = supabase()
    .from('room_posts')
    .select('*')
    .eq('room_id', id)
    .order('created_at', { ascending: false });
  if (body.q) postQuery = postQuery.ilike('text', '%' + escapeLike(body.q) + '%');
  const postRows = unwrap(await postQuery) || [];

  return {
    locked: false,
    room: {
      id: String(room.id),
      name: String(room.name),
      description: String(room.description || ''),
      category: String(room.category || 'Umum'),
      emoji: String(room.emoji || '💬'),
      access: String(room.access || 'public'),
      ownerHandle: owner ? '@' + String(owner.username) : '',
      mine: isOwner,
      members: Math.max(1, memberRows.length),
      joined: isJoined || isOwner
    },
    posts: postRows.map(post => {
      const author = ownerMap.get(String(post.user_id)) || null;
      return {
        id: String(post.id),
        name: String(author ? author.name : 'Pengguna RUMA'),
        handle: String(author ? '@' + author.username : ''),
        text: String(post.text || ''),
        likes: asNumber(post.likes, 0),
        createdAt: asNumber(post.created_at, 0)
      };
    })
  };
}

async function createRoom(body, user) {
  const name = clampText(body.name, 80);
  const description = clampText(body.description, 500);
  if (!name || !description) throw appError('Nama dan deskripsi Ruang wajib diisi.', 'VALIDATION');

  const access = body.access === 'private' ? 'private' : 'public';
  const password = String(body.password || '');
  if (access === 'private' && password.length < 4) {
    throw appError('Ruang privat membutuhkan password minimal 4 karakter.', 'VALIDATION');
  }

  const id = randomId('RM');
  const { error } = await supabase().from('rooms').insert({
    id,
    name,
    description,
    category: clampText(body.category || 'Umum', 40),
    emoji: clampText(body.emoji || '💬', 8),
    access,
    password_hash: access === 'private' ? hashPassword(password) : '',
    owner_id: user.id,
    verified: false,
    created_at: Date.now()
  });
  if (error) throw databaseError(error);

  const { error: memberError } = await supabase().from('room_members').insert({ room_id: id, user_id: user.id });
  if (memberError) {
    await supabase().from('rooms').delete().eq('id', id);
    throw databaseError(memberError);
  }

  return { id };
}

async function joinRoom(body, user) {
  const id = String(body.id || '');
  const { data: room, error } = await supabase().from('rooms').select('*').eq('id', id).maybeSingle();
  if (error) throw databaseError(error);
  if (!room) throw appError('Ruang tidak ditemukan.', 'NOT_FOUND');

  // Ruang privat warisan Google Sheets bisa saja belum punya password.
  const passwordOk = !room.password_hash || verifyPassword(room.password_hash, String(body.password || ''));
  if (room.access === 'private' && !passwordOk) {
    throw appError('Password Ruang salah.', 'AUTH');
  }

  const { data: existing, error: findError } = await supabase()
    .from('room_members')
    .select('room_id')
    .eq('room_id', id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (findError) throw databaseError(findError);

  if (!existing) {
    const { error: insertError } = await supabase()
      .from('room_members')
      .insert({ room_id: id, user_id: user.id });
    if (insertError) throw databaseError(insertError);
  }

  return { joined: true, members: Math.max(1, await countRows('room_members', query => query.eq('room_id', id))) };
}

async function leaveRoom(body, user) {
  const { error } = await supabase()
    .from('room_members')
    .delete()
    .eq('room_id', String(body.id || ''))
    .eq('user_id', user.id);
  if (error) throw databaseError(error);
  return true;
}

async function createRoomPost(body, user) {
  const text = clampText(body.text, MAX_TEXT);
  if (!text) throw appError('Teks tidak boleh kosong.', 'VALIDATION');
  const roomId = String(body.roomId || '');
  if (!roomId) throw appError('Ruang tidak valid.', 'VALIDATION');

  const { error } = await supabase().from('room_posts').insert({
    id: randomId('RP'),
    room_id: roomId,
    user_id: user.id,
    text,
    likes: 0,
    created_at: Date.now()
  });
  if (error) throw databaseError(error);
  return true;
}

async function likeRoomPost(body, user) {
  const id = String(body.id || '');
  const { data: post, error } = await supabase()
    .from('room_posts')
    .select('id,room_id,user_id,likes')
    .eq('id', id)
    .maybeSingle();
  if (error) throw databaseError(error);
  if (!post) throw appError('Diskusi tidak ditemukan.', 'NOT_FOUND');

  const likes = asNumber(post.likes, 0) + 1;
  const { error: updateError } = await supabase().from('room_posts').update({ likes }).eq('id', id);
  if (updateError) throw databaseError(updateError);

  const [author, room] = await Promise.all([
    getUserById(post.user_id),
    supabase().from('rooms').select('name').eq('id', post.room_id).maybeSingle()
  ]);
  if (author) {
    await createNotification(
      author.id,
      'room_like',
      user,
      id,
      user.name + ' menyukai diskusimu di Ruang ' + (room && room.data ? room.data.name : 'RUMA') + '.'
    );
  }

  return { likes };
}

/* ================================== REELS ================================== */

function reelDTO(reel, user, likes, saves, owners) {
  const id = String(reel.id);
  const owner = owners.get(String(reel.user_id)) || null;
  const handle = owner ? '@' + String(owner.username) : '';
  const name = String((owner && owner.name) || 'Pengguna RUMA');
  return {
    id,
    user: name,
    handle,
    initial: String((owner && (owner.name || owner.username)) || name).charAt(0).toUpperCase(),
    emoji: String(reel.emoji || '🎬'),
    caption: String(reel.caption || ''),
    audio: String(reel.audio || ''),
    avatarUrl: String(owner ? owner.avatar_url || '' : ''),
    color: String(owner && owner.color ? owner.color : '#e8efff'),
    ink: String(owner && owner.ink ? owner.ink : '#2859a8'),
    mediaUrl: String(reel.media_url || ''),
    mediaType: String(reel.media_type || ''),
    createdAt: asNumber(reel.created_at, 0),
    likes: likes.filter(row => String(row.reel_id) === id).length,
    liked: !!user && likes.some(row => String(row.reel_id) === id && String(row.user_id) === String(user.id)),
    saved: !!user && saves.some(row => String(row.reel_id) === id && String(row.user_id) === String(user.id)),
    mine: !!user && String(reel.user_id) === String(user.id)
  };
}

async function getReels(body, user) {
  let query = supabase().from('reels').select('*').order('created_at', { ascending: false });
  if (body.handle) {
    const target = await getUserByHandle(body.handle);
    if (!target) return { items: [] };
    query = query.eq('user_id', target.id);
  }
  const reels = unwrap(await query) || [];
  const ids = reels.map(reel => String(reel.id));

  const [likes, saves, users] = await Promise.all([
    ids.length ? selectIn('reel_likes', 'reel_id,user_id', 'reel_id', ids) : [],
    ids.length ? selectIn('reel_saves', 'reel_id,user_id', 'reel_id', ids) : [],
    allUsers()
  ]);
  const owners = await usersMap(users);

  return { items: reels.map(reel => reelDTO(reel, user, likes, saves, owners)) };
}

async function createReel(body, user) {
  const caption = clampText(body.caption || body.text, MAX_CAPTION);
  const mediaUrl = safeUrl(body.mediaUrl);
  const mediaType = clampText(body.mediaType, 80);
  const emoji = clampText(body.emoji, 8) || '🎬';

  if (!mediaUrl && !caption) throw appError('Unggah video atau tulis caption terlebih dahulu.', 'VALIDATION');
  if (mediaUrl && /^data:/i.test(mediaUrl)) {
    throw appError('Media belum terunggah ke server. Coba unggah ulang.', 'VALIDATION');
  }

  const reel = {
    id: randomId('RL'),
    user_id: user.id,
    emoji,
    caption,
    audio: clampText(body.audio, 200) || '♫ Original audio · ' + String(user.name),
    media_url: mediaUrl,
    media_type: mediaType,
    created_at: Date.now()
  };
  const { error } = await supabase().from('reels').insert(reel);
  if (error) throw databaseError(error);

  const owners = new Map([[String(user.id), user]]);
  return reelDTO(reel, user, [], [], owners);
}

async function deleteReel(body, user) {
  const { data, error } = await supabase()
    .from('reels')
    .delete()
    .eq('id', String(body.id || ''))
    .eq('user_id', user.id)
    .select('id');
  if (error) throw databaseError(error);
  if (!data || !data.length) {
    throw appError('Video tidak ditemukan atau kamu tidak memiliki hak akses.', 'NOT_FOUND');
  }
  return true;
}

async function toggleReelLike(body, user) {
  if (!body.id) throw appError('Video tidak valid.', 'VALIDATION');
  const result = await toggleRelation('reel_likes', 'reel_id', body.id, user);
  if (result.on) {
    const { data: reel } = await supabase().from('reels').select('user_id').eq('id', String(body.id)).maybeSingle();
    if (reel) {
      await createNotification(reel.user_id, 'reel_like', user, body.id, user.name + ' menyukai videomu.');
    }
  }
  return result;
}

async function sendGift(body, user) {
  const gift = String(body.gift || 'Mawar');
  const cost = GIFT_COSTS[gift] || 10;
  const reelId = String(body.reelId || '');

  const { data: reel, error } = await supabase().from('reels').select('user_id').eq('id', reelId).maybeSingle();
  if (error) throw databaseError(error);
  if (!reel) throw appError('Video tidak ditemukan.', 'NOT_FOUND');

  const coins = asNumber(user.coins, 0);
  if (coins < cost) throw appError('Saldo koin tidak mencukupi.', 'VALIDATION');

  const nextCoins = coins - cost;
  // Kunci optimistis: hanya potong saldo bila nilainya belum berubah sejak dibaca,
  // supaya dua gift bersamaan tidak membuat saldo minus/tertimpa.
  const { data: debited, error: coinError } = await supabase()
    .from('users')
    .update({ coins: nextCoins })
    .eq('id', user.id)
    .eq('coins', coins)
    .select('coins');
  if (coinError) throw databaseError(coinError);
  if (!debited || !debited.length) {
    throw appError('Saldo koin berubah. Coba kirim gift lagi.', 'CONFLICT');
  }

  const { error: giftError } = await supabase().from('gifts').insert({
    id: randomId('G'),
    reel_id: reelId,
    sender_id: user.id,
    gift_name: gift,
    coins: cost,
    created_at: Date.now()
  });
  if (giftError) {
    // Kembalikan koin bila pencatatan gift gagal (hanya bila saldo masih sama).
    await supabase().from('users').update({ coins }).eq('id', user.id).eq('coins', nextCoins);
    throw databaseError(giftError);
  }

  await createNotification(reel.user_id, 'reel_gift', user, reelId, user.name + ' mengirim gift ' + gift + ' untuk videomu.');

  return { coins: nextCoins, gift, reelId };
}

async function getCreatorData(user) {
  const [myPosts, allLikes, allGifts, myReels] = await Promise.all([
    supabase().from('posts').select('id,text').eq('user_id', user.id),
    supabase().from('likes').select('post_id'),
    supabase().from('gifts').select('reel_id,coins'),
    supabase().from('reels').select('id').eq('user_id', user.id)
  ]);

  const posts = unwrap(myPosts) || [];
  const likes = unwrap(allLikes) || [];
  const gifts = unwrap(allGifts) || [];
  const reels = unwrap(myReels) || [];

  const postIds = new Set(posts.map(post => String(post.id)));
  const reelIds = new Set(reels.map(reel => String(reel.id)));

  const likeCounts = new Map();
  likes.forEach(like => {
    const id = String(like.post_id);
    if (postIds.has(id)) likeCounts.set(id, (likeCounts.get(id) || 0) + 1);
  });

  let totalLikes = 0;
  postIds.forEach(id => { totalLikes += likeCounts.get(id) || 0; });

  const receivedGifts = gifts.filter(gift => reelIds.has(String(gift.reel_id)));
  const giftCoins = receivedGifts.reduce((sum, gift) => sum + (Number(gift.coins) || 0), 0);

  return {
    likes: totalLikes,
    profit: totalLikes * 500 + giftCoins,
    giftsReceived: receivedGifts.length,
    giftCoins,
    reels: reelIds.size,
    coins: asNumber(user.coins, 1250),
    posts: posts.map(post => ({
      text: String(post.text || '').slice(0, 90),
      likes: likeCounts.get(String(post.id)) || 0
    }))
  };
}

/* ================================ UPLOADS ================================== */

function publicUrl(path) {
  const { data } = supabase().storage.from(CONFIG.bucket).getPublicUrl(path);
  return data && data.publicUrl ? data.publicUrl : '';
}

function publicMedia(path, contentType, name) {
  const url = publicUrl(path);
  return {
    id: path,
    url,
    streamUrl: url,
    thumbnail: url,
    type: contentType,
    name,
    ownerId: ''
  };
}

async function createUpload(body, user) {
  const contentType = String(body.contentType || '').toLowerCase().split(';')[0].trim();
  if (!/^(image|video)\/[a-z0-9.+-]+$/.test(contentType)) {
    throw appError('Hanya berkas gambar atau video yang dapat diunggah.', 'VALIDATION');
  }

  const original = String(body.name || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
  const extension = (original.match(/\.[a-z0-9]{1,8}$/i) || [''])[0].toLowerCase();
  const kind = contentType.split('/')[0];
  const path = kind + '/' + user.id + '/' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + extension;

  const { data, error } = await supabase().storage.from(CONFIG.bucket).createSignedUploadUrl(path);
  if (error) throw storageError(error);

  const base = CONFIG.supabaseUrl;
  const signed = String(data.signedUrl || '');
  const uploadUrl = /^https?:\/\//i.test(signed)
    ? signed
    : base + '/storage/v1' + (signed.charAt(0) === '/' ? '' : '/') + signed;

  const url = publicUrl(path);
  return {
    bucket: CONFIG.bucket,
    path,
    token: String(data.token || ''),
    uploadUrl,
    url,
    streamUrl: url,
    thumbnail: url,
    publicUrl: url,
    type: contentType,
    name: original
  };
}

async function uploadMedia(body, user) {
  const dataUrl = String(body.dataUrl || '');
  const match = dataUrl.match(/^data:((?:image|video)\/[a-z0-9.+-]+);base64,(.*)$/i);
  if (!match) throw appError('Format media tidak valid.', 'VALIDATION');

  const contentType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) throw appError('Berkas media kosong.', 'VALIDATION');
  if (buffer.length > MAX_LEGACY_UPLOAD_BYTES) {
    throw appError('Berkas terlalu besar untuk jalur unggah lama. Gunakan unggahan langsung ke Storage.', 'TOO_LARGE');
  }

  const requestedType = String(body.mediaType || '').toLowerCase();
  if (requestedType && contentType.indexOf(requestedType + '/') !== 0) {
    throw appError('Jenis media tidak sesuai.', 'VALIDATION');
  }

  const original = String(body.name || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
  const extension = (original.match(/\.[a-z0-9]{1,8}$/i) || [''])[0].toLowerCase();
  const path = contentType.split('/')[0] + '/' + user.id + '/' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + extension;

  const { error } = await supabase().storage.from(CONFIG.bucket).upload(path, buffer, {
    contentType,
    upsert: false
  });
  if (error) throw storageError(error);

  const media = publicMedia(path, contentType, original);
  media.ownerId = String(user.id);
  return media;
}

/* ================================= REPORTS ================================= */

async function reportPost(body, user) {
  const postId = String(body.postId || '');
  const { data: post, error } = await supabase().from('posts').select('id').eq('id', postId).maybeSingle();
  if (error) throw databaseError(error);
  if (!post) throw appError('Postingan tidak ditemukan.', 'NOT_FOUND');

  const { error: insertError } = await supabase().from('reports').insert({
    id: randomId('REP'),
    post_id: postId,
    reporter_id: user.id,
    reason: clampText(body.reason || 'Pelanggaran panduan', 300),
    status: 'open',
    created_at: Date.now()
  });
  if (insertError) throw databaseError(insertError);
  return true;
}

/* ============================== NOTIFICATIONS ============================== */

async function getNotifications(user) {
  const [rows, unread] = await Promise.all([
    supabase()
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100),
    countRows('notifications', query => query.eq('user_id', user.id).eq('is_read', false))
  ]);
  const notifications = unwrap(rows) || [];

  const actorIds = Array.from(new Set(notifications.map(row => row.actor_id).filter(Boolean).map(String)));
  const actors = actorIds.length ? await selectIn('users', 'id,name,username,avatar_url', 'id', actorIds) : [];
  const actorMap = await usersMap(actors);

  return {
    items: notifications.map(row => {
      const actor = row.actor_id ? actorMap.get(String(row.actor_id)) : null;
      const actorName = String((actor && actor.name) || 'Pengguna RUMA');
      return {
        id: String(row.id),
        type: String(row.type || 'activity'),
        actorName,
        actorHandle: actor ? '@' + String(actor.username) : '',
        actorAvatarUrl: String(actor ? actor.avatar_url || '' : ''),
        actorInitial: actorName.charAt(0).toUpperCase(),
        entityId: String(row.entity_id || ''),
        message: String(row.message || 'Aktivitas baru di akunmu.'),
        read: row.is_read === true,
        createdAt: asNumber(row.created_at, 0)
      };
    }),
    unread
  };
}

async function markNotificationsRead(user) {
  const { error } = await supabase()
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', user.id)
    .eq('is_read', false);
  if (error) throw databaseError(error);
  return true;
}

/* ================================= ADMIN =================================== */

function isAdmin(user) {
  return !!user && user.status !== 'blocked' &&
    (String(user.role || '').toLowerCase() === 'admin' || String(user.username).toLowerCase() === 'roby');
}

function requireAdmin(user) {
  if (!isAdmin(user)) throw appError('Akses admin diperlukan.', 'FORBIDDEN');
}

async function adminAction(action, body, user) {
  requireAdmin(user);

  if (action === 'adminOverview') {
    const [users, posts, rooms, reels, openReports] = await Promise.all([
      countRows('users'),
      countRows('posts'),
      countRows('rooms'),
      countRows('reels'),
      countRows('reports', query => query.neq('status', 'resolved'))
    ]);
    return { users, posts, rooms, reels, openReports };
  }

  if (action === 'adminUsers') {
    const [users, followsResult] = await Promise.all([
      allUsers(),
      supabase().from('follows').select('follower_id,target_id')
    ]);
    const follows = unwrap(followsResult) || [];
    return {
      items: users.map(candidate => userDTO(candidate, {
        followers: follows.filter(row => String(row.target_id) === String(candidate.id)).length,
        following: follows.filter(row => String(row.follower_id) === String(candidate.id)).length
      }))
    };
  }

  if (action === 'adminPosts') {
    const posts = unwrap(
      await supabase().from('posts').select('*').order('created_at', { ascending: false }).limit(300)
    ) || [];
    const owners = await postOwnerMap(posts);
    return {
      items: posts.map(post => {
        const owner = owners.get(String(post.user_id)) || null;
        return {
          id: String(post.id),
          text: String(post.text || ''),
          handle: owner ? '@' + String(owner.username) : '',
          name: owner ? String(owner.name) : 'Pengguna RUMA',
          topic: String(post.topic || ''),
          mediaUrl: String(post.media_url || ''),
          mediaType: String(post.media_type || ''),
          createdAt: asNumber(post.created_at, 0)
        };
      })
    };
  }

  if (action === 'adminReports') {
    const [reports, users] = await Promise.all([
      supabase().from('reports').select('*').order('created_at', { ascending: false }).limit(300),
      allUsers()
    ]);
    const rows = unwrap(reports) || [];
    const owners = await usersMap(users);
    return {
      items: rows.map(report => {
        const reporter = owners.get(String(report.reporter_id)) || null;
        return {
          id: String(report.id),
          postId: String(report.post_id),
          reporterHandle: reporter ? '@' + String(reporter.username) : '',
          reason: String(report.reason || ''),
          status: String(report.status || 'open'),
          createdAt: asNumber(report.created_at, 0)
        };
      })
    };
  }

  if (action === 'adminUpdateUser') {
    const target = await getUserById(body.id);
    if (!target) throw appError('Pengguna tidak ditemukan.', 'NOT_FOUND');

    const isPrimary = String(target.username).toLowerCase() === 'roby';
    if (isPrimary && (body.status === 'blocked' || (body.role && body.role !== 'admin'))) {
      throw appError('Admin utama tidak dapat diblokir atau diturunkan role-nya.', 'FORBIDDEN');
    }

    const patch = {};
    if (['active', 'blocked'].indexOf(body.status) >= 0) patch.status = body.status;
    if (['admin', 'moderator', 'user'].indexOf(body.role) >= 0) patch.role = body.role;
    if (typeof body.verified === 'boolean') patch.verified = isPrimary ? true : body.verified;

    if (Object.keys(patch).length) {
      const { error } = await supabase().from('users').update(patch).eq('id', target.id);
      if (error) throw databaseError(error);
    }

    if (patch.status === 'blocked') {
      const { error: sessionError } = await supabase().from('sessions').delete().eq('user_id', target.id);
      if (sessionError) throw databaseError(sessionError);
    }
    return true;
  }

  if (action === 'adminDeletePost') {
    const { data, error } = await supabase()
      .from('posts')
      .delete()
      .eq('id', String(body.id || ''))
      .select('id');
    if (error) throw databaseError(error);
    if (!data || !data.length) throw appError('Postingan tidak ditemukan.', 'NOT_FOUND');
    return true;
  }

  if (action === 'adminResolveReport') {
    const { data, error } = await supabase()
      .from('reports')
      .update({ status: 'resolved', resolved_at: Date.now() })
      .eq('id', String(body.id || ''))
      .select('id');
    if (error) throw databaseError(error);
    if (!data || !data.length) throw appError('Laporan tidak ditemukan.', 'NOT_FOUND');
    return true;
  }

  throw appError('Aksi admin tidak dikenal: ' + action, 'NOT_FOUND');
}

/* ================================ DISPATCHER =============================== */

const ADMIN_ACTIONS = new Set([
  'adminOverview',
  'adminUsers',
  'adminPosts',
  'adminReports',
  'adminUpdateUser',
  'adminDeletePost',
  'adminResolveReport'
]);

const PUBLIC_ACTIONS = new Set(['feed', 'trends', 'people', 'profile', 'comments', 'rooms', 'room', 'reels']);

async function handleAction(action, body, req, token) {
  if (action === 'login') return handleLogin(body, req);
  if (action === 'register') return handleRegister(body, req);
  if (action === 'health') {
    return {
      database: !!(CONFIG.supabaseUrl && CONFIG.serviceKey),
      storage: !!CONFIG.bucket,
      turnstile: !!CONFIG.turnstileSecret
    };
  }

  if (PUBLIC_ACTIONS.has(action)) {
    const user = await getUserByToken(token);
    if (action === 'feed') return getFeed(body, user);
    if (action === 'trends') return getTrends();
    if (action === 'people') return getPeople(body, user);
    if (action === 'profile') return getProfile(body, user);
    if (action === 'comments') return getComments(body);
    if (action === 'rooms') return getRooms(body, user);
    if (action === 'room') return getRoomDetail(body, user);
    if (action === 'reels') return getReels(body, user);
  }

  const user = await requireUser(token);

  if (ADMIN_ACTIONS.has(action)) return adminAction(action, body, user);

  switch (action) {
    case 'me': return userDTO(user, await userCounts(user.id));
    case 'notifications': return getNotifications(user);
    case 'markNotificationsRead': return markNotificationsRead(user);
    case 'following': return { handles: await getFollowingHandles(user) };
    case 'createUpload': return createUpload(body, user);
    case 'uploadMedia': return uploadMedia(body, user);
    case 'reportPost': return reportPost(body, user);
    case 'createPost': return createPost(body, user);
    case 'deletePost': return deleteOwnPost(body, user);
    case 'toggleLike': return toggleLike(body, user);
    case 'toggleRepost': return toggleRepost(body, user);
    case 'toggleSave': return toggleRelation('saves', 'post_id', body.id, user);
    case 'addComment': return addComment(body, user);
    case 'toggleFollow': return toggleFollow(body, user);
    case 'updateProfile': return updateProfile(body, user);
    case 'changePassword': return handleChangePassword(body, user);
    case 'logout': return handleLogout(body, user);
    case 'createRoom': return createRoom(body, user);
    case 'joinRoom': return joinRoom(body, user);
    case 'leaveRoom': return leaveRoom(body, user);
    case 'createRoomPost': return createRoomPost(body, user);
    case 'likeRoomPost': return likeRoomPost(body, user);
    case 'createReel': return createReel(body, user);
    case 'deleteReel': return deleteReel(body, user);
    case 'toggleReelLike': return toggleReelLike(body, user);
    case 'toggleReelSave': return toggleRelation('reel_saves', 'reel_id', body.id, user);
    case 'sendGift': return sendGift(body, user);
    case 'creator': return getCreatorData(user);
    default:
      throw appError('Action tidak ditemukan: ' + action, 'NOT_FOUND');
  }
}

function parseBody(req) {
  let raw = req.body;
  if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
  if (raw == null || raw === '') return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch (_) {
      throw appError('Payload JSON tidak valid.', 'BAD_REQUEST');
    }
  }
  if (typeof raw === 'object') return raw;
  throw appError('Payload JSON tidak valid.', 'BAD_REQUEST');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method === 'GET') {
    res.status(200).json({
      ok: true,
      service: 'RUMA API',
      configured: !!(CONFIG.supabaseUrl && CONFIG.serviceKey),
      turnstile: !!CONFIG.turnstileSecret
    });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Gunakan POST.' });
    return;
  }

  let body;
  try {
    body = parseBody(req);
  } catch (error) {
    res.status(200).json({ ok: false, code: error.code || 'BAD_REQUEST', message: error.message });
    return;
  }

  const action = String(body.action || '');
  const token = String(body.token || '');

  try {
    const data = await handleAction(action, body, req, token);
    res.status(200).json({ ok: true, data });
  } catch (error) {
    if (!error || !error.ruma) {
      console.error('[ruma] unexpected error on action "' + action + '":', error);
      res.status(200).json({
        ok: false,
        code: 'SERVER_ERROR',
        message: 'Terjadi kesalahan sistem. Coba lagi.'
      });
      return;
    }
    res.status(200).json({ ok: false, code: error.code, message: error.message });
  }
};
