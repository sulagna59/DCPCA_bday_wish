/**
 * bday_wish.js — Daily birthday wish sender for DCPCA.
 *
 * Reads bday.xlsx, finds today's birthdays, sends a WhatsApp message
 * to the group for each birthday person.
 *
 * Photo Consent = Yes  → message + photo (local file path OR URL in Excel)
 * Photo Consent = No   → text only
 *
 * Cron (9 AM daily):
 *   0 9 * * * cd /Users/sulagna.b/Documents/forecast/dcpca_bday && node bday_wish.js >> /tmp/dcpca_bday.log 2>&1
 */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, MessageType } = require('@whiskeysockets/baileys');
const pino = require('pino');
const XLSX = require('xlsx');
const path = require('path');
const fs   = require('fs');

// ── Config ────────────────────────────────────────────────────────────────────
const GROUP_ID   = process.env.GROUP_ID;
const SHEET_URL  = process.env.SHEET_URL;
const AUTH_PATH  = path.join(__dirname, '.baileys_auth');

// ── Message templates (5, used rotationally) ──────────────────────────────────
const TEMPLATES = [
    (name, memberId) =>
`🎂 *Happy Birthday, ${name}!* 🎉
_Member ID: ${memberId}_

Wishing you a day filled with joy, laughter, and wonderful moments!

With warm wishes,
*DCPCA* ✨`,

    (name, memberId) =>
`🎉 *Many Happy Returns of the Day, ${name}!* 🎂
_Member ID: ${memberId}_

May this special day bring you endless happiness and all the love you deserve. Here's to another wonderful year ahead!

With warm regards,
*DCPCA* 🌟`,

    (name, memberId) =>
`🌟 *Wishing you a very Happy Birthday, ${name}!* 🎈
_Member ID: ${memberId}_

May each passing year bring you new joys, new hopes, and new beginnings. You make our DCPCA family shine brighter!

With love & best wishes,
*DCPCA* 🎊`,

    (name, memberId) =>
`🎊 *Happy Birthday, ${name}!* 🥳
_Member ID: ${memberId}_

Today is all about you — may it be as amazing as you are! Wishing you great health, happiness, and success in the year ahead.

Warmly,
*DCPCA* 🎂`,

    (name, memberId) =>
`🥳 *Heartiest Birthday Wishes, ${name}!* 🌸
_Member ID: ${memberId}_

On your special day, we celebrate the joy you bring to our community. May this year be your best one yet!

With affection,
*DCPCA* 🎉`,
];

const STATE_PATH = path.join(__dirname, 'bday_state.json');

function loadState() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); }
    catch { return { lastTemplateIndex: -1 }; }
}

function saveState(state) {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

function getMessage(name, memberId, baseIndex, personOffset) {
    const idx = (baseIndex + personOffset) % TEMPLATES.length;
    return TEMPLATES[idx](name, memberId);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function toIST(date) {
    // Convert any Date to IST day/month (handles UTC offset correctly)
    const ist = new Date(new Date(date).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    return { day: ist.getDate(), month: ist.getMonth() };
}

const MONTHS = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5,
                  jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };

async function todaysBirthdays() {
    const response = await fetch(SHEET_URL);
    if (!response.ok) throw new Error(`Failed to fetch sheet: ${response.status}`);
    const csv  = await response.text();
    const wb   = XLSX.read(csv, { type: 'string' });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { raw: false });

    const today = toIST(new Date());
    return rows.filter(row => {
        const dobStr = String(row['DOB'] || '').trim();
        if (!dobStr || dobStr.toLowerCase() === 'nan') return false;
        // Parse "D-Mon" or "DD-Mon" (e.g. "9-Aug", "10-Aug") — no timezone involved
        const m = dobStr.match(/^(\d{1,2})-([A-Za-z]{3})/);
        if (!m) return false;
        const day   = parseInt(m[1]);
        const month = MONTHS[m[2].toLowerCase()];
        return month !== undefined && day === today.day && month === today.month;
    });
}

function isValidUrl(str) {
    try { new URL(str); return true; } catch { return false; }
}

function mimeFromExt(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
             '.gif': 'image/gif',  '.webp': 'image/webp' }[ext] || 'image/jpeg';
}

function toDirectUrl(url) {
    // Convert Google Drive share link to direct download URL
    const m = url.match(/\/file\/d\/([^\/\?]+)/);
    if (m) return `https://drive.usercontent.google.com/download?id=${m[1]}&export=download&authuser=0`;
    return url;
}

async function resolvePhoto(photo) {
    // Returns { buffer, mime } or null
    if (!photo || ['nan', ''].includes(photo.toLowerCase())) return null;

    if (fs.existsSync(photo)) {
        // Local file path
        return { buffer: fs.readFileSync(photo), mime: mimeFromExt(photo) };
    }

    if (isValidUrl(photo)) {
        // Remote URL — auto-convert Google Drive share links
        try {
            const url      = toDirectUrl(photo);
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const rawMime = response.headers.get('content-type') || '';
            // Drive returns application/octet-stream — treat as image/jpeg
            const mime = rawMime.startsWith('image/') ? rawMime : 'image/jpeg';
            const buffer = Buffer.from(await response.arrayBuffer());
            return { buffer, mime };
        } catch (e) {
            console.warn(`⚠️ Photo fetch failed (${e.message}), sending text only.`);
            return null;
        }
    }

    return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
    if (!GROUP_ID) {
        console.error('❌ GROUP_ID is not set. Run setup.js first.');
        process.exit(1);
    }

    const birthdays = await todaysBirthdays();
    console.log(`${new Date().toISOString()} — ${birthdays.length} birthday(s) today.`);

    if (birthdays.length === 0) {
        console.log('No birthdays today. Done.');
        process.exit(0);
    }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_PATH);
    const sock = makeWASocket({
        auth:              state,
        logger:            pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser:           Browsers.ubuntu('Chrome'),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection }) => {
        if (connection === 'open') {
            console.log('WhatsApp connected.');

            const state = loadState();
            const baseIndex = state.lastTemplateIndex + 1;  // next after last used
            let personOffset = 0;

            for (const row of birthdays) {
                const name     = String(row['Name'] || '').trim();
                const memberId = String(row['Membership ID'] || '').trim();
                const consent   = String(row['Photo Consent'] || '').trim().toLowerCase() === 'yes';
                const photo     = String(row['Photo'] || '').trim();
                const text      = getMessage(name, memberId, baseIndex, personOffset);

                if (personOffset > 0) {
                    console.log(`⏳ Waiting 5 minutes before next wish...`);
                    await new Promise(r => setTimeout(r, 5 * 60 * 1000));
                }
                personOffset++;

                try {
                    const photoData = consent ? await resolvePhoto(photo) : null;

                    if (photoData) {
                        await sock.sendMessage(GROUP_ID, {
                            image:    photoData.buffer,
                            mimetype: photoData.mime,
                            caption:  text,
                        });
                    } else {
                        await sock.sendMessage(GROUP_ID, { text });
                    }
                    console.log(`✅ Sent for ${name} | photo: ${!!photoData}`);
                } catch (e) {
                    console.error(`❌ Failed for ${name}: ${e.message}`);
                }
            }

            // Save last template index used (last person's index)
            saveState({ lastTemplateIndex: (baseIndex + personOffset - 1) % TEMPLATES.length });

            // Wait 3s to ensure messages are delivered before closing
            await new Promise(r => setTimeout(r, 3000));
            process.exit(0);
        }

        if (connection === 'close') {
            console.error('❌ Connection closed unexpectedly.');
            process.exit(1);
        }
    });
}

run().catch(e => { console.error(e); process.exit(1); });
