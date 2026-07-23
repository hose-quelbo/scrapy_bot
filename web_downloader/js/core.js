import { logToTerminal } from './ui.js';

export let pyodideReady = false;
export let pyodideInstance = null;
export let extBridgeReady = false;

// -------------------------------------------------------------
// Extension Bridge Communication (Authenticated Fetch Proxy)
// -------------------------------------------------------------
export function checkExtensionBridge() {
    return new Promise((resolve) => {
        const pingId = Date.now().toString();
        const listener = (event) => {
            if (event.source !== window) return;
            if (event.data && event.data.type === "AMEVA_EXT_PONG") {
                window.removeEventListener("message", listener);
                resolve(event.data.version || true);
            }
        };
        window.addEventListener("message", listener);
        window.postMessage({ type: "AMEVA_EXT_PING", id: pingId }, "*");
        
        setTimeout(() => {
            window.removeEventListener("message", listener);
            resolve(false);
        }, 500);
    });
}

export function fetchViaExtensionBridge(url, headers = {}) {
    return new Promise((resolve, reject) => {
        if (!extBridgeReady) {
            reject(new Error("확장 프로그램이 설치되어 있지 않거나 새로고침이 필요합니다."));
            return;
        }

        const reqId = Date.now().toString() + Math.random().toString().slice(2, 6);
        const listener = (event) => {
            if (event.source !== window) return;
            if (event.data && event.data.type === "AMEVA_EXT_FETCH_RESULT" && event.data.id === reqId) {
                window.removeEventListener("message", listener);
                if (event.data.response && event.data.response.success) {
                    resolve(event.data.response.data);
                } else {
                    reject(new Error(event.data.response?.error || "Unknown Extension Bridge Error"));
                }
            }
        };
        window.addEventListener("message", listener);
        window.postMessage({ type: "AMEVA_EXT_FETCH", id: reqId, url: url, headers: headers }, "*");
        
        setTimeout(() => {
            window.removeEventListener("message", listener);
            reject(new Error("확장 프로그램 프록시 통신 타임아웃."));
        }, 15000); // 15s timeout
    });
}

// -------------------------------------------------------------
// Initialize Engines
// -------------------------------------------------------------
export async function initWASM() {
    const statusIndicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('status-text');
    const btnDownloadUrl = document.getElementById('btn-download-url');
    const btnSearchAccount = document.getElementById('btn-search-account');

    try {
        logToTerminal('확장 프로그램 프록시 브릿지 연결 시도 중...', 'info', 'url');
        const bridgeRes = await checkExtensionBridge();
        extBridgeReady = bridgeRes;
        
        if (extBridgeReady) {
            const v = typeof extBridgeReady === 'string' ? `v${extBridgeReady}` : '';
            logToTerminal(`인스타그램 로그인 인증 우회 프록시 브릿지 연결 성공! ${v}`, 'success', 'url');
            logToTerminal('인스타그램 쿠키를 활용하여 계정 및 스토리를 추출할 수 있습니다.', 'success', 'account');
        } else {
            logToTerminal('프록시 브릿지 없음. 인스타 계정 스캔은 공개 API로 제한됩니다.', 'warn', 'url');
        }

        logToTerminal('Pyodide 런타임 다운로드 중...', 'info', 'url');
        pyodideInstance = await loadPyodide();
        await pyodideInstance.loadPackage("micropip");
        await pyodideInstance.loadPackage("ssl");
        
        await pyodideInstance.loadPackage("lzma");
        const micropip = pyodideInstance.pyimport("micropip");
        
        logToTerminal('WASM 내부 패키지(instaloader, yt-dlp 등) 설치 중...', 'warn', 'url');
        await micropip.install('instaloader');
        await micropip.install('yt-dlp');
        pyodideReady = true;
        
        if(statusIndicator) statusIndicator.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]';
        if(statusText) statusText.textContent = `WASM & Extension Proxy 엔진 준비 완료`;
        
        if(btnDownloadUrl) btnDownloadUrl.disabled = false;
        if(btnSearchAccount) btnSearchAccount.disabled = false;

    } catch (error) {
        logToTerminal(`WASM 초기화 실패: ${error.message}`, 'error', 'url');
        if(statusIndicator) statusIndicator.className = 'w-2.5 h-2.5 rounded-full bg-amber-500';
        if(statusText) statusText.textContent = 'Native Fetch 모드 (Pyodide 실패)';
        if(btnDownloadUrl) btnDownloadUrl.disabled = false;
        if(btnSearchAccount) btnSearchAccount.disabled = false;
    }
}
