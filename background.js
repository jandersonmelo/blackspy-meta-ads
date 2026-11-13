/* global chrome */
'use strict';

function isAdLibraryUrl(url) {
  return /^https:\/\/(?:www\.|web\.)?facebook\.com\/ads\/library(?:\/|\?|$)/i.test(url || '');
}

async function injectRadar(tabId, url) {
  if (!isAdLibraryUrl(url)) return;
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch (error) {
    // A navigation can finish between the URL event and injection. The normal
    // content-script rule or a later URL event will retry safely.
    console.debug('[Blackspy Meta Ads] injeção adiada:', error.message);
  }
}

// Meta is a single-page application. This catches an in-page transition to
// /ads/library, where declarative content scripts do not run again.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab.url;
  if (changeInfo.url && isAdLibraryUrl(url)) injectRadar(tabId, url);
  if (changeInfo.status === 'complete' && isAdLibraryUrl(url)) injectRadar(tabId, url);
});

// ZIP "store" writer: it deliberately avoids third-party code and compression
// so downloaded media is not duplicated in memory while being compressed.
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[n] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function writeUint16(target, offset, value) {
  new DataView(target.buffer, target.byteOffset, target.byteLength).setUint16(offset, value, true);
}

function writeUint32(target, offset, value) {
  new DataView(target.buffer, target.byteOffset, target.byteLength).setUint32(offset, value >>> 0, true);
}

function joinBytes(parts, size) {
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

async function makeZip(files) {
  const encoder = new TextEncoder();
  const prepared = [];
  let size = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = new Uint8Array(await file.blob.arrayBuffer());
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    writeUint32(local, 0, 0x04034b50); writeUint16(local, 4, 20); writeUint16(local, 6, 0x0800);
    writeUint16(local, 8, 0); writeUint16(local, 10, 0); writeUint16(local, 12, 0);
    writeUint32(local, 14, crc); writeUint32(local, 18, data.length); writeUint32(local, 22, data.length);
    writeUint16(local, 26, name.length); writeUint16(local, 28, 0); local.set(name, 30);
    prepared.push({ name, data, local, crc, offset: size });
    size += local.length + data.length;
  }

  const centralParts = [];
  let centralSize = 0;
  for (const file of prepared) {
    const central = new Uint8Array(46 + file.name.length);
    writeUint32(central, 0, 0x02014b50); writeUint16(central, 4, 20); writeUint16(central, 6, 20); writeUint16(central, 8, 0x0800);
    writeUint16(central, 10, 0); writeUint16(central, 12, 0); writeUint16(central, 14, 0);
    writeUint32(central, 16, file.crc); writeUint32(central, 20, file.data.length); writeUint32(central, 24, file.data.length);
    writeUint16(central, 28, file.name.length); writeUint16(central, 30, 0); writeUint16(central, 32, 0); writeUint16(central, 34, 0); writeUint16(central, 36, 0);
    writeUint32(central, 38, 0); writeUint32(central, 42, file.offset); central.set(file.name, 46);
    centralParts.push(central); centralSize += central.length;
  }
  const end = new Uint8Array(22);
  writeUint32(end, 0, 0x06054b50); writeUint16(end, 4, 0); writeUint16(end, 6, 0);
  writeUint16(end, 8, prepared.length); writeUint16(end, 10, prepared.length); writeUint32(end, 12, centralSize); writeUint32(end, 16, size); writeUint16(end, 20, 0);
  const body = prepared.flatMap(file => [file.local, file.data]);
  return new Blob([joinBytes([...body, ...centralParts, end], size + centralSize + end.length)], { type: 'application/zip' });
}

function extensionFor(url, contentType, number) {
  const byMime = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm' };
  const match = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i);
  return byMime[contentType.split(';')[0].toLowerCase()] || (match ? match[1].toLowerCase() : `media${number}`);
}

function safeName(value) {
  return String(value).replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 70) || 'anuncio';
}

const SAVED_DB = 'radar-meta-saved-ads';
const SAVED_STORE = 'ads';

function savedDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SAVED_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(SAVED_STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Não foi possível abrir os anúncios salvos.'));
  });
}

async function savedAdById(id) {
  const db = await savedDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(SAVED_STORE, 'readonly').objectStore(SAVED_STORE).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

async function allSavedAds() {
  const db = await savedDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(SAVED_STORE, 'readonly').objectStore(SAVED_STORE).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

async function putSavedAd(ad) {
  const db = await savedDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(SAVED_STORE, 'readwrite').objectStore(SAVED_STORE).put(ad);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

async function saveAdLocally(record) {
  if (!record?.key) throw new Error('Não foi possível identificar este anúncio.');
  const previous = await savedAdById(record.key);
  const media = [];
  const errors = [];
  const urls = [...new Set(record.media || [])];
  for (let index = 0; index < urls.length; index += 1) {
    try {
      const file = await fetchMedia(urls[index], index + 1);
      media.push({ name: `criativo-${String(index + 1).padStart(2, '0')}.${file.extension}`, type: file.blob.type, blob: file.blob });
    } catch (error) {
      errors.push(error.message);
    }
  }
  const ad = {
    id: record.key,
    key: record.key,
    pageKey: record.pageKey || previous?.pageKey || 'page:desconhecida',
    pageName: record.pageName || previous?.pageName || 'Página não identificada',
    pageLibraryUrl: record.pageLibraryUrl || previous?.pageLibraryUrl || record.adLibraryUrl,
    adLibraryUrl: record.adLibraryUrl,
    start: record.start || previous?.start || null,
    text: record.text || previous?.text || '',
    media: media.length ? media : (previous?.media || []),
    errors,
    savedAt: new Date().toISOString()
  };
  await putSavedAd(ad);
  return { mediaCount: ad.media.length };
}

async function openSavedAds() {
  await chrome.tabs.create({ url: chrome.runtime.getURL('saved.html') });
}

async function zipDataUrl(zip) {
  // Service workers cannot create Blob URLs. A data URL is accepted by the
  // Downloads API and keeps the download self-contained. Its chunks have a
  // length divisible by three, so their Base64 output can be concatenated.
  const bytes = new Uint8Array(await zip.arrayBuffer());
  const chunkSize = 24576;
  let base64 = '';
  for (let start = 0; start < bytes.length; start += chunkSize) {
    base64 += btoa(String.fromCharCode(...bytes.subarray(start, Math.min(start + chunkSize, bytes.length))));
  }
  return `data:application/zip;base64,${base64}`;
}

async function fetchMedia(url, index) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, { credentials: 'include', signal: controller.signal });
    if (!response.ok) throw new Error(`Mídia ${index}: HTTP ${response.status}`);
    const blob = await response.blob();
    if (!blob.size) throw new Error(`Mídia ${index}: arquivo vazio`);
    return { blob, extension: extensionFor(url, blob.type, index) };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`Mídia ${index}: tempo limite excedido`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function downloadBundle(mediaUrls, record) {
  const uniqueUrls = [...new Set(mediaUrls)].slice(0, 20);
  const result = await Promise.allSettled(uniqueUrls.map(fetchMedia));
  const files = [];
  const errors = [];
  result.forEach((entry, index) => {
    if (entry.status === 'fulfilled') files.push({ name: `criativo-${String(index + 1).padStart(2, '0')}.${entry.value.extension}`, blob: entry.value.blob });
    else errors.push(entry.reason.message);
  });
  if (!files.length) throw new Error(errors.join('; ') || 'Nenhuma mídia do criativo foi encontrada.');

  const started = record.startedAt ? new Date(record.startedAt).toLocaleDateString('pt-BR') : 'Não identificada';
  const text = [
    'DADOS DO ANÚNCIO — Blackspy Meta Ads',
    `Identificador: ${record.id}`,
    `Início detectado: ${started}`,
    `Dias ativos: ${record.activeDays ?? 'Não identificado'}`,
    `Página da Biblioteca: ${record.pageUrl}`,
    '', 'TEXTO CAPTURADO DO ANÚNCIO', record.text
  ].join('\r\n');
  files.push({ name: 'texto-do-anuncio.txt', blob: new Blob(['\uFEFF', text], { type: 'text/plain;charset=utf-8' }) });
  if (errors.length) files.push({ name: 'midias-nao-baixadas.txt', blob: new Blob([errors.join('\r\n')], { type: 'text/plain;charset=utf-8' }) });

  const zip = await makeZip(files);
  const filename = `radar-meta/${safeName(record.id)}-${new Date().toISOString().slice(0, 10)}.zip`;
  return chrome.downloads.download({ url: await zipDataUrl(zip), filename, saveAs: false, conflictAction: 'uniquify' });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function isVideoFile(path) {
  return /\.(mp4|webm|mov|m4v)(?:$|\?)/i.test(path);
}

function activeDays(record) {
  if (!record.start) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(record.start).getTime()) / 86400000));
}

function adTextFile(record, pageAdCount) {
  const started = record.start ? new Date(record.start).toLocaleDateString('pt-BR') : 'Não identificada';
  return [
    'DADOS DO ANÚNCIO — Blackspy Meta Ads',
    `Identificador: ${record.key}`,
    `Página: ${record.pageName}`,
    `Anúncios encontrados para esta página: ${pageAdCount}`,
    `Início detectado: ${started}`,
    `Dias ativos: ${activeDays(record) ?? 'Não identificado'}`,
    `Link do anúncio: ${record.adLibraryUrl}`,
    `Link da página na Biblioteca: ${record.pageLibraryUrl}`,
    '', 'TEXTO CAPTURADO DO ANÚNCIO', record.text
  ].join('\r\n');
}

function libraryIndex(entries, summary) {
  const cards = entries.map(entry => {
    const preview = entry.media[0]
      ? (isVideoFile(entry.media[0]) ? `<video controls preload="metadata" src="${encodeURI(entry.media[0])}"></video>` : `<img loading="lazy" src="${encodeURI(entry.media[0])}" alt="Criativo">`)
      : '<div class="empty">Prévia não disponível</div>';
    const mediaLinks = entry.media.map((path, index) => `<a href="${encodeURI(path)}" target="_blank">Arquivo ${index + 1}</a>`).join(' · ') || 'Nenhuma mídia baixada';
    return `<article class="card"><div class="preview">${preview}</div><div class="body"><p class="page">${escapeHtml(entry.pageName)}</p><h2>${escapeHtml(entry.key)}</h2><dl><div><dt>Tempo ativo</dt><dd>${entry.days === null ? 'Não identificado' : `${entry.days} dias`}</dd></div><div><dt>Anúncios da página</dt><dd>${entry.pageAdCount}</dd></div></dl><p class="links"><a href="${escapeHtml(entry.adLibraryUrl)}" target="_blank" rel="noreferrer">Ver anúncio na Biblioteca</a><a href="${escapeHtml(entry.pageLibraryUrl)}" target="_blank" rel="noreferrer">Ver página na Biblioteca</a></p><p class="files">${mediaLinks}</p><details><summary>Texto do anúncio</summary><pre>${escapeHtml(entry.text)}</pre></details></div></article>`;
  }).join('\n');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Biblioteca de Criativos</title><style>body{margin:0;background:#f4f6f9;color:#182230;font:15px system-ui,-apple-system,Segoe UI,sans-serif}.top{padding:30px max(24px,calc((100% - 1180px)/2));background:#1877f2;color:#fff}.top h1{margin:0 0 8px;font-size:26px}.top p{margin:4px 0;opacity:.92}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:18px;max-width:1180px;margin:24px auto;padding:0 20px 40px}.card{overflow:hidden;border:1px solid #dce2eb;border-radius:12px;background:#fff;box-shadow:0 3px 12px #18223012}.preview{aspect-ratio:1.5;background:#eaf0f6;display:grid;place-items:center}.preview img,.preview video{display:block;width:100%;height:100%;object-fit:contain;background:#111}.empty{color:#627287}.body{padding:15px}.page{margin:0;color:#1877f2;font-size:12px;font-weight:700}.body h2{margin:5px 0 13px;font-size:15px;word-break:break-word}dl{display:flex;gap:22px;margin:0 0 14px}dt{color:#66758a;font-size:11px;text-transform:uppercase}dd{margin:2px 0 0;font-weight:700}.links{display:grid;gap:5px}.links a,.files a{color:#1468d5;text-decoration:none}.files{color:#66758a;font-size:12px}details{border-top:1px solid #e7ebf1;padding-top:10px;font-size:12px}summary{cursor:pointer;color:#526174}pre{white-space:pre-wrap;word-break:break-word;font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace}</style></head><body><header class="top"><h1>Biblioteca de Criativos</h1><p>${entries.length} ofertas exportadas · ${summary.totalFound || entries.length} anúncios encontrados na sessão</p><p>Gerada em ${new Date().toLocaleString('pt-BR')}</p></header><main class="grid">${cards}</main></body></html>`;
}

async function downloadCreativeLibrary(records, summary = {}) {
  if (!records.length) throw new Error('Não há ofertas para exportar.');
  const allPageCounts = new Map(summary.pageCounts || []);
  const files = [];
  const entries = [];
  const errors = [];

  for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
    const record = records[recordIndex];
    const folder = `ofertas/${String(recordIndex + 1).padStart(3, '0')}-${safeName(record.key)}`;
    const pageAdCount = allPageCounts.get(record.pageKey) || 1;
    const mediaPaths = [];
    const mediaUrls = [...new Set(record.media || [])];
    for (let mediaIndex = 0; mediaIndex < mediaUrls.length; mediaIndex += 1) {
      try {
        const media = await fetchMedia(mediaUrls[mediaIndex], mediaIndex + 1);
        const path = `${folder}/criativo-${String(mediaIndex + 1).padStart(2, '0')}.${media.extension}`;
        files.push({ name: path, blob: media.blob });
        mediaPaths.push(path);
      } catch (error) {
        errors.push(`${record.key} · mídia ${mediaIndex + 1}: ${error.message}`);
      }
    }
    files.push({ name: `${folder}/texto-do-anuncio.txt`, blob: new Blob(['\uFEFF', adTextFile(record, pageAdCount)], { type: 'text/plain;charset=utf-8' }) });
    entries.push({ ...record, pageAdCount, days: activeDays(record), media: mediaPaths });
  }

  files.push({ name: 'index.html', blob: new Blob([libraryIndex(entries, summary)], { type: 'text/html;charset=utf-8' }) });
  files.push({ name: 'LEIA-ME.txt', blob: new Blob(['Extraia todo o conteúdo deste ZIP e abra index.html no navegador para consultar a biblioteca de criativos.'], { type: 'text/plain;charset=utf-8' }) });
  if (errors.length) files.push({ name: 'midias-nao-baixadas.txt', blob: new Blob([errors.join('\r\n')], { type: 'text/plain;charset=utf-8' }) });

  const zip = await makeZip(files);
  const filename = `radar-meta/biblioteca-criativos-${new Date().toISOString().slice(0, 10)}.zip`;
  return chrome.downloads.download({ url: await zipDataUrl(zip), filename, saveAs: false, conflictAction: 'uniquify' });
}

async function downloadSavedCreativeLibrary() {
  const records = await allSavedAds();
  if (!records.length) throw new Error('Não há anúncios salvos para exportar.');
  const pageCounts = new Map();
  records.forEach(record => pageCounts.set(record.pageKey, (pageCounts.get(record.pageKey) || 0) + 1));
  const files = [];
  const entries = [];
  const errors = [];

  for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
    const record = records[recordIndex];
    const folder = `ofertas/${String(recordIndex + 1).padStart(3, '0')}-${safeName(record.key)}`;
    const pageAdCount = pageCounts.get(record.pageKey) || 1;
    const mediaPaths = [];
    (record.media || []).forEach((media, mediaIndex) => {
      if (!media?.blob || !media.blob.size) {
        errors.push(`${record.key} · mídia ${mediaIndex + 1}: arquivo local indisponível`);
        return;
      }
      const filename = safeName(media.name || `criativo-${String(mediaIndex + 1).padStart(2, '0')}`);
      const path = `${folder}/${filename}`;
      files.push({ name: path, blob: media.blob });
      mediaPaths.push(path);
    });
    files.push({ name: `${folder}/texto-do-anuncio.txt`, blob: new Blob(['\uFEFF', adTextFile(record, pageAdCount)], { type: 'text/plain;charset=utf-8' }) });
    entries.push({ ...record, pageAdCount, days: activeDays(record), media: mediaPaths });
  }

  const summary = { totalFound: records.length, pageCounts: [...pageCounts] };
  files.push({ name: 'index.html', blob: new Blob([libraryIndex(entries, summary)], { type: 'text/html;charset=utf-8' }) });
  files.push({ name: 'LEIA-ME.txt', blob: new Blob(['Extraia todo o conteúdo deste ZIP e abra index.html no navegador para consultar a biblioteca de criativos salvos.'], { type: 'text/plain;charset=utf-8' }) });
  if (errors.length) files.push({ name: 'midias-nao-baixadas.txt', blob: new Blob([errors.join('\r\n')], { type: 'text/plain;charset=utf-8' }) });

  const zip = await makeZip(files);
  const filename = `radar-meta/biblioteca-criativos-salvos-${new Date().toISOString().slice(0, 10)}.zip`;
  return chrome.downloads.download({ url: await zipDataUrl(zip), filename, saveAs: false, conflictAction: 'uniquify' });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const task = message?.type === 'DOWNLOAD_CREATIVE_BUNDLE'
    ? downloadBundle(message.media || [], message.record || {})
    : message?.type === 'DOWNLOAD_CREATIVE_LIBRARY'
      ? downloadCreativeLibrary(message.records || [], message.summary || {})
      : message?.type === 'SAVE_AD_LOCALLY'
        ? saveAdLocally(message.record || {})
        : message?.type === 'OPEN_SAVED_ADS'
          ? openSavedAds()
          : message?.type === 'DOWNLOAD_SAVED_CREATIVE_LIBRARY'
            ? downloadSavedCreativeLibrary()
      : null;
  if (!task) return undefined;
  task.then(downloadId => sendResponse({ ok: true, downloadId }))
    .catch(error => sendResponse({ ok: false, error: error.message || 'Falha ao criar o ZIP.' }));
  return true;
});
