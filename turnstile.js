'use strict';

/**
 * Pembungkus kecil Cloudflare Turnstile (explicit rendering).
 *
 * Widget hanya dirender bila window.RUMA_CONFIG.TURNSTILE_SITE_KEY terisi.
 * Status (selesai / kedaluwarsa / gagal) ditulis ke elemen #turnstileStatus
 * bila halaman menyediakannya, supaya pengguna tidak tertahan tanpa penjelasan.
 */
window.RumaTurnstile = (function () {
  let attempts = 0;
  let retries = 0;

  function siteKey() {
    const config = window.RUMA_CONFIG || {};
    return String(config.TURNSTILE_SITE_KEY || '').trim();
  }

  function enabled() {
    return siteKey().length > 0;
  }

  function status(text, kind) {
    if (typeof document === 'undefined') return;
    const element = document.getElementById('turnstileStatus');
    if (!element) return;
    element.textContent = text || '';
    element.className = 'turnstile-status' + (kind ? ' ' + kind : '');
    element.classList.toggle('hidden', !text);
  }

  function whenReady(callback, onTimeout) {
    if (window.turnstile && typeof window.turnstile.render === 'function') {
      callback();
      return;
    }
    attempts += 1;
    if (attempts > 80) {
      console.warn('[ruma] Cloudflare Turnstile tidak selesai dimuat.');
      if (onTimeout) onTimeout();
      return;
    }
    setTimeout(function () { whenReady(callback, onTimeout); }, 250);
  }

  function mount(element) {
    if (!element) return;
    if (!enabled()) {
      element.style.display = 'none';
      status('', '');
      return;
    }
    if (element.dataset.rumaTurnstileMounted === '1') return;
    element.dataset.rumaTurnstileMounted = '1';
    element.innerHTML = '';
    attempts = 0;
    retries = 0;
    status('Memuat verifikasi keamanan Cloudflare…', 'pending');

    whenReady(function () {
      if (element.isConnected === false) return;
      try {
        element.__rumaTurnstileId = window.turnstile.render(element, {
          sitekey: siteKey(),
          theme: 'light',
          language: 'id',
          size: 'normal',
          callback: function () {
            status('Verifikasi keamanan selesai.', 'ok');
          },
          'error-callback': function (code) {
            console.warn('[ruma] Turnstile error:', code);
            if (retries < 2) {
              retries += 1;
              status('Verifikasi gagal dimuat. Mencoba ulang…', 'error');
              // Muat ulang widget sekali-dua kali sebelum menyerah.
              setTimeout(function () {
                if (!window.turnstile || element.__rumaTurnstileId == null) return;
                try { window.turnstile.reset(element.__rumaTurnstileId); } catch (_) {}
              }, 1400);
            } else {
              status('Verifikasi keamanan gagal dimuat. Muat ulang halaman lalu coba lagi.', 'error');
            }
            return true;
          },
          'expired-callback': function () {
            status('Verifikasi kedaluwarsa. Selesaikan verifikasi lagi.', 'warn');
          },
          'timeout-callback': function () {
            status('Waktu verifikasi habis. Selesaikan verifikasi lagi.', 'warn');
          }
        });
        status('', '');
      } catch (error) {
        console.error('[ruma] Turnstile gagal dirender:', error);
        status('Verifikasi keamanan tidak dapat ditampilkan. Muat ulang halaman.', 'error');
      }
    }, function () {
      status('Verifikasi keamanan tidak dapat dimuat. Periksa koneksi lalu muat ulang halaman.', 'error');
    });
  }

  function token(element) {
    if (!enabled()) return '';
    const widgetId = element && element.__rumaTurnstileId;
    if (widgetId == null || !window.turnstile) return '';
    try {
      return window.turnstile.getResponse(widgetId) || '';
    } catch (_) {
      return '';
    }
  }

  function reset(element) {
    const widgetId = element && element.__rumaTurnstileId;
    if (widgetId == null || !window.turnstile) return;
    try {
      window.turnstile.reset(widgetId);
      status('', '');
    } catch (_) {
      // abaikan: widget mungkin sudah dibuang bersama DOM lama
    }
  }

  return { enabled: enabled, mount: mount, token: token, reset: reset };
})();
