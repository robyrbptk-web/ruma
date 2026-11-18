import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../turnstile.js', import.meta.url), 'utf8');

function makeStatus() {
  return {
    textContent: '',
    className: 'turnstile-status hidden',
    classList: {
      toggle(name, on) {
        this._hidden = on;
      }
    }
  };
}

function load({ siteKey = '', render = true, renderThrows = false } = {}) {
  const status = makeStatus();
  const calls = { render: [], reset: [] };
  let response = '';

  const window = {
    RUMA_CONFIG: { TURNSTILE_SITE_KEY: siteKey },
    turnstile: render
      ? {
          render(element, options) {
            calls.render.push(options);
            if (renderThrows) throw new Error('skrip Turnstile diblokir');
            element.__id = 7;
            return 7;
          },
          getResponse() {
            return response;
          },
          reset(id) {
            calls.reset.push(id);
          }
        }
      : undefined
  };

  const context = {
    window,
    console: { log: console.log, warn() {}, error() {} },
    setTimeout() {},
    document: {
      getElementById(id) {
        return id === 'turnstileStatus' ? status : null;
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  return {
    helper: window.RumaTurnstile,
    status,
    calls,
    setResponse(value) {
      response = value;
    }
  };
}

test('tanpa site key widget tidak dirender dan token kosong', () => {
  const { helper, calls } = load();
  assert.equal(helper.enabled(), false);
  const element = { style: {}, dataset: {}, innerHTML: 'lama' };
  helper.mount(element);
  assert.equal(calls.render.length, 0);
  assert.equal(helper.token(element), '');
  assert.equal(element.style.display, 'none');
});

test('site key dirender eksplisit dengan tema terang dan bahasa Indonesia', () => {
  const { helper, calls } = load({ siteKey: 'site-key' });
  assert.equal(helper.enabled(), true);
  const element = { style: {}, dataset: {}, innerHTML: '' };
  helper.mount(element);
  assert.equal(calls.render.length, 1);
  assert.equal(calls.render[0].sitekey, 'site-key');
  assert.equal(calls.render[0].theme, 'light');
  assert.equal(calls.render[0].language, 'id');
  assert.equal(element.dataset.rumaTurnstileMounted, '1');
  // mount kedua tidak menggandakan widget
  helper.mount(element);
  assert.equal(calls.render.length, 1);
});

test('token diambil dari widget dan reset memakai id yang sama', () => {
  const { helper, calls, setResponse } = load({ siteKey: 'site-key' });
  const element = { style: {}, dataset: {}, innerHTML: '' };
  helper.mount(element);
  assert.equal(helper.token(element), '');
  setResponse('token-123');
  assert.equal(helper.token(element), 'token-123');
  helper.reset(element);
  assert.deepEqual(calls.reset, [7]);
});

test('status sukses ditulis ke #turnstileStatus', () => {
  const { helper, status, calls } = load({ siteKey: 'site-key' });
  const element = { style: {}, dataset: {}, innerHTML: '' };
  helper.mount(element);
  calls.render[0].callback();
  assert.equal(status.textContent, 'Verifikasi keamanan selesai.');
  assert.match(status.className, /turnstile-status/);
  assert.match(status.className, /ok/);
});

test('kegagalan render memberi pesan error dan tidak melempar', () => {
  const { helper, status } = load({ siteKey: 'site-key', renderThrows: true });
  const element = { style: {}, dataset: {}, innerHTML: '' };
  assert.doesNotThrow(() => helper.mount(element));
  assert.match(status.textContent, /tidak dapat ditampilkan/i);
  assert.match(status.className, /error/);
  assert.equal(helper.token(element), '');
});
