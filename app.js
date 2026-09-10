'use strict';

// ===== State =====
const state = {
  files: [],
  images: [],
  currentIdx: 0,
  location: { text: null, lat: null, lng: null, source: 'gps' },
  settings: {
    dateEnabled: true,
    dateMode: 'auto',
    customDate: null,
    dateFormat: 'DD MMM YYYY HH:mm TZ',
    locEnabled: true,
    locMode: 'gps',
    manualLoc: '',
    coordsLat: null,
    coordsLng: null,
    coordsGeocodedName: null,
    coordsUseGeocode: true,
    wmTemplate: '{tanggal}\n\u{1F4CD} {lokasi}\n{koordinat}',  // default template
    fontSize: 28,
    color: '#ffffff',
    bgColor: '#000000',
    bgOpacity: 60,
    position: 'bottom-left',
    margin: 20,
    preset: 'modern',
  }
};

// ===== DOM refs =====
const $ = id => document.getElementById(id);
const dropzone = $('dropzone');
const fileInput = $('file-input');
const dropzoneContent = $('dropzone-content');
const canvasWrapper = $('canvas-wrapper');
const canvas = $('preview-canvas');
const ctx = canvas.getContext('2d');
const thumbnailStrip = $('thumbnail-strip');
const batchInfo = $('batch-info');
const batchCount = $('batch-count');
const navLabel = $('nav-label');
const btnPrev = $('btn-prev');
const btnNext = $('btn-next');
const downloadOverlay = $('download-overlay');
const downloadBar = $('download-bar');
const downloadProgressText = $('download-progress-text');

// ===== Months (Indonesian) =====
const MONTHS = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
const MONTHS_FULL = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const DAYS = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];

// ===== Date Formatting =====
function formatDate(date, format) {
  const pad = n => String(n).padStart(2, '0');
  const d = date;
  const replacements = {
    'YYYY': d.getFullYear(),
    'MM': pad(d.getMonth() + 1),
    'DD': pad(d.getDate()),
    'HH': pad(d.getHours()),
    'mm': pad(d.getMinutes()),
    'ss': pad(d.getSeconds()),
    'MMM': MONTHS[d.getMonth()],
    'MMMM': MONTHS_FULL[d.getMonth()],
    'dddd': DAYS[d.getDay()],
    'TZ': (function() {
      const offset = d.getTimezoneOffset();
      if (offset === -420) return 'WIB';
      if (offset === -480) return 'WITA';
      if (offset === -540) return 'WIT';
      const sign = offset > 0 ? '-' : '+';
      const hours = pad(Math.floor(Math.abs(offset) / 60));
      return `UTC${sign}${hours}`;
    })()
  };
  let result = format;
  // Order matters - replace longer patterns first
  ['dddd','MMMM','MMM','YYYY','MM','DD','HH','mm','ss','TZ'].forEach(k => {
    result = result.replace(k, replacements[k]);
  });
  return result;
}

// ===== Parse EXIF date =====
function parseExifDate(str) {
  if (!str) return null;
  // EXIF format: "YYYY:MM:DD HH:MM:SS"
  const m = str.match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (m) return new Date(m[1], m[2]-1, m[3], m[4], m[5], m[6]);
  return null;
}

// ===== EXIF Reader (minimal, pure JS) =====
function readExif(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = function(e) {
      const buf = e.target.result;
      const view = new DataView(buf);
      const exif = {};
      try {
        if (view.getUint16(0) !== 0xFFD8) { resolve(exif); return; }
        let offset = 2;
        while (offset < buf.byteLength) {
          if (view.getUint8(offset) !== 0xFF) break;
          const marker = view.getUint16(offset);
          if (marker === 0xFFE1) {
            // APP1 - EXIF
            const len = view.getUint16(offset + 2);
            const exifData = new DataView(buf, offset + 4, len - 2);
            if (String.fromCharCode(...new Uint8Array(buf, offset + 4, 4)) === 'Exif') {
              parseExifIFD(exifData, exif);
            }
            offset += 2 + len;
          } else if ((marker & 0xFF00) === 0xFF00 && marker !== 0xFFDA) {
            offset += 2 + view.getUint16(offset + 2);
          } else break;
        }
      } catch(err) { /* ignore */ }
      resolve(exif);
    };
    reader.onerror = () => resolve({});
    reader.readAsArrayBuffer(file.slice(0, 64 * 1024)); // read first 64KB
  });
}

function parseExifIFD(view, exif) {
  try {
    const littleEndian = view.getUint16(6) === 0x4949;
    const ifdOffset = view.getUint32(10, littleEndian) + 6;
    const numEntries = view.getUint16(ifdOffset, littleEndian);
    for (let i = 0; i < numEntries; i++) {
      const entryOffset = ifdOffset + 2 + i * 12;
      const tag = view.getUint16(entryOffset, littleEndian);
      const type = view.getUint16(entryOffset + 2, littleEndian);
      const count = view.getUint32(entryOffset + 4, littleEndian);
      let valOffset = entryOffset + 8;
      if (type === 2) { // ASCII string
        const strOffset = count > 4 ? view.getUint32(valOffset, littleEndian) + 6 : valOffset;
        let str = '';
        for (let c = 0; c < count - 1; c++) {
          str += String.fromCharCode(view.getUint8(strOffset + c));
        }
        if (tag === 0x0132) exif.DateTime = str;
        if (tag === 0x9003) exif.DateTimeOriginal = str;
        if (tag === 0x9291) exif.SubSecTimeOriginal = str;
      } else if (type === 5) { // RATIONAL
        const ratOffset = view.getUint32(valOffset, littleEndian) + 6;
        const toRat = (off) => view.getUint32(off, littleEndian) / view.getUint32(off + 4, littleEndian);
        if (tag === 0x8825) {
          // GPS IFD pointer - recurse
          const gpsOffset = view.getUint32(valOffset, littleEndian) + 6;
          parseGpsIFD(view, gpsOffset, exif, littleEndian);
        } else if (tag === 0x0002) { // GPSLatitude
          exif.GPSLatitude = [toRat(ratOffset), toRat(ratOffset+8), toRat(ratOffset+16)];
        } else if (tag === 0x0004) { // GPSLongitude
          exif.GPSLongitude = [toRat(ratOffset), toRat(ratOffset+8), toRat(ratOffset+16)];
        }
      } else if (tag === 0x8825 && type === 4) { // LONG - GPS IFD pointer
        const gpsOffset = view.getUint32(valOffset, littleEndian) + 6;
        parseGpsIFD(view, gpsOffset, exif, littleEndian);
      }
    }
  } catch(e) { /* ignore */ }
}

function parseGpsIFD(view, ifdOffset, exif, littleEndian) {
  try {
    const numEntries = view.getUint16(ifdOffset, littleEndian);
    for (let i = 0; i < numEntries; i++) {
      const entryOffset = ifdOffset + 2 + i * 12;
      const tag = view.getUint16(entryOffset, littleEndian);
      const type = view.getUint16(entryOffset + 2, littleEndian);
      const count = view.getUint32(entryOffset + 4, littleEndian);
      const valOffset = entryOffset + 8;
      if (type === 2) { // ASCII
        const strOffset = count > 4 ? view.getUint32(valOffset, littleEndian) + 6 : valOffset;
        let str = '';
        for (let c = 0; c < count - 1; c++) str += String.fromCharCode(view.getUint8(strOffset + c));
        if (tag === 1) exif.GPSLatitudeRef = str;
        if (tag === 3) exif.GPSLongitudeRef = str;
      } else if (type === 5) { // RATIONAL
        const ratOffset = view.getUint32(valOffset, littleEndian) + 6;
        const toRat = (off) => view.getUint32(off, littleEndian) / view.getUint32(off + 4, littleEndian);
        if (tag === 2) exif.GPSLatitude = [toRat(ratOffset), toRat(ratOffset+8), toRat(ratOffset+16)];
        if (tag === 4) exif.GPSLongitude = [toRat(ratOffset), toRat(ratOffset+8), toRat(ratOffset+16)];
      }
    }
  } catch(e) { /* ignore */ }
}

function gpsToDecimal(coords, ref) {
  if (!coords) return null;
  let val = coords[0] + coords[1]/60 + coords[2]/3600;
  if (ref === 'S' || ref === 'W') val = -val;
  return val;
}

// ===== Reverse Geocoding =====
async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14&accept-language=id`;
    const res = await fetch(url, { headers: { 'User-Agent': 'WatermarkPro/1.0' } });
    const data = await res.json();
    const a = data.address || {};
    const parts = [
      a.village || a.town || a.suburb || a.neighbourhood || a.city_district,
      a.city || a.county || a.municipality,
      a.state || a.region,
      a.country
    ].filter(Boolean);
    // Limit to 3 most specific parts
    return parts.slice(0, 3).join(', ');
  } catch(e) {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
}

// ===== GPS Detection =====
async function detectGPS() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolokasi tidak didukung'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000
    });
  });
}

async function fetchUserLocation() {
  const dot = document.querySelector('.gps-dot');
  const label = $('gps-label');
  const coordsDiv = $('coords-display');
  const coordsGroup = $('location-coords');

  dot.className = 'gps-dot';
  label.textContent = 'Mendeteksi lokasi...';

  try {
    const pos = await detectGPS();
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    state.location.lat = lat;
    state.location.lng = lng;
    state.location.source = 'gps';

    dot.classList.add('active');
    label.textContent = 'Lokasi terdeteksi';
    coordsGroup.style.display = 'flex';
    coordsDiv.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

    showToast('Mendeteksi nama lokasi...', 'info');
    const locName = await reverseGeocode(lat, lng);
    state.location.text = locName;
    label.textContent = locName;
    showToast(`📍 ${locName}`, 'success');

    if (state.images.length > 0) renderWatermark();
  } catch(err) {
    dot.classList.add('error');
    const msg = err.code === 1 ? 'Akses lokasi ditolak' : 'Gagal mendeteksi lokasi';
    label.textContent = msg;
    state.location.text = null;
    showToast(`⚠️ ${msg}. Gunakan mode manual.`, 'error');
  }
}

// ===== Image Loading =====
async function loadImages(files) {
  const validFiles = [...files].filter(f => f.type.match(/^image\/(jpeg|png|webp)$/));
  if (validFiles.length === 0) {
    showToast('Format tidak didukung. Gunakan JPG, PNG, atau WebP.', 'error');
    return;
  }

  const oversized = validFiles.filter(f => f.size > 20 * 1024 * 1024);
  if (oversized.length > 0) {
    showToast(`${oversized.length} file melebihi 20MB dan dilewati.`, 'error');
  }

  const okFiles = validFiles.filter(f => f.size <= 20 * 1024 * 1024);
  if (okFiles.length === 0) return;

  showToast(`Memuat ${okFiles.length} foto...`, 'info');

  for (const file of okFiles) {
    const img = new Image();
    const url = URL.createObjectURL(file);
    await new Promise((res) => {
      img.onload = res;
      img.onerror = res;
      img.src = url;
    });
    const exifData = await readExif(file);
    state.images.push({ file, img, url, exifData });
  }

  state.currentIdx = 0;
  updateUI();
  showToast(`${okFiles.length} foto berhasil dimuat!`, 'success');

  // Auto-detect GPS if mode = gps
  if (state.settings.locMode === 'gps' && !state.location.text) {
    fetchUserLocation();
  }
}

// ===== Update UI =====
function updateUI() {
  if (state.images.length === 0) {
    dropzone.style.display = 'flex';
    canvasWrapper.style.display = 'none';
    thumbnailStrip.style.display = 'none';
    batchInfo.style.display = 'none';
    return;
  }

  dropzone.style.display = 'none';
  canvasWrapper.style.display = 'flex';

  if (state.images.length > 1) {
    thumbnailStrip.style.display = 'flex';
    batchInfo.style.display = 'flex';
    batchCount.textContent = `${state.images.length} foto`;
    $('btn-download-all').style.display = 'flex';
    btnPrev.disabled = state.currentIdx === 0;
    btnNext.disabled = state.currentIdx === state.images.length - 1;
    navLabel.textContent = `${state.currentIdx + 1} / ${state.images.length}`;
  } else {
    thumbnailStrip.style.display = 'none';
    batchInfo.style.display = 'none';
    $('btn-download-all').style.display = 'none';
    btnPrev.disabled = true;
    btnNext.disabled = true;
    navLabel.textContent = '1 / 1';
  }

  renderThumbnails();
  renderWatermark();
}

// ===== Render Thumbnails =====
function renderThumbnails() {
  thumbnailStrip.innerHTML = '';
  state.images.forEach((item, idx) => {
    const div = document.createElement('div');
    div.className = `thumb-item ${idx === state.currentIdx ? 'active' : ''}`;
    div.onclick = () => { state.currentIdx = idx; updateUI(); };
    const img = document.createElement('img');
    img.src = item.url;
    img.alt = item.file.name;
    const rmBtn = document.createElement('button');
    rmBtn.className = 'thumb-remove';
    rmBtn.textContent = '×';
    rmBtn.title = 'Hapus foto ini';
    rmBtn.onclick = (e) => {
      e.stopPropagation();
      URL.revokeObjectURL(item.url);
      state.images.splice(idx, 1);
      if (state.currentIdx >= state.images.length) state.currentIdx = Math.max(0, state.images.length - 1);
      updateUI();
    };
    div.append(img, rmBtn);
    thumbnailStrip.appendChild(div);
  });
}

// ===== Get Current Date for Watermark =====
function getWatermarkDate(item) {
  const { dateMode, customDate, dateFormat } = state.settings;
  let date;
  if (dateMode === 'auto') {
    date = new Date();
  } else if (dateMode === 'exif') {
    const exifDate = item.exifData?.DateTimeOriginal || item.exifData?.DateTime;
    date = parseExifDate(exifDate) || new Date();
    if (!exifDate) showToast('EXIF tidak ditemukan, menggunakan waktu sekarang.', 'info');
  } else {
    date = customDate ? new Date(customDate) : new Date();
  }
  return formatDate(date, dateFormat);
}

// ===== Get Location for Watermark =====
async function getWatermarkLocation(item) {
  const { locMode, manualLoc, coordsLat, coordsLng, coordsGeocodedName, coordsUseGeocode } = state.settings;
  if (locMode === 'manual') return manualLoc || '';
  if (locMode === 'coords') {
    if (coordsLat === null || coordsLng === null) return '';
    if (coordsUseGeocode && coordsGeocodedName) return coordsGeocodedName;
    // Show raw coords as DMS or decimal
    return formatCoordsDecimal(coordsLat, coordsLng);
  }
  if (locMode === 'gps') return state.location.text || '';
  if (locMode === 'exif') {
    const ex = item.exifData;
    const lat = gpsToDecimal(ex?.GPSLatitude, ex?.GPSLatitudeRef);
    const lng = gpsToDecimal(ex?.GPSLongitude, ex?.GPSLongitudeRef);
    if (lat !== null && lng !== null) {
      if (!ex._geocoded) {
        ex._geocoded = await reverseGeocode(lat, lng);
      }
      return ex._geocoded;
    }
    return '';
  }
  return '';
}

// ===== Format decimal coords nicely =====
function formatCoordsDecimal(lat, lng) {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lngDir = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(5)}\u00b0${latDir}, ${Math.abs(lng).toFixed(5)}\u00b0${lngDir}`;
}

// ===== Default template =====
const DEFAULT_TEMPLATE = '{tanggal}\n\u{1F4CD} {lokasi}\n{koordinat}';

// ===== Render Template: resolve tokens into lines array =====
async function renderTemplate(template, item) {
  const { settings } = state;

  // Resolve each token value
  const dateTxt   = settings.dateEnabled ? getWatermarkDate(item) : '';
  const locTxt    = settings.locEnabled  ? (await getWatermarkLocation(item)) : '';
  
  let lat = null, lng = null;
  if (settings.locMode === 'coords') {
    lat = settings.coordsLat;
    lng = settings.coordsLng;
  } else if (settings.locMode === 'gps') {
    lat = state.location.lat;
    lng = state.location.lng;
  } else if (settings.locMode === 'exif') {
    const ex = item.exifData;
    lat = gpsToDecimal(ex?.GPSLatitude, ex?.GPSLatitudeRef);
    lng = gpsToDecimal(ex?.GPSLongitude, ex?.GPSLongitudeRef);
  }

  const coordTxt  = (lat !== null && lng !== null) ? formatCoordsDecimal(lat, lng) : '';
  const latTxt    = lat !== null ? String(lat) : '';
  const lngTxt    = lng !== null ? String(lng) : '';
  const fileName  = item.file.name.replace(/\.[^.]+$/, '');

  const tokens = {
    '{tanggal}':   dateTxt,
    '{lokasi}':    locTxt,
    '{koordinat}': coordTxt,
    '{lat}':       latTxt,
    '{lng}':       lngTxt,
    '{nama_file}': fileName,
  };

  return template
    .split('\n')
    .map(rawLine => {
      let line = rawLine;
      let hadToken = false;
      for (const [token, value] of Object.entries(tokens)) {
        if (line.includes(token)) {
          hadToken = true;
          line = line.split(token).join(value);
        }
      }
      line = line.trim();
      // If line contained a token that resolved to empty, and no meaningful text remains
      // (only whitespace / emoji / punctuation / symbols), skip it
      if (hadToken && line !== '' && !/[\w\u00C0-\u024F\u0400-\u04FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(line)) {
        return null;
      }
      return line || null;
    })
    .filter(Boolean);
}

// ===== Update live preview strip under textarea =====
async function updateTemplatePreview() {
  const tpl = state.settings.wmTemplate;
  const previewEl = $('template-preview');
  if (!previewEl) return;

  // Build a dummy item for preview when no images loaded
  const dummyItem = state.images.length > 0
    ? state.images[state.currentIdx]
    : { file: { name: 'foto.jpg' }, exifData: {} };

  const lines = await renderTemplate(tpl, dummyItem);

  if (lines.length === 0) {
    previewEl.innerHTML = '<div class="template-preview-empty">Tidak ada teks yang akan ditampilkan</div>';
    return;
  }
  previewEl.innerHTML = lines.map((l, i) =>
    `<div class="template-preview-line">
       <span class="line-num">${i + 1}</span>
       <span class="line-text">${escapeHtml(l)}</span>
     </div>`
  ).join('');
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ===== Draw Watermark on Canvas =====
async function drawWatermark(targetCanvas, targetCtx, item) {
  const { settings } = state;
  const img = item.img;
  targetCanvas.width = img.naturalWidth;
  targetCanvas.height = img.naturalHeight;

  // Draw original image
  targetCtx.drawImage(img, 0, 0);

  // Build text lines via template engine
  const lines = await renderTemplate(settings.wmTemplate, item);
  if (lines.length === 0) return;

  // Scale font relative to image size
  const scale = img.naturalWidth / 1000;
  const fontSize = Math.max(12, Math.round(settings.fontSize * scale));

  // Setup font
  const fontWeight = settings.preset === 'stamp' ? '800' : settings.preset === 'classic' ? '400' : '600';
  targetCtx.font = `${fontWeight} ${fontSize}px Inter, Arial, sans-serif`;
  targetCtx.textBaseline = 'top';

  const padding = Math.round(fontSize * 0.5);
  const lineHeight = Math.round(fontSize * 1.4);
  const maxWidth = Math.max(...lines.map(l => targetCtx.measureText(l).width));
  const boxW = maxWidth + padding * 2;
  const boxH = lines.length * lineHeight + padding * 2 - (lineHeight - fontSize) / 2;

  const margin = settings.margin * scale;
  const pos = settings.position;
  const W = img.naturalWidth, H = img.naturalHeight;

  let x, y;
  if (pos.includes('left')) x = margin;
  else if (pos.includes('right')) x = W - boxW - margin;
  else x = (W - boxW) / 2;

  if (pos.includes('top')) y = margin;
  else if (pos.includes('bottom')) y = H - boxH - margin;
  else y = (H - boxH) / 2;

  // Draw background
  if (settings.preset === 'stamp') {
    // Stamp style: bordered box
    const bgAlpha = settings.bgOpacity / 100;
    const bgHex = settings.bgColor;
    targetCtx.fillStyle = hexToRgba(bgHex, bgAlpha);
    roundRect(targetCtx, x, y, boxW, boxH, fontSize * 0.3);
    targetCtx.strokeStyle = settings.color;
    targetCtx.lineWidth = Math.max(2, fontSize * 0.08);
    targetCtx.stroke();
  } else if (settings.preset === 'minimal') {
    // Minimal: no background, just shadow
    targetCtx.shadowColor = 'rgba(0,0,0,0.8)';
    targetCtx.shadowBlur = fontSize * 0.5;
    targetCtx.shadowOffsetX = 1;
    targetCtx.shadowOffsetY = 1;
  } else {
    // Modern / Classic: semi-transparent background
    const bgAlpha = settings.bgOpacity / 100;
    targetCtx.fillStyle = hexToRgba(settings.bgColor, bgAlpha);
    if (settings.preset === 'modern') {
      roundRect(targetCtx, x, y, boxW, boxH, fontSize * 0.3);
    } else {
      targetCtx.fillRect(x, y, boxW, boxH);
    }
    // Accent bar for modern
    if (settings.preset === 'modern') {
      targetCtx.fillStyle = '#3b82f6';
      roundRect(targetCtx, x, y, Math.max(4, fontSize * 0.2), boxH, fontSize * 0.3);
    }
  }

  // Draw text
  targetCtx.shadowColor = 'transparent';
  targetCtx.shadowBlur = 0;
  targetCtx.fillStyle = settings.color;
  lines.forEach((line, i) => {
    targetCtx.fillText(line, x + padding, y + padding + i * lineHeight);
  });
}

// ===== Render Watermark on Preview =====
async function renderWatermark() {
  if (state.images.length === 0) return;
  const item = state.images[state.currentIdx];
  await drawWatermark(canvas, ctx, item);
}

// ===== Helper: Rounded Rect =====
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
}

// ===== Helper: Hex to RGBA =====
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ===== Download Single =====
async function downloadSingle(idx) {
  const item = state.images[idx];
  const offCanvas = document.createElement('canvas');
  const offCtx = offCanvas.getContext('2d');
  await drawWatermark(offCanvas, offCtx, item);
  const ext = item.file.type === 'image/png' ? 'png' : 'jpg';
  const quality = item.file.type === 'image/png' ? 1 : 0.92;
  const mime = item.file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const link = document.createElement('a');
  link.download = item.file.name.replace(/\.[^.]+$/, '') + '_watermark.' + ext;
  link.href = offCanvas.toDataURL(mime, quality);
  link.click();
  showToast('✅ Foto berhasil diunduh!', 'success');
}

// ===== Download All =====
async function downloadAll() {
  downloadOverlay.style.display = 'flex';
  downloadOverlay.removeAttribute('aria-hidden');
  const total = state.images.length;
  for (let i = 0; i < total; i++) {
    downloadProgressText.textContent = `${i + 1} / ${total}`;
    downloadBar.style.width = `${((i) / total) * 100}%`;
    await new Promise(r => setTimeout(r, 50)); // allow repaint
    await downloadSingle(i);
    await new Promise(r => setTimeout(r, 200));
  }
  downloadBar.style.width = '100%';
  await new Promise(r => setTimeout(r, 400));
  downloadOverlay.style.display = 'none';
  downloadOverlay.setAttribute('aria-hidden', 'true');
  showToast(`✅ ${total} foto berhasil diunduh!`, 'success');
}

// ===== Toast =====
function showToast(msg, type = 'info') {
  const tc = $('toast-container');
  const div = document.createElement('div');
  div.className = `toast ${type}`;
  const icons = {
    success: '<svg class="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    error: '<svg class="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    info: '<svg class="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
  };
  div.innerHTML = `${icons[type] || icons.info}<span>${msg}</span>`;
  tc.appendChild(div);
  setTimeout(() => {
    div.classList.add('hiding');
    div.addEventListener('animationend', () => div.remove());
  }, 3000);
}

// ===== Bind Events =====
function bindEvents() {
  // File upload
  $('btn-browse').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => loadImages(e.target.files));

  dropzone.addEventListener('click', () => {
    if (state.images.length === 0) fileInput.click();
  });
  dropzone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    loadImages(e.dataTransfer.files);
  });

  // Navigation
  btnPrev.addEventListener('click', () => {
    if (state.currentIdx > 0) { state.currentIdx--; updateUI(); }
  });
  btnNext.addEventListener('click', () => {
    if (state.currentIdx < state.images.length - 1) { state.currentIdx++; updateUI(); }
  });

  // Reset
  $('btn-reset').addEventListener('click', () => {
    state.images.forEach(item => URL.revokeObjectURL(item.url));
    state.images = [];
    state.currentIdx = 0;
    fileInput.value = '';
    updateUI();
    dropzone.style.display = 'flex';
    canvasWrapper.style.display = 'none';
  });

  // Download
  $('btn-download-single').addEventListener('click', () => downloadSingle(state.currentIdx));
  $('btn-download-all').addEventListener('click', downloadAll);

  // Apply
  $('btn-apply').addEventListener('click', () => {
    if (state.images.length === 0) { showToast('Upload foto terlebih dahulu!', 'error'); return; }
    renderWatermark();
    showToast('Watermark diterapkan!', 'success');
  });

  // Date/Time settings
  $('toggle-datetime').addEventListener('change', e => {
    state.settings.dateEnabled = e.target.checked;
    $('datetime-body').style.opacity = e.target.checked ? '1' : '0.4';
    renderWatermark();
  });

  document.querySelectorAll('input[name="date-mode"]').forEach(radio => {
    radio.addEventListener('change', e => {
      state.settings.dateMode = e.target.value;
      $('custom-datetime-group').style.display = e.target.value === 'custom' ? 'flex' : 'none';
      renderWatermark();
    });
  });

  $('custom-datetime').addEventListener('change', e => {
    state.settings.customDate = e.target.value;
    renderWatermark();
  });

  $('date-format').addEventListener('change', e => {
    state.settings.dateFormat = e.target.value;
    renderWatermark();
  });

  // Location settings
  $('toggle-location').addEventListener('change', e => {
    state.settings.locEnabled = e.target.checked;
    $('location-body').style.opacity = e.target.checked ? '1' : '0.4';
    renderWatermark();
  });

  document.querySelectorAll('input[name="loc-mode"]').forEach(radio => {
    radio.addEventListener('change', e => {
      state.settings.locMode = e.target.value;
      const isGps    = e.target.value === 'gps';
      const isManual = e.target.value === 'manual';
      const isCoords = e.target.value === 'coords';
      $('gps-status').style.display              = isGps    ? 'flex' : 'none';
      $('manual-location-group').style.display   = isManual ? 'flex' : 'none';
      $('coords-input-group').style.display      = isCoords ? 'block' : 'none';
      if (isGps && !state.location.text) fetchUserLocation();
      renderWatermark();
    });
  });

  $('btn-get-location').addEventListener('click', fetchUserLocation);

  $('manual-location').addEventListener('input', e => {
    state.settings.manualLoc = e.target.value;
    renderWatermark();
  });

  // Style settings
  $('wm-font-size').addEventListener('input', e => {
    state.settings.fontSize = parseInt(e.target.value);
    $('font-size-val').textContent = e.target.value + 'px';
    renderWatermark();
  });

  $('wm-color').addEventListener('input', e => {
    state.settings.color = e.target.value;
    $('color-label').textContent = e.target.value;
    renderWatermark();
  });

  $('wm-bg-color').addEventListener('input', e => {
    state.settings.bgColor = e.target.value;
    $('bg-color-label').textContent = e.target.value;
    renderWatermark();
  });

  $('wm-bg-opacity').addEventListener('input', e => {
    state.settings.bgOpacity = parseInt(e.target.value);
    $('bg-opacity-val').textContent = e.target.value + '%';
    renderWatermark();
  });

  $('wm-margin').addEventListener('input', e => {
    state.settings.margin = parseInt(e.target.value);
    $('margin-val').textContent = e.target.value + 'px';
    renderWatermark();
  });

  // Presets
  const PRESETS = {
    modern:  { color: '#ffffff', bgColor: '#000000', bgOpacity: 65, fontSize: 28 },
    classic: { color: '#f5f0e8', bgColor: '#1a1a1a', bgOpacity: 80, fontSize: 26 },
    minimal: { color: '#ffffff', bgColor: '#000000', bgOpacity: 0, fontSize: 26 },
    stamp:   { color: '#ff6b35', bgColor: '#1a0a00', bgOpacity: 85, fontSize: 30 },
  };

  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const p = btn.dataset.preset;
      state.settings.preset = p;
      const vals = PRESETS[p];
      Object.assign(state.settings, vals);
      $('wm-color').value = vals.color;
      $('color-label').textContent = vals.color;
      $('wm-bg-color').value = vals.bgColor;
      $('bg-color-label').textContent = vals.bgColor;
      $('wm-bg-opacity').value = vals.bgOpacity;
      $('bg-opacity-val').textContent = vals.bgOpacity + '%';
      $('wm-font-size').value = vals.fontSize;
      $('font-size-val').textContent = vals.fontSize + 'px';
      renderWatermark();
    });
  });

  // Template textarea
  const tmplTextarea = $('wm-template');
  tmplTextarea.addEventListener('input', () => {
    state.settings.wmTemplate = tmplTextarea.value;
    updateTemplatePreview();
    renderWatermark();
  });

  // Token pill buttons — insert token at cursor position
  document.querySelectorAll('.token-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const token = pill.dataset.token;
      const start = tmplTextarea.selectionStart;
      const end   = tmplTextarea.selectionEnd;
      const before = tmplTextarea.value.slice(0, start);
      const after  = tmplTextarea.value.slice(end);
      tmplTextarea.value = before + token + after;
      // Restore cursor after inserted token
      const pos = start + token.length;
      tmplTextarea.setSelectionRange(pos, pos);
      tmplTextarea.focus();
      state.settings.wmTemplate = tmplTextarea.value;
      updateTemplatePreview();
      renderWatermark();
    });
  });

  // Reset template button
  $('btn-template-reset').addEventListener('click', () => {
    tmplTextarea.value = DEFAULT_TEMPLATE;
    state.settings.wmTemplate = DEFAULT_TEMPLATE;
    updateTemplatePreview();
    renderWatermark();
    showToast('Template direset ke default.', 'info');
  });

  // Position grid
  document.querySelectorAll('.pos-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pos-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed','false'); });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed','true');
      state.settings.position = btn.dataset.pos;
      renderWatermark();
    });
  });

  // Help button
  $('btn-help').addEventListener('click', () => {
    showToast('WatermarkPro v1.0 — Buat watermark tanggal, jam & lokasi di foto Anda. Semua proses dilakukan di browser, foto Anda tidak dikirim ke server.', 'info');
  });

  // Paste from clipboard (only images, ignore if coord-paste is focused)
  document.addEventListener('paste', e => {
    if (document.activeElement && document.activeElement.id === 'coord-paste') return;
    const items = e.clipboardData?.items || [];
    const imageItems = [...items].filter(it => it.type.startsWith('image/'));
    if (imageItems.length > 0) {
      const files = imageItems.map(it => it.getAsFile()).filter(Boolean);
      loadImages(files);
    }
  });
}

// ===== Coords Mode Logic =====
function bindCoordsMode() {
  const latInput  = $('coord-lat');
  const lngInput  = $('coord-lng');
  const pasteInput = $('coord-paste');
  const lookupBtn  = $('btn-coord-lookup');
  const clearBtn   = $('btn-coord-clear');
  const resultBox  = $('coord-result');
  const resultName = $('coord-result-name');
  const resultRaw  = $('coord-result-raw');
  const useGeocodeChk = $('coord-use-geocode');

  // Parse "lat, lng" string from paste field
  function parsePasteField(val) {
    const clean = val.trim().replace(/\s+/g, ' ');
    // Match: optional sign, digits, optional decimal, separator (comma/space/semicolon), optional sign, digits
    const match = clean.match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
    if (!match) return null;
    const lat = parseFloat(match[1]);
    const lng = parseFloat(match[2]);
    if (isNaN(lat) || isNaN(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  }

  // Sync paste field → individual lat/lng inputs
  pasteInput.addEventListener('input', () => {
    const parsed = parsePasteField(pasteInput.value);
    if (parsed) {
      latInput.value = parsed.lat;
      lngInput.value = parsed.lng;
      state.settings.coordsLat = parsed.lat;
      state.settings.coordsLng = parsed.lng;
      pasteInput.style.borderColor = 'rgba(16,185,129,0.6)';
    } else if (pasteInput.value.trim()) {
      pasteInput.style.borderColor = 'rgba(239,68,68,0.5)';
    } else {
      pasteInput.style.borderColor = '';
    }
    // Reset geocode result when coords change
    state.settings.coordsGeocodedName = null;
    resultBox.style.display = 'none';
    renderWatermark();
  });

  // Sync individual inputs → state
  function syncLatLng() {
    const lat = parseFloat(latInput.value);
    const lng = parseFloat(lngInput.value);
    state.settings.coordsLat = isNaN(lat) ? null : lat;
    state.settings.coordsLng = isNaN(lng) ? null : lng;
    // Sync paste field
    if (!isNaN(lat) && !isNaN(lng)) {
      pasteInput.value = `${lat}, ${lng}`;
      pasteInput.style.borderColor = 'rgba(16,185,129,0.6)';
    } else {
      pasteInput.style.borderColor = '';
    }
    state.settings.coordsGeocodedName = null;
    resultBox.style.display = 'none';
    renderWatermark();
  }
  latInput.addEventListener('input', syncLatLng);
  lngInput.addEventListener('input', syncLatLng);

  // Lookup button: reverse geocode
  lookupBtn.addEventListener('click', async () => {
    const lat = state.settings.coordsLat;
    const lng = state.settings.coordsLng;
    if (lat === null || lng === null) {
      showToast('Masukkan koordinat terlebih dahulu.', 'error');
      return;
    }
    if (lat < -90 || lat > 90) { showToast('Lintang harus antara -90 dan 90.', 'error'); return; }
    if (lng < -180 || lng > 180) { showToast('Bujur harus antara -180 dan 180.', 'error'); return; }

    lookupBtn.disabled = true;
    lookupBtn.classList.add('loading');
    const origHTML = lookupBtn.innerHTML;
    lookupBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 0.8s linear infinite"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Mencari...`;

    try {
      const name = await reverseGeocode(lat, lng);
      state.settings.coordsGeocodedName = name;
      resultName.textContent = name;
      resultRaw.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      resultBox.style.display = 'flex';
      showToast(`📍 ${name}`, 'success');
      if (state.images.length > 0) renderWatermark();
    } catch(err) {
      showToast('Gagal mencari nama lokasi. Coba lagi.', 'error');
    } finally {
      lookupBtn.disabled = false;
      lookupBtn.classList.remove('loading');
      lookupBtn.innerHTML = origHTML;
    }
  });

  // Toggle: use geocoded name vs raw coords
  useGeocodeChk.addEventListener('change', e => {
    state.settings.coordsUseGeocode = e.target.checked;
    renderWatermark();
  });

  // Clear all
  clearBtn.addEventListener('click', () => {
    latInput.value = '';
    lngInput.value = '';
    pasteInput.value = '';
    pasteInput.style.borderColor = '';
    state.settings.coordsLat = null;
    state.settings.coordsLng = null;
    state.settings.coordsGeocodedName = null;
    resultBox.style.display = 'none';
    renderWatermark();
  });
}

// ===== Init =====
function init() {
  bindEvents();
  bindCoordsMode();

  // Set default datetime-local value to now
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 16);
  $('custom-datetime').value = local;
  state.settings.customDate = local;

  // Sync template textarea with state default
  $('wm-template').value = state.settings.wmTemplate;

  // Initial preview render
  updateTemplatePreview();

  // Re-render preview when date/loc toggles change (they already call renderWatermark,
  // but we also need to refresh the preview strip)
  $('toggle-datetime').addEventListener('change', updateTemplatePreview);
  $('toggle-location').addEventListener('change', updateTemplatePreview);

  showToast('👋 Selamat datang! Upload foto untuk memulai.', 'info');
}

document.addEventListener('DOMContentLoaded', init);
