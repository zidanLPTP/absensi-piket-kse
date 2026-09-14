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

// ================= LIFECYCLE & INIT =================
document.addEventListener('DOMContentLoaded', () => {
  initClockAndDates();
  setupSearch();
  renderApp();
  startLiveTicker();
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

// ================= ABSENSI ACTIONS =================
let pendingCancelId = null;

function mulaiAbsen(id) {
  const beswan = BESWAN_DATA.find(b => b.id === id);
  if (!beswan) return;

  const state = getAttendanceState();
  const now = new Date();

  state[id] = {
    status: 'countdown',
    startTime: now.getTime(),
    targetEndTime: now.getTime() + (COUNTDOWN_DURATION_SECONDS * 1000),
    jamMasuk: now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    tanggal: getTodayDateKey(),
    synced: false
  };

  saveAttendanceState(state);
  showToast(`Presensi dimulai untuk ${beswan.nama}. Timer 60 menit berjalan.`, 'info');
  renderApp();
}

function bukaModalBatalkan(id) {
  const beswan = BESWAN_DATA.find(b => b.id === id);
  if (!beswan) return;

  pendingCancelId = id;
  const modal = document.getElementById('cancelConfirmModal');
  const desc = document.getElementById('cancelModalDesc');
  const confirmBtn = document.getElementById('confirmCancelActionBtn');

  if (desc) {
    desc.innerHTML = `Yakin ingin membatalkan presensi untuk <strong>${beswan.nama}</strong>? Timer akan dihentikan dan status kembali menjadi Belum Hadir.`;
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
  if (state[id]) {
    delete state[id];
    saveAttendanceState(state);
  }

  closeCancelModal();
  showToast(`Presensi untuk ${nama} telah dibatalkan.`, 'warning');
  renderApp();
}

// Backward compatibility helper
function batalkanAbsen(id) {
  bukaModalBatalkan(id);
}

function selesaikanAbsen(id) {
  const state = getAttendanceState();
  const record = state[id];
  const beswan = BESWAN_DATA.find(b => b.id === id);

  if (!record || record.status === 'selesai') return;

  const now = new Date();
  const jamSelesai = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  record.status = 'selesai';
  record.jamSelesai = jamSelesai;
  record.synced = false;
  saveAttendanceState(state);

  renderApp();
  showToast(`Selamat! ${beswan.nama} sah piket selama 1 jam penuh. Sinkronisasi data...`, 'success');

  syncToGoogleSheets(beswan, record);
}

// ================= SYNC TO GOOGLE SHEETS =================
async function syncToGoogleSheets(beswan, record) {
  if (!GOOGLE_SCRIPT_URL || GOOGLE_SCRIPT_URL === "ISI_URL_WEB_APP_DISINI") {
    console.warn("URL Google Apps Script belum dikonfigurasi.");
    showToast(`Tercatat Hadir Lokal: ${beswan.nama}. (Harap konfigurasi GOOGLE_SCRIPT_URL).`, 'warning');
    return;
  }

  const payload = {
    id: beswan.id,
    nama: beswan.nama,
    divisi: beswan.divisi,
    hari_piket: beswan.hari_piket,
    tanggal: record.tanggal || getTodayDateKey(),
    jam_masuk: record.jamMasuk,
    jam_selesai: record.jamSelesai,
    status: "Hadir"
  };

  try {
    await fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const state = getAttendanceState();
    if (state[beswan.id]) {
      state[beswan.id].synced = true;
      saveAttendanceState(state);
    }
    showToast(`Data presensi ${beswan.nama} berhasil disinkronkan ke Google Sheets!`, 'success');
    renderApp();
  } catch (error) {
    console.error("Gagal sinkronisasi Google Sheets:", error);
    showToast(`Gagal mengirim data ke Sheets untuk ${beswan.nama}. Tersimpan di memori browser.`, 'error');
  }
}

// ================= LIVE TICKER =================
function startLiveTicker() {
  if (timerInterval) clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    const state = getAttendanceState();
    const now = Date.now();

    Object.keys(state).forEach(id => {
      const rec = state[id];
      if (rec && rec.status === 'countdown') {
        const timeLeftMs = rec.targetEndTime - now;
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

// ================= RENDERING LOGIC =================
function renderApp() {
  const todayHari = getTodayHariName();
  const state = getAttendanceState();

  let piketHariIniCount = 0;
  let completedCount = 0;

  BESWAN_DATA.forEach(b => {
    if (b.hari_piket.toLowerCase() === todayHari.toLowerCase()) piketHariIniCount++;
    if (state[b.id] && state[b.id].status === 'selesai') completedCount++;
  });

  const piketEl = document.getElementById('piketTodayCount');
  const compEl = document.getElementById('completedAttendanceCount');
  if (piketEl) piketEl.textContent = piketHariIniCount;
  if (compEl) compEl.textContent = completedCount;

  const filtered = BESWAN_DATA.filter(beswan => {
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch = !q ||
      beswan.nama.toLowerCase().includes(q) ||
      beswan.divisi.toLowerCase().includes(q);

    if (!matchesSearch) return false;

    const beswanState = state[beswan.id];
    const isTodayPiket = beswan.hari_piket.toLowerCase() === todayHari.toLowerCase();

    if (currentFilter === 'hari_ini') return isTodayPiket;
    if (currentFilter === 'aktif') return beswanState && beswanState.status === 'countdown';
    if (currentFilter === 'hadir') return beswanState && beswanState.status === 'selesai';

    return true;
  });

  renderTable(filtered, todayHari, state);
  renderCards(filtered, todayHari, state);

  const emptyStateEl = document.getElementById('emptyState');
  if (emptyStateEl) {
    if (filtered.length === 0) emptyStateEl.classList.remove('hidden');
    else emptyStateEl.classList.add('hidden');
  }
}

function renderTable(data, todayHari, state) {
  const tbody = document.getElementById('beswanTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  data.forEach((beswan) => {
    const isTodayPiket = beswan.hari_piket.toLowerCase() === todayHari.toLowerCase();
    const rec = state[beswan.id];
    const status = rec ? rec.status : 'idle';

    const tr = document.createElement('tr');
    tr.className = `transition-colors ${isTodayPiket ? 'row-piket-today font-medium' : 'hover:bg-gray-50'
      }`;

    let statusBadgeHtml = '';
    let actionBtnHtml = '';

    if (status === 'countdown') {
      const timeLeft = formatRemainingSeconds(rec.targetEndTime - Date.now());
      statusBadgeHtml = `
        <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-50 text-amber-900 border border-amber-300">
          <i class="fa-regular fa-clock text-kse-secondary"></i>
          <span>Piket (<span class="timer-display-${beswan.id} font-mono font-bold">${timeLeft}</span>)</span>
        </div>
      `;
      actionBtnHtml = `
        <button
          onclick="bukaModalBatalkan(${beswan.id})"
          class="w-full inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-rose-700 bg-white border border-rose-300 hover:bg-rose-50 transition"
          title="Batalkan presensi jika beswan meninggalkan sekretariat"
        >
          <i class="fa-solid fa-xmark text-[11px]"></i> Batalkan
        </button>
      `;
    } else if (status === 'selesai') {
      statusBadgeHtml = `
        <div class="inline-flex flex-col items-center justify-center text-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-300">
          <span class="inline-flex items-center gap-1 text-emerald-700 font-bold">
            <i class="fa-solid fa-check text-[10px]"></i> Hadir (Sah)
          </span>
          <span class="text-[10px] text-gray-500 font-mono">${rec.jamMasuk || ''} - ${rec.jamSelesai || ''}</span>
        </div>
      `;
      actionBtnHtml = `
        <button disabled class="w-full inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-gray-400 bg-gray-100 border border-gray-200 cursor-not-allowed">
          <i class="fa-solid fa-check text-[10px]"></i> Selesai
        </button>
      `;
    } else {
      statusBadgeHtml = `
        <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
          <span class="w-1.5 h-1.5 rounded-full bg-gray-400"></span>
          <span>Belum Hadir</span>
        </div>
      `;
      actionBtnHtml = `
        <button
          onclick="mulaiAbsen(${beswan.id})"
          class="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-white bg-kse-primary hover:bg-kse-darkGreen transition shadow-xs"
        >
          <i class="fa-solid fa-right-to-bracket text-kse-secondary text-[11px]"></i> Masuk
        </button>
      `;
    }

    const hariBadge = isTodayPiket
      ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-kse-primary text-white">
           <i class="fa-solid fa-star text-kse-secondary text-[10px]"></i> ${beswan.hari_piket}
         </span>`
      : `<span class="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
           ${beswan.hari_piket}
         </span>`;

    tr.innerHTML = `
      <td class="py-3 px-4 text-center text-xs text-gray-500 font-medium">${beswan.id}</td>
      <td class="py-3 px-4">
        <div class="flex flex-col items-start gap-1">
          <span class="font-semibold text-gray-900 leading-snug break-words">${beswan.nama}</span>
          ${isTodayPiket ? '<span class="inline-block text-[10px] bg-kse-secondary/20 text-kse-earth px-1.5 py-0.2 rounded font-semibold border border-kse-secondary/40">Piket Hari Ini</span>' : ''}
        </div>
      </td>
      <td class="py-3 px-4 text-gray-600 text-xs">
        <span class="leading-snug break-words" title="${beswan.divisi}">${beswan.divisi}</span>
      </td>
      <td class="py-3 px-4 text-center">${hariBadge}</td>
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
    const isTodayPiket = beswan.hari_piket.toLowerCase() === todayHari.toLowerCase();
    const rec = state[beswan.id];
    const status = rec ? rec.status : 'idle';

    const card = document.createElement('div');
    card.className = `p-3.5 rounded-lg border transition-all ${isTodayPiket
        ? 'bg-[#FAF7CC]/60 border-kse-primary shadow-xs'
        : 'bg-white border-gray-200'
      }`;

    let statusBadge = '';
    let actionBtn = '';

    if (status === 'countdown') {
      const timeLeft = formatRemainingSeconds(rec.targetEndTime - Date.now());
      statusBadge = `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-900 border border-amber-300">
          <i class="fa-regular fa-clock text-kse-secondary"></i>
          <span class="timer-display-${beswan.id} font-mono font-bold">${timeLeft}</span>
        </span>
      `;
      actionBtn = `
        <button
          onclick="bukaModalBatalkan(${beswan.id})"
          class="w-full py-1.5 px-3 rounded-md text-xs font-semibold text-rose-700 bg-white border border-rose-300 hover:bg-rose-50 flex items-center justify-center gap-1.5"
        >
          <i class="fa-solid fa-xmark text-xs"></i> Batalkan Presensi
        </button>
      `;
    } else if (status === 'selesai') {
      statusBadge = `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
          <i class="fa-solid fa-check text-emerald-600"></i> Hadir (60m)
        </span>
      `;
      actionBtn = `
        <button disabled class="w-full py-1.5 px-3 rounded-md text-xs font-semibold text-gray-400 bg-gray-100 border border-gray-200 cursor-not-allowed flex items-center justify-center gap-1.5">
          <i class="fa-solid fa-check"></i> Selesai (${rec.jamMasuk || ''} - ${rec.jamSelesai || ''})
        </button>
      `;
    } else {
      statusBadge = `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
          Belum Hadir
        </span>
      `;
      actionBtn = `
        <button
          onclick="mulaiAbsen(${beswan.id})"
          class="w-full py-2 px-3 rounded-md text-xs font-semibold text-white bg-kse-primary hover:bg-kse-darkGreen flex items-center justify-center gap-1.5 shadow-xs"
        >
          <i class="fa-solid fa-right-to-bracket text-kse-secondary"></i> Absen Masuk (1 Jam)
        </button>
      `;
    }

    card.innerHTML = `
      <div class="flex items-start justify-between gap-2 mb-2">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <span class="text-[11px] font-bold text-gray-400">#${beswan.id}</span>
            <h4 class="text-xs font-bold text-gray-900 truncate">${beswan.nama}</h4>
          </div>
          <p class="text-[11px] text-gray-500 mt-0.5 truncate">${beswan.divisi}</p>
        </div>
        <div class="shrink-0">
          ${statusBadge}
        </div>
      </div>

      <div class="flex items-center justify-between text-[11px] py-1.5 border-t border-gray-100 my-1.5">
        <span class="text-gray-500">Jadwal Piket:</span>
        ${isTodayPiket
        ? `<span class="font-bold text-kse-primary bg-kse-secondary/30 px-1.5 py-0.2 rounded flex items-center gap-1 border border-kse-secondary/50">
                 <i class="fa-solid fa-star text-kse-earth text-[9px]"></i> ${beswan.hari_piket} (Hari Ini)
               </span>`
        : `<span class="font-medium text-gray-700">${beswan.hari_piket}</span>`
      }
      </div>

      <div class="mt-2">
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
      btn.className = "filter-pill px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide transition border bg-kse-primary text-white border-kse-primary shadow-xs";
    } else {
      btn.className = "filter-pill px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide transition border bg-gray-50 text-gray-700 hover:bg-gray-100 border-gray-300";
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
