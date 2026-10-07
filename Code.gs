/**
 * =========================================================================
 * GOOGLE APPS SCRIPT - SISTEM ABSENSI PIKET PAGUYUBAN KSE UNRI
 * =========================================================================
 * 1. doPost & doGet: Backend serverless untuk mencatat data presensi dari Web
 *    GitHub Pages ke Google Sheets secara otomatis (5 Kolom).
 * 2. onOpen & buatTabRekapBulanan: Menu otomatis untuk menyusun tabel rekapitulasi
 *    kehadiran bulanan (misal: 16 Sep - 15 Okt) dengan rumus dinamis COUNTIFS.
 */

// Membaca data kehadiran hari ini untuk sinkronisasi multi-device (GET)
function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetName = "Data Presensi";
    var sheet =
      ss.getSheetByName(sheetName) ||
      ss.getSheetByName("Sheet1") ||
      ss.getActiveSheet();

    var targetTanggal =
      (e && e.parameter && e.parameter.tanggal) ||
      Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyy-MM-dd");

    var attendedList = [];

    if (sheet && sheet.getLastRow() > 1) {
      var lastRow = sheet.getLastRow();
      var values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
      for (var i = 0; i < values.length; i++) {
        var rowNama = String(values[i][0] || "").trim();
        var rowDivisi = String(values[i][1] || "").trim();
        var rowHari = String(values[i][2] || "").trim();
        var rowTgl = values[i][3];
        if (rowTgl instanceof Date) {
          rowTgl = Utilities.formatDate(rowTgl, "Asia/Jakarta", "yyyy-MM-dd");
        } else {
          rowTgl = String(rowTgl || "").trim();
          if (rowTgl.length >= 10 && rowTgl.indexOf("-") === 4) {
            rowTgl = rowTgl.substring(0, 10);
          }
        }
        var rowStatus = String(values[i][4] || "").trim();

        // Hanya sertakan rekaman yang tanggalnya sesuai hari ini dan berstatus hadir
        if (rowTgl === targetTanggal && rowStatus.toLowerCase().indexOf("hadir") !== -1) {
          attendedList.push({
            nama: rowNama,
            divisi: rowDivisi,
            hari: rowHari,
            tanggal: rowTgl,
            status: rowStatus
          });
        }
      }
    }

    return ContentService.createTextOutput(
      JSON.stringify({
        status: "success",
        tanggal: targetTanggal,
        attended: attendedList,
        count: attendedList.length
      }),
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({
        status: "error",
        message: err.toString()
      }),
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

// Menangani data presensi masuk dari web (POST) - Mendukung Single & Batch Processing
function doPost(e) {
  var lock = LockService.getScriptLock();
  // Naikkan batas tunggu lock ke 30 detik agar antrean banyak data tidak timeout
  lock.waitLock(30000);

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetName = "Data Presensi";

    // Cari sheet target, atau gunakan sheet pertama/aktif
    var sheet =
      ss.getSheetByName(sheetName) ||
      ss.getSheetByName("Sheet1") ||
      ss.getActiveSheet();
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
      "Status Kehadiran",
    ];

    // Jika baris pertama masih kosong atau belum ada header, buat dan beri format profesional KSE UNRI
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(headers);

      var headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setBackground("#004834"); // Deep Forest Green KSE
      headerRange.setFontColor("#FFFFFF"); // Teks Putih
      headerRange.setFontWeight("bold"); // Tebal
      headerRange.setFontSize(11);
      headerRange.setFontFamily("Montserrat");
      headerRange.setHorizontalAlignment("center");
      headerRange.setVerticalAlignment("middle");
      sheet.setRowHeight(1, 36);
      sheet.setFrozenRows(1);

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

      // Lebar kolom standar profesional KSE UNRI
      sheet.setColumnWidth(1, 230); // Nama Anggota
      sheet.setColumnWidth(2, 260); // Divisi
      sheet.setColumnWidth(3, 110); // Hari
      sheet.setColumnWidth(4, 120); // Tanggal
      sheet.setColumnWidth(5, 160); // Status Kehadiran
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

    // Dukung format Single Item maupun Batch Items (Array)
    var items = [];
    if (Array.isArray(data)) {
      items = data;
    } else if (data.items && Array.isArray(data.items)) {
      items = data.items;
    } else if (data.nama) {
      items = [data];
    }

    var mapHariEng = {
      Sunday: "Minggu",
      Monday: "Senin",
      Tuesday: "Selasa",
      Wednesday: "Rabu",
      Thursday: "Kamis",
      Friday: "Jumat",
      Saturday: "Sabtu",
    };

    var rowsToAppend = [];
    for (var i = 0; i < items.length; i++) {
      var itm = items[i];

      // Ambil Hari Aktual saat presensi ditekan (Fallback ke hitungan waktu server jika payload kosong)
      var hariAktual =
        itm.hari_presensi ||
        Utilities.formatDate(new Date(), "Asia/Jakarta", "EEEE");
      if (mapHariEng[hariAktual]) {
        hariAktual = mapHariEng[hariAktual];
      }

      var nama = itm.nama || "Tidak Diketahui";
      var divisi = itm.divisi || "-";
      var tanggal =
        itm.tanggal ||
        Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyy-MM-dd");
      var status = itm.status || "Hadir";

      rowsToAppend.push([nama, divisi, hariAktual, tanggal, status]);
    }

    // Cek duplikasi di Google Sheets sebelum menulis data (Anti-Duplikasi Multi-Device)
    var lastRow = sheet.getLastRow();
    var existingSet = {};

    if (lastRow > 1) {
      var existingValues = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
      for (var r = 0; r < existingValues.length; r++) {
        var exNama = String(existingValues[r][0] || "").toLowerCase().trim();
        var exTgl = existingValues[r][3];
        if (exTgl instanceof Date) {
          exTgl = Utilities.formatDate(exTgl, "Asia/Jakarta", "yyyy-MM-dd");
        } else {
          exTgl = String(exTgl || "").trim();
          if (exTgl.length >= 10 && exTgl.indexOf("-") === 4) {
            exTgl = exTgl.substring(0, 10);
          }
        }
        if (exNama && exTgl) {
          existingSet[exNama + "_" + exTgl] = true;
        }
      }
    }

    var finalRowsToAppend = [];
    var duplicateCount = 0;

    for (var k = 0; k < rowsToAppend.length; k++) {
      var candidate = rowsToAppend[k];
      var candidateNama = String(candidate[0] || "").toLowerCase().trim();
      var candidateTgl = String(candidate[3] || "").trim();
      if (candidateTgl.length >= 10 && candidateTgl.indexOf("-") === 4) {
        candidateTgl = candidateTgl.substring(0, 10);
      }
      var candidateKey = candidateNama + "_" + candidateTgl;

      if (!existingSet[candidateKey]) {
        finalRowsToAppend.push(candidate);
        existingSet[candidateKey] = true; // Cegah duplikat ganda dalam 1 batch payload
      } else {
        duplicateCount++;
      }
    }

    // Tulis baris secara atomik & cepat (Bulk Writing via setValues)
    if (finalRowsToAppend.length > 0) {
      var startRow = sheet.getLastRow() + 1;
      var numRows = finalRowsToAppend.length;

      var dataRange = sheet.getRange(startRow, 1, numRows, 5);
      dataRange.setValues(finalRowsToAppend);
      dataRange.setFontFamily("Montserrat");
      dataRange.setFontSize(10);
      dataRange.setVerticalAlignment("middle");

      // Rata tengah untuk kolom Hari, Tanggal, dan Status
      sheet.getRange(startRow, 3, numRows, 3).setHorizontalAlignment("center");

      // Set tinggi baris efisien
      for (var r = startRow; r < startRow + numRows; r++) {
        sheet.setRowHeight(r, 28);
      }
    }

    return ContentService.createTextOutput(
      JSON.stringify({
        status: "success",
        count: finalRowsToAppend.length,
        skippedDuplicates: duplicateCount,
        message:
          finalRowsToAppend.length > 0
            ? "Presensi berhasil dicatat (" + finalRowsToAppend.length + " data)"
            : "Data presensi sudah tercatat sebelumnya (tidak ada duplikasi)",
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

// =========================================================================
// MENU KHUSUS REKAPITULASI KEHADIRAN BULANAN (COUNTIFS OTOMATIS)
// =========================================================================

/**
 * Otomatis menambahkan menu 'Rekapitulasi KSE UNRI' di menu bar atas Google Sheets
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu("Rekapitulasi KSE UNRI")
    .addItem("Buat / Perbarui Tab Rekap Bulanan", "buatTabRekapBulanan")
    .addToUi();
}

/**
 * Menyusun tab 'Rekap Kehadiran' lengkap dengan 67 nama beswan,
 * kotak filter rentang tanggal (misal 16 Sep - 15 Okt), dan rumus COUNTIFS dinamis.
 */
function buatTabRekapBulanan() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = "Rekap Kehadiran";
  var sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  } else {
    sheet.clear();
  }

  // 1. Judul Banner Header
  sheet.getRange("A1:G1").merge();
  var titleCell = sheet.getRange("A1");
  titleCell.setValue("REKAPITULASI KEHADIRAN PIKET SEKRETARIAT - PAGUYUBAN KSE UNRI");
  titleCell.setBackground("#004834");
  titleCell.setFontColor("#FFFFFF");
  titleCell.setFontWeight("bold");
  titleCell.setFontSize(12);
  titleCell.setFontFamily("Montserrat");
  titleCell.setHorizontalAlignment("center");
  titleCell.setVerticalAlignment("middle");
  sheet.setRowHeight(1, 38);

  // 2. Kotak Kontrol Periode (Baris 2)
  sheet.getRange("B2").setValue("Periode Mulai (YYYY-MM-DD):").setFontWeight("bold").setHorizontalAlignment("right");
  sheet.getRange("C2").setValue("2026-09-16").setHorizontalAlignment("center").setBackground("#FAF7CC").setFontWeight("bold");
  sheet.getRange("D2").setValue("Periode Selesai (YYYY-MM-DD):").setFontWeight("bold").setHorizontalAlignment("right");
  sheet.getRange("E2").setValue("2026-10-15").setHorizontalAlignment("center").setBackground("#FAF7CC").setFontWeight("bold");
  sheet.getRange("F2").setValue("Ubah tanggal di C2 & E2 untuk mereset & menghitung otomatis periode berikutnya.")
    .setFontColor("#555555").setFontStyle("italic").setFontSize(9);

  // Border aksen emas untuk input tanggal C2 & E2
  var dateBorder = SpreadsheetApp.BorderStyle.SOLID_MEDIUM;
  sheet.getRange("C2").setBorder(true, true, true, true, null, null, "#EEB319", dateBorder);
  sheet.getRange("E2").setBorder(true, true, true, true, null, null, "#EEB319", dateBorder);
  sheet.setRowHeight(2, 30);
  sheet.setRowHeight(3, 10); // Jarak spasi kosong baris 3

  // 3. Header Tabel (Baris 4)
  var headers = [
    "No",
    "Nama Anggota",
    "Divisi",
    "Jadwal Piket",
    "Target Piket",
    "Jumlah Hadir",
    "Status Evaluasi"
  ];
  sheet.getRange(4, 1, 1, headers.length).setValues([headers]);

  var tableHeaderRange = sheet.getRange(4, 1, 1, headers.length);
  tableHeaderRange.setBackground("#004834");
  tableHeaderRange.setFontColor("#FFFFFF");
  tableHeaderRange.setFontWeight("bold");
  tableHeaderRange.setFontSize(10);
  tableHeaderRange.setFontFamily("Montserrat");
  tableHeaderRange.setHorizontalAlignment("center");
  tableHeaderRange.setVerticalAlignment("middle");
  tableHeaderRange.setBorder(null, null, true, null, null, null, "#EEB319", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sheet.setRowHeight(4, 34);

  // 4. Master Data 67 Beswan KSE UNRI
  var beswanList = [
    { id: 1, nama: "Ilham Radhifa", divisi: "Badan Pengurus Harian (BPH)", hari: "Selasa, Rabu, Sabtu", target: 12 },
    { id: 2, nama: "Fernando Situmorang", divisi: "Badan Pengurus Harian (BPH)", hari: "Senin, Kamis, Jumat", target: 12 },
    { id: 3, nama: "Raissa Nabila Putri Riski", divisi: "Badan Pengurus Harian (BPH)", hari: "Senin, Selasa, Jumat", target: 12 },
    { id: 4, nama: "Ainesis Siringo Ringo", divisi: "Badan Pengurus Harian (BPH)", hari: "Rabu, Jumat, Sabtu", target: 12 },
    { id: 5, nama: "Renna Mailina", divisi: "Badan Pengurus Harian (BPH)", hari: "Senin, Rabu, Kamis", target: 12 },
    { id: 6, nama: "Muhammad Renaldy Saputra", divisi: "Pendidikan dan Pelatihan (DIKLAT)", hari: "Senin, Jumat", target: 8 },
    { id: 7, nama: "Najwa Syafiqah", divisi: "Pendidikan dan Pelatihan (DIKLAT)", hari: "Jumat", target: 4 },
    { id: 8, nama: "Hameezah", divisi: "Pendidikan dan Pelatihan (DIKLAT)", hari: "Senin", target: 4 },
    { id: 9, nama: "Halya Febriani", divisi: "Pendidikan dan Pelatihan (DIKLAT)", hari: "Kamis", target: 4 },
    { id: 10, nama: "Adelia", divisi: "Pendidikan dan Pelatihan (DIKLAT)", hari: "Sabtu", target: 4 },
    { id: 11, nama: "Citra Melamedika", divisi: "Pendidikan dan Pelatihan (DIKLAT)", hari: "Jumat", target: 4 },
    { id: 12, nama: "Azizah Zahra Nurwani", divisi: "Pendidikan dan Pelatihan (DIKLAT)", hari: "Rabu", target: 4 },
    { id: 13, nama: "Mufidli Halim", divisi: "Pendidikan dan Pelatihan (DIKLAT)", hari: "Selasa", target: 4 },
    { id: 14, nama: "Hanifah Ryanti", divisi: "Pendidikan dan Pelatihan (DIKLAT)", hari: "Sabtu", target: 4 },
    { id: 15, nama: "Tanziilal Azizirrahim", divisi: "Pendidikan dan Pelatihan (DIKLAT)", hari: "Jumat", target: 4 },
    { id: 16, nama: "Deno Rangga Alif", divisi: "Komunikasi dan Informasi (KOMINFO)", hari: "Senin, Selasa", target: 8 },
    { id: 17, nama: "Sarah Filia Hutasoit", divisi: "Komunikasi dan Informasi (KOMINFO)", hari: "Selasa", target: 4 },
    { id: 18, nama: "Hanna Rida Yolavani Pandiangan", divisi: "Komunikasi dan Informasi (KOMINFO)", hari: "Senin", target: 4 },
    { id: 19, nama: "Salsa Nabila Zahira", divisi: "Komunikasi dan Informasi (KOMINFO)", hari: "Rabu", target: 4 },
    { id: 20, nama: "Ghinna Faadhilah Husni", divisi: "Komunikasi dan Informasi (KOMINFO)", hari: "Senin", target: 4 },
    { id: 21, nama: "Novia Putri Tiefi", divisi: "Komunikasi dan Informasi (KOMINFO)", hari: "Selasa", target: 4 },
    { id: 22, nama: "Ade Gheriya Rahima Br. Pasaribu", divisi: "Komunikasi dan Informasi (KOMINFO)", hari: "Jumat", target: 4 },
    { id: 23, nama: "Dzakira Syarqiya", divisi: "Komunikasi dan Informasi (KOMINFO)", hari: "Kamis", target: 4 },
    { id: 24, nama: "Muhammad Jadid Ghifari", divisi: "Komunikasi dan Informasi (KOMINFO)", hari: "Rabu", target: 4 },
    { id: 25, nama: "Rahma Cahyani", divisi: "Komunikasi dan Informasi (KOMINFO)", hari: "Rabu", target: 4 },
    { id: 26, nama: "Latifah Hanum", divisi: "Komunikasi dan Informasi (KOMINFO)", hari: "Selasa", target: 4 },
    { id: 27, nama: "Rahmah Azzahra", divisi: "Rumah Gurindam (RAGAM)", hari: "Kamis, Sabtu", target: 8 },
    { id: 28, nama: "Regina Wulandari", divisi: "Rumah Gurindam (RAGAM)", hari: "Kamis", target: 4 },
    { id: 29, nama: "Lili", divisi: "Rumah Gurindam (RAGAM)", hari: "Kamis", target: 4 },
    { id: 30, nama: "Herma Desviona", divisi: "Rumah Gurindam (RAGAM)", hari: "Selasa", target: 4 },
    { id: 31, nama: "Odelia Rejoice Moranda Sibuea", divisi: "Rumah Gurindam (RAGAM)", hari: "Sabtu", target: 4 },
    { id: 32, nama: "Rian Setiawan", divisi: "Rumah Gurindam (RAGAM)", hari: "Selasa", target: 4 },
    { id: 33, nama: "Maulya Luthfiana Fathny", divisi: "Rumah Gurindam (RAGAM)", hari: "Sabtu", target: 4 },
    { id: 34, nama: "Zulkifli Boy Simatupang", divisi: "Rumah Gurindam (RAGAM)", hari: "Sabtu", target: 4 },
    { id: 35, nama: "Jesika Maretta Br Manullang", divisi: "Rumah Gurindam (RAGAM)", hari: "Selasa", target: 4 },
    { id: 36, nama: "Maya Tri Putri", divisi: "Rumah Gurindam (RAGAM)", hari: "Sabtu", target: 4 },
    { id: 37, nama: "Muhammad Erwa Sandyka", divisi: "Ekonomi, Bisnis, dan Partnership (EKOBIS)", hari: "Kamis, Sabtu", target: 8 },
    { id: 38, nama: "Mitraturahmah", divisi: "Ekonomi, Bisnis, dan Partnership (EKOBIS)", hari: "Rabu", target: 4 },
    { id: 39, nama: "Jannati Zerlina", divisi: "Ekonomi, Bisnis, dan Partnership (EKOBIS)", hari: "Selasa", target: 4 },
    { id: 40, nama: "Annisa Nurul Ramadhani", divisi: "Ekonomi, Bisnis, dan Partnership (EKOBIS)", hari: "Jumat", target: 4 },
    { id: 41, nama: "Sisca Rahma Alya", divisi: "Ekonomi, Bisnis, dan Partnership (EKOBIS)", hari: "Sabtu", target: 4 },
    { id: 42, nama: "Thalita Anindya Ahnaf", divisi: "Ekonomi, Bisnis, dan Partnership (EKOBIS)", hari: "Rabu", target: 4 },
    { id: 43, nama: "Yusri Arya Pratama", divisi: "Ekonomi, Bisnis, dan Partnership (EKOBIS)", hari: "Kamis", target: 4 },
    { id: 44, nama: "Faris Alphard", divisi: "Ekonomi, Bisnis, dan Partnership (EKOBIS)", hari: "Rabu", target: 4 },
    { id: 45, nama: "Diva Nura Asmara", divisi: "Ekonomi, Bisnis, dan Partnership (EKOBIS)", hari: "Senin", target: 4 },
    { id: 46, nama: "Fahmi Agustiadi Idris", divisi: "Ekonomi, Bisnis, dan Partnership (EKOBIS)", hari: "Rabu", target: 4 },
    { id: 47, nama: "Hikmah Syahrini", divisi: "Community Development (COMDEV)", hari: "Kamis, Jumat", target: 8 },
    { id: 48, nama: "Alysa Pardalana Febia", divisi: "Community Development (COMDEV)", hari: "Rabu", target: 4 },
    { id: 49, nama: "Verronica Allysia Tampubolon", divisi: "Community Development (COMDEV)", hari: "Senin", target: 4 },
    { id: 50, nama: "Tengku Risya Dwi Julietha", divisi: "Community Development (COMDEV)", hari: "Senin", target: 4 },
    { id: 51, nama: "Naufal Labib Ramadhani", divisi: "Community Development (COMDEV)", hari: "Sabtu", target: 4 },
    { id: 52, nama: "Hadelia Clara", divisi: "Community Development (COMDEV)", hari: "Kamis", target: 4 },
    { id: 53, nama: "Siti Tri Nopianti", divisi: "Community Development (COMDEV)", hari: "Jumat", target: 4 },
    { id: 54, nama: "Sabda Yohana Harita", divisi: "Community Development (COMDEV)", hari: "Kamis", target: 4 },
    { id: 55, nama: "Fadhila Fahtur Rahman", divisi: "Community Development (COMDEV)", hari: "Jumat", target: 4 },
    { id: 56, nama: "Christina Geovani Sinaga", divisi: "Community Development (COMDEV)", hari: "Selasa", target: 4 },
    { id: 57, nama: "Teguh Febryano", divisi: "Community Development (COMDEV)", hari: "Senin", target: 4 },
    { id: 58, nama: "Miranda Sinaga", divisi: "Internal Relation (IR)", hari: "Rabu, Kamis", target: 8 },
    { id: 59, nama: "Fanny Marissa Putri", divisi: "Internal Relation (IR)", hari: "Jumat", target: 4 },
    { id: 60, nama: "Yunika Nuuru Afriza", divisi: "Internal Relation (IR)", hari: "Selasa", target: 4 },
    { id: 61, nama: "Hana Revalina Situmorang", divisi: "Internal Relation (IR)", hari: "Jumat", target: 4 },
    { id: 62, nama: "Neldia Zamriati", divisi: "Internal Relation (IR)", hari: "Selasa", target: 4 },
    { id: 63, nama: "Febriani", divisi: "Internal Relation (IR)", hari: "Rabu", target: 4 },
    { id: 64, nama: "Arinil Haqqoh", divisi: "Internal Relation (IR)", hari: "Kamis", target: 4 },
    { id: 65, nama: "Fathin Ahmad Zidan", divisi: "Internal Relation (IR)", hari: "Senin", target: 4 },
    { id: 66, nama: "Jose Earl Parulian Manurung", divisi: "Internal Relation (IR)", hari: "Sabtu", target: 4 },
    { id: 67, nama: "Afry Dearny Sinaga", divisi: "Internal Relation (IR)", hari: "Sabtu", target: 4 },
  ];

  var rowValues = [];
  for (var i = 0; i < beswanList.length; i++) {
    var b = beswanList[i];
    var rowIdx = 5 + i;

    // Formula COUNTIFS dinamis mengacu ke Tanggal Mulai ($C$2) dan Tanggal Selesai ($E$2)
    var formulaCount =
      '=COUNTIFS(\'Data Presensi\'!$A:$A, B' + rowIdx + ', \'Data Presensi\'!$D:$D, ">="&$C$2, \'Data Presensi\'!$D:$D, "<="&$E$2)';

    // Formula Status Evaluasi
    var formulaStatus =
      '=IF(F' + rowIdx + '>=E' + rowIdx + ', "Memenuhi Target", "Kurang " & (E' + rowIdx + '-F' + rowIdx + ') & " Piket")';

    rowValues.push([
      b.id,
      b.nama,
      b.divisi,
      b.hari,
      b.target,
      formulaCount,
      formulaStatus
    ]);
  }

  // Tulis 67 baris data dan rumus sekaligus
  var dataRange = sheet.getRange(5, 1, rowValues.length, 7);
  dataRange.setValues(rowValues);
  dataRange.setFontFamily("Montserrat");
  dataRange.setFontSize(10);
  dataRange.setVerticalAlignment("middle");

  // Format perataan (alignment)
  sheet.getRange(5, 1, rowValues.length, 1).setHorizontalAlignment("center"); // No
  sheet.getRange(5, 2, rowValues.length, 2).setHorizontalAlignment("left");   // Nama & Divisi
  sheet.getRange(5, 4, rowValues.length, 4).setHorizontalAlignment("center"); // Jadwal, Target, Jumlah Hadir, Status

  // Tinggi baris dan kunci 4 baris pertama agar header tetap terlihat saat scroll
  for (var r = 5; r <= 4 + rowValues.length; r++) {
    sheet.setRowHeight(r, 26);
  }
  sheet.setFrozenRows(4);

  // Auto-resize seluruh kolom agar rapi
  for (var c = 1; c <= 7; c++) {
    sheet.autoResizeColumn(c);
  }

  // Tampilkan notifikasi popup berhasil
  var ui = SpreadsheetApp.getUi();
  ui.alert(
    "Berhasil!",
    "Tab 'Rekap Kehadiran' telah selesai dibuat/diperbarui dengan 67 data beswan.\n\nAnda dapat mengganti tanggal periode di Cell C2 dan E2 kapan saja untuk mereset dan menghitung periode berikutnya secara instan.",
    ui.ButtonSet.OK
  );
}
