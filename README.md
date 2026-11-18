# RUMA — Supabase + Vercel

Frontend statis RUMA kini memakai:

- **Vercel** untuk hosting situs dan satu Serverless Function `POST /api/ruma`.
- **Supabase Postgres** untuk seluruh data (akun, postingan, Ruang, Reels, gift, laporan, notifikasi).
- **Supabase Storage** untuk foto dan video (unggahan langsung dari browser, bukan lewat Vercel).
- **Cloudflare Turnstile** untuk melindungi login, pendaftaran, dan login admin.

Google Apps Script tidak dipakai lagi oleh aplikasi. File lama dipindahkan ke
[`legacy/`](./legacy) sebagai arsip dan acuan migrasi data, bukan bagian dari runtime.

---

## 1. Siapkan project Supabase

1. Masuk ke [supabase.com](https://supabase.com) dengan akunmu, lalu **New project**.
2. Buka **SQL Editor**, tempel seluruh isi [`supabase/schema.sql`](./supabase/schema.sql), lalu **Run**.
   Skrip ini membuat semua tabel, index, RLS, bucket Storage `ruma-media`, dan policy baca publik.
3. Buka **Project Settings → API**, catat:
   - `Project URL` → menjadi `SUPABASE_URL`
   - `service_role` key (atau Secret key `sb_secret_...`) → menjadi `SUPABASE_SERVICE_ROLE_KEY`

> **Penting:** service role key hanya boleh disimpan di environment Vercel / file `.env`
> lokal. Jangan pernah menaruhnya di `config.js`, HTML, atau kode frontend. RLS pada semua
> tabel sudah aktif tanpa policy, sehingga kunci anon tidak bisa membaca data.

---

## 2. Siapkan environment lokal

```powershell
Copy-Item .env.example .env
npm install
```

Isi `.env`:

```dotenv
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
SUPABASE_MEDIA_BUCKET=ruma-media
TURNSTILE_SECRET_KEY=0x4AAAAAAA...
TURNSTILE_HOSTNAMES=ruma.vercel.app
```

`TURNSTILE_HOSTNAMES` opsional. Jika diisi, token Turnstile hanya diterima dari
hostname tersebut.

### Periksa kesiapan

```powershell
npm run doctor
npm test
```

`doctor` membaca `.env` lalu memeriksa kredensial, seluruh tabel, dan bucket Storage.
Skrip ini hanya membaca — tidak membuat atau mengubah data. `npm test` menguji hash
kata sandi (scrypt + hash warisan Apps Script) dan helper widget Turnstile.

---

## 3. Impor data dari Google Sheets

Data lama tetap bisa dibawa tanpa kehilangan akun, postingan, atau sesi login.

1. Buka Spreadsheet RUMA → **File → Download → Comma-separated values (.csv)**.
2. Simpan setiap sheet ke satu folder, misalnya `sheet-data/`, dengan nama file
   sama seperti nama sheet: `Users.csv`, `Posts.csv`, `Comments.csv`, `Likes.csv`,
   `Saves.csv`, `Reposts.csv`, `Followers.csv`, `Rooms.csv`, `RoomMembers.csv`,
   `RoomPosts.csv`, `Reels.csv`, `ReelLikes.csv`, `ReelSaves.csv`, `Gifts.csv`,
   `Reports.csv`, `Notifications.csv`.
3. Jalankan:

```powershell
npm run import-sheets -- ./sheet-data
```

Cek dulu tanpa menulis apa pun:

```powershell
npm run import-sheets -- ./sheet-data --dry-run
```

Skrip memetakan kolom lama ke tabel baru, melewati baris yang relasi induknya tidak
ada, dan menampilkan jumlah baris yang diimpor. Jalankan sekali saja; menjalankan
ulang akan menimpa data dengan isi CSV.

**Kata sandi lama tetap berlaku.** Server mendukung format `sha256$salt$hash` buatan
Apps Script, kata sandi polos warisan lama, dan otomatis memindahkannya ke `scrypt`
saat pengguna berhasil login. Token sesi lama juga diimpor ke tabel `sessions`, jadi
pengguna yang masih login di browser tidak perlu masuk ulang.

---

## 3b. Pindahkan media lama dari Google Drive

RUMA sekarang **hanya memutar media dari Supabase Storage**; URL Google Drive tidak
lagi didukung. Untuk menyelamatkan foto/video lama, jalankan skrip migrasi berikut
sebelum mengumumkan pembaruan:

```powershell
npm run migrate-media
npm run migrate-media -- --apply
```

Skrip mengunduh setiap berkas Drive yang dirujuk `users.avatar_url`,
`users.banner_url`, `posts.media_url`, dan `reels.media_url`, mengunggahnya ke
Supabase Storage (`legacy/...`), lalu memperbarui kolom URL di database. Tanpa
`--apply`, skrip hanya melaporkan apa yang akan dilakukan.

> Berkas Drive harus masih dibagikan **"anyone with link"** seperti pengaturan GAS
> lama. Berkas yang sudah dihapus atau diprivat akan dilaporkan gagal; unggah ulang
> manual bila perlu.

---

## 4. Buat akun admin

```powershell
npm run create-admin -- --username roby --password "kata-sandi-yang-kuat"
```

Jika akun `roby` sudah ada hasil impor, perintah ini memastikan role-nya `admin`,
status `active`, dan `verified`. Password tidak diubah kecuali menambahkan `--force`:

```powershell
npm run create-admin -- --username roby --password "baru" --force
```

Jika `--password` dikosongkan, skrip membuat password acak dan mencetaknya sekali.

---

## 5. Buat widget Cloudflare Turnstile

1. Buka [dash.cloudflare.com](https://dash.cloudflare.com) → **Turnstile** → **Add widget**.
2. Isi nama widget, lalu tambahkan domain:
   - domain produksi Vercel, misalnya `ruma.vercel.app`
   - `localhost` untuk pengembangan lokal
3. Pilih mode **Managed**. Catat:
   - **Site Key** (publik) → isi di `config.js`
   - **Secret Key** (rahasia) → isi `TURNSTILE_SECRET_KEY` di Vercel/`.env`

Untuk pengujian lokal Cloudflare menyediakan site key & secret key khusus:
<https://developers.cloudflare.com/turnstile/troubleshooting/testing/>

Widget muncul otomatis di halaman masuk/daftar dan login admin. Jika `config.js`
tidak berisi site key, widget disembunyikan; tetapi jika server tetap punya secret,
login akan ditolak sampai site key diisi. **Isi keduanya di produksi.**

---

## 6. Isi `config.js`

```js
window.RUMA_CONFIG = {
  API_URL: '/api/ruma',
  TURNSTILE_SITE_KEY: '0x4AAAAAAA...'
};
```

`config.js` bersifat publik. Hanya site key Turnstile yang boleh ada di sini.

`API_URL` boleh diganti ke URL absolut bila frontend dan API dipisah domain,
misalnya `https://api.ruma.id/api/ruma`. Nilai `localStorage.ruma_api_url` lama
diabaikan selama `config.js` berisi `API_URL`.

---

## 7. Deploy ke Vercel

### Lewat dashboard (disarankan)

1. Push repo ini ke GitHub.
2. Buka [vercel.com/new](https://vercel.com/new), import repo `ruma`.
3. Framework preset: **Other**. Build command: kosong. Output directory: kosong.
4. Tambahkan environment variables untuk **Production**, **Preview**, dan **Development**:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_MEDIA_BUCKET=ruma-media
TURNSTILE_SECRET_KEY
TURNSTILE_HOSTNAMES=ruma.vercel.app
```

5. **Deploy**.

### Lewat CLI

```powershell
npm i -g vercel
vercel link
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add TURNSTILE_SECRET_KEY production
vercel --prod
```

Setelah deploy, atur domain Vercel agar sama dengan domain yang didaftarkan di
widget Turnstile.

---

## 8. Verifikasi

1. Buka `https://domain-kamu/api/ruma` → harus muncul
   `{"ok":true,"service":"RUMA API","configured":true,"turnstile":true}`.
2. Buka `/auth.html`, pastikan widget Turnstile tampil, lalu masuk dengan akun admin.
3. Coba buat postingan dengan foto/video, cek file masuk ke Supabase Storage.
4. Buka `/admin.html`, login admin (Turnstile juga tampil), cek Ringkasan/Pengguna/Postingan/Laporan.
5. Setelah semuanya stabil, hentikan deployment Web App Apps Script lama.

---

## Struktur file

```text
api/ruma.js               Serverless Function tunggal (semua action)
lib/password.js           scrypt + verifikasi hash lama Apps Script
supabase/schema.sql       Skema Postgres, RLS, bucket Storage
scripts/create-admin.mjs  Membuat/mempromosikan admin
scripts/import-sheets.mjs Impor CSV dari Google Sheets
scripts/migrate-drive-media.mjs  Pindahkan media Drive lama ke Supabase
scripts/doctor.mjs        Cek kesiapan kredensial, skema, dan bucket
test/password.test.mjs    Uji hash kata sandi (scrypt + format lama)
test/turnstile.test.mjs   Uji helper widget Turnstile
config.js                 Konfigurasi publik (API URL, site key Turnstile)
turnstile.js              Helper render/ambil token Turnstile
auth.html / auth.js       Halaman masuk & daftar + Turnstile
admin.html / admin.js     Panel admin + Turnstile
index.html                Aplikasi utama (feed video gaya TikTok)
legacy/                   Apps Script lama (arsip, tidak dipakai)
```

---

## Catatan teknis

- API tetap memakai protokol lama `{ action, token, ...payload }` → `{ ok, data }`
  agar seluruh frontend yang ada tidak perlu ditulis ulang.
- Password baru di-hash dengan `scrypt` (`node:crypto`). Hash Apps Script dan
  kata sandi polos lama tetap diverifikasi lalu ditingkatkan otomatis.
- Maksimal 5 sesi aktif per akun; sesi terlama dicabut otomatis.
- Mengganti username tidak lagi perlu menyunting handle di banyak tabel karena
  postingan, komentar, Ruang, Reels, laporan, dan notifikasi merujuk ke `user_id`.
- Blokir pengguna langsung menghapus semua sesinya.
- Unggahan media memakai **signed upload URL** Supabase, sehingga berkas hingga 50 MB tidak
  melewati batas body 4,5 MB Serverless Function Vercel.
- Action `uploadMedia` lama tetap tersedia untuk kompatibilitas berkas kecil
  (maksimal 3 MB), tetapi frontend baru memakai `createUpload`.
- Tab **Video** memakai penampil vertikal gaya TikTok: satu video per layar,
  geser ke atas/bawah, autoplay senyap, ketuk untuk jeda, ketuk dua kali untuk
  menyukai, dan tombol suara. Semua video diputar langsung dari Supabase Storage;
  tidak ada iframe atau pemutar Google Drive.
- RLS aktif di semua tabel tanpa policy: hanya service role yang bisa mengakses.
  Bucket `ruma-media` publik untuk dibaca sehingga URL media bisa langsung dipakai
  di `<img>`/`<video>`.

---

## Troubleshooting

**`configured:false` di /api/ruma**
Environment Vercel belum terisi atau belum di-redeploy setelah menambah env.

**Login selalu "Verifikasi Cloudflare Turnstile gagal"**
Pastikan site key di `config.js` dan secret key di Vercel berasal dari widget yang
sama, dan domain Vercel sudah terdaftar di widget. Jika memakai `TURNSTILE_HOSTNAMES`,
pastikan hostname-nya persis sama (tanpa `https://`).

**`Username atau password salah` padahal benar**
Cek apakah baris pengguna berhasil diimpor (`Users.csv`) dan kolom `password` ikut
terbawa. Akun hasil impor bisa dipromosikan ulang dengan `npm run create-admin`.

**Media gagal diunggah**
Pastikan bucket `ruma-media` ada, publik, dan limit file 50 MB. Jalankan ulang
`supabase/schema.sql` bila perlu. Cek juga Console browser untuk respons CORS/Storage.

**Video lama Google Drive tidak bisa diputar**
Drive tidak lagi dipakai. Jalankan `npm run migrate-media -- --apply` untuk
memindahkan media lama ke Supabase Storage, atau minta pengguna mengunggah ulang.

**Widget Turnstile tidak muncul**
Pastikan `config.js` berisi `TURNSTILE_SITE_KEY` (site key, bukan secret), domain
sudah didaftarkan di widget Cloudflare, dan `https://challenges.cloudflare.com`
tidak diblokir jaringan. Pesan kegagalan akan tampil di bawah widget; muat ulang
halaman bila verifikasi gagal dimuat.
