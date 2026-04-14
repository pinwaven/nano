require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');

// Load the admin-panel FC handler
const adminHandler = require('../src/functions/admin-panel/index').handler;

const app = express();
const port = 3001;

// We need raw body to pass to the FC handler which expects Buffer
app.use(bodyParser.raw({ type: '*/*', limit: '10mb' }));

app.all('*', async (req, res) => {
    console.log(`[Local Admin] ${req.method} ${req.path}`);

    const fcRequest = {
        rawPath: req.path,
        headers: req.headers,
        requestContext: {
            http: {
                method: req.method,
                path: req.path
            }
        },
        queryParameters: req.query,
        body: req.body, // req.body is a Buffer due to bodyParser.raw
        isBase64Encoded: false
    };

    try {
        const result = await adminHandler(fcRequest, {}, {});
        
        if (result.statusCode === 301 || result.statusCode === 302) {
            return res.redirect(result.statusCode, result.headers.location);
        }

        if (result.headers) {
            Object.entries(result.headers).forEach(([k, v]) => {
                if (k.toLowerCase() !== 'content-encoding') {
                    res.setHeader(k, v);
                }
            });
        }

        res.status(result.statusCode || 200);

        if (result.isBase64Encoded) {
            res.send(Buffer.from(result.body, 'base64'));
        } else {
            res.send(result.body);
        }
    } catch (err) {
        console.error('[Local Admin] Error:', err);
        res.status(500).send('Internal Server Error');
    }
});

app.listen(port, () => {
    console.log(`\x1b[36m[Nano Admin] Serving admin-panel at http://localhost:${port}/admin/\x1b[0m`);
    console.log(`[Nano Admin] Proxying /admin/api to: ${process.env.WORKER_URL || 'http://localhost:3000'}`);
});
