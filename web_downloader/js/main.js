import { initWASM, pyodideReady, pyodideInstance } from './core.js';
import { switchTab, switchExtTab, openExtensionModal, closeExtensionModal, logToTerminal, copyToClipboard } from './ui.js';
import { parseTikTokUrl, parseTikTokAccount } from './parser_tiktok.js';
import { parseInstagramUrl, parseInstagramAccount } from './parser_instagram.js';
import { downloadSingleBlob, downloadSelectedMedia, selectAllMedia, renderRealGallery } from './downloader.js';
import { openHistoryModal, closeHistoryModal, clearHistory } from './history.js';

// Load components
async function loadComponents() {
    const components = [
        { id: 'comp-view-url', url: 'components/view_url.html' },
        { id: 'comp-view-account', url: 'components/view_account.html' },
        { id: 'comp-gallery', url: 'components/gallery.html' },
        { id: 'comp-modal-ext', url: 'components/modal_extension.html' },
        { id: 'comp-modal-contact', url: 'components/modal_contact.html' },
        { id: 'comp-modal-history', url: 'components/modal_history.html' }
    ];

    for (const comp of components) {
        const res = await fetch(comp.url);
        const html = await res.text();
        const el = document.getElementById(comp.id);
        if (el) el.innerHTML = html;
    }
}

async function startUrlDownload() {
    const urlInput = document.getElementById('url-input')?.value.trim();
    if (!urlInput) {
        logToTerminal('다운로드할 URL을 입력해주세요.', 'error', 'url');
        return;
    }

    logToTerminal(`미디어 추출 시작: ${urlInput}`, 'info', 'url');
    const btnDownloadUrl = document.getElementById('btn-download-url');
    if (btnDownloadUrl) {
        btnDownloadUrl.disabled = true;
        btnDownloadUrl.innerHTML = '<span class="animate-pulse">분석 중...</span>';
    }

    try {
        let mediaItems = [];
        let title = 'AMEVA_Media';

        if (urlInput.includes('tiktok.com')) {
            mediaItems = await parseTikTokUrl(urlInput);
            title = mediaItems[0]?.filename?.split('.')[0] || 'TikTok_Download';
        } else if (urlInput.includes('instagram.com')) {
            const result = await parseInstagramUrl(urlInput);
            mediaItems = result.mediaItems;
            title = result.title;
        }

        if (mediaItems.length === 0 && pyodideReady) {
            logToTerminal('WASM Pyodide 백업 파서 실행 중...', 'warn', 'url');
            const pyCode = `
import yt_dlp, json
ydl_opts = {'quiet': True, 'skip_download': True}
url = "${urlInput}"
res = ""
try:
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        res = json.dumps(ydl.extract_info(url, download=False))
except Exception as e:
    res = json.dumps({"error": str(e)})
res
            `;
            const pyResStr = await pyodideInstance.runPythonAsync(pyCode);
            const pyRes = JSON.parse(pyResStr);
            if (pyRes.url) {
                mediaItems.push({ type: 'video', url: pyRes.url, filename: `${title}_fallback.mp4` });
            }
        }

        if (mediaItems.length === 0) {
            throw new Error('페이지에서 미디어를 추출할 수 없거나 비공개 게시물입니다.');
        }

        if (mediaItems.length === 1) {
            logToTerminal(`추출 성공! 다운로드 시작...`, 'success', 'url');
            await downloadSingleBlob(mediaItems[0].url, mediaItems[0].filename, 'url');
            logToTerminal('✅ 다운로드가 완료되었습니다!', 'success', 'url');
        } else {
            logToTerminal(`여러 개의 파일 압축(ZIP) 진행 중...`, 'info', 'url');
            if (typeof JSZip === 'undefined') throw new Error("JSZip 라이브러리가 로드되지 않았습니다.");
            
            const zip = new JSZip();
            for (let i = 0; i < mediaItems.length; i++) {
                logToTerminal(`[${i+1}/${mediaItems.length}] ${mediaItems[i].filename} 가져오는 중...`, 'info', 'url');
                const fileRes = await fetch(mediaItems[i].url);
                const fileBlob = await fileRes.blob();
                zip.file(mediaItems[i].filename, fileBlob);
            }
            
            logToTerminal('ZIP 압축 생성 중...', 'info', 'url');
            const content = await zip.generateAsync({type:"blob"});
            const blobUrl = URL.createObjectURL(content);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = `${title}_bundle.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
            logToTerminal('✅ ZIP 일괄 다운로드가 완료되었습니다!', 'success', 'url');
        }

    } catch (error) {
        logToTerminal(`추출 실패: ${error.message}`, 'error', 'url');
    } finally {
        if (btnDownloadUrl) {
            btnDownloadUrl.disabled = false;
            btnDownloadUrl.innerHTML = '추출 및 다운로드';
        }
    }
}

let currentAccountCursor = 0;
let currentAccountInput = '';
let currentAccountPlatform = '';

async function startAccountSearch(isLoadMoreArg = false) {
    // Prevent DOM Event object from being treated as true
    const isLoadMore = isLoadMoreArg === true;
    
    const platform = document.getElementById('platform-select')?.value;
    const accountInput = document.getElementById('account-input')?.value.replace('@', '').trim();
    
    if (!accountInput) {
        logToTerminal('계정 아이디를 입력해주세요.', 'error', 'account');
        return;
    }

    if (!isLoadMore) {
        currentAccountCursor = 0;
        currentAccountInput = accountInput;
        currentAccountPlatform = platform;
    }

    const btnText = isLoadMore ? '더보기 로딩 중...' : '스캔 중...';
    logToTerminal(`@${currentAccountInput} 계정의 ${currentAccountPlatform} 미디어 스캔 중... (Cursor: ${currentAccountCursor})`, 'info', 'account');
    
    const btnSearchAccount = document.getElementById('btn-search-account');
    if (btnSearchAccount && !isLoadMore) {
        btnSearchAccount.disabled = true;
        btnSearchAccount.innerHTML = `<span class="animate-pulse">${btnText}</span>`;
    }

    const loadMoreBtn = document.getElementById('btn-load-more');
    if (loadMoreBtn && isLoadMore) {
        loadMoreBtn.disabled = true;
        loadMoreBtn.innerHTML = `<span class="animate-pulse">${btnText}</span>`;
    }

    try {
        let result = { items: [], cursor: 0, hasMore: false };
        if (currentAccountPlatform === 'tiktok') {
            result = await parseTikTokAccount(currentAccountInput, currentAccountCursor);
        } else if (currentAccountPlatform === 'instagram') {
            // Instagram currently returns just an array, we can wrap it
            const igItems = await parseInstagramAccount(currentAccountInput);
            result = { items: igItems, cursor: 0, hasMore: false };
        }

        if (!result || !result.items || result.items.length === 0) {
            if (!isLoadMore) {
                throw new Error('모든 폴백 엔진(API -> 크롤러 -> WASM Pyodide)이 실패했습니다. 계정이 비공개이거나 차단되었습니다.');
            } else {
                logToTerminal('더 이상 불러올 데이터가 없습니다.', 'warn', 'account');
                return;
            }
        }

        currentAccountCursor = result.cursor;
        
        logToTerminal(`스캔 성공! ${result.items.length}개의 미디어를 불러왔습니다.`, 'success', 'account');
        
        // Pass result and isLoadMore to downloader
        renderRealGallery(result.items, isLoadMore, result.hasMore, loadMoreAccountMedia);

    } catch (error) {
        logToTerminal(`스캔 실패: ${error.message}`, 'error', 'account');
    } finally {
        if (btnSearchAccount && !isLoadMore) {
            btnSearchAccount.disabled = false;
            btnSearchAccount.innerHTML = '계정 전체 미디어 스캔';
        }
        if (loadMoreBtn && isLoadMore) {
            loadMoreBtn.disabled = false;
            loadMoreBtn.innerHTML = '더보기 (Load More)';
        }
    }
}

export function loadMoreAccountMedia() {
    startAccountSearch(true);
}

function bindEvents() {
    // Top nav & tabs
    document.getElementById('btn-open-history')?.addEventListener('click', openHistoryModal);
    document.getElementById('btn-open-ext-modal')?.addEventListener('click', openExtensionModal);
    document.getElementById('tab-url')?.addEventListener('click', () => switchTab('url'));
    document.getElementById('tab-account')?.addEventListener('click', () => switchTab('account'));
    document.getElementById('btn-open-contact-modal')?.addEventListener('click', () => {
        const m = document.getElementById('contact-modal');
        if(m) m.classList.remove('hidden');
    });

    // Actions
    document.getElementById('btn-download-url')?.addEventListener('click', startUrlDownload);
    document.getElementById('btn-search-account')?.addEventListener('click', startAccountSearch);
    document.getElementById('btn-select-all')?.addEventListener('click', selectAllMedia);
    document.getElementById('btn-download-selected')?.addEventListener('click', downloadSelectedMedia);
    
    // Auth & Other
    document.getElementById('btn-ig-login')?.addEventListener('click', () => {
        window.open('https://www.instagram.com', 'igLogin', 'width=600,height=700');
    });

    // Clear Logs
    document.getElementById('btn-clear-log-url')?.addEventListener('click', () => {
        const el = document.getElementById('log-output-url');
        if(el) el.innerHTML = '';
    });
    document.getElementById('btn-clear-log-account')?.addEventListener('click', () => {
        const el = document.getElementById('log-output-account');
        if(el) el.innerHTML = '';
    });

    // Modals
    document.getElementById('btn-close-ext-modal')?.addEventListener('click', closeExtensionModal);
    document.getElementById('btn-close-ext-modal-footer')?.addEventListener('click', closeExtensionModal);
    document.getElementById('btn-close-contact-modal')?.addEventListener('click', () => {
        const m = document.getElementById('contact-modal');
        if(m) m.classList.add('hidden');
    });
    document.getElementById('btn-close-history-modal')?.addEventListener('click', closeHistoryModal);
    document.getElementById('btn-clear-history')?.addEventListener('click', clearHistory);
    
    // Ext Tabs
    const extBrowsers = ['chrome', 'edge', 'whale', 'opera', 'firefox'];
    extBrowsers.forEach(b => {
        document.getElementById(`ext-tab-${b}`)?.addEventListener('click', () => switchExtTab(b));
    });

    // Copy text
    document.querySelectorAll('.copy-text').forEach(el => {
        el.addEventListener('click', () => {
            if(el.dataset.text) copyToClipboard(el.dataset.text);
        });
    });

    // Platform change storage
    const platformSelect = document.getElementById('platform-select');
    if (platformSelect) {
        platformSelect.addEventListener('change', (e) => {
            localStorage.setItem('ameva_last_platform', e.target.value);
        });
    }
}

window.addEventListener('DOMContentLoaded', async () => {
    // 1. Load HTML components
    await loadComponents();
    
    // 2. Bind DOM Events
    bindEvents();

    // 3. Init engines
    initWASM();
    
    // Restore state from localStorage
    const lastTab = localStorage.getItem('ameva_last_tab') || 'url';
    const lastPlatform = localStorage.getItem('ameva_last_platform') || 'tiktok';
    
    switchTab(lastTab);
    
    const platformSelect = document.getElementById('platform-select');
    if (platformSelect) {
        platformSelect.value = lastPlatform;
    }
});
