import { saveToHistory } from './history.js';
import { logToTerminal } from './ui.js';
import { extBridgeReady } from './core.js';

export let selectedMediaItems = new Set();
export let currentScrapedItemsMap = new Map();

// -------------------------------------------------------------
// Gallery Rendering
// -------------------------------------------------------------
export function renderRealGallery(items, isAppend = false, hasMore = false, loadMoreCallback = null) {
    const galleryContainer = document.getElementById('gallery-container');
    const mediaGrid = document.getElementById('media-grid');
    const loadMoreContainer = document.getElementById('load-more-container');
    const btnLoadMore = document.getElementById('btn-load-more');
    
    galleryContainer.classList.remove('hidden');
    
    if (!isAppend) {
        mediaGrid.innerHTML = '';
        selectedMediaItems.clear();
        currentScrapedItemsMap.clear();
        updateDownloadButtonText();
    }

    const history = JSON.parse(localStorage.getItem('ameva_download_history') || '[]');
    const downloadedIds = new Set(history.map(item => item.mediaId).filter(id => id));

    items.forEach(item => {
        // Prevent duplicates in append mode
        if (currentScrapedItemsMap.has(item.id)) return;
        
        currentScrapedItemsMap.set(item.id, item);
        const isDownloaded = downloadedIds.has(item.id);

        const card = document.createElement('div');
        card.className = 'gallery-item relative rounded-xl overflow-hidden bg-slate-900 border border-slate-800 aspect-[9/16] cursor-pointer group';
        card.onclick = (e) => toggleMediaSelection(item.id, card, e);

        card.innerHTML = `
            <img src="${item.thumb}" class="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" alt="thumbnail">
            
            <div class="absolute top-2 right-2 z-10">
                <input type="checkbox" class="media-item-checkbox pointer-events-none" id="checkbox-${item.id}">
            </div>
            
            <div class="absolute bottom-0 inset-x-0 bg-gradient-to-t from-slate-950 to-transparent p-3 pt-8">
                <span class="inline-block px-1.5 py-0.5 bg-slate-900/90 rounded text-[10px] font-bold ${item.type === 'video' ? 'text-blue-400' : 'text-pink-400'} mb-1 border border-slate-800">
                    ${item.type.toUpperCase()}
                </span>
                ${isDownloaded ? '<span class="inline-block ml-1 px-1.5 py-0.5 bg-emerald-500/90 rounded text-[10px] font-bold text-slate-950 mb-1 border border-emerald-400">✓ 다운로드됨</span>' : ''}
                <p class="text-white text-xs font-medium truncate">${item.title}</p>
            </div>
        `;
        mediaGrid.appendChild(card);
    });

    if (hasMore && loadMoreContainer && btnLoadMore) {
        loadMoreContainer.classList.remove('hidden');
        // Clean up old listener safely by cloning or rewriting onclick
        btnLoadMore.onclick = () => {
            if (typeof loadMoreCallback === 'function') {
                loadMoreCallback();
            }
        };
    } else if (loadMoreContainer) {
        loadMoreContainer.classList.add('hidden');
    }
}

export function toggleMediaSelection(id, cardElement, event) {
    const checkbox = cardElement.querySelector('input[type="checkbox"]');
    if (selectedMediaItems.has(id)) {
        selectedMediaItems.delete(id);
        cardElement.classList.remove('selected');
        checkbox.checked = false;
    } else {
        selectedMediaItems.add(id);
        cardElement.classList.add('selected');
        checkbox.checked = true;
    }
    updateDownloadButtonText();
}

export function selectAllMedia() {
    const isAllSelected = selectedMediaItems.size > 0 && selectedMediaItems.size === currentScrapedItemsMap.size;
    
    document.querySelectorAll('.gallery-item').forEach(card => {
        const checkbox = card.querySelector('input[type="checkbox"]');
        const id = checkbox.id.replace('checkbox-', '');
        
        if (isAllSelected) {
            selectedMediaItems.delete(id);
            card.classList.remove('selected');
            checkbox.checked = false;
        } else {
            selectedMediaItems.add(id);
            card.classList.add('selected');
            checkbox.checked = true;
        }
    });
    updateDownloadButtonText();
}

function updateDownloadButtonText() {
    const btnDownloadSelected = document.getElementById('btn-download-selected');
    if(!btnDownloadSelected) return;
    
    btnDownloadSelected.textContent = `선택 다운로드 (${selectedMediaItems.size})`;
    if (selectedMediaItems.size > 0) {
        btnDownloadSelected.classList.remove('opacity-50', 'cursor-not-allowed');
    } else {
        btnDownloadSelected.classList.add('opacity-50', 'cursor-not-allowed');
    }
}

// -------------------------------------------------------------
// Downloading Logic
// -------------------------------------------------------------
export async function downloadSingleBlob(url, filename, mode = 'url') {
    const fileRes = await fetch(url);
    const fileBlob = await fileRes.blob();
    const blobUrl = URL.createObjectURL(fileBlob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
    saveToHistory(filename, url, mode !== 'url' ? mode : null); 
}

export async function downloadSelectedMedia() {
    if (selectedMediaItems.size === 0) return;
    
    const history = JSON.parse(localStorage.getItem('ameva_download_history') || '[]');
    const downloadedIds = new Set(history.map(item => item.mediaId).filter(id => id));
    
    const duplicateItems = [];
    for (const id of selectedMediaItems) {
        if (downloadedIds.has(id)) {
            const item = currentScrapedItemsMap.get(id);
            if (item) duplicateItems.push(item);
        }
    }

    if (duplicateItems.length > 0) {
        return new Promise((resolve) => {
            const modal = document.getElementById('redownload-modal');
            const list = document.getElementById('redownload-list');
            const confirmBtn = document.getElementById('btn-confirm-redownload');
            
            list.innerHTML = duplicateItems.map(item => `<li>• ${item.title}</li>`).join('');
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            
            confirmBtn.onclick = async () => {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
                await executeBatchDownload();
                resolve();
            };
            
            document.getElementById('btn-close-redownload-modal').onclick = 
            document.getElementById('btn-cancel-redownload').onclick = () => {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
                logToTerminal('다운로드가 취소되었습니다.', 'warn', 'account');
                resolve();
            };
        });
    } else {
        await executeBatchDownload();
    }
}

export async function executeBatchDownload() {
    logToTerminal(`선택한 ${selectedMediaItems.size}개 미디어 일괄 다운로드를 시작합니다...`, 'info', 'account');

    for (const id of selectedMediaItems) {
        const item = currentScrapedItemsMap.get(id);
        if (!item || !item.url) continue;

        try {
            logToTerminal(`다운로드 중: ${item.title}...`, 'info', 'account');
            let downloadUrl = item.url;
            
            if (downloadUrl.includes('tiktok.com') && !downloadUrl.includes('.mp4') && !downloadUrl.includes('tikwm')) {
                logToTerminal(`원본 URL 변환 중...`, 'info', 'account');
                const tikwmRes = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(downloadUrl)}`);
                const tikwmJson = await tikwmRes.json();
                if (tikwmJson.data && tikwmJson.data.play) {
                    downloadUrl = tikwmJson.data.play.startsWith('http') 
                        ? tikwmJson.data.play 
                        : "https://www.tikwm.com" + tikwmJson.data.play;
                } else {
                    throw new Error('원본 비디오 링크를 추출하지 못했습니다.');
                }
            }
            
            await downloadSingleBlob(downloadUrl, `${item.title}_${Date.now()}.${item.type === 'video' ? 'mp4' : 'jpg'}`, item.id);
            logToTerminal(`✅ 저장 완료: ${item.title}`, 'success', 'account');
        } catch (e) {
            logToTerminal(`❌ 저장 실패 (${item.title}): ${e.message}`, 'error', 'account');
            if (e.message.includes('Failed to fetch') && !extBridgeReady) {
                logToTerminal('확장프로그램이 설치되지 않아 CORS 차단이 발생했을 수 있습니다.', 'warn', 'account');
            }
        }
    }

    logToTerminal('🎉 일괄 다운로드 작업이 완료되었습니다!', 'success', 'account');
}
