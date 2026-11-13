(() => {
  'use strict';
  const DB = 'radar-meta-saved-ads';
  const STORE = 'ads';
  const container = document.querySelector('#ads');
  const count = document.querySelector('#count');
  const downloadAll = document.querySelector('#download-all');
  const objectUrls = [];

  function database() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function allAds() {
    const db = await database();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).finally(() => db.close());
  }

  async function deleteAd(id) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    }).finally(() => db.close());
  }

  function elapsed(start) {
    if (!start) return 'Data não identificada';
    const days = Math.max(0, Math.floor((Date.now() - new Date(start).getTime()) / 86400000));
    return days === 1 ? '1 dia' : `${days} dias`;
  }

  function text(value, className) { const element = document.createElement('p'); element.className = className; element.textContent = value; return element; }

  async function copyLinks(ad, button) {
    const value = [ad.adLibraryUrl, ad.pageLibraryUrl].filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const area = document.createElement('textarea'); area.value = value; document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove();
    }
    const original = button.textContent; button.textContent = 'Links copiados ✓'; window.setTimeout(() => { button.textContent = original; }, 1600);
  }

  function downloadMedia(ad, button) {
    const media = ad.media || [];
    if (!media.length) { button.textContent = 'Sem mídia salva'; window.setTimeout(() => { button.textContent = 'Baixar mídia'; }, 1600); return; }
    media.forEach((file, index) => {
      const url = URL.createObjectURL(file.blob); objectUrls.push(url);
      const link = document.createElement('a'); link.href = url; link.download = `${ad.key.replace(/[^a-z0-9_-]/gi, '-')}-${file.name || `criativo-${index + 1}`}`; link.click();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
        const position = objectUrls.indexOf(url);
        if (position >= 0) objectUrls.splice(position, 1);
      }, 60000);
    });
    const original = button.textContent; button.textContent = media.length === 1 ? 'Download iniciado ✓' : `${media.length} downloads iniciados ✓`; window.setTimeout(() => { button.textContent = original; }, 1800);
  }

  function downloadAllSaved() {
    downloadAll.disabled = true;
    downloadAll.textContent = 'Montando ZIP…';
    chrome.runtime.sendMessage({ type: 'DOWNLOAD_SAVED_CREATIVE_LIBRARY' }, response => {
      const error = chrome.runtime.lastError?.message || response?.error;
      downloadAll.textContent = error ? 'Falha ao gerar ZIP' : 'ZIP baixado ✓';
      window.setTimeout(() => {
        downloadAll.disabled = !container.querySelector('.card');
        downloadAll.textContent = 'Baixar tudo em ZIP';
      }, 2200);
    });
  }

  function render(ad) {
    const article = document.createElement('article'); article.className = 'card';
    const media = document.createElement('div'); media.className = 'media';
    const first = ad.media?.[0];
    if (first?.blob) {
      const url = URL.createObjectURL(first.blob); objectUrls.push(url);
      const isVideo = first.type?.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(first.name || '');
      const preview = document.createElement(isVideo ? 'video' : 'img');
      preview.src = url; preview.alt = 'Criativo salvo';
      if (isVideo) { preview.controls = true; preview.preload = 'metadata'; }
      media.appendChild(preview);
    } else media.appendChild(text('Mídia não estava disponível no momento do salvamento.', 'empty'));
    const body = document.createElement('div'); body.className = 'body';
    body.append(text(ad.pageName || 'Página não identificada', 'page'));
    const title = document.createElement('h2'); title.textContent = ad.key; body.appendChild(title);
    const details = document.createElement('dl');
    [['Tempo ativo', elapsed(ad.start)], ['Mídias salvas', String(ad.media?.length || 0)]].forEach(([label, value]) => { const box = document.createElement('div'); const dt = document.createElement('dt'); dt.textContent = label; const dd = document.createElement('dd'); dd.textContent = value; box.append(dt, dd); details.appendChild(box); });
    body.appendChild(details);
    const links = document.createElement('p'); links.className = 'links';
    [[ad.adLibraryUrl, 'Ver anúncio na Biblioteca'], [ad.pageLibraryUrl, 'Ver página na Biblioteca']].forEach(([href, label]) => { if (!href) return; const link = document.createElement('a'); link.href = href; link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = label; links.appendChild(link); });
    body.appendChild(links);
    const actions = document.createElement('div'); actions.className = 'actions';
    const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copiar links'; copy.addEventListener('click', () => copyLinks(ad, copy));
    const download = document.createElement('button'); download.type = 'button'; download.textContent = 'Baixar mídia'; download.addEventListener('click', () => downloadMedia(ad, download));
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'danger'; remove.textContent = 'Apagar salvo'; remove.addEventListener('click', async () => {
      remove.disabled = true;
      try {
        await deleteAd(ad.id);
        article.querySelectorAll('img,video').forEach(node => URL.revokeObjectURL(node.src));
        article.remove();
        const left = container.querySelectorAll('.card').length;
        count.textContent = left ? `${left} anúncio(s) armazenado(s) localmente neste navegador.` : 'Nenhum anúncio foi salvo ainda.';
        downloadAll.disabled = !left;
        if (!left) container.appendChild(text('Volte à Biblioteca de Anúncios e clique em “Salvar anúncio” em qualquer criativo.', 'notice'));
      } catch {
        remove.disabled = false;
        remove.textContent = 'Falha ao apagar';
        window.setTimeout(() => { remove.textContent = 'Apagar salvo'; }, 1800);
      }
    });
    actions.append(copy, download, remove); body.appendChild(actions);
    const disclosure = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Texto do anúncio'; const pre = document.createElement('pre'); pre.textContent = ad.text || 'Sem texto capturado.'; disclosure.append(summary, pre); body.appendChild(disclosure);
    article.append(media, body); return article;
  }

  downloadAll.addEventListener('click', downloadAllSaved);
  allAds().then(ads => {
    ads.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
    count.textContent = ads.length ? `${ads.length} anúncio(s) armazenado(s) localmente neste navegador.` : 'Nenhum anúncio foi salvo ainda.';
    if (!ads.length) { container.appendChild(text('Volte à Biblioteca de Anúncios e clique em “Salvar anúncio” em qualquer criativo.', 'notice')); return; }
    downloadAll.disabled = false;
    ads.forEach(ad => container.appendChild(render(ad)));
  }).catch(() => { count.textContent = 'Não foi possível abrir a biblioteca local.'; });
  window.addEventListener('beforeunload', () => objectUrls.forEach(URL.revokeObjectURL));
})();
