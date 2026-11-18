#!/usr/bin/env node
/**
 * Impor data lama Google Sheets ke Supabase.
 *
 * 1. Buka Spreadsheet RUMA → File → Download → Comma-separated values (.csv)
 *    untuk setiap sheet (Users, Posts, Comments, Likes, ...).
 * 2. Simpan semua file CSV ke satu folder, misalnya ./sheet-data
 *    dengan nama file sama seperti nama sheet: Users.csv, Posts.csv, dst.
 * 3. Jalankan:
 *      npm run import-sheets -- ./sheet-data
 *
 * Opsi:
 *   --dir <folder>   folder CSV (default: ./sheet-data)
 *   --dry-run        hanya membaca dan melaporkan jumlah baris
 *
 * Skrip aman dijalankan ulang (upsert berdasarkan primary key), tetapi
 * menjalankan ulang dapat menimpa perubahan yang dibuat setelah migrasi.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

/* ---------------------------------- CSV ---------------------------------- */

function parseCsv(source) {
  const text = String(source || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }

  const filled = rows.filter(cells => cells.some(cell => String(cell).trim() !== ''));
  if (!filled.length) return [];

  const headers = filled[0].map(header => String(header).trim());
  return filled.slice(1).map(cells => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = cells[index] == null ? '' : String(cells[index]);
    });
    return record;
  });
}

/* -------------------------------- HELPERS -------------------------------- */

function text(value) {
  return String(value == null ? '' : value).trim();
}

function pick(record, ...keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      const value = text(record[key]);
      if (value !== '') return value;
    }
  }
  return '';
}

function bool(value) {
  const normalized = text(value).toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'ya' || normalized === 'yes';
}

function int(value, fallback) {
  const number = Number(text(value));
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function epoch(value) {
  const raw = text(value);
  if (!raw) return 0;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) return Math.trunc(numeric);
  const parsed = Date.parse(raw.replace(' ', 'T'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeUsername(value) {
  return text(value).toLowerCase().replace(/^@/, '');
}

function normalizeHandle(value) {
  return normalizeUsername(value);
}

function parseTokens(raw) {
  const value = text(raw);
  if (!value) return [];
  if (value.charAt(0) === '[') {
    try {
      const list = JSON.parse(value);
      return Array.isArray(list) ? list.filter(Boolean).map(String) : [];
    } catch (_) {
      return [];
    }
  }
  return [value];
}

function newId(prefix) {
  return prefix + '_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

/* ---------------------------------- MAIN --------------------------------- */

function readArg(name) {
  const index = process.argv.indexOf('--' + name);
  if (index < 0) return '';
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : '';
}

const dryRun = process.argv.includes('--dry-run');
const directory = path.resolve(readArg('dir') || process.argv[2] || 'sheet-data');
const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');

if (!supabaseUrl || !serviceKey) {
  console.error('SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib diisi. Salin .env.example menjadi .env terlebih dahulu.');
  process.exit(1);
}
if (!fs.existsSync(directory)) {
  console.error('Folder tidak ditemukan: ' + directory);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

let skipped = 0;

function readSheet(name) {
  const file = path.join(directory, name + '.csv');
  if (!fs.existsSync(file)) {
    console.log('• ' + name + '.csv tidak ditemukan — dilewati.');
    return null;
  }
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  console.log('• ' + name + '.csv: ' + rows.length + ' baris');
  return rows;
}

async function write(table, rows, onConflict) {
  if (!rows.length) {
    console.log('  ' + table + ': tidak ada data.');
    return;
  }
  if (dryRun) {
    console.log('  ' + table + ': ' + rows.length + ' baris siap diimpor (dry-run).');
    return;
  }

  for (let index = 0; index < rows.length; index += 200) {
    const chunk = rows.slice(index, index + 200);
    const options = onConflict ? { onConflict } : undefined;
    const { error } = await supabase.from(table).upsert(chunk, options);
    if (error) {
      throw new Error('Gagal menulis ' + table + ' (baris ' + (index + 1) + '-' + (index + chunk.length) + '): ' + error.message);
    }
  }
  console.log('  ' + table + ': ' + rows.length + ' baris diimpor.');
}

function filterKnown(rows, predicate, label) {
  const output = rows.filter(predicate);
  skipped += rows.length - output.length;
  if (output.length !== rows.length) {
    console.log('  ' + label + ': ' + (rows.length - output.length) + ' baris dilewati karena relasi tidak ditemukan.');
  }
  return output;
}

async function main() {
  console.log('Folder sumber: ' + directory);
  if (dryRun) console.log('Mode dry-run: tidak ada data yang ditulis.');

  const userRows = readSheet('Users');
  if (!userRows) {
    console.error('Users.csv wajib ada karena semua tabel lain merujuk ke pengguna.');
    process.exit(1);
  }

  const userByHandle = new Map();
  const users = [];
  const sessions = [];
  const now = Date.now();

  userRows.forEach(row => {
    const username = normalizeUsername(pick(row, 'username', 'Username'));
    if (!username) {
      skipped += 1;
      return;
    }
    const id = pick(row, 'id', 'ID') || newId('U');
    users.push({
      id,
      username,
      password_hash: text(row.password != null ? row.password : row.Password),
      name: pick(row, 'name', 'Name') || username,
      bio: pick(row, 'bio', 'Bio'),
      color: pick(row, 'color', 'Color') || '#e8efff',
      ink: pick(row, 'ink', 'Ink') || '#2859a8',
      coins: int(pick(row, 'coins', 'Coins'), 1250),
      role: ['user', 'moderator', 'admin'].includes(text(row.role)) ? text(row.role) : 'user',
      status: text(row.status) === 'blocked' ? 'blocked' : 'active',
      avatar_url: pick(row, 'avatarUrl', 'avatar_url'),
      banner_url: pick(row, 'bannerUrl', 'banner_url'),
      verified: bool(row.verified),
      created_at: epoch(pick(row, 'createdAt', 'created_at')) || now
    });
    userByHandle.set(username, id);

    parseTokens(row.token).forEach(token => {
      sessions.push({ token, user_id: id, created_at: now });
    });
  });

  console.log('  Users: ' + users.length + ' akun, ' + sessions.length + ' sesi aktif warisan.');
  await write('users', users, 'id');
  await write('sessions', sessions, 'token');

  const userIds = new Set(users.map(user => user.id));

  /* -------------------------------- POSTS -------------------------------- */
  const postRows = readSheet('Posts') || [];
  const posts = filterKnown(postRows, row => {
    const userId = pick(row, 'userId');
    return userIds.has(userId);
  }, 'Posts').map(row => ({
    id: pick(row, 'id') || newId('P'),
    user_id: pick(row, 'userId'),
    topic: pick(row, 'topic') || 'Diskusi Umum',
    text: text(row.text),
    media_url: pick(row, 'mediaUrl'),
    media_type: pick(row, 'mediaType'),
    media_name: pick(row, 'mediaName'),
    created_at: epoch(row.createdAt) || now
  })).filter(post => post.text !== '' || post.media_url !== '');
  const postIds = new Set(posts.map(post => post.id));
  await write('posts', posts, 'id');

  /* ------------------------------ COMMENTS ------------------------------- */
  const commentRows = readSheet('Comments') || [];
  const comments = filterKnown(commentRows, row =>
    postIds.has(pick(row, 'postId')) && userIds.has(pick(row, 'userId')), 'Comments'
  ).map(row => ({
    id: pick(row, 'id') || newId('C'),
    post_id: pick(row, 'postId'),
    user_id: pick(row, 'userId'),
    text: text(row.text),
    created_at: epoch(row.createdAt) || now
  })).filter(comment => comment.text !== '');
  await write('comments', comments, 'id');

  /* --------------------------- RELASI POSTINGAN -------------------------- */
  async function importSimpleRelation(sheet, table, keyField, keyColumn) {
    const rows = readSheet(sheet) || [];
    const keySet = keyField === 'postId' ? postIds : userIds;
    const output = filterKnown(rows, row => {
      const key = pick(row, keyField);
      const userId = pick(row, 'userId');
      return keySet.has(key) && userIds.has(userId);
    }, sheet).map(row => ({
      [keyColumn]: pick(row, keyField),
      user_id: pick(row, 'userId')
    }));
    const unique = [];
    const seen = new Set();
    output.forEach(row => {
      const key = row[keyColumn] + '|' + row.user_id;
      if (seen.has(key)) return;
      seen.add(key);
      unique.push(row);
    });
    await write(table, unique, keyColumn + ',user_id');
  }

  await importSimpleRelation('Likes', 'likes', 'postId', 'post_id');
  await importSimpleRelation('Saves', 'saves', 'postId', 'post_id');
  await importSimpleRelation('Reposts', 'reposts', 'postId', 'post_id');

  /* ------------------------------- FOLLOWS ------------------------------- */
  const followerRows = readSheet('Followers') || [];
  const follows = filterKnown(followerRows, row => {
    const follower = normalizeHandle(row.followerHandle);
    const target = normalizeHandle(row.targetHandle);
    return userByHandle.has(follower) && userByHandle.has(target) && follower !== target;
  }, 'Followers').map(row => ({
    follower_id: userByHandle.get(normalizeHandle(row.followerHandle)),
    target_id: userByHandle.get(normalizeHandle(row.targetHandle))
  }));
  await write('follows', follows, 'follower_id,target_id');

  /* -------------------------------- ROOMS -------------------------------- */
  const roomRows = readSheet('Rooms') || [];
  const rooms = filterKnown(roomRows, row => userByHandle.has(normalizeHandle(row.ownerHandle)), 'Rooms').map(row => ({
    id: pick(row, 'id') || newId('RM'),
    name: pick(row, 'name') || 'Ruang RUMA',
    description: pick(row, 'description'),
    category: pick(row, 'category') || 'Umum',
    emoji: pick(row, 'emoji') || '💬',
    access: text(row.access) === 'private' ? 'private' : 'public',
    password_hash: text(row.password),
    owner_id: userByHandle.get(normalizeHandle(row.ownerHandle)),
    verified: bool(row.verified),
    created_at: epoch(row.createdAt) || now
  }));
  const roomIds = new Set(rooms.map(room => room.id));
  await write('rooms', rooms, 'id');

  const memberRows = readSheet('RoomMembers') || [];
  const members = filterKnown(memberRows, row =>
    roomIds.has(pick(row, 'roomId')) && userIds.has(pick(row, 'userId')), 'RoomMembers'
  ).map(row => ({ room_id: pick(row, 'roomId'), user_id: pick(row, 'userId') }));
  await write('room_members', members, 'room_id,user_id');

  const roomPostRows = readSheet('RoomPosts') || [];
  const roomPosts = filterKnown(roomPostRows, row =>
    roomIds.has(pick(row, 'roomId')) && userIds.has(pick(row, 'userId')), 'RoomPosts'
  ).map(row => ({
    id: pick(row, 'id') || newId('RP'),
    room_id: pick(row, 'roomId'),
    user_id: pick(row, 'userId'),
    text: text(row.text),
    likes: int(row.likes, 0),
    created_at: epoch(row.createdAt) || now
  })).filter(post => post.text !== '');
  await write('room_posts', roomPosts, 'id');

  /* -------------------------------- REELS -------------------------------- */
  const reelRows = readSheet('Reels') || [];
  const reels = filterKnown(reelRows, row => userByHandle.has(normalizeHandle(row.handle)), 'Reels').map(row => ({
    id: pick(row, 'id') || newId('RL'),
    user_id: userByHandle.get(normalizeHandle(row.handle)),
    emoji: pick(row, 'emoji') || '🎬',
    caption: pick(row, 'caption'),
    audio: pick(row, 'audio'),
    media_url: pick(row, 'mediaUrl'),
    media_type: pick(row, 'mediaType'),
    created_at: epoch(row.createdAt) || now
  }));
  const reelIds = new Set(reels.map(reel => reel.id));
  await write('reels', reels, 'id');

  async function importReelRelation(sheet, table) {
    const rows = readSheet(sheet) || [];
    const output = filterKnown(rows, row =>
      reelIds.has(pick(row, 'reelId')) && userIds.has(pick(row, 'userId')), sheet
    ).map(row => ({ reel_id: pick(row, 'reelId'), user_id: pick(row, 'userId') }));
    await write(table, output, 'reel_id,user_id');
  }

  await importReelRelation('ReelLikes', 'reel_likes');
  await importReelRelation('ReelSaves', 'reel_saves');

  const giftRows = readSheet('Gifts') || [];
  const gifts = filterKnown(giftRows, row =>
    reelIds.has(pick(row, 'reelId')) && userIds.has(pick(row, 'senderUserId')), 'Gifts'
  ).map(row => ({
    id: pick(row, 'id') || newId('G'),
    reel_id: pick(row, 'reelId'),
    sender_id: pick(row, 'senderUserId'),
    gift_name: pick(row, 'giftName') || 'Mawar',
    coins: int(row.coins, 10),
    created_at: epoch(row.createdAt) || now
  }));
  await write('gifts', gifts, 'id');

  /* ------------------------------- REPORTS ------------------------------- */
  const reportRows = readSheet('Reports') || [];
  const reports = reportRows.map(row => {
    const reporterId = pick(row, 'reporterUserId') ||
      userByHandle.get(normalizeHandle(pick(row, 'reporterHandle', 'reporter', 'ReporterHandle'))) || '';
    return {
      id: pick(row, 'id') || newId('REP'),
      post_id: pick(row, 'postId'),
      reporter_id: reporterId,
      reason: pick(row, 'reason') || 'Pelanggaran panduan',
      status: pick(row, 'status') || 'open',
      created_at: epoch(row.createdAt) || now,
      resolved_at: epoch(row.resolvedAt) || null
    };
  }).filter(report => {
    const keep = postIds.has(report.post_id) && userIds.has(report.reporter_id);
    if (!keep) skipped += 1;
    return keep;
  });
  await write('reports', reports, 'id');

  /* ---------------------------- NOTIFICATIONS ---------------------------- */
  const notificationRows = readSheet('Notifications') || [];
  const notifications = filterKnown(notificationRows, row =>
    userIds.has(pick(row, 'userId')), 'Notifications'
  ).map(row => {
    const actorId = pick(row, 'actorUserId');
    return {
      id: pick(row, 'id') || newId('N'),
      user_id: pick(row, 'userId'),
      type: pick(row, 'type') || 'activity',
      actor_id: userIds.has(actorId) ? actorId : null,
      entity_id: pick(row, 'entityId'),
      message: pick(row, 'message') || 'Aktivitas baru di akunmu.',
      is_read: bool(row.read),
      created_at: epoch(row.createdAt) || now
    };
  });
  await write('notifications', notifications, 'id');

  console.log('');
  console.log('Selesai.' + (skipped ? ' ' + skipped + ' baris dilewati.' : ''));
  console.log('Langkah berikutnya:');
  console.log('  1. Pastikan minimal satu akun admin: npm run create-admin -- --username roby');
  console.log('  2. Isi SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, dan TURNSTILE_* di Vercel.');
  console.log('  3. Isi API_URL dan TURNSTILE_SITE_KEY di config.js, lalu deploy.');
}

main().catch(error => {
  console.error('');
  console.error('Impor gagal:', error.message || error);
  process.exit(1);
});
