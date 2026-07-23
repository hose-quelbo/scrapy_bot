// background.js
// Handles authenticated fetch requests on behalf of the web app

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "fetch_proxy") {

        const fetchOptions = {
            method: 'GET',
            headers: request.headers || {},
            credentials: 'include'
        };

        fetch(request.url, fetchOptions)
            .then(async (res) => {
                const text = await res.text();
                if (res.ok) {
                    sendResponse({ success: true, data: text, status: res.status });
                } else {
                    sendResponse({ success: false, error: `HTTP ${res.status}: ${text}`, status: res.status });
                }
            })
            .catch(err => {
                sendResponse({ success: false, error: err.message });
            });

        // Return true to indicate we will send a response asynchronously
        return true;
    }

    if (request.action === "ig_tab_scrape") {
        const username = request.username;
        try {
            chrome.tabs.create({ url: `https://www.instagram.com/${username}/`, active: true }, (tab) => {
                if (chrome.runtime.lastError || !tab) {
                    sendResponse({ success: false, error: "탭 생성 실패: " + (chrome.runtime.lastError ? chrome.runtime.lastError.message : "알 수 없음") });
                    return;
                }
                const tabId = tab.id;

                let injected = false;
                let responseSent = false;

                const safeSendResponse = (data) => {
                    if (!responseSent) {
                        responseSent = true;
                        try { sendResponse(data); } catch (e) { }
                    }
                };

                const doExtraction = () => {
                    if (injected) return;
                    injected = true;
                    chrome.tabs.onUpdated.removeListener(listener);

                    try {
                        chrome.scripting.executeScript({
                            target: { tabId: tabId },
                            args: [username],
                            func: (username) => {
                                return new Promise((resolve) => {
                                    // 0. API Fetch attempt (most reliable since we are in the IG tab context)
                                    const match = document.cookie.match(/csrftoken=([^;]+)/);
                                    const csrf = match ? match[1] : '';

                                    try {
                                        fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`, {
                                            headers: {
                                                'X-IG-App-ID': '936619743392459',
                                                'X-Requested-With': 'XMLHttpRequest',
                                                'X-CSRFToken': csrf
                                            }
                                        }).then(res => res.json()).then(json => {
                                            let user = json?.data?.user;
                                            if (user && user.edge_owner_to_timeline_media) {
                                                let apiEdges = user.edge_owner_to_timeline_media.edges;
                                                if (apiEdges && apiEdges.length > 0) {
                                                    resolve({ edges: apiEdges, pageText: "API fetch successful", url: window.location.href });
                                                    return;
                                                }
                                            }
                                            startDomExtraction();
                                        }).catch(err => {
                                            startDomExtraction();
                                        });
                                    } catch (e) {
                                        startDomExtraction();
                                    }

                                    function startDomExtraction() {
                                        let attempts = 0;
                                        let checkInterval = setInterval(() => {
                                            let edgesMap = new Map();

                                            // 1. JSON Extraction attempt
                                            function extractNodes(obj) {
                                                if (!obj || typeof obj !== 'object') return;
                                                if (typeof obj.shortcode === 'string' && typeof obj.display_url === 'string') {
                                                    edgesMap.set(obj.shortcode, { node: obj });
                                                }
                                                for (let key in obj) {
                                                    if (obj.hasOwnProperty(key)) {
                                                        extractNodes(obj[key]);
                                                    }
                                                }
                                            }

                                            let scripts = document.querySelectorAll('script');
                                            for (let s of scripts) {
                                                if (s.textContent.includes('shortcode') && s.textContent.includes('display_url')) {
                                                    try {
                                                        if (s.type === 'application/json' || s.type.includes('json')) {
                                                            extractNodes(JSON.parse(s.textContent));
                                                        }
                                                    } catch (e) { }
                                                }
                                            }

                                            let edges = Array.from(edgesMap.values());

                                            // 2. DOM Extraction attempt
                                            if (edges.length === 0) {
                                                let anchors = document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]');
                                                for (let a of anchors) {
                                                    let match = a.href.match(/(?:p|reel)\/([^\/?#&]+)/);
                                                    if (match) {
                                                        let shortcode = match[1];
                                                        let img = a.querySelector('img');
                                                        if (img && !edgesMap.has(shortcode)) {
                                                            edgesMap.set(shortcode, {
                                                                node: {
                                                                    id: shortcode, // added id
                                                                    shortcode: shortcode,
                                                                    display_url: img.src || img.getAttribute('data-src') || '',
                                                                    video_url: a.href, // fallback for video_url
                                                                    is_video: a.href.includes('/reel/') || !!a.querySelector('svg'),
                                                                    __from_dom: true
                                                                }
                                                            });
                                                        }
                                                    }
                                                }
                                                edges = Array.from(edgesMap.values());
                                            }

                                            window.scrollTo(0, document.body.scrollHeight);
                                            attempts++;

                                            // Stop when we have a good amount, or after 30 seconds (60 attempts)
                                            if (edges.length >= 100 || attempts >= 60) {
                                                clearInterval(checkInterval);
                                                let pageText = document.body ? document.body.innerText.substring(0, 200).replace(/\n/g, ' ') : "No body";
                                                resolve({ edges: edges, pageText: pageText, url: window.location.href });
                                            }
                                        }, 500); // Check every 500ms
                                    }
                                });
                            }
                        }, (results) => {
                            try { chrome.tabs.remove(tabId, () => { let _ = chrome.runtime.lastError; }); } catch (e) { } // safely close tab

                            if (chrome.runtime.lastError) {
                                safeSendResponse({ success: false, error: chrome.runtime.lastError.message });
                                return;
                            }

                            if (results && results[0] && results[0].result) {
                                let res = results[0].result;
                                if (res.edges && res.edges.length > 0) {
                                    safeSendResponse({ success: true, edges: res.edges });
                                } else {
                                    safeSendResponse({ success: false, error: "데이터 없음. 탭 화면 요약: [" + res.pageText + "] (URL: " + res.url + ")" });
                                }
                            } else {
                                safeSendResponse({ success: false, error: "탭에서 스크립트 실행 결과를 받지 못했습니다." });
                            }
                        });
                    } catch (err) {
                        safeSendResponse({ success: false, error: "스크립트 주입 에러: " + err.message });
                    }
                };

                const listener = function (changedTabId, info) {
                    if (changedTabId === tabId && info.status === 'complete') {
                        doExtraction();
                    }
                };

                chrome.tabs.onUpdated.addListener(listener);

                // Safety fallback 1: if the page doesn't finish loading in 8 seconds, try extracting anyway
                setTimeout(() => {
                    doExtraction();
                }, 8000);

                // Safety fallback 2: Guarantee response within 42 seconds to prevent app.js 45s timeout
                // Note: The inner polling takes up to 30 seconds, so this needs to be longer than (fallback 1 + polling time).
                setTimeout(() => {
                    safeSendResponse({ success: false, error: "확장 프로그램 내부 강제 타임아웃 방어막 가동됨." });
                }, 42000);
            });
        } catch (err) {
            sendResponse({ success: false, error: "탭 생성 중 치명적 에러: " + err.message });
        }
        return true;
    }

    if (request.action === "tiktok_tab_scrape") {
        const username = request.username;
        try {
            chrome.tabs.create({ url: `https://www.tiktok.com/@${username}`, active: true }, (tab) => {
                if (chrome.runtime.lastError || !tab) {
                    sendResponse({ success: false, error: "탭 생성 실패: " + (chrome.runtime.lastError ? chrome.runtime.lastError.message : "알 수 없음") });
                    return;
                }
                const tabId = tab.id;
                let injected = false;
                let responseSent = false;

                const safeSendResponse = (data) => {
                    if (!responseSent) {
                        responseSent = true;
                        try { sendResponse(data); } catch (e) { }
                    }
                };

                const doExtraction = () => {
                    if (injected) return;
                    injected = true;
                    chrome.tabs.onUpdated.removeListener(listener);

                    try {
                        chrome.scripting.executeScript({
                            target: { tabId: tabId },
                            func: () => {
                                // Inject XHR/Fetch interceptor to page context to capture lazy-loaded API responses
                                const interceptScript = document.createElement('script');
                                interceptScript.textContent = `
                                    window.__AMEVA_TIKTOK_ITEMS = [];
                                    const origFetch = window.fetch;
                                    window.fetch = async function(...args) {
                                        const response = await origFetch.apply(this, args);
                                        const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
                                        if (url.includes('/api/post/item_list/')) {
                                            response.clone().json().then(data => {
                                                if (data && data.itemList) {
                                                    window.__AMEVA_TIKTOK_ITEMS.push(...data.itemList);
                                                    document.documentElement.setAttribute('data-ameva-items', JSON.stringify(window.__AMEVA_TIKTOK_ITEMS));
                                                }
                                            }).catch(e=>{});
                                        }
                                        return response;
                                    };
                                `;
                                document.documentElement.appendChild(interceptScript);

                                return new Promise((resolve) => {
                                    let attempts = 0;
                                    let checkInterval = setInterval(() => {
                                        window.scrollTo(0, document.body.scrollHeight);
                                        attempts++;

                                        let items = [];
                                        
                                        // 1. Parse initial load items from SIGI_STATE
                                        const sigiScript = document.getElementById('SIGI_STATE');
                                        if (sigiScript) {
                                            try {
                                                const sigi = JSON.parse(sigiScript.textContent);
                                                const itemList = sigi.ItemModule || {};
                                                items = Object.values(itemList);
                                            } catch(e) {}
                                        } else {
                                            const uniScript = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
                                            if (uniScript) {
                                                try {
                                                    const uni = JSON.parse(uniScript.textContent);
                                                    const itemList = uni?.default?.["user-post"]?.list || uni?.__DEFAULT_SCOPE__?.["webapp.user-detail"]?.itemList || [];
                                                    items = Array.isArray(itemList) ? itemList : Object.values(itemList);
                                                } catch(e) {}
                                            }
                                        }

                                        // 2. Parse intercepted lazy loaded items
                                        const interceptedAttr = document.documentElement.getAttribute('data-ameva-items');
                                        if (interceptedAttr) {
                                            try {
                                                const interceptedItems = JSON.parse(interceptedAttr);
                                                items = items.concat(interceptedItems);
                                            } catch(e) {}
                                        }

                                        // Deduplicate by ID
                                        const uniqueMap = new Map();
                                        items.forEach(v => {
                                            if (v && (v.id || v.video?.id)) {
                                                uniqueMap.set(v.id || v.video?.id, v);
                                            }
                                        });

                                        const uniqueItems = Array.from(uniqueMap.values());

                                        if (uniqueItems.length >= 60 || attempts >= 40) { // Try for 20 seconds
                                            clearInterval(checkInterval);
                                            resolve({ items: uniqueItems, url: window.location.href });
                                        }
                                    }, 500);
                                });
                            }
                        }, (results) => {
                            try { chrome.tabs.remove(tabId); } catch(e) {}
                            if (chrome.runtime.lastError) {
                                safeSendResponse({ success: false, error: chrome.runtime.lastError.message });
                                return;
                            }
                            if (results && results[0] && results[0].result) {
                                const res = results[0].result;
                                safeSendResponse({ success: true, items: res.items });
                            } else {
                                safeSendResponse({ success: false, error: "탭에서 결과를 받지 못했습니다." });
                            }
                        });
                    } catch (err) {
                        safeSendResponse({ success: false, error: "스크립트 주입 에러: " + err.message });
                    }
                };

                const listener = function (changedTabId, info) {
                    if (changedTabId === tabId && info.status === 'complete') {
                        doExtraction();
                    }
                };
                chrome.tabs.onUpdated.addListener(listener);

                setTimeout(() => doExtraction(), 8000);
                setTimeout(() => safeSendResponse({ success: false, error: "타임아웃" }), 35000);
            });
        } catch (err) {
            sendResponse({ success: false, error: err.message });
        }
        return true;
    }
});
