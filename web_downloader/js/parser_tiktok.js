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

export async function parseTikTokAccount(accountInput) {
    let mediaItems = [];
    
    // 1. Tab Scraper (강력한 Lazy Loading 우회기)
    if (extBridgeReady) {
        logToTerminal('틱톡 탭 스크래퍼 엔진 가동 중 (무한 스크롤 자동화)...', 'info', 'account');
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
                }, 40000); // Wait up to 40s
            });

            if (response && response.success && response.items) {
                logToTerminal(`탭 스크래핑 성공: ${response.items.length}개의 아이템 파싱됨.`, 'success', 'account');
                
                const videos = response.items;
                mediaItems = videos.map(v => {
                    const videoId = v.id || v.video?.id || v.itemStruct?.id;
                    const videoObj = v.video || v.itemStruct?.video || {};
                    return {
                        id: videoId,
                        type: 'video', // we can default to video, if slideshow it'll be mapped by downloader later or here
                        thumb: videoObj.cover || videoObj.originCover || 'https://picsum.photos/300/450',
                        url: videoObj.playAddr || videoObj.downloadAddr || `https://www.tiktok.com/@${accountInput}/video/${videoId}`,
                        title: v.desc || v.itemStruct?.desc || `TikTok_${videoId}`
                    };
                }).filter(item => item.id);
            } else {
                throw new Error(response?.error || "탭 스크래핑 데이터 없음.");
            }
        } catch (e) {
            logToTerminal(`탭 스크래퍼 에러: ${e.message}`, 'error', 'account');
        }
    } else {
        logToTerminal('확장 프로그램 없음: 탭 스크래퍼(스크롤 자동화)를 사용할 수 없습니다.', 'warn', 'account');
    }

    // 2. TikWM API Fallback
    if (mediaItems.length === 0) {
        logToTerminal('TikWM API 파서로 우회 접속 중...', 'info', 'account');
        try {
            const fetchUrl = `https://www.tikwm.com/api/user/posts?unique_id=${encodeURIComponent(accountInput)}&count=33`;
            let resText = '';
            
            if (extBridgeReady) {
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
            }
        } catch(e) {
            logToTerminal(`TikWM API 실패: ${e.message}`, 'warn', 'account');
        }
    }

    // 3. Pyodide yt-dlp Fallback
    if (mediaItems.length === 0 && pyodideReady) {
        logToTerminal('WASM(Pyodide) yt-dlp 엔진으로 계정 전체 스캔 중 (시간이 오래 걸릴 수 있습니다)...', 'warn', 'account');
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
                mediaItems = pyRes.data;
            } else {
                throw new Error(pyRes.message);
            }
        } catch (err) {
            logToTerminal(`Pyodide 엔진 오류: ${err.message}`, 'error', 'account');
        }
    }

    // 4. Urlebird Fallback
    if (mediaItems.length === 0) {
        logToTerminal('모든 방식 차단됨. 퍼블릭 아카이브(UrleBird) 최후 우회 탐색 시작...', 'info', 'account');
        try {
            const urlebirdUrl = `https://urlebird.com/user/${encodeURIComponent(accountInput)}/`;
            let ubHtml = '';
            if (extBridgeReady) {
                ubHtml = await fetchViaExtensionBridge(urlebirdUrl);
            } else {
                const ubRes = await fetch(urlebirdUrl);
                if (ubRes.ok) ubHtml = await ubRes.text();
            }
            
            if (ubHtml) {
                const jsonRegex = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
                let match;
                while ((match = jsonRegex.exec(ubHtml)) !== null) {
                    try {
                        const data = JSON.parse(match[1]);
                        if (data['@type'] === 'ItemList' && Array.isArray(data.itemListElement)) {
                            const itemsMap = new Map();
                            for (const item of data.itemListElement) {
                                if (!item.url) continue;
                                const idMatch = item.url.match(/(\d+)\/?$/);
                                if (idMatch && item.thumbnailUrl && item.thumbnailUrl.length > 0) {
                                    itemsMap.set(idMatch[1], item.thumbnailUrl[0]);
                                }
                            }
                            
                            if (itemsMap.size > 0) {
                                mediaItems = Array.from(itemsMap.entries()).map(([id, thumb]) => ({
                                    id: id,
                                    type: 'video',
                                    thumb: thumb,
                                    url: `https://www.tiktok.com/@${accountInput}/video/${id}`,
                                    title: `TikTok_${id}`
                                }));
                                break; 
                            }
                        }
                    } catch (e) {}
                }
            }
        } catch (ubErr) {
            logToTerminal(`UrleBird 우회 탐색 실패: ${ubErr.message}`, 'error', 'account');
        }
    }
    
    return mediaItems;
}
