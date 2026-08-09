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
const GROUP_ID   = '120363427760976937@g.us';
const SHEET_URL  = 'https://docs.google.com/spreadsheets/d/1Y4Xb9kHeK9yLF_l74rmxbQ5hXC5JkRTE/export?format=csv';
const AUTH_PATH  = path.join(__dirname, '.baileys_auth');

// ── Message template ──────────────────────────────────────────────────────────
const message = (firstName, memberId) =>
`🎂 *Happy Birthday, ${firstName}!* 🎉
_Member ID: ${memberId}_

Wishing you a day filled with joy, laughter, and wonderful moments!

With warm wishes,
*DCPCA* ✨`;

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
    if (m) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
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
        const url      = toDirectUrl(photo);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status} fetching photo`);
        const buffer = Buffer.from(await response.arrayBuffer());
        const mime   = response.headers.get('content-type') || 'image/jpeg';
        return { buffer, mime };
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

            for (const row of birthdays) {
                const name      = String(row['Name'] || '').trim();
                const firstName = name.split(' ')[0];
                const memberId  = String(row['Membership ID'] || '').trim();
                const consent   = String(row['Photo Consent'] || '').trim().toLowerCase() === 'yes';
                const photo     = String(row['Photo'] || '').trim();

                try {
                    const photoData = consent ? await resolvePhoto(photo) : null;

                    if (photoData) {
                        await sock.sendMessage(GROUP_ID, {
                            image:    photoData.buffer,
                            mimetype: photoData.mime,
                            caption:  message(firstName, memberId),
                        });
                    } else {
                        await sock.sendMessage(GROUP_ID, { text: message(firstName, memberId) });
                    }
                    console.log(`✅ Sent for ${name} | photo: ${!!photoData}`);
                } catch (e) {
                    console.error(`❌ Failed for ${name}: ${e.message}`);
                }
            }

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
