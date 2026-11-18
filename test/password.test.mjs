import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { hashPassword, verifyPassword, needsPasswordUpgrade } from '../lib/password.js';

function legacyHash(password, salt) {
  return 'sha256$' + salt + '$' + crypto.createHash('sha256').update(salt + ':' + password).digest('hex');
}

test('hash baru memakai scrypt dan memverifikasi kata sandi yang benar', () => {
  const stored = hashPassword('rahasia123');
  assert.match(stored, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.equal(verifyPassword(stored, 'rahasia123'), true);
  assert.equal(verifyPassword(stored, 'rahasia124'), false);
  assert.equal(needsPasswordUpgrade(stored), false);
});

test('setiap hash memakai salt berbeda', () => {
  assert.notEqual(hashPassword('rahasia123'), hashPassword('rahasia123'));
});

test('hash warisan Apps Script masih bisa dipakai lalu ditandai perlu upgrade', () => {
  const stored = legacyHash('sandiLama', 'abcdef0123456789');
  assert.equal(verifyPassword(stored, 'sandiLama'), true);
  assert.equal(verifyPassword(stored, 'sandiLain'), false);
  assert.equal(needsPasswordUpgrade(stored), true);
});

test('kata sandi polos warisan sangat lama tetap diterima', () => {
  assert.equal(verifyPassword('polos123', 'polos123'), true);
  assert.equal(verifyPassword('polos123', 'salah'), false);
  assert.equal(needsPasswordUpgrade('polos123'), true);
});

test('nilai rusak tidak pernah lolos', () => {
  for (const stored of ['', null, undefined, 'scrypt$', 'scrypt$abc', 'sha256$x', 'scrypt$abcd$zz', 'sha256$abcd$zz']) {
    assert.equal(verifyPassword(stored, 'apa saja'), false);
  }
});
