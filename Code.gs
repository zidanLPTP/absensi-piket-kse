/**
 * =========================================================================
 * GOOGLE APPS SCRIPT - SISTEM ABSENSI PIKET PAGUYUBAN KSE UNRI
 * =========================================================================
 * Backend serverless untuk mencatat data presensi dari Web GitHub Pages
 * ke Google Sheets secara otomatis setelah 60 menit durasi piket terpenuhi.
 */

// Pengecekan status Web App via browser (GET)
function doGet(e) {
  return ContentService.createTextOutput(
    JSON.stringify({
      status: "success",
      message: "API Presensi Piket KSE UNRI Aktif dan Siap Menerima Data Presensi."
    })
  ).setMimeType(ContentService.MimeType.JSON);
}

// Menangani data presensi masuk (POST)
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000); // Kunci concurrency 10 detik

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetName = "Data Presensi";
    var sheet = ss.getSheetByName(sheetName);

    // Inisialisasi sheet dan header jika pertama kali digunakan
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      var headers = [
        "Timestamp Sistem",
        "ID Beswan",
        "Nama Beswan",
        "Divisi",
        "Hari Piket Jadwal",
        "Tanggal Presensi",
        "Jam Masuk",
        "Jam Selesai",
        "Durasi Piket",
        "Status Kehadiran"
      ];
      sheet.appendRow(headers);

      // Desain Header dengan Identitas Warna KSE UNRI (Deep Forest Green: #004834)
      var headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setBackground("#004834");
      headerRange.setFontColor("#FFFFFF");
      headerRange.setFontWeight("bold");
      sheet.setFrozenRows(1);
    }

    // Parsing data payload JSON
    var data = {};
    if (e && e.postData && e.postData.contents) {
      try {
        data = JSON.parse(e.postData.contents);
      } catch (parseErr) {
        data = e.parameter || {};
      }
    } else if (e && e.parameter) {
      data = e.parameter;
    }

    var nowTimestamp = Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyy-MM-dd HH:mm:ss");
    var idBeswan     = data.id || "-";
    var nama         = data.nama || "Tidak Diketahui";
    var divisi       = data.divisi || "-";
    var hariPiket    = data.hari_piket || "-";
    var tanggal      = data.tanggal || Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyy-MM-dd");
    var jamMasuk     = data.jam_masuk || "-";
    var jamSelesai   = data.jam_selesai || Utilities.formatDate(new Date(), "Asia/Jakarta", "HH:mm:ss");
    var durasi       = "60 Menit";
    var status       = data.status || "Hadir";

    // Simpan baris rekaman presensi
    sheet.appendRow([
      nowTimestamp,
      idBeswan,
      nama,
      divisi,
      hariPiket,
      tanggal,
      jamMasuk,
      jamSelesai,
      durasi,
      status
    ]);

    for (var col = 1; col <= 10; col++) {
      sheet.autoResizeColumn(col);
    }

    return ContentService.createTextOutput(
      JSON.stringify({
        status: "success",
        message: "Presensi berhasil dicatat di Google Sheets",
        nama: nama
      })
    ).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(
      JSON.stringify({
        status: "error",
        message: error.toString()
      })
    ).setMimeType(ContentService.MimeType.JSON);

  } finally {
    lock.releaseLock();
  }
}
