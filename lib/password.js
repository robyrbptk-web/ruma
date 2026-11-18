'use strict';

// Kata sandi baru disimpan sebagai "scrypt$<salt>$<hash>".
// Format lama Google Apps Script ("sha256$<salt>$<hash>") dan kata sandi
// polos tetap bisa diverifikasi supaya akun hasil migrasi tidak terkunci.
// Keduanya otomatis dipindahkan ke scrypt saat pengguna berhasil masuk.

const crypto = require('crypto');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function scryptHash(password, salt) {
  return crypto.scryptSync(String(password), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 64 * 1024 * 1024
  });
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return 'scrypt$' + salt + '$' + scryptHash(password, salt).toString('hex');
}

function verifyPassword(stored, password) {
  const value = String(stored == null ? '' : stored);
  if (!value) return false;

  if (value.indexOf('scrypt$') === 0) {
    const parts = value.split('$');
    if (parts.length !== 3 || !parts[1] || !parts[2]) return false;
    const expected = Buffer.from(parts[2], 'hex');
    if (!expected.length) return false;
    let actual;
    try {
      actual = scryptHash(password, parts[1]);
    } catch (_) {
      return false;
    }
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }

  // Format Apps Script: sha256$<salt>$<sha256(salt + ":" + password)>
  if (value.indexOf('sha256$') === 0) {
    const parts = value.split('$');
    if (parts.length !== 3 || !parts[1] || !parts[2]) return false;
    const digest = crypto
      .createHash('sha256')
      .update(String(parts[1]) + ':' + String(password))
      .digest('hex');
    return safeEqual(digest, parts[2]);
  }

  // Kata sandi polos warisan versi sangat lama.
  return safeEqual(value, String(password));
}

function needsPasswordUpgrade(stored) {
  return String(stored == null ? '' : stored).indexOf('scrypt$') !== 0;
}

module.exports = {
  hashPassword,
  verifyPassword,
  needsPasswordUpgrade
};
