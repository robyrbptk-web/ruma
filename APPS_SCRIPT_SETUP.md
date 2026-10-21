# Setup backend RUMA dan admin

Gunakan file lengkap [RUMA_APPS_SCRIPT_COMPLETE.gs](./RUMA_APPS_SCRIPT_COMPLETE.gs). File tersebut sudah berisi backend lama, fitur akun, profil, username, relasi pengguna, laporan, dan seluruh route admin. Jangan menggabungkannya dengan patch secara manual.

1. Buka project Google Apps Script yang terhubung dengan Spreadsheet database RUMA.
2. Hapus kode lama pada editor Apps Script, lalu salin seluruh isi [RUMA_APPS_SCRIPT_COMPLETE.gs](./RUMA_APPS_SCRIPT_COMPLETE.gs) ke satu file `.gs`.
3. Simpan project, pilih fungsi `setupRuma`, lalu klik **Run** dan berikan izin Google satu kali. Fungsi ini menyiapkan seluruh sheet dan akun admin. Jika ingin hanya memperbaiki akun admin, gunakan `setupAdminAccount`.
4. Deploy atau redeploy sebagai **Web app**. Pilih akun eksekusi pemilik Spreadsheet dan akses sesuai kebutuhan aplikasi.
5. Salin URL deployment Web app ke frontend melalui console browser:

   ```js
   localStorage.setItem('ruma_api_url', 'URL_WEB_APP_ANDA');
   ```

   Setelah itu buka ulang halaman RUMA.
6. Login menggunakan:

   - Username: roby
   - Password: tauhid12

Dashboard admin tersedia di [admin.html](./admin.html). Jika URL Web App belum diisi, frontend tetap menyediakan mode lokal untuk pemeriksaan tampilan. Data produksi akan tersimpan di Spreadsheet setelah URL Web app dipasang.

Fungsi `setupAdminAccount()` membuat atau memperbaiki akun admin berikut:

- Username: `roby`
- Password: `tauhid12`
- Role: `admin`
- Status: `active`

File [appscript_admin_patch.gs](./appscript_admin_patch.gs) dipertahankan sebagai arsip patch lama. File itu tidak perlu disalin jika memakai file lengkap.

## Upload foto dan video

Backend menyimpan media ke Google Drive melalui endpoint `uploadMedia`, kemudian menyimpan URL media pada postingan. Untuk folder khusus, buat folder Drive lalu simpan ID-nya di **Project Settings → Script properties** dengan nama:

```text
RUMA_MEDIA_FOLDER_ID
```

Jika property tersebut tidak dibuat, file akan disimpan di Drive milik akun eksekusi Apps Script. Batas upload dari frontend saat ini 8 MB per file.
