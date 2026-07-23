export let currentActiveTab = 'url';
export let currentMode = 'url';

export function logToTerminal(message, type = 'info', mode = null) {
    const targetMode = mode || currentActiveTab;
    const logOutput = document.getElementById(`log-output-${targetMode}`);
    const logContainer = document.getElementById(`log-container-${targetMode}`);

    if (!logOutput) return;

    const li = document.createElement('li');
    li.textContent = `[${targetMode.toUpperCase()}] ${message}`;
    switch(type) {
        case 'error': li.className = 'text-red-400'; break;
        case 'success': li.className = 'text-emerald-400'; break;
        case 'warn': li.className = 'text-amber-400'; break;
        default: li.className = 'text-slate-300';
    }
    logOutput.appendChild(li);
    if (logContainer) {
        logContainer.scrollTop = logContainer.scrollHeight;
    }
}

export function openExtensionModal() {
    const modal = document.getElementById('extension-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

export function closeExtensionModal() {
    const modal = document.getElementById('extension-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

export function switchExtTab(browser) {
    const browsers = ['chrome', 'edge', 'whale', 'opera', 'firefox'];
    browsers.forEach(b => {
        const tabBtn = document.getElementById(`ext-tab-${b}`);
        const content = document.getElementById(`ext-content-${b}`);
        if (!tabBtn || !content) return;
        
        if (b === browser) {
            tabBtn.className = 'px-4 py-3 text-xs font-bold text-emerald-300 border-b-2 border-emerald-400 transition-all whitespace-nowrap';
            content.classList.remove('hidden');
            content.classList.add('block');
        } else {
            tabBtn.className = 'px-4 py-3 text-xs font-medium text-slate-400 border-b-2 border-transparent hover:text-emerald-100 transition-all whitespace-nowrap';
            content.classList.add('hidden');
            content.classList.remove('block');
        }
    });
}

export function switchTab(tabId) {
    currentActiveTab = tabId;
    currentMode = tabId;
    
    document.getElementById('view-url').classList.add('hidden');
    document.getElementById('view-account').classList.add('hidden');
    document.getElementById(`view-${tabId}`).classList.remove('hidden');

    const urlTab = document.getElementById('tab-url');
    const accountTab = document.getElementById('tab-account');
    
    const inactiveClasses = ['font-medium', 'text-slate-400', 'bg-transparent', 'border-transparent', 'hover:text-slate-200', 'hover:bg-white/5'];
    const activeClasses = ['font-bold', 'text-emerald-300', 'bg-white/5', 'border-emerald-400'];

    urlTab.classList.remove(...activeClasses);
    urlTab.classList.add(...inactiveClasses);
    accountTab.classList.remove(...activeClasses);
    accountTab.classList.add(...inactiveClasses);

    const activeElem = document.getElementById(`tab-${tabId}`);
    activeElem.classList.remove(...inactiveClasses);
    activeElem.classList.add(...activeClasses);

    const galleryContainer = document.getElementById('gallery-container');
    const mediaGrid = document.getElementById('media-grid');
    if (galleryContainer) galleryContainer.classList.add('hidden');
    if (mediaGrid) mediaGrid.innerHTML = '';
    
    // reset selected in downloader.js? 
    // Need to do this carefully if they are decoupled

    localStorage.setItem('ameva_last_tab', tabId);
}

export function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        alert('주소가 클립보드에 복사되었습니다!\\n주소창에 붙여넣기 해주세요.');
    }).catch(err => {
        console.error('복사 실패:', err);
    });
}
