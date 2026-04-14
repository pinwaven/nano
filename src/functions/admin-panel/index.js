const fs = require('fs');
const path = require('path');
const https = require('https');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.wasm': 'application/wasm'
};

const WORKER_URL = process.env.WORKER_URL || '';

async function proxyApi(event, rawPath) {
    const apiPath = rawPath.replace(/^\/admin\/api/, '').replace(/^\/api/, '');
    const method = event.requestContext?.http?.method || 'GET';
    const query = event.queryParameters || {};
    let body = event.body || '';

    if (event.isBase64Encoded && body) {
        body = Buffer.from(body, 'base64').toString('utf8');
    }

    const queryString = Object.keys(query).length 
        ? '?' + new URLSearchParams(query).toString()
        : '';

    const url = new URL(WORKER_URL + apiPath + queryString);

    const options = {
        method: method,
        headers: {
            ...event.headers,
        }
    };
    delete options.headers['content-length'];
    delete options.headers['connection'];
    delete options.headers['host'];

    return new Promise((resolve) => {
        const req = https.request(url, options, (res) => {
            let chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const data = Buffer.concat(chunks);
                const respHeaders = {};
                for (const key in res.headers) {
                    respHeaders[key.toLowerCase()] = res.headers[key];
                }
                respHeaders['access-control-allow-origin'] = '*';
                
                resolve({
                    statusCode: res.statusCode,
                    headers: respHeaders,
                    body: data.toString('base64'),
                    isBase64Encoded: true
                });
            });
        });

        req.on('error', (e) => {
            console.error('Proxy Error:', e);
            resolve({
                statusCode: 502,
                headers: { 'content-type': 'application/json' },
                body: Buffer.from(JSON.stringify({ error: 'Gateway Error', details: e.message })).toString('base64'),
                isBase64Encoded: true
            });
        });

        if (body && method !== 'GET' && method !== 'HEAD') {
            req.write(body);
        }
        req.end();
    });
}

exports.handler = async (req, resp, context) => {
    let event = req;
    
    // FC 3.0 often passes the event as a Buffer that needs parsing
    if (Buffer.isBuffer(req)) {
        try {
            event = JSON.parse(req.toString());
        } catch (e) {
            console.error('Failed to parse event Buffer:', e);
        }
    }

    const rawPath = event.rawPath || event.requestContext?.http?.path || '/';
    const method = event.requestContext?.http?.method || (event.requestContext && event.requestContext.http ? event.requestContext.http.method : 'GET');

    console.log(JSON.stringify({ 
        level: 'INFO', 
        msg: 'Request received', 
        data: { 
            rawPath, 
            method,
            isBuffer: Buffer.isBuffer(req)
        } 
    }));

    // Debug endpoint
    if (rawPath === '/admin/status' || rawPath === '/status') {
        return {
            statusCode: 200,
            headers: { 'content-type': 'application/json' },
            body: Buffer.from(JSON.stringify({ 
                status: 'ok', 
                rawPath,
                method,
                event_keys: Object.keys(event)
            })).toString('base64'),
            isBase64Encoded: true
        };
    }

    if (rawPath === '/admin') {
        return {
            statusCode: 301,
            headers: { 'location': '/admin/' },
            body: '',
            isBase64Encoded: false
        };
    }

    if (rawPath.startsWith('/admin/api')) {
        return await proxyApi(event, rawPath);
    }

    let targetPath = rawPath;
    if (targetPath.startsWith('/admin/')) {
        targetPath = targetPath.substring(7); // remove '/admin/'
    } else if (targetPath === '/admin') {
        targetPath = '';
    }

    if (targetPath && !targetPath.startsWith('/')) {
        targetPath = '/' + targetPath;
    }

    if (targetPath === '' || targetPath === '/' || !targetPath.includes('.')) {
        targetPath = '/index.html';
    }

    const safePath = path.normalize(targetPath).replace(/^(\.\.[\/\\])+/, '');
    let filePath = path.join(__dirname, 'dist', safePath);

    try {
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
            filePath = path.join(__dirname, 'dist', 'index.html');
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        const content = fs.readFileSync(filePath);

        return {
            statusCode: 200,
            headers: { 
                'content-type': contentType,
                'cache-control': 'public, max-age=3600',
                'content-disposition': 'inline'
            },
            body: content.toString('base64'),
            isBase64Encoded: true
        };
    } catch (err) {
        console.error('File serving error:', err);
        return {
            statusCode: 500,
            headers: { 'content-type': 'text/plain' },
            body: Buffer.from('Internal Server Error').toString('base64'),
            isBase64Encoded: true
        };
    }
};
