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
   - Password: kata sandi sementara yang tercetak pada log eksekusi `setupRuma`

Dashboard admin tersedia di [admin.html](./admin.html). URL Web App wajib diisi: tanpa backend, aplikasi tidak dapat dipakai karena semua akun diverifikasi server dan tidak ada mode lokal.

Fungsi `setupAdminAccount()` membuat akun admin berikut:

- Username: `roby`
- Password: kata sandi sementara buatan server, ditampilkan sekali di log eksekusi
- Role: `admin`
- Status: `active`

Kata sandi disimpan sebagai hash `sha256$salt$hash`, bukan teks biasa. Jika akun admin sudah ada, `setupAdminAccount()` tidak menimpa kata sandinya. Ganti kata sandi lewat **Profil → Ubah profil → Ganti kata sandi**. Akun lama yang masih menyimpan kata sandi apa adanya tetap bisa masuk dan otomatis dipindahkan ke bentuk hash saat login berikutnya.

Jangan menambahkan file patch lama ke project Apps Script: cukup satu file `RUMA_APPS_SCRIPT_COMPLETE.gs`, karena duplikat fungsi dapat menimpa versi yang benar.

## Upload foto dan video

Backend menyimpan media ke Google Drive melalui endpoint `uploadMedia`, kemudian menyimpan URL media pada postingan. Untuk folder khusus, buat folder Drive lalu simpan ID-nya di **Project Settings → Script properties** dengan nama:

```text
RUMA_MEDIA_FOLDER_ID
```

Jika property tersebut tidak dibuat, file akan disimpan di Drive milik akun eksekusi Apps Script. Batas upload dari frontend saat ini 8 MB per file.
