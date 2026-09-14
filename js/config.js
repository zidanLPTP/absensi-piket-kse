/**
 * =========================================================================
 * KONFIGURASI SISTEM ABSENSI PIKET PAGUYUBAN KSE UNRI
 * =========================================================================
 */

// Ganti nilai berikut dengan Web App Deployment URL dari Google Apps Script Anda
const GOOGLE_SCRIPT_URL = "ISI_URL_WEB_APP_DISINI";

// Durasi Countdown Piket (60 Menit = 3600 Detik)
const COUNTDOWN_DURATION_SECONDS = 3600;

// Pemetaan Nama Hari & Bulan Bahasa Indonesia
const HARI_MAP = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const BULAN_MAP = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];
