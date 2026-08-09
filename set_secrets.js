/**
 * set_secrets.js — Upload BAILEYS_CREDS to GitHub Secrets.
 * Usage: GH_PAT=your_token node set_secrets.js
 */
const fs    = require('fs');
const path  = require('path');
const https = require('https');

const REPO  = 'sulagna59/DCPCA_bday_wish';
const TOKEN = process.env.GH_PAT;
if (!TOKEN) { console.error('Set GH_PAT env var first.\nUsage: GH_PAT=yourtoken node set_secrets.js'); process.exit(1); }

async function api(method, endpoint, body) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const req  = https.request({
            hostname: 'api.github.com',
            path:     endpoint,
            method,
            headers: {
                'Authorization': `Bearer ${TOKEN}`,
                'Accept':        'application/vnd.github+json',
                'User-Agent':    'dcpca-bday-setup',
                'X-GitHub-Api-Version': '2022-11-28',
                ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
            },
        }, res => {
            let raw = '';
            res.on('data', c => raw += c);
            res.on('end', () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : {} }));
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

async function setSecret(keyId, keyB64, name, value) {
    const sodium = require('libsodium-wrappers');
    await sodium.ready;
    const key      = sodium.from_base64(keyB64, sodium.base64_variants.ORIGINAL);
    const msgBytes = sodium.from_string(value);
    const enc      = sodium.crypto_box_seal(msgBytes, key);
    const encB64   = sodium.to_base64(enc, sodium.base64_variants.ORIGINAL);

    const res = await api('PUT', `/repos/${REPO}/actions/secrets/${name}`, {
        encrypted_value: encB64,
        key_id: keyId,
    });
    if (res.status === 201 || res.status === 204) {
        console.log(`✅ ${name} set`);
    } else {
        console.error(`❌ ${name} failed:`, res.status, res.body);
    }
}

async function run() {
    const pkRes = await api('GET', `/repos/${REPO}/actions/secrets/public-key`);
    if (pkRes.status !== 200) { console.error('Failed to get public key:', pkRes.body); process.exit(1); }
    const { key_id, key } = pkRes.body;

    // Only creds.json — small enough for a secret
    const creds = fs.readFileSync(path.join(__dirname, '.baileys_auth', 'creds.json'), 'utf8');
    await setSecret(key_id, key, 'BAILEYS_CREDS', creds);

    console.log('\nDone. Now commit bday.xlsx to the repo, then trigger the workflow manually from the Actions tab.');
}

run().catch(e => { console.error(e); process.exit(1); });
