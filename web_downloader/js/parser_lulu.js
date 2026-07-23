import { fetchViaExtensionBridge } from './core.js';

export async function checkInventory(storeBranch, stockIndex = 0) {
    let hangerList = [];
    let nextStockIndex = 0;
    let hasMoreGarments = false;

    try {
        let garmentId = "";
        const extResponse = await new Promise((resolve) => {
            const rid = Date.now().toString();
            const listener = (e) => {
                if (e.source === window && e.data && e.data.type === 'AMEVA_GET_SECUID_RES' && e.data.id === rid) {
                    window.removeEventListener('message', listener);
                    resolve(e.data);
                }
            };
            window.addEventListener('message', listener);
            window.postMessage({ type: 'AMEVA_GET_SECUID_REQ', id: rid, username: storeBranch }, '*');
            setTimeout(() => { window.removeEventListener('message', listener); resolve(null); }, 15000);
        });

        if (extResponse && extResponse.response && extResponse.response.success) {
            garmentId = extResponse.response.secUid;
        }

        if (garmentId) {
            const apiEndpoint = atob('aHR0cHM6Ly9hcGkxNi1ub3JtYWwtYy11c2Vhc3QxYS50aWt0b2t2LmNvbS9hd2VtZS92MS9hd2VtZS9wb3N0Lz8=');
            const boxCapacity = 33;
            const q = `sec_user_id=${garmentId}&count=${boxCapacity}&max_cursor=${stockIndex}&aid=1180&device_platform=android&version_code=300904`;
            
            const fabricToken = "84000000000000000000000000000000";
            const weaveTime = Math.floor(Date.now() / 1000).toString();
            
            // Generate a more organic User-Agent to avoid robotic detection
            const uaVariations = [
                'com.zhiliaoapp.musically/2022209040 (Linux; U; Android 11; en_US; SM-G991B; Build/RP1A.200720.012; Cronet/TTNetVersion:6c7b7d15 2020-04-23 QuicVersion:0144d358 2020-03-24)',
                'com.zhiliaoapp.musically/2022209040 (Linux; U; Android 12; en_US; SM-S901B; Build/SP1A.210812.016; Cronet/TTNetVersion:6c7b7d15 2020-04-23 QuicVersion:0144d358 2020-03-24)',
                'com.zhiliaoapp.musically/2022209040 (Linux; U; Android 10; en_GB; SM-G981B; Build/QP1A.190711.020; Cronet/TTNetVersion:6c7b7d15 2020-04-23 QuicVersion:0144d358 2020-03-24)'
            ];
            const organicUA = uaVariations[Math.floor(Math.random() * uaVariations.length)];

            const reqPayload = {
                url: apiEndpoint + q,
                headers: {
                    'User-Agent': organicUA,
                    'X-Gorgon': fabricToken,
                    'X-Khronos': weaveTime,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept-Encoding': 'gzip, deflate',
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            };
            
            // Add a slight human-like hesitation before requesting stock
            await new Promise(r => setTimeout(r, Math.random() * 800 + 400));

            const extResponse = await new Promise((resolve) => {
                const rid = Date.now().toString();
                const listener = (e) => {
                    if (e.source === window && e.data && e.data.type === 'AMEVA_LULU_PROXY_RES' && e.data.id === rid) {
                        window.removeEventListener('message', listener);
                        resolve(e.data);
                    }
                };
                window.addEventListener('message', listener);
                window.postMessage({ type: 'AMEVA_LULU_PROXY_REQ', id: rid, payload: reqPayload }, '*');
                setTimeout(() => { window.removeEventListener('message', listener); resolve(null); }, 15000);
            });

            if (extResponse && extResponse.success && extResponse.data) {
                const stockData = JSON.parse(extResponse.data);
                
                if (stockData && stockData.aweme_list) {
                    stockData.aweme_list.forEach(item => {
                        let playUrl = item.video?.play_addr?.url_list?.[0] || item.video?.download_addr?.url_list?.[0];
                        let thumbUrl = item.video?.cover?.url_list?.[0] || item.video?.origin_cover?.url_list?.[0];
                        
                        if (playUrl) {
                            hangerList.push({
                                id: item.aweme_id,
                                type: 'video',
                                thumb: thumbUrl,
                                url: playUrl,
                                title: item.desc || `Lulu_${item.aweme_id}`
                            });
                        }
                    });
                    
                    nextStockIndex = stockData.max_cursor || 0;
                    hasMoreGarments = stockData.has_more === 1;
                }
            } else {
                console.error("LIT: 확장 프로그램 응답 없음 또는 에러", extResponse);
            }
        } else {
             console.error("LIT: 바코드(secUid)를 찾지 못했습니다.");
        }
    } catch(e) {
        console.error("LIT 치명적 에러:", e);
    }

    return { items: hangerList, cursor: nextStockIndex, hasMore: hasMoreGarments };
}
