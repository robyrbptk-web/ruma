/**
 * Konfigurasi publik RUMA.
 *
 * File ini dimuat browser, jadi HANYA berisi nilai publik.
 * Jangan pernah menaruh service role key Supabase atau secret Turnstile di sini.
 */
window.RUMA_CONFIG = {
  // Alamat backend. Kosongkan atau biarkan '/api/ruma' jika frontend dan API
  // berada di domain Vercel yang sama.
  API_URL: '/api/ruma',

  // Cloudflare Turnstile → Site Key (publik), bukan Secret Key.
  // Kosongkan untuk menonaktifkan widget di sisi browser.
  TURNSTILE_SITE_KEY: '0x4AAAAAAGAa7Niz4KSiG1Tw'
};
