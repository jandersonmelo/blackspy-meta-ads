const status = document.querySelector('#status');
const openButton = document.querySelector('#open-panel');

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function setup() {
  const tab = await currentTab();
  const isLibrary = tab?.url && /^https:\/\/(?:www\.|web\.)?facebook\.com\/ads\/library(?:\/|\?|$)/i.test(tab.url);
  if (!isLibrary) {
    status.textContent = 'Abra a Biblioteca de Anúncios da Meta nesta aba para usar a extensão.';
    openButton.disabled = true;
    return;
  }
  status.textContent = 'Pronto. Use o botão para abrir ou recolher o painel.';
  openButton.addEventListener('click', async () => {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'SHOW_PANEL' });
    } catch {
      // Fallback for when the user navigated to the library within Facebook's
      // single-page app and the declarative content script has not run yet.
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content.css'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tab.id, { type: 'SHOW_PANEL' });
    }
    window.close();
  });
}

setup().catch(() => {
  status.textContent = 'Recarregue a página da Biblioteca de Anúncios e tente novamente.';
  openButton.disabled = true;
});
