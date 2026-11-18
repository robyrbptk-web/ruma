/**
 * Pemeriksa kesiapan RUMA sebelum deploy.
 *
 * Jalankan setelah mengisi .env:
 *   npm run doctor
 *
 * Skrip ini hanya membaca: tidak membuat, mengubah, atau menghapus data.
 * Keluar dengan kode 1 bila ada masalah yang menghalangi aplikasi berjalan.
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const REQUIRED_TABLES = [
  'users', 'sessions', 'posts', 'comments', 'likes', 'saves', 'reposts',
  'follows', 'rooms', 'room_members', 'room_posts', 'reels', 'reel_likes',
  'reel_saves', 'gifts', 'reports', 'notifications'
];

const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const bucket = String(process.env.SUPABASE_MEDIA_BUCKET || 'ruma-media');
const turnstileSecret = String(process.env.TURNSTILE_SECRET_KEY || '');

const problems = [];
const warnings = [];

function ok(label, detail) {
  console.log('  ✓ ' + label + (detail ? ' — ' + detail : ''));
}

function fail(label, detail) {
  problems.push(label);
  console.log('  ✗ ' + label + (detail ? ' — ' + detail : ''));
}

function warn(label, detail) {
  warnings.push(label);
  console.log('  ! ' + label + (detail ? ' — ' + detail : ''));
}

function checkEnv() {
  console.log('\n• Environment');
  if (!supabaseUrl) fail('SUPABASE_URL belum diisi');
  else if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)) {
    warn('SUPABASE_URL bentuknya tidak biasa', supabaseUrl);
  } else ok('SUPABASE_URL', supabaseUrl);

  if (!serviceKey) fail('SUPABASE_SERVICE_ROLE_KEY belum diisi');
  else if (serviceKey.startsWith('eyJ')) ok('SUPABASE_SERVICE_ROLE_KEY', 'JWT service role');
  else if (serviceKey.startsWith('sb_secret_')) ok('SUPABASE_SERVICE_ROLE_KEY', 'secret key baru');
  else warn('SUPABASE_SERVICE_ROLE_KEY tidak dikenali', 'pastikan memakai service role, bukan anon key');

  if (!turnstileSecret) {
    warn('TURNSTILE_SECRET_KEY kosong', 'login berjalan tanpa verifikasi Turnstile');
  } else if (turnstileSecret.length < 20) {
    warn('TURNSTILE_SECRET_KEY terlalu pendek', 'periksa dashboard Cloudflare');
  } else {
    ok('TURNSTILE_SECRET_KEY', 'terisi');
  }
}

function checkSiteKey() {
  console.log('\n• config.js (dibaca browser)');
  try {
    const source = fs.readFileSync(new URL('../config.js', import.meta.url), 'utf8');
    if (/TURNSTILE_SITE_KEY\s*:\s*''/.test(source)) {
      warn('TURNSTILE_SITE_KEY masih kosong', 'widget tidak muncul sampai site key diisi');
    } else {
      ok('TURNSTILE_SITE_KEY terisi');
    }
    if (/API_URL\s*:\s*''/.test(source)) warn('API_URL kosong', 'frontend akan memakai /api/ruma');
    else ok('API_URL dikonfigurasi');
  } catch (error) {
    warn('config.js tidak dapat dibaca', error.message);
  }
}

async function checkDatabase(supabase) {
  console.log('\n• Database & skema');
  let reachable = false;
  for (const table of REQUIRED_TABLES) {
    const { error } = await supabase.from(table).select('*', { head: true, count: 'exact' }).limit(0);
    if (!error) {
      reachable = true;
      continue;
    }
    const message = String(error.message || '');
    if (/does not exist|Could not find the table|relation .* does not exist/i.test(message)) {
      fail('Tabel ' + table + ' belum ada', 'jalankan supabase/schema.sql');
    } else {
      fail('Tabel ' + table + ' tidak dapat dibaca', message);
    }
  }
  if (reachable) ok('Skema dapat diakses');
  return reachable;
}

async function checkStorage(supabase) {
  console.log('\n• Storage bucket');
  const { data, error } = await supabase.storage.getBucket(bucket);
  if (error) {
    fail('Bucket "' + bucket + '" tidak ditemukan', 'jalankan supabase/schema.sql');
    return;
  }
  if (!data.public) warn('Bucket tidak publik', 'URL media tidak akan bisa dibuka pengunjung');
  else ok('Bucket "' + bucket + '" publik');
  const limit = Number(data.file_size_limit || 0);
  if (limit && limit < 50 * 1024 * 1024) {
    warn('Batas berkas bucket ' + Math.round(limit / 1024 / 1024) + ' MB', 'schema memakai 50 MB');
  } else if (limit) {
    ok('Batas berkas', Math.round(limit / 1024 / 1024) + ' MB');
  }
}

async function main() {
  console.log('RUMA — pemeriksaan kesiapan');
  checkEnv();
  checkSiteKey();

  if (!supabaseUrl || !serviceKey) {
    console.log('\nPemeriksaan database dilewati karena kredensial Supabase belum lengkap.');
  } else {
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    await checkDatabase(supabase);
    await checkStorage(supabase);
  }

  console.log('\nRingkasan');
  if (!problems.length && !warnings.length) {
    console.log('  Semua pemeriksaan lulus. RUMA siap di-deploy.');
    return;
  }
  if (problems.length) console.log('  Masalah yang harus diperbaiki: ' + problems.length);
  problems.forEach(item => console.log('    - ' + item));
  if (warnings.length) console.log('  Peringatan (boleh dilanjutkan): ' + warnings.length);
  warnings.forEach(item => console.log('    - ' + item));

  if (problems.length) process.exitCode = 1;
  else console.log('\nTidak ada masalah yang menghalangi. Lanjutkan deploy ke Vercel.');
}

main().catch(error => {
  console.error('\nPemeriksaan gagal:', error.message || error);
  process.exitCode = 1;
});
