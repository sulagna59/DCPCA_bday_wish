/**
 * setup.js — Run ONCE to connect your WhatsApp account via Baileys.
 *
 * Steps:
 *   1. node setup.js
 *   2. Enter the pairing code in WhatsApp → Settings → Linked Devices → Link with Phone Number
 *   3. Send any message in your birthday group
 *   4. Copy the group ID printed here → paste into bday_wish.js as GROUP_ID
 */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino  = require('pino');
const path  = require('path');

const PHONE_NUMBER = '917439902459';   // bot number with country code, no +
const AUTH_PATH    = path.join(__dirname, '.baileys_auth');

async function start() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_PATH);

    const sock = makeWASocket({
        auth:               state,
        logger:             pino({ level: 'silent' }),
        printQRInTerminal:  false,
        browser:            Browsers.ubuntu('Chrome'),
    });

    sock.ev.on('creds.update', saveCreds);

    // Request pairing code on first run
    if (!state.creds.registered) {
        await new Promise(r => setTimeout(r, 2000));
        const code = await sock.requestPairingCode(PHONE_NUMBER);
        console.log('\n🔑 Enter this code in WhatsApp on the phone:');
        console.log('   Settings → Linked Devices → Link with Phone Number\n');
        console.log(`   Code: ${code}\n`);
    }

    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
        if (connection === 'open') {
            console.log('✅ Connected!\n');
            console.log('📨 Now send any message in your birthday group.');
            console.log('   The group ID will print here automatically.\n');
        }
        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            if (code !== DisconnectReason.loggedOut) {
                console.log('Reconnecting...');
                start();
            }
        }
    });

    // Capture group ID from any incoming or outgoing message in a group
    sock.ev.on('messages.upsert', ({ messages }) => {
        for (const msg of messages) {
            const chatId = msg.key?.remoteJid;
            if (chatId && chatId.endsWith('@g.us')) {
                console.log('✅ Group ID captured!');
                console.log(`   ID : ${chatId}`);
                console.log('\n👆 Paste this as GROUP_ID in bday_wish.js');
                process.exit(0);
            }
        }
    });
}

start().catch(console.error);
