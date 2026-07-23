import { logToTerminal } from './ui.js';
import { extBridgeReady, fetchViaExtensionBridge, pyodideReady, pyodideInstance } from './core.js';

export async function parseTikTokUrl(urlInput) {
    let mediaItems = [];
    let title = 'TikTok_Download';
    logToTerminal('TikTok 추출 시도 중...', 'info', 'url');
    
    try {
        let json;
        if (extBridgeReady) {
            logToTerminal('확장 프로그램 프록시를 통해 우회 접속 (TikWM API)...', 'info', 'url');
            const resText = await fetchViaExtensionBridge(`https://www.tikwm.com/api/?url=${encodeURIComponent(urlInput)}`);
            json = JSON.parse(resText);
        } else {
            const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(urlInput)}`);
            json = await res.json();
        }

        if (json && json.data) {
            title = `TikTok_${json.data.id || Date.now()}`;
            
            if (json.data.images && Array.isArray(json.data.images)) {
                logToTerminal(`틱톡 슬라이드쇼 사진 ${json.data.images.length}장 발견!`, 'success', 'url');
                json.data.images.forEach((imgUrl, idx) => {
                    mediaItems.push({ type: 'photo', url: imgUrl, filename: `${title}_img${idx+1}.jpg` });
                });
                if (json.data.music) {
                    mediaItems.push({ type: 'audio', url: json.data.music, filename: `${title}_audio.mp3` });
                }
            } else if (json.data.play) {
                logToTerminal(`틱톡 비디오 발견!`, 'success', 'url');
                mediaItems.push({ type: 'video', url: json.data.play, filename: `${title}.mp4` });
            }
        }
    } catch (e) {
        logToTerminal(`TikWM API 실패, 내부 파서로 넘어갑니다: ${e.message}`, 'warn', 'url');
    }

    if (mediaItems.length === 0) {
        try {
            const response = await fetch(urlInput);
            const htmlText = await response.text();
            const playAddrMatch = htmlText.match(/"playAddr":"([^"]+)"/) || htmlText.match(/"downloadAddr":"([^"]+)"/);
            if (playAddrMatch) {
                const videoUrl = playAddrMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
                mediaItems.push({ type: 'video', url: videoUrl, filename: `${title}.mp4` });
            }
        } catch(e) {
             logToTerminal(`HTML 추출 실패: ${e.message}`, 'error', 'url');
        }
    }
    return mediaItems;
}

export async function parseTikTokAccount(accountInput, cursor = 0) {
    let mediaItems = [];
    let nextCursor = 0;
    let hasMore = false;
    
    // 1. TikWM API (가장 빠르고 정확함, cursor 지원)
    logToTerminal(`TikWM API 파서로 계정 피드 조회 중... (Cursor: ${cursor})`, 'info', 'account');
    try {
        const fetchUrl = `https://www.tikwm.com/api/user/posts?unique_id=${encodeURIComponent(accountInput)}&count=33&cursor=${cursor}`;
        let resText = '';
        
        if (extBridgeReady) {
            logToTerminal('확장 프로그램 브릿지로 우회 접속 중...', 'info', 'account');
            resText = await fetchViaExtensionBridge(fetchUrl);
        } else {
            const res = await fetch(fetchUrl);
            resText = await res.text();
        }
        
        const json = JSON.parse(resText);
        if (json && json.data && json.data.videos) {
            mediaItems = json.data.videos.map(v => ({
                id: v.id,
                type: 'video',
                thumb: v.cover,
                url: v.play,
                title: v.title || `TikTok_${v.id}`
            }));
            nextCursor = json.data.cursor || 0;
            hasMore = json.data.hasMore === 1 || json.data.hasMore === true;
            logToTerminal(`API 호출 성공! ${mediaItems.length}개 렌더링 준비 완료.`, 'success', 'account');
            return { items: mediaItems, cursor: nextCursor, hasMore: hasMore };
        }
    } catch(e) {
        logToTerminal(`TikWM API 실패: ${e.message}`, 'warn', 'account');
    }

    // API 실패 시에만 fallback으로 넘어가지만, fallback들은 pagination(Load More)을 완벽히 지원하기 어렵습니다.
    // 일단 첫 페이지만이라도 보여주기 위해 유지합니다.
    if (cursor === 0 && mediaItems.length === 0) {
        // Tab Scraper
        if (extBridgeReady) {
            logToTerminal('API 실패, 틱톡 탭 스크래퍼 엔진 가동 중...', 'info', 'account');
            try {
                const response = await new Promise((resolve, reject) => {
                    const reqId = Date.now().toString();
                    window.postMessage({ type: 'AMEVA_EXT_TIKTOK_SCRAPE', id: reqId, username: accountInput }, '*');
                    
                    const listener = (event) => {
                        if (event.source !== window || !event.data || event.data.type !== 'AMEVA_EXT_TIKTOK_SCRAPE_RESULT') return;
                        if (event.data.id === reqId) {
                            window.removeEventListener('message', listener);
                            resolve(event.data.response);
                        }
                    };
                    window.addEventListener('message', listener);
                    
                    setTimeout(() => {
                        window.removeEventListener('message', listener);
                        reject(new Error("틱톡 탭 스크래핑 시간 초과."));
                    }, 40000); 
                });

                if (response && response.success && response.items) {
                    const videos = response.items;
                    mediaItems = videos.map(v => {
                        const videoId = v.id || v.video?.id || v.itemStruct?.id;
                        const videoObj = v.video || v.itemStruct?.video || {};
                        return {
                            id: videoId,
                            type: 'video', 
                            thumb: videoObj.cover || videoObj.originCover || 'https://picsum.photos/300/450',
                            url: videoObj.playAddr || videoObj.downloadAddr || `https://www.tiktok.com/@${accountInput}/video/${videoId}`,
                            title: v.desc || v.itemStruct?.desc || `TikTok_${videoId}`
                        };
                    }).filter(item => item.id);
                    return { items: mediaItems, cursor: 0, hasMore: false };
                }
            } catch (e) {
                logToTerminal(`탭 스크래퍼 에러: ${e.message}`, 'error', 'account');
            }
        }

        // Pyodide yt-dlp Fallback
        if (mediaItems.length === 0 && pyodideReady) {
            logToTerminal('WASM yt-dlp 엔진으로 계정 전체 스캔 중 (최대 30개)...', 'warn', 'account');
            const pyCode = `
import json
def fetch_tiktok_profile(target_username):
    try:
        import yt_dlp
        ydl_opts = {'quiet': True, 'extract_flat': True, 'playlistend': 30}
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            res = ydl.extract_info(f"https://www.tiktok.com/@{target_username}", download=False)
            items = []
            for entry in res.get('entries', []):
                items.append({
                    "id": entry.get('id', ''),
                    "type": "video",
                    "thumb": entry.get('thumbnails', [{}])[0].get('url', '') if entry.get('thumbnails') else '',
                    "url": entry.get('url', ''),
                    "title": entry.get('title', f"TikTok_{entry.get('id', '')}")
                })
            if items:
                return json.dumps({"success": True, "engine": "yt-dlp", "data": items})
    except Exception as e:
        return json.dumps({"success": False, "message": str(e)})
    return json.dumps({"success": False, "message": "데이터를 찾을 수 없습니다."})

fetch_tiktok_profile("${accountInput}")
`;
            try {
                const pyResStr = await pyodideInstance.runPythonAsync(pyCode);
                const pyRes = JSON.parse(pyResStr);
                
                if (pyRes.success && pyRes.data) {
                    return { items: pyRes.data, cursor: 0, hasMore: false };
                }
            } catch (err) {}
        }
    }
    
    return { items: mediaItems, cursor: 0, hasMore: false };
}
