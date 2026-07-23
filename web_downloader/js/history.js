import { downloadSingleBlob } from './downloader.js';

export function generateUUID() {
    if (crypto && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

export function saveToHistory(filename, url, mediaId = null) {
    try {
        const history = JSON.parse(localStorage.getItem('ameva_download_history') || '[]');
        const type = filename.endsWith('.mp4') ? 'VIDEO' : (filename.endsWith('.zip') ? 'ZIP' : 'PHOTO');
        const now = new Date();
        const timeStr = now.toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' });
        
        history.unshift({
            uuid: generateUUID(),
            timestamp: timeStr,
            date: now.toLocaleDateString('ko-KR'),
            filename: filename,
            url: url,
            type: type,
            mediaId: mediaId
        });
        
        if (history.length > 2000) history.length = 2000;
        
        localStorage.setItem('ameva_download_history', JSON.stringify(history));
    } catch (e) {
        console.error("History save error:", e);
    }
}

export function renderHistory() {
    const tbody = document.getElementById('history-table-body');
    if (!tbody) return;
    
    try {
        const history = JSON.parse(localStorage.getItem('ameva_download_history') || '[]');
        tbody.innerHTML = '';
        
        if (history.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="py-8 text-center text-slate-500">다운로드 기록이 없습니다.</td></tr>`;
            return;
        }
        
        history.forEach(item => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-slate-900/50 transition-colors group';
            
            let typeColor = 'text-slate-400';
            if (item.type === 'VIDEO') typeColor = 'text-blue-400';
            else if (item.type === 'PHOTO') typeColor = 'text-pink-400';
            else if (item.type === 'ZIP') typeColor = 'text-amber-400';
            
            tr.innerHTML = `
                <td class="py-3 px-4 text-emerald-100">
                    <div class="text-xs text-slate-400">${item.date}</div>
                    ${item.timestamp}
                </td>
                <td class="py-3 px-4">
                    <span class="inline-block px-1.5 py-0.5 bg-black/40 rounded text-[10px] font-bold border border-white/5 ${typeColor}">
                        ${item.type}
                    </span>
                </td>
                <td class="py-3 px-4 text-emerald-100 font-medium truncate max-w-[250px]" title="${item.filename}">
                    ${item.filename}
                </td>
                <td class="py-3 px-4 text-center">
                    <div class="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button class="btn-share-history px-2 py-1 bg-white/5 hover:bg-emerald-500/20 text-emerald-300 rounded text-xs font-semibold transition-colors border border-transparent hover:border-emerald-500/30" data-url="${item.url}" title="클립보드에 주소 복사">
                            공유
                        </button>
                        <button class="btn-redownload-history px-2 py-1 bg-white/5 hover:bg-emerald-500/20 text-emerald-300 rounded text-xs font-semibold transition-colors border border-transparent hover:border-emerald-500/30" data-url="${item.url}" data-filename="${item.filename}" title="다시 다운로드">
                            재다운로드
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // Event listeners
        document.querySelectorAll('.btn-share-history').forEach(btn => {
            btn.onclick = () => shareHistoryItem(btn.dataset.url);
        });
        document.querySelectorAll('.btn-redownload-history').forEach(btn => {
            btn.onclick = () => redownloadHistoryItem(btn.dataset.url, btn.dataset.filename);
        });

    } catch(e) {
        tbody.innerHTML = `<tr><td colspan="4" class="py-8 text-center text-red-400">기록을 불러오는데 실패했습니다.</td></tr>`;
    }
}

function shareHistoryItem(url) {
    if (!url) return alert('공유할 URL이 없습니다.');
    navigator.clipboard.writeText(url).then(() => {
        alert('✅ 다운로드 원본 링크가 클립보드에 복사되었습니다!');
    }).catch(err => {
        alert('복사 실패: ' + err);
    });
}

function redownloadHistoryItem(url, filename) {
    if (!url) return alert('다운로드할 URL이 없습니다.');
    downloadSingleBlob(url, filename, 'url').catch(e => alert('다운로드 실패: ' + e.message));
}

export function openHistoryModal() {
    document.getElementById('history-modal').classList.remove('hidden');
    document.getElementById('history-modal').classList.add('flex');
    renderHistory();
}

export function closeHistoryModal() {
    document.getElementById('history-modal').classList.add('hidden');
    document.getElementById('history-modal').classList.remove('flex');
}

export function clearHistory() {
    if (confirm('모든 다운로드 기록을 삭제하시겠습니까?')) {
        localStorage.removeItem('ameva_download_history');
        renderHistory();
    }
}
