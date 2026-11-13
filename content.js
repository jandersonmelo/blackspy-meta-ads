(() => {
  'use strict';

  if (window.__adLibraryRadarLoaded) return;
  window.__adLibraryRadarLoaded = true;

  const state = {
    records: new Map(),
    running: false,
    interval: null,
    observer: null,
    speed: 1000,
    noGrowthCycles: 0,
    lastSize: 0,
    panel: null,
    scanQueued: false,
    scanTimer: null,
    scanning: false,
    initialized: false,
    routeWatcher: null,
    loadedCount: 0,
    filteredLoadedCount: 0,
    currentCards: new Map(),
    filterTargets: new Set(),
    followBottom: true,
    filters: { minPageAds: 1, minDays: 0 }
  };

  const selectors = [
    '[data-testid="ad_library_card"]',
    '[data-testid="ad-library-card"]',
    '[data-testid="ad_archive_ad_card"]',
    '[data-ad-preview="message"]'
  ];

  function isLibraryRoute() {
    return /^\/ads\/library(?:\/|$)/i.test(location.pathname);
  }

  function normalize(value) {
    return value.replace(/\s+/g, ' ').trim();
  }

  const libraryIdPattern = /(?:Library\s*ID|Ad\s*Library\s*ID|ID\s+da\s+Biblioteca|ID\s+da\s+Biblioteca\s+de\s+Anúncios|Identificação\s+da\s+Biblioteca)\s*[:#-]?\s*(\d{6,25})/iu;

  function libraryId(text) {
    return normalize(text).match(libraryIdPattern)?.[1] || null;
  }

  function cardText(card) {
    // Avoid cloning a large React card on every scroll mutation. Our labels
    // are appended after the creative, so removing their known text is enough.
    const raw = card.innerText || card.textContent || '';
    return normalize(raw
      .replace(/\s*(?:Radar|Blackspy):\s*.*?(?=\s*(?:Baixar criativo \(\.zip\)|Salvar anúncio)|$)/iu, '')
      .replace(/Baixar criativo \(\.zip\)|Salvar anúncio|Salvando…|Salvo localmente ✓/gu, ''));
  }

  function findDate(text) {
    // Meta varies this wording by language and test group. Capture the date
    // after the status label, then use one parser for all displayed formats.
    const labels = [
      /começou\s+a\s+(?:ser\s+)?(?:veiculad[oa]|veicular)\s+em\s*([^\n|·]{4,45})/iu,
      /(?:ativo|em\s+veiculação)\s+desde\s*([^\n|·]{4,45})/iu,
      /início(?:\s+da\s+veiculação)?\s*(?:em)?\s*[:\-]?\s*([^\n|·]{4,45})/iu,
      /started\s+(?:running\s+)?(?:on)?\s*[:\-]?\s*([^\n|·]{4,45})/iu,
      /running\s+since\s*([^\n|·]{4,45})/iu
    ];
    for (const label of labels) {
      const match = text.match(label);
      const parsed = match && parseMetaDate(match[1]);
      if (parsed) return parsed;
    }
    // Conservative fallback for cards where Meta omitted the label but
    // displayed one unambiguous long-form date.
    const candidates = [
      ...text.matchAll(/\b\d{4}-\d{1,2}-\d{1,2}\b/g),
      ...text.matchAll(/\b[0-3]?\d\s+de\s+[\p{L}.]+\s+de\s+\d{4}\b/giu),
      ...text.matchAll(/\b[\p{L}.]+\s+[0-3]?\d,?\s+\d{4}\b/giu),
      ...text.matchAll(/\b[0-3]?\d\s+[\p{L}.]+\s+\d{4}\b/giu),
      ...text.matchAll(/\b[0-3]?\d\/[0-1]?\d\/\d{2,4}\b/g)
    ].map(match => match[0]);
    // Cards ordinarily have only the start date. If the label is localized in
    // an unexpected way, use the first clearly formatted date Meta displays.
    return candidates.map(parseMetaDate).find(Boolean) || null;
  }

  function parseMetaDate(value) {
    const months = { jan: 0, janeiro: 0, january: 0, fev: 1, fevereiro: 1, feb: 1, february: 1, mar: 2, março: 2, march: 2, abr: 3, abril: 3, apr: 3, april: 3, mai: 4, maio: 4, may: 4, jun: 5, junho: 5, june: 5, jul: 6, julho: 6, july: 6, ago: 7, agosto: 7, aug: 7, august: 7, set: 8, setembro: 8, sep: 8, sept: 8, september: 8, out: 9, outubro: 9, oct: 9, october: 9, nov: 10, novembro: 10, november: 10, dez: 11, dezembro: 11, dec: 11, december: 11 };
    const normalized = normalize(value).toLocaleLowerCase('pt-BR').replaceAll('.', '');
    const iso = normalized.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
    if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
    const portuguese = normalized.match(/(\d{1,2})\s+de\s+([\p{L}]+)\s+de\s+(\d{4})/u);
    if (portuguese && months[portuguese[2]] !== undefined) return new Date(+portuguese[3], months[portuguese[2]], +portuguese[1]);
    const englishMonthFirst = normalized.match(/([a-z]+)\s+(\d{1,2}),?\s+(\d{4})/i);
    if (englishMonthFirst && months[englishMonthFirst[1]] !== undefined) return new Date(+englishMonthFirst[3], months[englishMonthFirst[1]], +englishMonthFirst[2]);
    const englishDayFirst = normalized.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/i);
    if (englishDayFirst && months[englishDayFirst[2]] !== undefined) return new Date(+englishDayFirst[3], months[englishDayFirst[2]], +englishDayFirst[1]);
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
    const numeric = value.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (numeric) return new Date(numeric[3].length === 2 ? 2000 + +numeric[3] : +numeric[3], +numeric[2] - 1, +numeric[1]);
    return null;
  }

  // Kept below the original parser so these definitions take precedence in
  // older installs too. Meta changes the visible wording and sometimes keeps
  // the date only in an accessibility attribute.
  const startDateLabels = [
    /comecou\s+a\s+(?:ser\s+)?(?:veiculad[oa]|veicular|exibid[oa])\s+em\s*([^\n|\u00b7]{3,80})/i,
    /(?:anuncio\s+)?(?:ativo|em\s+veiculacao)\s+desde\s*([^\n|\u00b7]{3,80})/i,
    /(?:anuncio\s+)?(?:iniciado|inicio|data\s+de\s+inicio)(?:\s+da\s+veiculacao)?\s*(?:em)?\s*[:\-]?\s*([^\n|\u00b7]{3,80})/i,
    /(?:started\s+(?:running\s+)?(?:on)?|ad\s+started\s+on|active\s+since|running\s+since|start\s+date)\s*[:\-]?\s*([^\n|\u00b7]{3,80})/i,
    /(?:comenzo\s+a\s+publicarse\s+el|activo\s+desde|fecha\s+de\s+inicio)\s*[:\-]?\s*([^\n|\u00b7]{3,80})/i
  ];

  function canonicalDateText(value) {
    return normalize(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replaceAll('.', '');
  }

  function dateFromParts(year, month, day) {
    const result = new Date(year, month, day);
    if (result.getFullYear() !== year || result.getMonth() !== month || result.getDate() !== day) return null;
    return result.getTime() <= Date.now() + 86400000 ? result : null;
  }

  function parseMetaDate(value) {
    const months = { jan: 0, janeiro: 0, january: 0, fev: 1, fevereiro: 1, feb: 1, february: 1, mar: 2, marco: 2, march: 2, abr: 3, abril: 3, apr: 3, april: 3, mai: 4, maio: 4, may: 4, jun: 5, junho: 5, june: 5, jul: 6, julho: 6, ago: 7, agosto: 7, aug: 7, august: 7, set: 8, setembro: 8, sep: 8, sept: 8, september: 8, out: 9, outubro: 9, oct: 9, october: 9, nov: 10, novembro: 10, november: 10, dez: 11, dezembro: 11, dec: 11, december: 11 };
    const source = canonicalDateText(value);
    const iso = source.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
    if (iso) return dateFromParts(+iso[1], +iso[2] - 1, +iso[3]);
    const portuguese = source.match(/(\d{1,2})\s+de\s+([\p{L}]+)\s+de\s+(\d{4})/u);
    if (portuguese && months[portuguese[2]] !== undefined) return dateFromParts(+portuguese[3], months[portuguese[2]], +portuguese[1]);
    const monthFirst = source.match(/([a-z]+)\s+(\d{1,2}),?\s+(\d{4})/i);
    if (monthFirst && months[monthFirst[1]] !== undefined) return dateFromParts(+monthFirst[3], months[monthFirst[1]], +monthFirst[2]);
    const dayFirst = source.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/i);
    if (dayFirst && months[dayFirst[2]] !== undefined) return dateFromParts(+dayFirst[3], months[dayFirst[2]], +dayFirst[1]);
    const numeric = source.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\b/);
    if (!numeric) return null;
    const year = numeric[3].length === 2 ? 2000 + +numeric[3] : +numeric[3];
    const first = +numeric[1]; const second = +numeric[2];
    // Portuguese uses day/month; preserve an unambiguous month/day date when
    // the card is rendered in English.
    return first > 12 ? dateFromParts(year, second - 1, first) : second > 12 ? dateFromParts(year, first - 1, second) : dateFromParts(year, second - 1, first);
  }

  function findDate(text) {
    const source = canonicalDateText(text);
    for (const label of startDateLabels) {
      const found = source.match(label);
      const parsed = found && parseMetaDate(found[1]);
      if (parsed) return parsed;
    }
    const candidates = [
      ...source.matchAll(/\b\d{4}-\d{1,2}-\d{1,2}\b/g),
      ...source.matchAll(/\b[0-3]?\d\s+de\s+[\p{L}.]+\s+de\s+\d{4}\b/giu),
      ...source.matchAll(/\b[\p{L}.]+\s+[0-3]?\d,?\s+\d{4}\b/giu),
      ...source.matchAll(/\b[0-3]?\d\s+[\p{L}.]+\s+\d{4}\b/giu),
      ...source.matchAll(/\b[0-3]?\d[\/-][0-1]?\d[\/-]\d{2,4}\b/g)
    ].map(match => match[0]);
    return candidates.map(parseMetaDate).find(Boolean) || null;
  }

  function findDateInCard(card, visibleText) {
    const sources = new Set([visibleText]);
    card.querySelectorAll('[aria-label], [title], [data-tooltip-content], time[datetime]').forEach(element => {
      ['aria-label', 'title', 'data-tooltip-content', 'datetime'].forEach(attribute => {
        const value = element.getAttribute(attribute);
        if (value) sources.add(value);
      });
    });
    const expectedId = libraryId(visibleText);
    let parent = card.parentElement;
    // Some layouts split the ad header (with the start date) and creative
    // into sibling elements. Walk only through a wrapper that still contains
    // this one Library ID, never a wrapper with several ads.
    for (let depth = 0; parent && depth < 4; depth += 1, parent = parent.parentElement) {
      const parentText = normalize(parent.innerText || parent.textContent || '');
      const ids = [...canonicalDateText(parentText).matchAll(/(?:library\s*id|ad\s*library\s*id|id\s+da\s+biblioteca|identificacao\s+da\s+biblioteca)\s*[:#-]?\s*(\d{6,25})/gi)].map(match => match[1]);
      if (expectedId && ids.some(id => id !== expectedId)) break;
      if (parentText) sources.add(parentText);
    }
    for (const source of sources) {
      const parsed = findDate(source);
      if (parsed) return parsed;
    }
    return null;
  }

  function durationDays(start) {
    return Math.max(0, Math.floor((Date.now() - start.getTime()) / 86400000));
  }

  function cardKey(card, text) {
    const id = libraryId(text) || card.getAttribute('data-ad-id') || card.dataset.adId || card.querySelector('[id*="ad_id"]')?.id;
    if (id) return `id:${id}`;
    const link = [...card.querySelectorAll('a[href]')].map(a => a.href).find(href => /ad_library|ad\/library|id=/.test(href));
    if (link) return `link:${link}`;
    return `text:${text.slice(0, 280)}`;
  }

  function showCardStats(card, record, pageAdCount) {
    if (!record) return;
    const days = record.start ? durationDays(new Date(record.start)) : null;
    const adsLabel = pageAdCount === 1 ? '1 anúncio nesta página' : `${pageAdCount} anúncios nesta página`;
    const daysLabel = days === null ? 'data não identificada' : (days === 1 ? 'há 1 dia' : `há ${days} dias`);
    let badge = card.querySelector(':scope > .ad-library-radar-duration');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'ad-library-radar-duration';
      const downloadButton = card.querySelector(':scope > .ad-library-radar-download');
      if (downloadButton) card.insertBefore(badge, downloadButton);
      else card.appendChild(badge);
    }
    const nextText = `Blackspy: ${adsLabel} · ${daysLabel}`;
    if (badge.textContent !== nextText) badge.textContent = nextText;
  }

  function creativeUrls(card) {
    const urls = new Set();
    card.querySelectorAll('video').forEach(video => {
      [video.currentSrc, video.src, ...[...video.querySelectorAll('source')].map(source => source.src)].forEach(url => {
        if (/^https?:/i.test(url || '')) urls.add(url);
      });
    });
    card.querySelectorAll('img').forEach(image => {
      const box = image.getBoundingClientRect();
      if (image.naturalWidth >= 120 || image.naturalHeight >= 120 || box.width >= 120 || box.height >= 120) {
        const url = image.currentSrc || image.src;
        if (/^https?:/i.test(url || '')) urls.add(url);
      }
    });
    return [...urls];
  }

  function pageDetails(card, text) {
    const params = new URLSearchParams(location.search);
    const currentPageId = params.get('view_all_page_id');
    if (currentPageId) return { key: `page:${currentPageId}`, name: `Página ${currentPageId}`, libraryUrl: `https://www.facebook.com/ads/library/?view_all_page_id=${currentPageId}`, known: true };

    const pageId = text.match(/(?:Page ID|ID da Página)\s*[:#-]?\s*(\d{6,25})/iu)?.[1];
    if (pageId) return { key: `page:${pageId}`, name: `Página ${pageId}`, libraryUrl: `https://www.facebook.com/ads/library/?view_all_page_id=${pageId}`, known: true };

    const pageLink = [...card.querySelectorAll('a[href]')].find(link => {
      try {
        const url = new URL(link.href);
        return /(?:^|\.)facebook\.com$/i.test(url.hostname) && !/^\/ads\/library/i.test(url.pathname) && !/^\/l\.php/i.test(url.pathname) && normalize(link.textContent || '').length > 1;
      } catch { return false; }
    });
    if (pageLink) {
      const name = normalize(pageLink.textContent || '') || 'Página identificada';
      const url = new URL(pageLink.href);
      // Facebook often adds per-ad tracking parameters. Group by the profile
      // path so all ads from the same page share one filter counter.
      const profileUrl = `${url.origin}${url.pathname.replace(/\/$/, '')}`;
      return { key: `url:${profileUrl}`, name, libraryUrl: location.href, known: true };
    }
    // Do not turn an unavailable page identity into an empty filter result.
    // These cards remain visible until Meta exposes a usable page reference.
    return { key: 'page:desconhecida', name: 'Página não identificada', libraryUrl: location.href, known: false };
  }

  function adLibraryLink(key) {
    const id = key.match(/(?:^id:|(?:Library|Biblioteca).*?)(\d{6,25})/iu)?.[1];
    return id ? `https://www.facebook.com/ads/library/?id=${id}` : location.href;
  }

  function downloadBundle(card, text, key, button) {
    const media = creativeUrls(card);
    if (!media.length) {
      button.textContent = 'Mídia ainda não carregada';
      window.setTimeout(() => { button.textContent = 'Baixar criativo (.zip)'; }, 2200);
      return;
    }
    const start = findDateInCard(card, text);
    const record = { id: key, text, startedAt: start ? start.toISOString() : null, activeDays: start ? durationDays(start) : null, pageUrl: location.href };
    button.disabled = true;
    button.textContent = 'Preparando ZIP…';
    chrome.runtime.sendMessage({ type: 'DOWNLOAD_CREATIVE_BUNDLE', media, record }, response => {
      const error = chrome.runtime.lastError?.message || response?.error;
      button.textContent = error ? 'Não foi possível baixar' : 'ZIP baixado';
    if (error) console.warn('[Blackspy Meta Ads]', error);
      window.setTimeout(() => { button.disabled = false; button.textContent = 'Baixar criativo (.zip)'; }, 2200);
    });
  }

  function showDownloadButton(card) {
    if (card.querySelector(':scope > .ad-library-radar-download')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ad-library-radar-download';
    button.textContent = 'Baixar criativo (.zip)';
    button.title = 'Baixa a mídia e um arquivo de texto com o conteúdo do anúncio';
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const text = cardText(card);
      downloadBundle(card, text, cardKey(card, text), button);
    });
    card.appendChild(button);
  }

  function saveAd(card, button) {
    const text = cardText(card);
    const key = card.dataset.adLibraryRadarKey || cardKey(card, text);
    const saved = state.records.get(key);
    const start = findDateInCard(card, text);
    const page = pageDetails(card, text);
    const record = {
      ...saved,
      key,
      pageKey: page.known ? page.key : saved?.pageKey || page.key,
      pageName: page.known ? page.name : saved?.pageName || page.name,
      pageLibraryUrl: page.known ? page.libraryUrl : saved?.pageLibraryUrl || page.libraryUrl,
      start: start ? start.toISOString() : saved?.start || null,
      text,
      // Prefer the URLs in the currently visible card; URLs captured while
      // scrolling can expire before the user clicks Save.
      media: [...new Set([...(saved?.media || []), ...creativeUrls(card)])],
      adLibraryUrl: adLibraryLink(key)
    };
    button.disabled = true;
    button.textContent = 'Salvando…';
    chrome.runtime.sendMessage({ type: 'SAVE_AD_LOCALLY', record }, response => {
      const error = chrome.runtime.lastError?.message || response?.error;
      button.textContent = error ? 'Falha ao salvar' : 'Salvo localmente ✓';
    if (error) console.warn('[Blackspy Meta Ads]', error);
      window.setTimeout(() => { button.disabled = false; button.textContent = 'Salvar anúncio'; }, 2200);
    });
  }

  function showSaveButton(card) {
    if (card.querySelector(':scope > .ad-library-radar-save')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ad-library-radar-save';
    button.textContent = 'Salvar anúncio';
    button.title = 'Salva texto, dados e mídias neste navegador';
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      saveAd(card, button);
    });
    card.appendChild(button);
  }

  function isLikelyAdCard(element) {
    const text = normalize(element.innerText || '');
    return Boolean(libraryId(text)) || /(?:Biblioteca de Anúncios|Ad Library|Começou a (?:ser )?veiculad[oa]|Started running on)/iu.test(text);
  }

  function markerElements() {
    return [...document.querySelectorAll('div, article, section, span')].filter(element => {
      const text = normalize(element.textContent || '');
      if (!libraryId(text) || text.length > 300) return false;
      // Keep the smallest element that contains the complete Library ID.
      return ![...element.children].some(child => libraryId(child.textContent || ''));
    });
  }

  function cardFromMarker(marker, allMarkers) {
    let current = marker;
    let best = marker;
    for (let depth = 0; current && depth < 12; depth += 1, current = current.parentElement) {
      const containedMarkers = allMarkers.filter(other => current.contains(other)).length;
      if (containedMarkers > 1) break;
      best = current;
      if (current.querySelector('img, video, [role="img"]')) return current;
    }
    return best;
  }

  function discoveredCards() {
    const cards = new Set();
    selectors.forEach(selector => document.querySelectorAll(selector).forEach(card => {
      if (isLikelyAdCard(card)) cards.add(card);
    }));
    if (cards.size) return [...cards];

    const markers = markerElements();
    markers.forEach(marker => cards.add(cardFromMarker(marker, markers)));
    return [...cards].filter(card => card && card !== document.body && card !== document.documentElement && isLikelyAdCard(card));
  }

  function scan() {
    if (state.scanning) return;
    state.scanning = true;
    state.scanQueued = false;
    state.scanTimer = null;
    try {
      const cards = discoveredCards();
      const loadedKeys = new Set();
      const currentCards = new Map();

      cards.forEach(card => {
      const text = cardText(card);
      if (!text || !isLikelyAdCard(card)) return;
      const key = cardKey(card, text);
      loadedKeys.add(key);
      const existing = state.records.get(key);
      const start = existing?.start ? new Date(existing.start) : findDateInCard(card, text);
      const page = pageDetails(card, text);
      state.records.set(key, {
        key,
        pageKey: page.known ? page.key : existing?.pageKey || page.key,
        pageName: page.known ? page.name : existing?.pageName || page.name,
        pageLibraryUrl: page.known ? page.libraryUrl : existing?.pageLibraryUrl || page.libraryUrl,
        pageKnown: page.known || existing?.pageKnown || false,
        start: start ? start.toISOString() : existing?.start || null,
        text: text.slice(0, 3000),
        media: existing?.media?.length ? existing.media : creativeUrls(card),
        adLibraryUrl: adLibraryLink(key)
      });
      card.dataset.adLibraryRadarKey = key;
      currentCards.set(key, card);
      showDownloadButton(card);
      showSaveButton(card);
      });
      state.loadedCount = loadedKeys.size;
      state.currentCards = currentCards;
      const counts = pageCounts();
      state.currentCards.forEach((card, key) => showCardStats(card, state.records.get(key), counts.get(state.records.get(key)?.pageKey) || 1));
      applyFilters();
      updatePanel();
    } finally {
      state.scanning = false;
    }
  }

  function queueScan(delay = 450) {
    if (state.scanTimer) window.clearTimeout(state.scanTimer);
    state.scanQueued = true;
    state.scanTimer = window.setTimeout(scan, delay);
  }

  function pageCounts() {
    const counts = new Map();
    state.records.forEach(record => counts.set(record.pageKey, (counts.get(record.pageKey) || 0) + 1));
    return counts;
  }

  function recordMatchesFilters(record, counts = pageCounts()) {
    if (!record) return false;
    const pageTotal = counts.get(record.pageKey) || 0;
    if (record.pageKnown && pageTotal < state.filters.minPageAds) return false;
    if (state.filters.minDays > 0 && (!record.start || durationDays(new Date(record.start)) < state.filters.minDays)) return false;
    return true;
  }

  function cardIdCount(element) {
    const ids = new Set();
    element.querySelectorAll('div, article, section, span').forEach(child => {
      const id = libraryId(child.textContent || '');
      if (id) ids.add(id);
    });
    return ids.size;
  }

  function layoutItemForCard(card) {
    let item = card;
    for (let depth = 0; item?.parentElement && depth < 8; depth += 1) {
      const parent = item.parentElement;
      const display = getComputedStyle(parent).display;
      const isCollectionLayout = display.includes('grid') || display.includes('flex');
      // Hide the direct grid/flex child only when it belongs to one card. This
      // prevents accidentally hiding a whole results container.
      if (isCollectionLayout && cardIdCount(item) <= 1) return item;
      item = parent;
    }
    return card;
  }

  function applyFilters(cards = [...state.currentCards.values()]) {
    const counts = pageCounts();
    const shownKeys = new Set();
    state.filterTargets.forEach(target => target.classList.remove('ad-library-radar-filtered'));
    const nextTargets = new Set();
    cards.forEach(card => {
      const key = card.dataset.adLibraryRadarKey || cardKey(card, cardText(card));
      const record = state.records.get(key);
      // Meta may replace an element between scans. An unregistered element is
      // kept visible rather than incorrectly hidden by a stale filter state.
      const matches = !record || recordMatchesFilters(record, counts);
      const target = layoutItemForCard(card);
      target.classList.toggle('ad-library-radar-filtered', !matches);
      nextTargets.add(target);
      if (matches && record) shownKeys.add(key);
    });
    state.filterTargets = nextTargets;
    // Never leave the user with a blank list just because Meta replaced card
    // wrappers while a filter was being calculated.
    if (cards.length && !shownKeys.size && (state.filters.minPageAds > 1 || state.filters.minDays > 0)) {
      nextTargets.forEach(target => target.classList.remove('ad-library-radar-filtered'));
      state.filteredLoadedCount = state.loadedCount;
      if (state.panel) state.panel.querySelector('[data-note]').textContent = 'Não foi possível confirmar correspondências; os cartões foram mantidos visíveis.';
      return;
    }
    state.filteredLoadedCount = shownKeys.size;
  }

  function stats() {
    const records = [...state.records.values()];
    const dated = records.filter(record => record.start).map(record => durationDays(new Date(record.start)));
    return { total: records.length, loaded: state.loadedCount, filteredLoaded: state.filteredLoadedCount, dated: dated.length, oldest: dated.length ? Math.max(...dated) : null };
  }

  function formatDays(days) {
    if (days === null) return '—';
    if (days === 1) return '1 dia';
    return `${days} dias`;
  }

  function updatePanel() {
    if (!state.panel) return;
    const { total, loaded, filteredLoaded, dated, oldest } = stats();
    state.panel.querySelector('[data-total]').textContent = total;
    state.panel.querySelector('[data-loaded]').textContent = loaded;
    state.panel.querySelector('[data-filtered]').textContent = filteredLoaded;
    state.panel.querySelector('[data-dated]').textContent = dated ? `${dated} com data` : 'aguardando';
    state.panel.querySelector('[data-oldest]').textContent = formatDays(oldest);
    state.panel.querySelector('[data-status]').classList.toggle('running', state.running);
    state.panel.querySelector('[data-status-text]').textContent = state.running ? 'Rolagem automática ativa' : 'Pronto para analisar';
    state.panel.querySelector('[data-scroll]').textContent = state.running ? 'Pausar rolagem' : 'Iniciar rolagem';
    state.panel.querySelector('[data-scroll]').className = state.running ? 'stop' : '';
  }

  function scrollStep() {
    if (!state.followBottom) return;
    const page = document.documentElement;
    window.scrollTo({ top: Math.max(page.scrollHeight, document.body?.scrollHeight || 0), behavior: 'auto' });
    window.setTimeout(() => {
      scan();
    }, Math.min(700, state.speed - 100));
  }

  function startAutoScroll() {
    if (state.running) return;
    state.running = true;
    scrollStep();
    state.interval = window.setInterval(scrollStep, state.speed);
    updatePanel();
  }

  function stopAutoScroll(note = 'Acompanhamento do fim pausado.') {
    state.running = false;
    if (state.interval) window.clearInterval(state.interval);
    state.interval = null;
    if (state.panel) state.panel.querySelector('[data-note]').textContent = note;
    updatePanel();
  }

  function downloadCsv() {
    const rows = [['identificador', 'inicio', 'dias_ativo', 'texto']];
    [...state.records.values()].forEach(record => rows.push([record.key, record.start || '', record.start ? durationDays(new Date(record.start)) : '', record.text]));
    const escape = value => `"${String(value).replaceAll('"', '""')}"`;
    const csv = '\uFEFF' + rows.map(row => row.map(escape).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `anuncios-meta-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function downloadAllBundles(button) {
    const counts = pageCounts();
    const records = [...state.records.values()];
    if (!records.length) {
      state.panel.querySelector('[data-note]').textContent = 'Nenhuma oferta foi carregada ainda.';
      return;
    }
    button.disabled = true;
    button.textContent = 'Montando biblioteca…';
    chrome.runtime.sendMessage({ type: 'DOWNLOAD_CREATIVE_LIBRARY', records, summary: { totalFound: state.records.size, pageCounts: [...counts] } }, response => {
      const error = chrome.runtime.lastError?.message || response?.error;
      state.panel.querySelector('[data-note]').textContent = error ? `Falha: ${error}` : `${records.length} ofertas exportadas para o ZIP.`;
      button.disabled = false;
      button.textContent = 'Baixar todas em ZIP';
    });
  }

  function createPanel() {
    const host = document.createElement('aside');
    host.id = 'ad-library-radar';
    host.innerHTML = `
      <section class="radar-card">
        <header class="radar-head"><span class="radar-brand"><span class="radar-mark">◉</span> Blackspy Meta Ads</span><button class="radar-toggle" title="Recolher" aria-label="Recolher painel">−</button></header>
        <div class="radar-body">
          <div class="radar-grid">
            <div class="radar-metric"><span class="radar-label">Anúncios encontrados</span><strong class="radar-value" data-total>0</strong><span class="radar-sub"><b data-loaded>0</b> carregados · <b data-filtered>0</b> exibidos</span></div>
            <div class="radar-metric"><span class="radar-label">Maior tempo ativo</span><strong class="radar-value" data-oldest>—</strong><span class="radar-sub" data-dated>aguardando</span></div>
          </div>
          <div class="radar-row"><button type="button" data-scroll>Acompanhar fim</button><button type="button" class="secondary" data-export>Exportar CSV</button></div>
          <div class="radar-setting radar-filters">
            <span class="radar-label">Filtros dos cartões carregados</span>
            <label>Mín. anúncios da mesma página<select data-min-page-ads><option value="1">1 anúncio</option><option value="2">2 anúncios</option><option value="3">3 anúncios</option><option value="5">5 anúncios</option><option value="10">10 anúncios</option></select></label>
            <label>Mín. dias ativo<input data-min-days type="number" min="0" value="0" inputmode="numeric"></label>
          </div>
          <div class="radar-row"><button type="button" class="secondary" data-reset-filters>Limpar filtros</button><button type="button" data-download-all>Baixar todas em ZIP</button></div>
          <div class="radar-row"><button type="button" class="secondary" data-saved>★ Anúncios salvos</button></div>
          <div class="radar-setting"><span class="radar-label">Intervalo da rolagem: <span data-speed>1,0 s</span></span><input data-speed-input type="range" min="600" max="3000" step="200" value="1000"></div>
          <p class="radar-note"><i class="radar-status" data-status></i><span data-status-text>Pronto para analisar</span></p>
        </div>
      </section>`;
    document.documentElement.appendChild(host);
    state.panel = host;
    host.querySelector('[data-scroll]').addEventListener('click', () => state.running ? stopAutoScroll() : startAutoScroll());
    host.querySelector('[data-export]').addEventListener('click', downloadCsv);
    host.querySelector('[data-download-all]').addEventListener('click', event => downloadAllBundles(event.currentTarget));
    host.querySelector('[data-saved]').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'OPEN_SAVED_ADS' }));
    host.querySelector('[data-min-page-ads]').addEventListener('change', event => { state.filters.minPageAds = +event.target.value; applyFilters(); updatePanel(); });
    host.querySelector('[data-min-days]').addEventListener('change', event => { state.filters.minDays = Math.max(0, +event.target.value || 0); event.target.value = state.filters.minDays; applyFilters(); updatePanel(); });
    host.querySelector('[data-reset-filters]').addEventListener('click', () => {
      state.filters = { minPageAds: 1, minDays: 0 };
      host.querySelector('[data-min-page-ads]').value = '1';
      host.querySelector('[data-min-days]').value = '0';
      applyFilters(); updatePanel();
    });
    host.querySelector('.radar-toggle').addEventListener('click', event => { event.stopPropagation(); host.classList.toggle('is-collapsed'); });
    host.querySelector('[data-speed-input]').addEventListener('input', event => {
      state.speed = +event.target.value;
      host.querySelector('[data-speed]').textContent = `${(state.speed / 1000).toFixed(1).replace('.', ',')} s`;
      if (state.running) { stopAutoScroll('Velocidade atualizada.'); startAutoScroll(); }
    });
    makeDraggable(host, host.querySelector('.radar-head'));
    updatePanel();
  }

  function makeDraggable(element, handle) {
    let startX, startY, originX, originY;
    handle.addEventListener('pointerdown', event => {
      if (event.target.closest('button')) return;
      startX = event.clientX; startY = event.clientY;
      const box = element.getBoundingClientRect(); originX = box.left; originY = box.top;
      handle.setPointerCapture(event.pointerId);
      const move = moveEvent => { element.style.left = `${Math.max(0, originX + moveEvent.clientX - startX)}px`; element.style.top = `${Math.max(0, originY + moveEvent.clientY - startY)}px`; element.style.right = 'auto'; };
      const end = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end);
    });
  }

  function init() {
    if (state.initialized || !isLibraryRoute()) return;
    state.initialized = true;
    if (state.routeWatcher) window.clearInterval(state.routeWatcher);
    createPanel();
    scan();
    state.observer = new MutationObserver(mutations => {
      // Ignore our own labels/buttons. Meta batches many changes while
      // scrolling, so wait for that batch to settle before one full scan.
      const pageChanged = mutations.some(mutation => {
        const element = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
        return !element?.closest('#ad-library-radar, .ad-library-radar-duration, .ad-library-radar-download, .ad-library-radar-save');
      });
      if (pageChanged) queueScan();
    });
    state.observer.observe(document.body, { childList: true, subtree: true });
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message.type === 'SHOW_PANEL') {
      init();
      if (state.panel) state.panel.style.display = '';
    }
    if (message.type === 'TOGGLE_PANEL') {
      init();
      if (state.panel) state.panel.style.display = state.panel.style.display === 'none' ? '' : 'none';
    }
  });

  init();
  // Facebook changes routes without a document reload. This content script is
  // registered on Facebook itself, then becomes active only in the Ad Library.
  if (!state.initialized) {
    state.routeWatcher = window.setInterval(init, 500);
  }
})();
