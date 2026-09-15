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
      message:
        "API Presensi Piket KSE UNRI Aktif dan Siap Menerima Data Presensi.",
    }),
  ).setMimeType(ContentService.MimeType.JSON);
}

// Menangani data presensi masuk (POST)
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000); // Kunci concurrency 10 detik

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetName = "Data Presensi";
    
    // Cari sheet target, atau gunakan sheet pertama/aktif
    var sheet = ss.getSheetByName(sheetName) || ss.getSheetByName("Sheet1") || ss.getActiveSheet();
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    } else if (sheet.getName() !== sheetName && sheet.getLastRow() === 0) {
      sheet.setName(sheetName);
    }

    // 5 Kolom Sesuai Kebutuhan Presensi KSE UNRI
    var headers = [
      "Nama Anggota",
      "Divisi",
      "Hari",
      "Tanggal",
      "Status Kehadiran"
    ];

    // Jika baris pertama masih kosong atau belum ada header, buat dan beri format profesional KSE UNRI
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(headers);

      var headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setBackground("#004834"); // Deep Forest Green KSE
      headerRange.setFontColor("#FFFFFF"); // Teks Putih
      headerRange.setFontWeight("bold"); // Tebal
      headerRange.setFontSize(11); // Ukuran font proporsional
      headerRange.setFontFamily("Montserrat"); // Font resmi
      headerRange.setHorizontalAlignment("center");
      headerRange.setVerticalAlignment("middle");
      sheet.setRowHeight(1, 36); // Tinggi baris header proporsional
      sheet.setFrozenRows(1); // Kunci baris pertama agar tetap terlihat saat scroll

      // Border bawah aksen emas (#EEB319 KSE Golden Yellow)
      headerRange.setBorder(
        null,
        null,
        true,
        null,
        null,
        null,
        "#EEB319",
        SpreadsheetApp.BorderStyle.SOLID_MEDIUM,
      );
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

    // Ambil Hari Aktual saat presensi ditekan (Fallback ke hitungan waktu server jika payload kosong)
    var hariAktual =
      data.hari_presensi ||
      Utilities.formatDate(new Date(), "Asia/Jakarta", "EEEE");
    var mapHariEng = {
      Sunday: "Minggu",
      Monday: "Senin",
      Tuesday: "Selasa",
      Wednesday: "Rabu",
      Thursday: "Kamis",
      Friday: "Jumat",
      Saturday: "Sabtu",
    };
    if (mapHariEng[hariAktual]) {
      hariAktual = mapHariEng[hariAktual];
    }

    var nama = data.nama || "Tidak Diketahui";
    var divisi = data.divisi || "-";
    var tanggal =
      data.tanggal ||
      Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyy-MM-dd");
    var status = data.status || "Hadir";

    // Simpan baris rekaman presensi dengan Hari Kehadiran Aktual
    sheet.appendRow([nama, divisi, hariAktual, tanggal, status]);

    var lastRow = sheet.getLastRow();
    sheet.setRowHeight(lastRow, 28);

    // Styling baris data: font bersih, vertikal tengah, dan alignment yang rapi
    var dataRange = sheet.getRange(lastRow, 1, 1, 5);
    dataRange.setFontFamily("Montserrat");
    dataRange.setFontSize(10);
    dataRange.setVerticalAlignment("middle");

    // Rata tengah untuk Hari, Tanggal, dan Status
    sheet.getRange(lastRow, 3, 1, 3).setHorizontalAlignment("center");

    // Auto-fit lebar kolom agar teks tidak terpotong
    for (var col = 1; col <= 5; col++) {
      sheet.autoResizeColumn(col);
    }

    return ContentService.createTextOutput(
      JSON.stringify({
        status: "success",
        message: "Presensi berhasil dicatat di Google Sheets",
        nama: nama,
      }),
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(
      JSON.stringify({
        status: "error",
        message: error.toString(),
      }),
    ).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
