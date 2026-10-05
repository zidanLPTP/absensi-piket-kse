/**
 * =========================================================================
 * LOGIKA APLIKASI PRESENSI PIKET PAGUYUBAN KSE UNRI (app.js)
 * Pola: Vanilla JS + LocalStorage Persistence + Auto-Sync Google Sheets
 * =========================================================================
 */

// State internal aplikasi
let currentFilter = 'semua';
let searchQuery = '';
let timerInterval = null;

// ================= UTILITIES & DATE HELPERS =================
function getTodayDateKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getStorageKey() {
  return `kse_piket_${getTodayDateKey()}`;
}

function getTodayHariName() {
  return HARI_MAP[new Date().getDay()];
}

function getAttendanceState() {
  try {
    const data = localStorage.getItem(getStorageKey());
    return data ? JSON.parse(data) : {};
  } catch (err) {
    console.error("Gagal membaca LocalStorage:", err);
    return {};
  }
}

function saveAttendanceState(state) {
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify(state));
  } catch (err) {
    console.error("Gagal menyimpan LocalStorage:", err);
  }
}

function formatRemainingSeconds(diffMs) {
  if (diffMs <= 0) return "00:00";
  const totalSec = Math.floor(diffMs / 1000);
  const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

// ================= JADWAL PIKET HELPERS (Mendukung Single Hari atau Array Hari) =================
function getJadwalPiketArray(hariPiket) {
  if (!hariPiket) return [];
  const formatHariName = (h) => {
    const str = String(h).trim();
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  };
  if (Array.isArray(hariPiket)) {
    return hariPiket.map(formatHariName).filter(Boolean);
  }
  if (typeof hariPiket === 'string') {
    return hariPiket.split(',').map(formatHariName).filter(Boolean);
  }
  return [];
}

function isBeswanPiketToday(beswan, todayHari) {
  if (!beswan) return false;
  const list = getJadwalPiketArray(beswan.hari_piket);
  return list.some(h => h.toLowerCase() === todayHari.toLowerCase());
}

function renderJadwalBadges(hariPiket, todayHari) {
  const list = getJadwalPiketArray(hariPiket);
  if (list.length === 0) {
    return `<span class="text-gray-400 text-xs">-</span>`;
  }
  return `
    <div class="flex flex-wrap items-center justify-center gap-1">
      ${list.map(hari => {
        const isToday = hari.toLowerCase() === todayHari.toLowerCase();
        if (isToday) {
          return `<span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-kse-primary text-white shadow-xs">
            ${hari}
          </span>`;
        }
        return `<span class="inline-block px-1.5 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-700 border border-gray-200">
          ${hari}
        </span>`;
      }).join('')}
    </div>
  `;
}

function renderMobileJadwalBadges(hariPiket, todayHari) {
  const list = getJadwalPiketArray(hariPiket);
  if (list.length === 0) {
    return `<span class="text-gray-400 text-xs">-</span>`;
  }
  return `
    <div class="flex flex-wrap items-center justify-end gap-1">
      ${list.map(hari => {
        const isToday = hari.toLowerCase() === todayHari.toLowerCase();
        if (isToday) {
          return `<span class="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-kse-primary text-white shadow-xs">
            ${hari} (Hari Ini)
          </span>`;
        }
        return `<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold text-gray-600 bg-gray-100 border border-gray-200">
          ${hari}
        </span>`;
      }).join('')}
    </div>
  `;
}

// ================= LIFECYCLE & INIT =================
document.addEventListener('DOMContentLoaded', () => {
  initClockAndDates();
  setupSearch();
  reconcileUnsyncedSessions();
  updateSyncIndicatorUI();
  renderApp();
  startLiveTicker();
  processSyncQueue();

  // Event listener deteksi online/offline
  window.addEventListener('online', () => {
    updateSyncIndicatorUI();
    showToast('Koneksi internet pulih. Memproses antrean sinkronisasi...', 'info');
    processSyncQueue();
  });

  window.addEventListener('offline', () => {
    updateSyncIndicatorUI();
    showToast('Koneksi terputus. Data presensi tetap tersimpan aman di antrean lokal.', 'warning');
  });

  // Background worker tiap 30 detik untuk memastikan tidak ada data yang tertunda
  setInterval(() => {
    if (!isProcessingQueue && navigator.onLine) {
      const queue = getSyncQueue();
      if (queue.some(item => item.status === 'pending')) {
        processSyncQueue();
      }
    }
  }, 30000);
});

function initClockAndDates() {
  const now = new Date();
  const hariName = HARI_MAP[now.getDay()];
  const tgl = now.getDate();
  const bln = BULAN_MAP[now.getMonth()];
  const thn = now.getFullYear();

  const dateLabel = document.getElementById('currentDateLabel');
  const activeDayText = document.getElementById('activeDayText');
  const totalCount = document.getElementById('totalBeswanCount');

  if (dateLabel) dateLabel.textContent = `${hariName}, ${tgl} ${bln} ${thn}`;
  if (activeDayText) activeDayText.textContent = hariName;
  if (totalCount) totalCount.textContent = BESWAN_DATA.length;

  setInterval(() => {
    const timeNow = new Date();
    const hh = String(timeNow.getHours()).padStart(2, '0');
    const mm = String(timeNow.getMinutes()).padStart(2, '0');
    const ss = String(timeNow.getSeconds()).padStart(2, '0');
    const clockEl = document.getElementById('liveClock');
    const clockMobileEl = document.getElementById('liveClockMobile');
    if (clockEl) clockEl.textContent = `${hh}:${mm}:${ss} WIB`;
    if (clockMobileEl) clockMobileEl.textContent = `${hh}:${mm} WIB`;
  }, 1000);
}

const MAX_PIKET_PER_DAY = 3;

// Helper normalisasi struktur data agar kompatibel dengan data lama di LocalStorage
function normalizeRecord(raw) {
  if (!raw) {
    return { sessions: [], activeSession: null };
  }

  // Jika sudah berformat baru (memiliki array sessions atau properti activeSession)
  if (Array.isArray(raw.sessions) || raw.activeSession !== undefined) {
    return {
      sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
      activeSession: raw.activeSession || null
    };
  }

  // Migrasi otomatis dari struktur legacy (single session)
  const sessions = [];
  let activeSession = null;

  if (raw.status === 'selesai') {
    sessions.push({
      session: 1,
      startTime: raw.startTime || (Date.now() - (COUNTDOWN_DURATION_SECONDS * 1000)),
      endTime: raw.targetEndTime || Date.now(),
      jamMasuk: raw.jamMasuk || '-',
      jamSelesai: raw.jamSelesai || '-',
      tanggal: raw.tanggal || getTodayDateKey(),
      synced: raw.synced !== false
    });
  } else if (raw.status === 'countdown') {
    activeSession = {
      session: 1,
      startTime: raw.startTime || Date.now(),
      targetEndTime: raw.targetEndTime || (Date.now() + (COUNTDOWN_DURATION_SECONDS * 1000)),
      jamMasuk: raw.jamMasuk || new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      tanggal: raw.tanggal || getTodayDateKey()
    };
  }

  return { sessions, activeSession };
}

// ================= ABSENSI ACTIONS =================
let pendingCancelId = null;

function mulaiAbsen(id) {
  const beswan = BESWAN_DATA.find(b => b.id === id);
  if (!beswan) return;

  const state = getAttendanceState();
  const record = normalizeRecord(state[id]);

  if (record.activeSession) {
    showToast(`Piket ke-${record.activeSession.session} untuk ${beswan.nama} sedang berjalan.`, 'warning');
    return;
  }

  if (record.sessions.length >= MAX_PIKET_PER_DAY) {
    showToast(`Batas maksimal (${MAX_PIKET_PER_DAY}x piket per hari) telah tercapai untuk ${beswan.nama}.`, 'warning');
    return;
  }

  const nextSession = record.sessions.length + 1;
  const now = new Date();

  record.activeSession = {
    session: nextSession,
    startTime: now.getTime(),
    targetEndTime: now.getTime() + (COUNTDOWN_DURATION_SECONDS * 1000),
    jamMasuk: now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    tanggal: getTodayDateKey()
  };

  state[id] = record;
  saveAttendanceState(state);
  showToast(`Presensi Piket ke-${nextSession} dimulai untuk ${beswan.nama}. Timer berjalan.`, 'info');
  renderApp();
}

function bukaModalBatalkan(id) {
  const beswan = BESWAN_DATA.find(b => b.id === id);
  if (!beswan) return;

  const state = getAttendanceState();
  const record = normalizeRecord(state[id]);
  if (!record.activeSession) return;

  pendingCancelId = id;
  const modal = document.getElementById('cancelConfirmModal');
  const desc = document.getElementById('cancelModalDesc');
  const confirmBtn = document.getElementById('confirmCancelActionBtn');

  const sessionNum = record.activeSession.session;
  if (desc) {
    let extraNote = '';
    if (record.sessions.length > 0) {
      extraNote = `<br><span class="inline-block mt-2 text-emerald-700 font-medium bg-emerald-50 px-2 py-1 rounded border border-emerald-200">✓ ${record.sessions.length} sesi piket sebelumnya tetap tersimpan sah di Google Sheets.</span>`;
    }
    desc.innerHTML = `Apakah Anda yakin ingin membatalkan <strong>Piket ke-${sessionNum}</strong> untuk <strong>${beswan.nama}</strong>? Timer sesi ini akan dihentikan.${extraNote}`;
  }

  if (confirmBtn) {
    confirmBtn.onclick = eksekusiBatalkan;
  }

  if (modal) {
    modal.classList.remove('hidden');
  }
}

function closeCancelModal() {
  pendingCancelId = null;
  const modal = document.getElementById('cancelConfirmModal');
  if (modal) modal.classList.add('hidden');
}

// Tutup modal via keyboard Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeCancelModal();
  }
});

function eksekusiBatalkan() {
  if (!pendingCancelId) return;

  const id = pendingCancelId;
  const beswan = BESWAN_DATA.find(b => b.id === id);
  const nama = beswan ? beswan.nama : 'Beswan';

  const state = getAttendanceState();
  const record = normalizeRecord(state[id]);
  const cancelledSession = record.activeSession ? record.activeSession.session : 1;

  record.activeSession = null;
  if (record.sessions.length === 0) {
    delete state[id];
  } else {
    state[id] = record;
  }
  saveAttendanceState(state);

  closeCancelModal();
  showToast(`Piket ke-${cancelledSession} untuk ${nama} telah dibatalkan.`, 'warning');
  renderApp();
}

// Backward compatibility helper
function batalkanAbsen(id) {
  bukaModalBatalkan(id);
}

function selesaikanAbsen(id) {
  const state = getAttendanceState();
  const record = normalizeRecord(state[id]);
  const beswan = BESWAN_DATA.find(b => b.id === id);

  if (!record || !record.activeSession || !beswan) return;

  const active = record.activeSession;
  const now = new Date();
  const jamSelesai = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const sessionObj = {
    session: active.session,
    startTime: active.startTime,
    endTime: now.getTime(),
    jamMasuk: active.jamMasuk,
    jamSelesai: jamSelesai,
    tanggal: active.tanggal || getTodayDateKey(),
    synced: false
  };

  record.sessions.push(sessionObj);
  record.activeSession = null;
  state[id] = record;
  saveAttendanceState(state);

  renderApp();
  showToast(`Selamat! ${beswan.nama} sah menyelesaikan Piket ke-${sessionObj.session} (60 menit). Sinkronisasi data...`, 'success');

  syncToGoogleSheets(beswan, sessionObj);
}

// ================= PERSISTENT QUEUE & GOOGLE SHEETS BATCH SYNC =================
const SYNC_QUEUE_KEY = 'kse_sync_queue';
let isProcessingQueue = false;

function getSyncQueue() {
  try {
    const raw = localStorage.getItem(SYNC_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("Gagal membaca sync queue:", e);
    return [];
  }
}

function saveSyncQueue(queue) {
  try {
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.error("Gagal menyimpan sync queue:", e);
  }
  updateSyncIndicatorUI();
}

function addToSyncQueue(beswan, sessionObj) {
  const queue = getSyncQueue();
  const queueId = `${beswan.id}_${sessionObj.session}_${sessionObj.tanggal || getTodayDateKey()}_${sessionObj.startTime || Date.now()}`;

  // Hindari duplikasi di dalam antrean
  if (queue.some(item => item.queueId === queueId)) {
    return;
  }

  const payload = {
    id: beswan.id,
    nama: beswan.nama,
    divisi: beswan.divisi,
    jadwal_piket: getJadwalPiketArray(beswan.hari_piket).join(", ") || "-",
    hari_presensi: getTodayHariName(), // Hari aktual saat presensi selesai
    tanggal: sessionObj.tanggal || getTodayDateKey(),
    jam_masuk: sessionObj.jamMasuk,
    jam_selesai: sessionObj.jamSelesai,
    status: `Hadir (Piket ${sessionObj.session})`
  };

  queue.push({
    queueId: queueId,
    beswanId: beswan.id,
    sessionNumber: sessionObj.session,
    payload: payload,
    status: 'pending', // 'pending' | 'syncing'
    retries: 0,
    createdAt: Date.now()
  });

  saveSyncQueue(queue);
}

function reconcileUnsyncedSessions() {
  const state = getAttendanceState();
  const queue = getSyncQueue();
  let added = 0;

  Object.keys(state).forEach(id => {
    const numId = parseInt(id, 10);
    const beswan = BESWAN_DATA.find(b => b.id === numId);
    if (!beswan) return;

    const rec = normalizeRecord(state[id]);
    rec.sessions.forEach(sess => {
      if (sess.synced === false) {
        const queueId = `${beswan.id}_${sess.session}_${sess.tanggal || getTodayDateKey()}_${sess.startTime || ''}`;
        const alreadyInQueue = queue.some(q => q.queueId === queueId || (q.beswanId === beswan.id && q.sessionNumber === sess.session));
        if (!alreadyInQueue) {
          queue.push({
            queueId: queueId,
            beswanId: beswan.id,
            sessionNumber: sess.session,
            payload: {
              id: beswan.id,
              nama: beswan.nama,
              divisi: beswan.divisi,
              jadwal_piket: getJadwalPiketArray(beswan.hari_piket).join(", ") || "-",
              hari_presensi: getTodayHariName(),
              tanggal: sess.tanggal || getTodayDateKey(),
              jam_masuk: sess.jamMasuk,
              jam_selesai: sess.jamSelesai,
              status: `Hadir (Piket ${sess.session})`
            },
            status: 'pending',
            retries: 0,
            createdAt: Date.now()
          });
          added++;
        }
      }
    });
  });

  if (added > 0) {
    saveSyncQueue(queue);
  }
}

async function processSyncQueue() {
  if (isProcessingQueue) return;

  if (!navigator.onLine) {
    updateSyncIndicatorUI();
    return;
  }

  if (!GOOGLE_SCRIPT_URL || GOOGLE_SCRIPT_URL === "ISI_URL_WEB_APP_DISINI") {
    updateSyncIndicatorUI();
    return;
  }

  let queue = getSyncQueue();
  const now = Date.now();
  let recovered = false;

  // Pulihkan item yang stuck 'syncing' lebih dari 45 detik (misal akibat browser sleep / freeze)
  queue.forEach(item => {
    if (item.status === 'syncing' && (now - (item.syncStartedAt || now)) > 45000) {
      item.status = 'pending';
      recovered = true;
    }
  });
  if (recovered) saveSyncQueue(queue);

  const pendingItems = queue.filter(item => item.status === 'pending');
  if (pendingItems.length === 0) {
    updateSyncIndicatorUI();
    return;
  }

  isProcessingQueue = true;

  // Batching hingga 10 item per request untuk efisiensi tinggi & anti-timeout
  const BATCH_SIZE = 10;
  const batch = pendingItems.slice(0, BATCH_SIZE);
  const batchIds = new Set(batch.map(b => b.queueId));

  queue.forEach(item => {
    if (batchIds.has(item.queueId)) {
      item.status = 'syncing';
      item.syncStartedAt = Date.now();
    }
  });
  saveSyncQueue(queue);
  updateSyncIndicatorUI();

  try {
    const payloadBody = {
      items: batch.map(b => b.payload)
    };

    await fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadBody)
    });

    // Berhasil dikirim! Hapus item batch dari antrean lokal
    const freshQueue = getSyncQueue();
    const remainingQueue = freshQueue.filter(item => !batchIds.has(item.queueId));
    saveSyncQueue(remainingQueue);

    // Tandai session terkait sebagai synced: true di attendance state
    const state = getAttendanceState();
    let stateChanged = false;
    batch.forEach(item => {
      if (state[item.beswanId]) {
        const rec = normalizeRecord(state[item.beswanId]);
        const targetSession = rec.sessions.find(s => s.session === item.sessionNumber);
        if (targetSession && !targetSession.synced) {
          targetSession.synced = true;
          state[item.beswanId] = rec;
          stateChanged = true;
        }
      }
    });
    if (stateChanged) {
      saveAttendanceState(state);
      renderApp();
    }

    if (batch.length === 1) {
      showToast(`Data Piket ${batch[0].payload.nama} (Piket ke-${batch[0].sessionNumber}) berhasil disinkronkan ke Google Sheets!`, 'success');
    } else {
      showToast(`${batch.length} data presensi piket berhasil disinkronkan ke Google Sheets!`, 'success');
    }
  } catch (error) {
    console.error("Gagal sinkronisasi antrean ke Google Sheets:", error);
    const currentQueue = getSyncQueue();
    currentQueue.forEach(item => {
      if (batchIds.has(item.queueId)) {
        item.status = 'pending';
        item.retries = (item.retries || 0) + 1;
        delete item.syncStartedAt;
      }
    });
    saveSyncQueue(currentQueue);
    showToast(`Koneksi terganggu. ${batch.length} data aman di antrean lokal & akan otomatis dikirim saat online.`, 'warning');
  } finally {
    isProcessingQueue = false;
    updateSyncIndicatorUI();

    // Jika masih ada item antrean yang belum terkirim, jeda 600ms lalu lanjutkan batch berikutnya
    const remainingPending = getSyncQueue().filter(item => item.status === 'pending');
    if (remainingPending.length > 0 && navigator.onLine) {
      setTimeout(() => {
        processSyncQueue();
      }, 600);
    }
  }
}

// Wrapper kompatibilitas untuk panggilan sinkronisasi
function syncToGoogleSheets(beswan, sessionObj) {
  addToSyncQueue(beswan, sessionObj);
  processSyncQueue();
}

function manualTriggerSync() {
  if (!navigator.onLine) {
    showToast("Perangkat Anda sedang offline. Mohon periksa koneksi internet.", "warning");
    return;
  }
  const queue = getSyncQueue();
  const pendingCount = queue.filter(q => q.status === 'pending').length;
  if (pendingCount === 0) {
    showToast("Semua data presensi sudah tersinkronkan ke Google Sheets.", "success");
    return;
  }
  showToast(`Menyinkronkan ${pendingCount} antrean data ke Google Sheets...`, "info");
  processSyncQueue();
}

function updateSyncIndicatorUI() {
  const badgeBtn = document.getElementById('syncStatusBadge');
  const badgeText = document.getElementById('syncStatusText');
  const badgeIcon = document.getElementById('syncStatusIcon');
  if (!badgeBtn || !badgeText || !badgeIcon) return;

  if (!GOOGLE_SCRIPT_URL || GOOGLE_SCRIPT_URL === "ISI_URL_WEB_APP_DISINI") {
    badgeBtn.className = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition border bg-amber-900/60 text-amber-200 border-amber-500/50 hover:bg-amber-900";
    badgeIcon.className = "fa-solid fa-triangle-exclamation text-xs text-amber-300";
    badgeText.textContent = "URL Belum Diset";
    badgeBtn.title = "GOOGLE_SCRIPT_URL di config.js belum diisi";
    return;
  }

  if (!navigator.onLine) {
    const queue = getSyncQueue();
    const count = queue.length;
    badgeBtn.className = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition border bg-rose-900/60 text-rose-200 border-rose-500/50 hover:bg-rose-900";
    badgeIcon.className = "fa-solid fa-cloud-slash text-xs text-rose-300";
    badgeText.textContent = count > 0 ? `Offline (${count} Antrean)` : "Offline";
    badgeBtn.title = "Koneksi offline. Data tersimpan aman di antrean lokal browser.";
    return;
  }

  const queue = getSyncQueue();
  const pendingCount = queue.filter(q => q.status === 'pending').length;
  const syncingCount = queue.filter(q => q.status === 'syncing').length;

  if (syncingCount > 0 || isProcessingQueue) {
    badgeBtn.className = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition border bg-amber-900/70 text-amber-200 border-amber-400/60 animate-pulse";
    badgeIcon.className = "fa-solid fa-arrows-rotate fa-spin text-xs text-amber-300";
    badgeText.textContent = `Menyinkronkan (${pendingCount + syncingCount})...`;
    badgeBtn.title = "Sedang mengirim batch data presensi ke Google Sheets...";
  } else if (pendingCount > 0) {
    badgeBtn.className = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition border bg-amber-900/60 text-amber-200 border-amber-500/50 hover:bg-amber-900";
    badgeIcon.className = "fa-solid fa-cloud-arrow-up text-xs text-amber-300";
    badgeText.textContent = `${pendingCount} Menunggu Sync`;
    badgeBtn.title = "Klik untuk segera mengirim antrean ke Google Sheets";
  } else {
    badgeBtn.className = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition border bg-emerald-900/60 text-emerald-200 border-emerald-500/50 hover:bg-emerald-900";
    badgeIcon.className = "fa-solid fa-cloud-check text-xs text-emerald-300";
    badgeText.textContent = "Tersinkronkan";
    badgeBtn.title = "Semua data presensi telah tersinkronkan ke Google Sheets";
  }
}

// ================= LIVE TICKER =================
function startLiveTicker() {
  if (timerInterval) clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    const state = getAttendanceState();
    const now = Date.now();

    Object.keys(state).forEach(id => {
      const rec = normalizeRecord(state[id]);
      if (rec && rec.activeSession) {
        const timeLeftMs = rec.activeSession.targetEndTime - now;
        const elements = document.querySelectorAll(`.timer-display-${id}`);

        if (timeLeftMs <= 0) {
          selesaikanAbsen(parseInt(id, 10));
        } else {
          const timeFormatted = formatRemainingSeconds(timeLeftMs);
          elements.forEach(el => el.textContent = timeFormatted);
        }
      }
    });
  }, 1000);
}

// ================= SORTING PRIORITY =================
// Menempatkan yang piket hari ini & sedang aktif di paling atas
function sortBeswanList(list, todayHari, state) {
  return [...list].sort((a, b) => {
    const aRec = normalizeRecord(state[a.id]);
    const bRec = normalizeRecord(state[b.id]);

    const aIsActive = aRec.activeSession !== null;
    const bIsActive = bRec.activeSession !== null;

    const aIsTodayPiket = isBeswanPiketToday(a, todayHari);
    const bIsTodayPiket = isBeswanPiketToday(b, todayHari);

    const aHasAttended = aRec.sessions.length > 0;
    const bHasAttended = bRec.sessions.length > 0;

    // Bobot prioritas tampilan:
    // 1. Sedang aktif hitung mundur piket: 300
    // 2. Jadwal piket hari ini: 200
    // 3. Sudah ada sesi piket selesai hari ini: 100
    // 4. Lainnya: 0
    const aScore = (aIsActive ? 300 : 0) + (aIsTodayPiket ? 200 : 0) + (aHasAttended ? 100 : 0);
    const bScore = (bIsActive ? 300 : 0) + (bIsTodayPiket ? 200 : 0) + (bHasAttended ? 100 : 0);

    if (bScore !== aScore) {
      return bScore - aScore; // Skor tertinggi di posisi paling atas
    }

    return a.id - b.id; // Sekunder: urutkan nomor ID
  });
}

// ================= RENDERING LOGIC =================
function renderApp() {
  const todayHari = getTodayHariName();
  const state = getAttendanceState();

  let piketHariIniCount = 0;
  let activeCount = 0;
  let completedBeswanCount = 0;
  let totalCompletedSessions = 0;

  BESWAN_DATA.forEach(b => {
    const isToday = isBeswanPiketToday(b, todayHari);
    const rec = normalizeRecord(state[b.id]);

    if (isToday) piketHariIniCount++;
    if (rec.activeSession) activeCount++;
    if (rec.sessions.length > 0) {
      completedBeswanCount++;
      totalCompletedSessions += rec.sessions.length;
    }
  });

  const piketEl = document.getElementById('piketTodayCount');
  const compEl = document.getElementById('completedAttendanceCount');
  if (piketEl) piketEl.textContent = piketHariIniCount;
  if (compEl) {
    compEl.textContent = totalCompletedSessions > 0 ? `${completedBeswanCount} (${totalCompletedSessions} Sesi)` : '0';
  }

  // Update counter dinamis pada tombol filter
  const btnFilterSemua = document.getElementById('btnFilterSemua');
  const btnFilterHariIni = document.getElementById('btnFilterHariIni');
  const btnFilterAktif = document.getElementById('btnFilterAktif');
  const btnFilterHadir = document.getElementById('btnFilterHadir');

  if (btnFilterSemua) btnFilterSemua.textContent = `Semua (${BESWAN_DATA.length})`;
  if (btnFilterHariIni) btnFilterHariIni.innerHTML = `<i class="fa-regular fa-calendar-check text-kse-secondary"></i> Piket Hari Ini (${piketHariIniCount})`;
  if (btnFilterAktif) btnFilterAktif.innerHTML = `<i class="fa-regular fa-clock text-amber-600"></i> Berlangsung (${activeCount})`;
  if (btnFilterHadir) btnFilterHadir.innerHTML = `<i class="fa-regular fa-circle-check text-emerald-600"></i> Selesai (${completedBeswanCount})`;

  const filtered = BESWAN_DATA.filter(beswan => {
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch = !q ||
      beswan.nama.toLowerCase().includes(q) ||
      beswan.divisi.toLowerCase().includes(q);

    if (!matchesSearch) return false;

    const rec = normalizeRecord(state[beswan.id]);
    const isTodayPiket = isBeswanPiketToday(beswan, todayHari);
    const isActive = rec.activeSession !== null;
    const hasAttended = rec.sessions.length > 0;

    if (currentFilter === 'hari_ini') return isTodayPiket || isActive || hasAttended;
    if (currentFilter === 'aktif') return isActive;
    if (currentFilter === 'hadir') return hasAttended;

    return true;
  });

  // Saat filter 'semua' (atau default), yang piket hari ini SELALU muncul di paling atas!
  const sorted = sortBeswanList(filtered, todayHari, state);

  renderTable(sorted, todayHari, state);
  renderCards(sorted, todayHari, state);

  const emptyStateEl = document.getElementById('emptyState');
  if (emptyStateEl) {
    if (sorted.length === 0) emptyStateEl.classList.remove('hidden');
    else emptyStateEl.classList.add('hidden');
  }
}

function renderTable(data, todayHari, state) {
  const tbody = document.getElementById('beswanTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  data.forEach((beswan) => {
    const isTodayPiket = isBeswanPiketToday(beswan, todayHari);
    const isBPH = beswan.divisi.includes('BPH') || beswan.divisi.toLowerCase().includes('pengurus harian');
    const rec = normalizeRecord(state[beswan.id]);
    const active = rec.activeSession;
    const completedCount = rec.sessions.length;

    const tr = document.createElement('tr');
    tr.className = `transition-colors ${isTodayPiket ? 'row-piket-today font-medium' : 'hover:bg-gray-50'}`;

    let statusBadgeHtml = '';
    let actionBtnHtml = '';

    if (active) {
      const timeLeft = formatRemainingSeconds(active.targetEndTime - Date.now());
      statusBadgeHtml = `
        <div class="inline-flex flex-col items-center justify-center gap-0.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-50 text-amber-900 border border-amber-300">
          <div class="inline-flex items-center gap-1.5">
            <i class="fa-regular fa-clock text-amber-600"></i>
            <span>Piket ke-${active.session} (<span class="timer-display-${beswan.id} font-mono font-bold">${timeLeft}</span>)</span>
          </div>
          ${completedCount > 0 ? `<span class="text-[10px] text-amber-800 font-normal">Sesi sebelumnya: ${completedCount}x selesai</span>` : ''}
        </div>
      `;
      actionBtnHtml = `
        <button
          onclick="bukaModalBatalkan(${beswan.id})"
          class="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold text-rose-700 bg-white border border-rose-300 hover:bg-rose-50 transition"
          title="Batalkan piket sesi ini"
        >
          <i class="fa-solid fa-xmark text-xs"></i> Batalkan Sesi ${active.session}
        </button>
      `;
    } else if (completedCount >= MAX_PIKET_PER_DAY) {
      statusBadgeHtml = `
        <div class="inline-flex flex-col items-center justify-center text-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-100 text-emerald-900 border border-emerald-400 shadow-xs">
          <span class="inline-flex items-center gap-1 text-emerald-800 font-bold">
            <i class="fa-solid fa-circle-check text-emerald-600 text-[10px]"></i> 3/3 Piket (Lengkap)
          </span>
          <span class="text-[10px] text-emerald-700 font-medium">Maksimal Hari Ini Tercapai</span>
        </div>
      `;
      actionBtnHtml = `
        <button disabled class="w-full inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 cursor-not-allowed">
          <i class="fa-solid fa-check-double text-[11px]"></i> Selesai 3x
        </button>
      `;
    } else if (completedCount > 0) {
      const nextSession = completedCount + 1;
      const historySummary = rec.sessions.map(s => {
        const syncMark = s.synced ? '✓' : '⌛';
        return `S${s.session}:${(s.jamMasuk || '').substring(0, 5)}-${(s.jamSelesai || '').substring(0, 5)} ${syncMark}`;
      }).join(', ');
      statusBadgeHtml = `
        <div class="inline-flex flex-col items-center justify-center text-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-300">
          <span class="inline-flex items-center gap-1 text-emerald-700 font-bold">
            <i class="fa-solid fa-circle-check text-emerald-600 text-[10px]"></i> ${completedCount}/${MAX_PIKET_PER_DAY} Piket Selesai
          </span>
          <span class="text-[10px] text-gray-500 font-mono" title="${historySummary}">${historySummary}</span>
        </div>
      `;
      actionBtnHtml = `
        <button
          onclick="mulaiAbsen(${beswan.id})"
          class="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold text-kse-primary bg-[#FAF7CC] hover:bg-[#F5F1B5] border border-kse-secondary transition shadow-xs"
          title="Mulai sesi piket berikutnya"
        >
          <i class="fa-solid fa-plus text-kse-primary text-xs"></i> Piket ke-${nextSession} (1 Jam)
        </button>
      `;
    } else {
      statusBadgeHtml = `
        <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
          <span class="w-1.5 h-1.5 rounded-full bg-gray-400"></span>
          <span>Belum Piket (0/${MAX_PIKET_PER_DAY})</span>
        </div>
      `;
      actionBtnHtml = `
        <button
          onclick="mulaiAbsen(${beswan.id})"
          class="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold text-white bg-kse-primary hover:bg-kse-darkGreen transition shadow-xs"
        >
          <i class="fa-solid fa-right-to-bracket text-kse-secondary text-xs"></i> Masuk
        </button>
      `;
    }

    const hariBadgesHtml = renderJadwalBadges(beswan.hari_piket, todayHari);

    tr.innerHTML = `
      <td class="py-3 px-4 text-center text-xs text-gray-500 font-medium">${beswan.id}</td>
      <td class="py-3 px-4">
        <div class="flex flex-col items-start gap-1">
          <span class="font-semibold text-gray-900 leading-snug break-words">${beswan.nama}</span>
          <div class="flex flex-wrap items-center gap-1">
            ${isTodayPiket ? '<span class="inline-block text-[10px] bg-kse-secondary/20 text-kse-earth px-1.5 py-0.2 rounded font-semibold border border-kse-secondary/40">Piket Hari Ini</span>' : ''}
            ${isBPH ? '<span class="inline-block text-[10px] font-bold bg-amber-50 text-amber-900 px-1.5 py-0.2 rounded border border-amber-300" title="BPH diwajibkan piket 3x seminggu"><i class="fa-solid fa-shield-halved text-kse-secondary text-[9px]"></i> BPH</span>' : ''}
          </div>
        </div>
      </td>
      <td class="py-3 px-4 text-gray-600 text-xs">
        <span class="leading-snug break-words" title="${beswan.divisi}">${beswan.divisi}</span>
      </td>
      <td class="py-3 px-4 text-center">${hariBadgesHtml}</td>
      <td class="py-3 px-4 text-center">${statusBadgeHtml}</td>
      <td class="py-3 px-4 text-center">${actionBtnHtml}</td>
    `;

    tbody.appendChild(tr);
  });
}

function renderCards(data, todayHari, state) {
  const container = document.getElementById('beswanMobileList');
  if (!container) return;
  container.innerHTML = '';

  data.forEach((beswan) => {
    const isTodayPiket = isBeswanPiketToday(beswan, todayHari);
    const isBPH = beswan.divisi.includes('BPH') || beswan.divisi.toLowerCase().includes('pengurus harian');
    const rec = normalizeRecord(state[beswan.id]);
    const active = rec.activeSession;
    const completedCount = rec.sessions.length;

    const card = document.createElement('div');
    card.className = `p-4 rounded-xl border transition-all ${isTodayPiket
        ? 'bg-[#FAF7CC]/40 border-kse-primary/40 shadow-xs'
        : 'bg-white border-gray-200 shadow-xs'
      }`;

    let statusBadge = '';
    let actionBtn = '';

    if (active) {
      const timeLeft = formatRemainingSeconds(active.targetEndTime - Date.now());
      statusBadge = `
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-50 text-amber-900 border border-amber-300">
          <i class="fa-regular fa-clock text-amber-600"></i>
          <span>Piket ke-${active.session}: <span class="timer-display-${beswan.id} font-mono font-bold">${timeLeft}</span></span>
        </span>
      `;
      actionBtn = `
        <button
          onclick="bukaModalBatalkan(${beswan.id})"
          class="w-full py-2 px-3 rounded-lg text-xs font-semibold text-rose-700 bg-rose-50/50 hover:bg-rose-50 border border-rose-200 flex items-center justify-center gap-2 active:scale-[0.99] transition"
        >
          <i class="fa-solid fa-xmark text-xs"></i> Batalkan Sesi ${active.session}
        </button>
      `;
    } else if (completedCount >= MAX_PIKET_PER_DAY) {
      statusBadge = `
        <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-100 text-emerald-900 border border-emerald-400">
          <i class="fa-solid fa-circle-check text-emerald-600"></i> 3/3 Selesai (Lengkap)
        </span>
      `;
      actionBtn = `
        <button disabled class="w-full py-2 px-3 rounded-lg text-xs font-semibold text-emerald-800 bg-emerald-50/60 border border-emerald-200 cursor-not-allowed flex items-center justify-center gap-2">
          <i class="fa-solid fa-check-double text-emerald-600"></i> Selesai (Maksimal 3x Piket Hari Ini)
        </button>
      `;
    } else if (completedCount > 0) {
      const nextSession = completedCount + 1;
      statusBadge = `
        <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-300">
          <i class="fa-solid fa-circle-check text-emerald-600"></i> ${completedCount}/${MAX_PIKET_PER_DAY} Selesai
        </span>
      `;
      actionBtn = `
        <button
          onclick="mulaiAbsen(${beswan.id})"
          class="w-full py-2.5 px-3 rounded-lg text-xs font-bold text-kse-primary bg-[#FAF7CC] hover:bg-[#F5F1B5] border border-kse-secondary active:scale-[0.99] flex items-center justify-center gap-2 shadow-xs transition"
        >
          <i class="fa-solid fa-plus text-kse-primary"></i> + Mulai Piket ke-${nextSession} (1 Jam)
        </button>
      `;
    } else {
      statusBadge = `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-gray-100 text-gray-600 border border-gray-200">
          Belum Piket (0/${MAX_PIKET_PER_DAY})
        </span>
      `;
      actionBtn = `
        <button
          onclick="mulaiAbsen(${beswan.id})"
          class="w-full py-2.5 px-3 rounded-lg text-xs font-bold text-white bg-kse-primary hover:bg-kse-darkGreen active:scale-[0.99] flex items-center justify-center gap-2 shadow-xs transition"
        >
          <i class="fa-solid fa-right-to-bracket text-kse-secondary"></i> Absen Masuk
        </button>
      `;
    }

    let historyHtml = '';
    if (completedCount > 0) {
      const sessionTags = rec.sessions.map(s => `
        <span class="text-[10px] ${s.synced ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-amber-50 text-amber-900 border-amber-300'} px-1.5 py-0.5 rounded border font-mono inline-flex items-center gap-1">
          <span>Sesi ${s.session}: ${(s.jamMasuk || '').substring(0, 5)} - ${(s.jamSelesai || '').substring(0, 5)}</span>
          ${s.synced ? '<i class="fa-solid fa-check text-[9px] text-emerald-600" title="Tersinkron ke Google Sheets"></i>' : '<i class="fa-solid fa-cloud-arrow-up text-[9px] text-amber-600 animate-pulse" title="Menunggu sinkronisasi"></i>'}
        </span>
      `).join('');
      historyHtml = `
        <div class="flex flex-wrap items-center gap-1.5 py-1 text-xs">
          <span class="text-[11px] text-gray-500">Riwayat:</span>
          ${sessionTags}
        </div>
      `;
    }

    card.innerHTML = `
      <div class="flex items-start justify-between gap-3 mb-2">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5 mb-0.5">
            <span class="text-[10px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">#${beswan.id}</span>
            <h4 class="text-xs font-bold text-gray-900 leading-snug break-words">${beswan.nama}</h4>
          </div>
          <div class="flex flex-wrap items-center gap-1">
            <p class="text-[11px] text-gray-500 leading-tight break-words">${beswan.divisi}</p>
            ${isBPH ? '<span class="inline-block text-[10px] font-bold bg-amber-50 text-amber-900 px-1.5 py-0.2 rounded border border-amber-300">BPH</span>' : ''}
          </div>
        </div>
        <div class="shrink-0">
          ${statusBadge}
        </div>
      </div>

      <div class="flex items-center justify-between text-xs py-1.5 border-t border-gray-100 my-1">
        <span class="text-gray-500 text-[11px] shrink-0 mr-2">Jadwal Piket:</span>
        ${renderMobileJadwalBadges(beswan.hari_piket, todayHari)}
      </div>

      ${historyHtml}

      <div class="mt-2.5">
        ${actionBtn}
      </div>
    `;

    container.appendChild(card);
  });
}

// ================= SEARCH & FILTER CONTROLS =================
function setupSearch() {
  const input = document.getElementById('searchInput');
  const clearBtn = document.getElementById('clearSearchBtn');
  if (!input) return;

  input.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    if (clearBtn) {
      if (searchQuery.length > 0) clearBtn.classList.remove('hidden');
      else clearBtn.classList.add('hidden');
    }
    renderApp();
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      input.value = '';
      searchQuery = '';
      clearBtn.classList.add('hidden');
      renderApp();
      input.focus();
    });
  }
}

function setFilter(filterType) {
  currentFilter = filterType;

  const filterButtons = {
    semua: document.getElementById('btnFilterSemua'),
    hari_ini: document.getElementById('btnFilterHariIni'),
    aktif: document.getElementById('btnFilterAktif'),
    hadir: document.getElementById('btnFilterHadir')
  };

  Object.keys(filterButtons).forEach(key => {
    const btn = filterButtons[key];
    if (!btn) return;
    if (key === filterType) {
      btn.className = "filter-pill px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide transition border bg-kse-primary text-white border-kse-primary shadow-xs flex items-center gap-1.5";
    } else {
      btn.className = "filter-pill px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide transition border bg-gray-50 text-gray-700 hover:bg-gray-100 border-gray-300 flex items-center gap-1.5";
    }
  });

  renderApp();
}

// ================= TOAST NOTIFICATION =================
let toastTimeout = null;

function showToast(message, type = 'info') {
  const toast = document.getElementById('toastNotification');
  const msgEl = document.getElementById('toastMessage');
  const iconEl = document.getElementById('toastIcon');
  if (!toast || !msgEl || !iconEl) return;

  msgEl.textContent = message;

  if (type === 'success') {
    toast.className = "transform transition-all duration-300 ease-out bg-emerald-700 text-white px-5 py-3.5 rounded-xl shadow-lg flex items-center justify-between";
    iconEl.className = "fa-solid fa-circle-check text-white text-lg";
  } else if (type === 'warning') {
    toast.className = "transform transition-all duration-300 ease-out bg-amber-600 text-white px-5 py-3.5 rounded-xl shadow-lg flex items-center justify-between";
    iconEl.className = "fa-solid fa-triangle-exclamation text-white text-lg";
  } else if (type === 'error') {
    toast.className = "transform transition-all duration-300 ease-out bg-rose-700 text-white px-5 py-3.5 rounded-xl shadow-lg flex items-center justify-between";
    iconEl.className = "fa-solid fa-circle-xmark text-white text-lg";
  } else {
    toast.className = "transform transition-all duration-300 ease-out bg-kse-primary text-white px-5 py-3.5 rounded-xl shadow-lg flex items-center justify-between";
    iconEl.className = "fa-solid fa-circle-info text-kse-secondary text-lg";
  }

  toast.classList.remove('hidden');

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => hideToast(), 5000);
}

function hideToast() {
  const toast = document.getElementById('toastNotification');
  if (toast) toast.classList.add('hidden');
}
