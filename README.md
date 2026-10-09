# WatermarkPro 📸

[![Website](https://img.shields.io/badge/Website-mark.pilarlabs.id-blue?style=flat-square)](https://mark.pilarlabs.id)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](LICENSE)
[![Vanilla JS](https://img.shields.io/badge/Vanilla-JavaScript-F7DF1E?logo=javascript&logoColor=black&style=flat-square)](#)
[![Privacy Friendly](https://img.shields.io/badge/Privacy-100%25%20Client--Side-brightgreen?style=flat-square)](#)

Aplikasi web modern, cepat, dan aman untuk membubuhkan cap air (*watermark*) informasi tanggal, jam, dan lokasi GPS pada foto langsung dari browser tanpa perlu instalasi aplikasi tambahan.

🌐 **Akses Langsung:** [mark.pilarlabs.id](https://mark.pilarlabs.id)

---

## ✨ Fitur Utama

- 🔒 **100% Aman & Privasi Terjaga (Client-Side)**: Semua proses rendering dilakukan langsung di browser Anda menggunakan HTML5 Canvas. Foto Anda tidak pernah diunggah ke server mana pun.
- 🕒 **Tanggal & Waktu Fleksibel**:
  - Deteksi otomatis waktu terkini dengan zona waktu (WIB/WITA/WIT).
  - Ekstraksi waktu asli pengambilan foto melalui metadata EXIF.
  - Opsi penanggalan kustom manual.
  - Berbagai pilihan format penanggalan berbahasa Indonesia.
- 📍 **Deteksi & Input Lokasi Komprehensif**:
  - GPS perangkat otomatis dengan reverse geocoding (mendeteksi nama jalan, kecamatan, kota).
  - Koordinat dari EXIF foto.
  - Input koordinat manual (Latitude / Longitude atau salin-tempel) lengkap dengan tombol pencari nama lokasi.
  - Teks lokasi bebas manual.
- 🏷️ **Template Teks & Token Dinamis**:
  - Personalisasi susunan watermark menggunakan token otomatis:
    - `{tanggal}` — Tanggal & waktu sesuai format pilihan.
    - `{lokasi}` — Nama alamat / kota.
    - `{koordinat}` — Lintang & bujur desimal.
    - `{lat}` & `{lng}` — Lintang atau bujur spesifik.
    - `{nama_file}` — Nama file asli foto.
- 🎨 **Kustomisasi Tampilan & Preset**:
  - Pilihan preset desain instan: **Modern**, **Klasik**, **Minimal**, dan **Stempel**.
  - Kontrol ukuran font, warna teks, warna latar belakang (badge), serta opasitas transparansi latar belakang.
  - 9 posisi peletakan watermark (grid 3×3) dan pengaturan margin tepi.
- 📁 **Dukungan Batch Processing (Banyak Foto Sekaligus)**:
  - Drag-and-drop atau pilih banyak foto sekaligus (JPG, PNG, WebP, HEIC hingga 50 MB per file).
  - Pratinjau navigasi foto dan strip thumbnail.
  - Opsi *Unduh Foto Ini* atau *Unduh Semua* dengan progress modal.
- 📱 **Responsif & Ringan**:
  - Tampilan rapi dan nyaman digunakan di perangkat desktop, tablet, maupun ponsel (*mobile friendly*).

---

## 🚀 Panduan Penggunaan

1. **Buka Aplikasi**: Kunjungi [mark.pilarlabs.id](https://mark.pilarlabs.id) atau jalankan secara lokal.
2. **Unggah Foto**: Seret foto ke area dropzone atau klik **Pilih dari perangkat** (bisa memilih lebih dari 1 foto).
3. **Atur Pengaturan Watermark**:
   - Atur pengaturan **Tanggal & Waktu** (Otomatis / EXIF / Kustom).
   - Atur **Lokasi** (GPS / EXIF / Koordinat / Manual).
   - Sesuaikan **Gaya Watermark** (Preset, ukuran font, warna, dan opasitas).
   - Sesuaikan susunan teks di panel **Template Teks**.
   - Tentukan **Posisi & Margin** pada foto.
4. **Terapkan**: Klik tombol **Terapkan Watermark**.
5. **Unduh**: Klik **Unduh Foto Ini** untuk menyimpan foto yang sedang aktif, atau **Unduh Semua** untuk memproses dan mengunduh seluruh antrean foto.

---

## 🛠️ Teknologi yang Digunakan

- **HTML5**: Struktur semantik & antarmuka aplikasi.
- **CSS3 (Vanilla CSS)**: Desain responsif, CSS Variables, Flexbox, CSS Grid, dan animasi micro-interaction.
- **JavaScript (Vanilla ES6+)**: Logika aplikasi murni tanpa dependensi framework eksternal:
  - HTML5 Canvas API untuk rendering dan ekspor gambar.
  - Geolocation API untuk deteksi GPS.
  - OpenStreetMap (Nominatim) & BigDataCloud Reverse Geocoding API untuk konversi koordinat ke nama lokasi.
  - EXIF parser bawaan untuk membaca metadata kamera/foto.

---

## 💻 Menjalankan Secara Lokal

Karena proyek ini murni dibangun menggunakan HTML, CSS, dan JavaScript tanpa *build step*, Anda dapat menjalankannya dengan mudah:

### 1. Klon Repositori
```bash
git clone https://github.com/pilarlabsid/watermark-app.git
cd watermark-app
```

### 2. Jalankan dengan Web Server Lokal
Gunakan server statis sederhana pilihan Anda, misalnya:

**Menggunakan Python:**
```bash
python3 -m http.server 8080
```

**Menggunakan Node.js (`npx serve` atau `live-server`):**
```bash
npx serve .
```

Lalu buka browser Anda di `http://localhost:8080` (atau port yang ditampilkan).

> **Catatan**: Fitur Geolocation (GPS) di browser membutuhkan konteks aman (*Secure Context* / HTTPS atau `localhost`).

---

## 📂 Struktur Direktori

```text
watermark-app/
├── index.html       # Struktur HTML halaman utama & modal
├── style.css        # Tata letak, tema modern, & gaya responsif
├── app.js           # Logika pemrosesan foto, canvas rendering, EXIF, & geocoding
├── CNAME            # Konfigurasi custom domain (mark.pilarlabs.id)
└── README.md        # Dokumentasi proyek
```

---

## 📄 Lisensi

Proyek ini dirilis di bawah lisensi [MIT](LICENSE). Silakan gunakan, pelajari, dan kembangkan sesuai kebutuhan Anda.

---

Dikembangkan dengan ❤️ oleh [Pilar Labs](https://pilarlabs.id).
