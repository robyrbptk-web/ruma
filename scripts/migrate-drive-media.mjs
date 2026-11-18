/**
 * Pindahkan media lama RUMA dari Google Drive ke Supabase Storage.
 *
 * Skrip ini membaca URL Drive yang tersimpan di tabel users/posts/reels,
 * mengunduh berkasnya dari Drive (file lama dibagikan "anyone with link"),
 * mengunggahnya ke bucket Supabase, lalu memperbarui kolom URL di database.
 *
 * Pemakaian:
 *   npm run migrate-media                 (uji coba, tidak menulis apa pun)
 *   npm run migrate-media -- --apply      (lakukan perubahan)
 *   npm run migrate-media -- --apply --verbose
 *   npm run migrate-media -- --only posts (users | posts | reels)
 */
import { createClient } from '@supabase/supabase-js';

function readArg(name) {
  const index = process.argv.indexOf('--' + name);
  if (index < 0) return '';
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : '';
}

const apply = process.argv.includes('--apply');
const verbose = process.argv.includes('--verbose');
const only = readArg('only');
const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const bucket = String(process.env.SUPABASE_MEDIA_BUCKET || 'ruma-media');

if (!supabaseUrl || !serviceKey) {
  console.error('SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib diisi. Salin .env.example menjadi .env.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const PAGE_SIZE = 500;
const MAX_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT = 30000;

const SOURCES = [
  { table: 'users', columns: ['avatar_url', 'banner_url'] },
  { table: 'posts', columns: ['media_url'] },
  { table: 'reels', columns: ['media_url'] }
];

function isDriveUrl(value) {
  return /https?:\/\/(?:drive|docs)\.google\.com\/|https?:\/\/drive\.usercontent\.google\.com\/|script\.googleusercontent\.com\//i.test(String(value || ''));
}

function driveId(url) {
  const value = String(url || '');
  const patterns = [/[?&]id=([^&#]+)/i, /\/file\/d\/([^/?#]+)/i, /\/d\/([^/?#]+)/i];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match && match[1]) return decodeURIComponent(match[1]);
  }
  return '';
}

function extensionFor(contentType) {
  const type = String(contentType || '').toLowerCase().split(';')[0].trim();
  const map = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/avif': '.avif',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'video/ogg': '.ogv'
  };
  if (map[type]) return map[type];
  if (type.startsWith('image/')) return '.img';
  if (type.startsWith('video/')) return '.vid';
  return '.bin';
}

async function downloadFromDrive(id) {
  const url = 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(id) + '&confirm=t';
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT),
    headers: { 'User-Agent': 'RUMA-Media-Migrator/1.0' }
  });
  if (!response.ok) throw new Error('Drive HTTP ' + response.status);

  const contentType = String(response.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
  if (!/^image\/|^video\/|^application\/octet-stream/.test(contentType)) {
    throw new Error('Drive mengembalikan ' + (contentType || 'tipe tidak dikenal') + ' (berkas mungkin tidak publik)');
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error('Berkas Drive kosong.');
  if (buffer.length > MAX_BYTES) {
    throw new Error('Berkas terlalu besar: ' + Math.round(buffer.length / 1024 / 1024) + ' MB');
  }

  return { buffer, contentType };
}

async function main() {
  console.log('Mode  :', apply ? 'TERAPKAN (menulis ke Supabase)' : 'UJI COBA (tidak menulis apa pun)');
  console.log('Bucket:', bucket);

  const cache = new Map(); // driveId -> public URL
  const stats = { scanned: 0, migrated: 0, failed: 0 };

  async function migrateOne(source, row, column, url) {
    stats.scanned += 1;
    const id = driveId(url);
    if (!id) {
      stats.failed += 1;
      console.warn('  ! ' + source.table + '/' + row.id + '/' + column + ': ID Drive tidak ditemukan');
      return;
    }

    try {
      let publicUrl = cache.get(id);
      if (!publicUrl) {
        if (verbose) console.log('  ↓ unduh', id);
        const file = await downloadFromDrive(id);
        const objectPath = 'legacy/' + source.table + '/' + id + extensionFor(file.contentType);
        if (apply) {
          const upload = await supabase.storage.from(bucket).upload(objectPath, file.buffer, {
            contentType: file.contentType,
            upsert: true,
            cacheControl: '31536000'
          });
          if (upload.error) throw new Error('upload: ' + upload.error.message);
        }
        publicUrl = supabase.storage.from(bucket).getPublicUrl(objectPath).data.publicUrl;
        cache.set(id, publicUrl);
        if (verbose) console.log('  ✓', publicUrl);
      }

      if (apply) {
        const update = await supabase.from(source.table).update({ [column]: publicUrl }).eq('id', row.id);
        if (update.error) throw new Error('update: ' + update.error.message);
      }
      stats.migrated += 1;
      console.log('  ✓ ' + source.table + '/' + row.id + '/' + column + ' → ' + publicUrl);
    } catch (error) {
      stats.failed += 1;
      console.warn('  ! ' + source.table + '/' + row.id + '/' + column + ': ' + error.message);
    }
  }

  for (const source of SOURCES) {
    if (only && only !== source.table) continue;
    console.log('\n• ' + source.table);

    let from = 0;
    let total = 0;
    while (true) {
      const { data: rows, error } = await supabase
        .from(source.table)
        .select('id,' + source.columns.join(','))
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        console.error('  Gagal membaca tabel:', error.message);
        stats.failed += 1;
        break;
      }
      if (!rows || !rows.length) break;
      total += rows.length;

      for (const row of rows) {
        for (const column of source.columns) {
          const url = String(row[column] || '');
          if (isDriveUrl(url)) await migrateOne(source, row, column, url);
        }
      }

      if (rows.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    if (!total) console.log('  tidak ada baris');
  }

  console.log('\nSelesai.');
  console.log('  URL Drive ditemukan :', stats.scanned);
  console.log('  Berhasil dipetakan  :', stats.migrated);
  console.log('  Gagal               :', stats.failed);
  if (!apply && stats.migrated) {
    console.log('\nJalankan ulang dengan --apply untuk mengunggah dan memperbarui database:');
    console.log('  npm run migrate-media -- --apply');
  }
}

main().catch(error => {
  console.error('Migrasi gagal:', error);
  process.exit(1);
});
