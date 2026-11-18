#!/usr/bin/env node
/**
 * Membuat (atau mempromosikan) akun admin RUMA di Supabase.
 *
 * Pemakaian:
 *   npm run create-admin -- --username roby --password "kata-sandi-kuat"
 *   npm run create-admin                      # password acak dicetak sekali
 *   npm run create-admin -- --force           # ganti password akun yang sudah ada
 *
 * Membutuhkan SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY (dibaca dari .env).
 */

import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const require = createRequire(import.meta.url);
const { hashPassword } = require('../lib/password.js');

function readArg(name) {
  const index = process.argv.indexOf('--' + name);
  if (index < 0) return '';
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : '';
}

const force = process.argv.includes('--force');
const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const username = String(readArg('username') || process.env.ADMIN_USERNAME || 'roby').toLowerCase().trim().replace(/^@/, '');
const passwordArg = String(readArg('password') || process.env.ADMIN_PASSWORD || '');

if (!supabaseUrl || !serviceKey) {
  console.error('SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib diisi. Salin .env.example menjadi .env terlebih dahulu.');
  process.exit(1);
}
if (!/^[a-z0-9_]{3,20}$/.test(username)) {
  console.error('Username harus 3-20 karakter: huruf kecil, angka, atau _.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function temporaryPassword() {
  return 'ruma-' + crypto.randomBytes(6).toString('base64url');
}

async function main() {
  const { data: existing, error } = await supabase
    .from('users')
    .select('id,username')
    .eq('username', username)
    .maybeSingle();

  if (error) throw error;

  if (existing) {
    const patch = { role: 'admin', status: 'active', verified: true };
    let temporary = '';
    if (force) {
      temporary = passwordArg || temporaryPassword();
      patch.password_hash = hashPassword(temporary);
    }

    const { error: updateError } = await supabase.from('users').update(patch).eq('id', existing.id);
    if (updateError) throw updateError;

    console.log('Akun admin "' + username + '" sudah ada dan dipastikan aktif.');
    if (force) {
      console.log('Password baru: ' + temporary);
      console.log('Semua sesi lama dicabut.');
      await supabase.from('sessions').delete().eq('user_id', existing.id);
    } else {
      console.log('Password tidak diubah. Gunakan --force untuk menggantinya.');
    }
    return;
  }

  const password = passwordArg || temporaryPassword();
  const { error: insertError } = await supabase.from('users').insert({
    id: 'U_' + crypto.randomUUID(),
    username,
    password_hash: hashPassword(password),
    name: username === 'roby' ? 'Roby' : username,
    bio: 'Administrator RUMA',
    color: '#e8efff',
    ink: '#2859a8',
    coins: 1250,
    role: 'admin',
    status: 'active',
    avatar_url: '',
    banner_url: '',
    verified: true,
    created_at: Date.now()
  });
  if (insertError) throw insertError;

  console.log('Akun admin "' + username + '" berhasil dibuat.');
  console.log('Password: ' + password);
  console.log('Ganti kata sandi setelah login pertama melalui Profil → Ganti kata sandi.');
}

main().catch(error => {
  console.error('Gagal membuat admin:', error.message || error);
  process.exit(1);
});
