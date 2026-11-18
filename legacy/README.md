# Arsip Google Apps Script

Folder ini menyimpan backend lama RUMA yang **tidak dipakai lagi** oleh aplikasi.

- `RUMA_APPS_SCRIPT_COMPLETE.gs` — backend Apps Script + Spreadsheet.
- `APPS_SCRIPT_SETUP.md` — cara setup versi lama.

Backend pengganti ada di [`../api/ruma.js`](../api/ruma.js) (Vercel) dengan database
dan storage Supabase. Lihat [`../README.md`](../README.md) untuk langkah migrasi.

Folder ini boleh dihapus setelah data selesai diimpor dan aplikasi baru berjalan
stabil. Menyimpannya membantu sebagai acuan nama kolom saat impor CSV.
