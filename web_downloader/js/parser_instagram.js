import { logToTerminal } from './ui.js';
import { extBridgeReady, fetchViaExtensionBridge, pyodideReady, pyodideInstance } from './core.js';

export async function parseInstagramUrl(urlInput) {
    let mediaItems = [];
    let title = 'Instagram_Media';
    logToTerminal('인스타그램 추출 시도 중...', 'info', 'url');
    
    const shortcodeMatch = urlInput.match(/(?:p|reel|tv)\/([^\/?#&]+)/);
    
    if (shortcodeMatch && extBridgeReady) {
        logToTerminal('프록시 브릿지(인증 모드)를 사용하여 고품질/다중 미디어 추출 중...', 'info', 'url');
        const shortcode = shortcodeMatch[1];
        try {
            const igJsonText = await fetchViaExtensionBridge(`https://www.instagram.com/graphql/query/?query_hash=b3055c01b4b222b8a47dc12b090e4e64&variables={"shortcode":"${shortcode}"}`);
            const igData = JSON.parse(igJsonText);
            const media = igData.data.shortcode_media;
            title = `IG_${shortcode}`;
            
            if (media.edge_sidecar_to_children) {
                logToTerminal(`인스타그램 다중 미디어 ${media.edge_sidecar_to_children.edges.length}개 발견!`, 'success', 'url');
                media.edge_sidecar_to_children.edges.forEach((edge, idx) => {
                    const node = edge.node;
                    if (node.is_video) {
                        mediaItems.push({ type: 'video', url: node.video_url, filename: `${title}_${idx+1}.mp4` });
                    } else {
                        mediaItems.push({ type: 'photo', url: node.display_url, filename: `${title}_${idx+1}.jpg` });
                    }
                });
            } else if (media.is_video) {
                logToTerminal(`인스타그램 비디오/릴스 발견!`, 'success', 'url');
                mediaItems.push({ type: 'video', url: media.video_url, filename: `${title}.mp4` });
            } else {
                mediaItems.push({ type: 'photo', url: media.display_url, filename: `${title}.jpg` });
            }
        } catch (e) {
            logToTerminal(`프록시 브릿지 추출 실패, HTML 정규식 파서로 우회합니다. (${e.message})`, 'warn', 'url');
        }
    }

    if (mediaItems.length === 0) {
        const response = await fetch(urlInput);
        const htmlText = await response.text();
        const ogVideoMatch = htmlText.match(/<meta[^>]+property="og:video"[^>]+content="([^"]+)"/);
        const ogImageMatch = htmlText.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/);
        if (ogVideoMatch) { 
            mediaItems.push({ type: 'video', url: ogVideoMatch[1].replace(/&amp;/g, '&'), filename: `${title}.mp4` }); 
        } else if (ogImageMatch) { 
            mediaItems.push({ type: 'photo', url: ogImageMatch[1].replace(/&amp;/g, '&'), filename: `${title}.jpg` }); 
        }
    }
    
    return { mediaItems, title };
}

export async function parseInstagramAccount(accountInput) {
    let mediaItems = [];
    logToTerminal('인스타그램 계정 프로필 조회 중...', 'info', 'account');
    
    if (extBridgeReady) {
        logToTerminal('인스타그램 쿠키 인증 브릿지 활성화됨.', 'info', 'account');
        try {
            let profileJsonText = '';
            let edges = [];
            let user = null;

            try {
                try {
                    profileJsonText = await fetchViaExtensionBridge(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(accountInput)}`, { 
                        'X-IG-App-ID': '936619743392459',
                        'X-Requested-With': 'XMLHttpRequest'
                    });
                    const json = JSON.parse(profileJsonText);
                    user = json.data?.user || json.graphql?.user;
                    edges = user?.edge_owner_to_timeline_media?.edges || [];
                } catch (apiErr) {
                    logToTerminal(`기본 API 차단됨, HTML 분석 모드(Fallback)로 진입합니다...`, 'warn', 'account');
                    const html = await fetchViaExtensionBridge(`https://www.instagram.com/${encodeURIComponent(accountInput)}/`);
                    
                    const edgeMatch = html.match(/"edge_owner_to_timeline_media":\{"count":\d+,"page_info":\{.*?\},"edges":(\[.*?\])\}/);
                    if (edgeMatch) {
                        edges = JSON.parse(edgeMatch[1]);
                        const idMatch = html.match(/"profile_id":"(\d+)"/) || html.match(/"id":"(\d+)"/);
                        user = { id: idMatch ? idMatch[1] : null };
                    } else {
                        const idMatch = html.match(/"profile_id":"(\d+)"/) || html.match(/"user_id":"(\d+)"/);
                        if (idMatch) {
                            const gqlText = await fetchViaExtensionBridge(`https://www.instagram.com/graphql/query/?query_hash=69cba40317214236af40e7efa697781d&variables={"id":"${idMatch[1]}","first":12}`);
                            const gqlJson = JSON.parse(gqlText);
                            user = gqlJson.data?.user;
                            edges = user?.edge_owner_to_timeline_media?.edges || [];
                        } else {
                            throw new Error("프로필 데이터 및 ID를 HTML에서 찾을 수 없습니다.");
                        }
                    }
                }
            } catch (parseErr) {
                logToTerminal(`모든 내부 파싱 완전 차단됨. 궁극의 탭 스크래퍼(Tab Scraper)를 가동합니다...`, 'warn', 'account');
                const response = await new Promise((resolve, reject) => {
                    const reqId = Date.now().toString();
                    window.postMessage({ type: 'AMEVA_EXT_IG_SCRAPE', id: reqId, username: accountInput }, '*');
                    
                    const listener = (event) => {
                        if (event.source !== window || !event.data || event.data.type !== 'AMEVA_EXT_IG_SCRAPE_RESULT') return;
                        if (event.data.id === reqId) {
                            window.removeEventListener('message', listener);
                            resolve(event.data.response);
                        }
                    };
                    window.addEventListener('message', listener);
                    
                    setTimeout(() => {
                        window.removeEventListener('message', listener);
                        reject(new Error("탭 스크래핑 시간 초과 (인스타그램 로그인이 필요할 수 있습니다)."));
                    }, 45000);
                });

                if (response && response.success && response.edges) {
                    edges = response.edges;
                } else {
                    throw new Error(response?.error || "탭 스크래핑에서도 데이터를 찾지 못했습니다.");
                }
            }

            if (!edges || edges.length === 0) {
                throw new Error("가져올 수 있는 미디어가 없거나 비공개 계정입니다.");
            }
            
            mediaItems = edges.map(e => {
                const node = e.node;
                return {
                    id: node.id,
                    type: node.is_video ? 'video' : 'photo',
                    thumb: node.display_url,
                    url: node.is_video ? node.video_url : node.display_url,
                    title: `IG_${node.id}`
                };
            });
            
            const userId = user?.id;
            if (userId) {
                try {
                    await fetchViaExtensionBridge(`https://www.instagram.com/graphql/query/?query_hash=x&variables={"reel_ids":["${userId}"],"precomposed_overlay":false}`);
                } catch (stErr) {
                    // ignore
                }
            }

        } catch (e) {
            logToTerminal(`계정/스토리 스캔 실패 (인증 브릿지 에러): ${e.message}`, 'error', 'account');
        }
    } else {
        logToTerminal('비로그인 상태 우회 시도 중...', 'warn', 'account');
        const res = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(accountInput)}`, {
            headers: { 
                'X-IG-App-ID': '936619743392459',
                'X-Requested-With': 'XMLHttpRequest'
            }
        });
        if (res.ok) {
            const json = await res.json();
            const edges = json.data?.user?.edge_owner_to_timeline_media?.edges || [];
            mediaItems = edges.map(e => {
                const node = e.node;
                return {
                    id: node.id,
                    type: node.is_video ? 'video' : 'photo',
                    thumb: node.display_url,
                    url: node.is_video ? node.video_url : node.display_url,
                    title: `IG_${node.id}`
                };
            });
        } else {
            throw new Error("인스타그램 비회원 접근이 차단되었습니다.");
        }
    }

    if (mediaItems.length === 0 && pyodideReady) {
        logToTerminal('기존 방식 실패. WASM(Pyodide) 인스타그램 다중 폴백 엔진 가동 중...', 'warn', 'account');
        const pyCode = `
import json
def fetch_instagram_profile(target_username):
    try:
        import yt_dlp
        ydl_opts = {'quiet': True, 'extract_flat': True}
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            res = ydl.extract_info(f"https://www.instagram.com/{target_username}/", download=False)
            items = []
            for entry in res.get('entries', [])[:12]:
                items.append({
                    "id": entry.get('id', ''),
                    "type": "video",
                    "thumb": entry.get('thumbnails', [{}])[0].get('url', '') if entry.get('thumbnails') else '',
                    "url": entry.get('url', ''),
                    "title": entry.get('title', f"IG_{entry.get('id', '')}")
                })
            if items:
                return json.dumps({"success": True, "engine": "yt-dlp", "data": items})
    except Exception as e:
        pass
    return json.dumps({"success": False, "message": "안됩니다 ㅠ"})

fetch_instagram_profile("${accountInput}")
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
    return mediaItems;
}
