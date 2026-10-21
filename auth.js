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

function readUsers() {
  let users=[];
  try { users=JSON.parse(localStorage.getItem('ruma_demo_users') || '[]'); }
  catch (_) {}
  const admin=users.find(user=>user.username==='roby');
  if(!admin)users.unshift({name:'Roby',username:'roby',password:'tauhid12',initial:'R',role:'admin',createdAt:Date.now()});
  else{admin.password='tauhid12';admin.role='admin';admin.name=admin.name||'Roby';admin.initial='R';}
  writeUsers(users);
  return users;
}

function writeUsers(users) {
  localStorage.setItem('ruma_demo_users', JSON.stringify(users));
}

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
    : 'Belum punya akun? Pilih tab Daftar untuk membuat akun demo.';
  setMessage('');
}

function normalizeUsername(value) {
  return value.trim().toLowerCase().replace(/^@/, '');
}

async function apiAuth(action, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
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
  if (password.length < 8) {
    setMessage('Password minimal 8 karakter.');
    passwordInput.focus();
    return;
  }

  try {
    const data = await apiAuth(mode === 'register' ? 'register' : 'login', {
      username,
      password,
      ...(mode === 'register' ? {name} : {})
    });
    localStorage.setItem('ruma_token', data.token);
    localStorage.setItem('ruma_user', JSON.stringify(data.user));
    localStorage.setItem('ruma_demo_session', JSON.stringify(data.user));
    setMessage(mode === 'register' ? 'Akun berhasil dibuat. Mengarahkan ke RUMA...' : 'Berhasil masuk. Mengarahkan ke RUMA...', true);
    submitButton.disabled = true;
    setTimeout(() => { location.href = './index.html'; }, 500);
    return;
  } catch (error) {
    if (error.backend) {
      setMessage(error.message);
      return;
    }
  }

  const users = readUsers();
  const existing = users.find(user => user.username === username);

  if (mode === 'register') {
    if (name.length < 2) {
      setMessage('Nama lengkap minimal 2 karakter.');
      nameInput.focus();
      return;
    }
    if (existing) {
      setMessage('Username sudah digunakan. Silakan pilih username lain.');
      usernameInput.focus();
      return;
    }
    const user = {name, username, password, initial: name.charAt(0).toUpperCase(), createdAt: Date.now()};
    users.push(user);
    writeUsers(users);
    localStorage.setItem('ruma_demo_session', JSON.stringify(user));
    setMessage('Akun berhasil dibuat. Mengarahkan ke RUMA...', true);
  } else {
    if (!existing || existing.password !== password) {
      setMessage('Username atau password belum tepat.');
      passwordInput.focus();
      return;
    }
    localStorage.setItem('ruma_demo_session', JSON.stringify(existing));
    setMessage('Berhasil masuk. Mengarahkan ke RUMA...', true);
  }

  submitButton.disabled = true;
  setTimeout(() => { location.href = './index.html'; }, 500);
});

updateMode(mode);
