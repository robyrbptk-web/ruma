'use strict';

const form = document.getElementById('authForm');
const loginTab = document.getElementById('loginTab');
const registerTab = document.getElementById('registerTab');
const nameField = document.getElementById('nameField');
const nameInput = document.getElementById('name');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const togglePassword = document.getElementById('togglePassword');
const submitButton = document.getElementById('submitButton');
const message = document.getElementById('message');
const hint = document.getElementById('hint');
const API_URL = localStorage.getItem('ruma_api_url') || 'https://script.google.com/macros/s/AKfycbyl6evQ9sGyZExU57dPz5JGr2ZdZUFZYefj3cziUCpp7lRPGldNstmnv7ZgjaPLs3rg/exec';

let mode = new URLSearchParams(location.search).get('mode') === 'register' ? 'register' : 'login';

function setMessage(text, success = false) {
  message.textContent = text;
  message.classList.toggle('success', success);
}

function updateMode(nextMode) {
  mode = nextMode;
  const register = mode === 'register';
  loginTab.classList.toggle('active', !register);
  registerTab.classList.toggle('active', register);
  nameField.classList.toggle('hidden', !register);
  nameInput.required = register;
  passwordInput.autocomplete = register ? 'new-password' : 'current-password';
  submitButton.textContent = register ? 'Buat akun' : 'Masuk';
  hint.textContent = register
    ? 'Sudah punya akun? Pilih tab Masuk untuk melanjutkan.'
    : 'Belum punya akun? Pilih tab Daftar untuk membuat akun baru.';
  setMessage('');
}

function normalizeUsername(value) {
  return value.trim().toLowerCase().replace(/^@/, '');
}

async function apiAuth(action, payload) {
  const controller = new AbortController();
  // Apps Script butuh beberapa detik untuk menjawab; batas sebelumnya terlalu
  // ketat sehingga permintaan yang sebenarnya berhasil terlihat gagal.
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {'Content-Type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({action, ...payload}),
      signal: controller.signal
    });
    clearTimeout(timeout);
    const result = await response.json();
    if (!result.ok) {
      const error = new Error(result.message || 'Autentikasi gagal.');
      error.backend = true;
      throw error;
    }
    return result.data;
  } catch (error) {
    clearTimeout(timeout);
    if (error.backend) throw error;
    error.network = true;
    throw error;
  }
}

loginTab.addEventListener('click', () => updateMode('login'));
registerTab.addEventListener('click', () => updateMode('register'));

togglePassword.addEventListener('click', () => {
  const visible = passwordInput.type === 'text';
  passwordInput.type = visible ? 'password' : 'text';
  togglePassword.textContent = visible ? 'Tampilkan' : 'Sembunyikan';
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  const username = normalizeUsername(usernameInput.value);
  const password = passwordInput.value;
  const name = nameInput.value.trim();

  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    setMessage('Username harus 3-20 karakter: huruf kecil, angka, atau _.');
    usernameInput.focus();
    return;
  }
  if (mode === 'register' && name.length < 2) {
    setMessage('Nama lengkap minimal 2 karakter.');
    nameInput.focus();
    return;
  }
  if (password.length < 8) {
    setMessage('Password minimal 8 karakter.');
    passwordInput.focus();
    return;
  }

  submitButton.disabled = true;
  setMessage('Menghubungi server RUMA…');

  // Akun hanya diverifikasi server. Tidak ada lagi cadangan akun lokal, jadi
  // aplikasi tidak bisa dibuka tanpa masuk atau mendaftar lebih dulu.
  try {
    const data = await apiAuth(mode === 'register' ? 'register' : 'login', {
      username,
      password,
      ...(mode === 'register' ? {name} : {})
    });
    if (!data || !data.token || !data.user) throw new Error('Server tidak mengembalikan sesi yang sah.');
    localStorage.setItem('ruma_token', data.token);
    localStorage.setItem('ruma_user', JSON.stringify(data.user));
    localStorage.setItem('ruma_demo_session', JSON.stringify(data.user));
    localStorage.removeItem('ruma_demo_users');
    setMessage(mode === 'register' ? 'Akun berhasil dibuat. Mengarahkan ke RUMA…' : 'Berhasil masuk. Mengarahkan ke RUMA…', true);
    setTimeout(() => { location.href = './index.html'; }, 500);
  } catch (error) {
    submitButton.disabled = false;
    setMessage(
      error.backend
        ? error.message
        : 'Tidak dapat menghubungi server RUMA. Periksa koneksi internet lalu coba lagi.',
      false
    );
  }
});

updateMode(mode);
