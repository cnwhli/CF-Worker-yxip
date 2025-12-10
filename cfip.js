// 主Worker逻辑，与_workers.js配合实现核心功能
// 存储键名与常量定义
const IP_STORAGE_KEY = "cloudflare_ips";
const SPEED_STORAGE_KEY = "speed_ips";
const LAST_UPDATE_KEY = "last_update";

// IP数据源（与_workers.js保持一致）
const IP_SOURCES = [
    "https://ip.164746.xyz",
    "https://ip.haogege.xyz",
    "https://stock.hostmonit.com/CloudFlareYes",
    "https://api.uouin.com/cloudflare.html",
    "https://addressesapi.090227.xyz",
    "https://www.wetest.vip"
];

// 从数据源收集IP
export async function collectIPs() {
    const uniqueIPs = new Set();
    const results = [];

    for (const source of IP_SOURCES) {
        try {
            const response = await fetch(source, { timeout: 10000 });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const text = await response.text();
            const ips = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || [];
            
            ips.forEach(ip => {
                // 简单IP格式验证
                if (/^(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(ip)) {
                    uniqueIPs.add(ip);
                }
            });
            
            results.push({
                source,
                count: ips.length,
                valid: Array.from(uniqueIPs).filter(ip => ips.includes(ip)).length,
                success: true
            });
        } catch (error) {
            results.push({
                source,
                error: error.message,
                success: false
            });
        }
    }

    return {
        ips: Array.from(uniqueIPs).map(ip => ({ ip, delay: null })),
        count: uniqueIPs.size,
        sources: results,
        timestamp: new Date().toISOString()
    };
}

// 测试单个IP延迟
export async function testIPDelay(ip) {
    try {
        const start = performance.now();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超时

        await fetch(`https://${ip}/cdn-cgi/trace`, {
            method: 'GET',
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        clearTimeout(timeoutId);
        const delay = Math.round(performance.now() - start);
        return { ip, delay, success: true };
    } catch (error) {
        return {
            ip,
            delay: null,
            success: false,
            error: error.name === 'AbortError' ? '超时' : error.message
        };
    }
}

// 批量测试IP并筛选优质IP
export async function batchTestIPs(ips, limit = 25) {
    if (!ips || ips.length === 0) return { fastIPs: [], allResults: [] };

    // 并发测试（控制并发数避免超时）
    const concurrency = 10;
    const results = [];
    const batches = [];

    for (let i = 0; i < ips.length; i += concurrency) {
        batches.push(ips.slice(i, i + concurrency));
    }

    for (const batch of batches) {
        const batchResults = await Promise.all(
            batch.map(ipObj => testIPDelay(ipObj.ip))
        );
        results.push(...batchResults);
        // 每批测试后短暂休息，避免请求过于密集
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // 处理结果：过滤成功的并按延迟排序
    const validResults = results
        .filter(r => r.success && r.delay !== null)
        .sort((a, b) => a.delay - b.delay);

    // 取前N个优质IP
    return {
        fastIPs: validResults.slice(0, limit),
        allResults: results,
        testedAt: new Date().toISOString()
    };
}
