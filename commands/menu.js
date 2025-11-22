// commands/menu.js
const fs = require('fs');
const net = require('net');
const path = require('path');
const Database = require('better-sqlite3');
const { ensureUser } = require('../lib/db');
const { isOwnerMsg } = require('../lib/owner');

// ====== CONFIG ======
const BRAND_NAME = 'JULAK VPN';
const STORE_NAME = 'PAPADAAN-STORE';
const CONTACT_ADM = '@rajaganjil93';

// ====== Plugins ======
function safeRequire(p){ try{ return require(p); } catch{return { execute: async()=>{} }; } }
const pTrialSSH    = safeRequire('./trialssh');
const pTrialVMESS  = safeRequire('./trialvmess');
const pTrialVLESS  = safeRequire('./trialvless');
const pTrialTROJAN = safeRequire('./trialtrojan');
const pAddSSH      = safeRequire('./addssh');
const pAddVMESS    = safeRequire('./addvmess');
const pAddVLESS    = safeRequire('./addvless');
const pAddTROJAN   = safeRequire('./addtrojan');
const pRenewSSH    = safeRequire('./renewssh');
const pRenewVMESS  = safeRequire('./renewvmess');
const pRenewVLESS  = safeRequire('./renewvless');
const pRenewTROJAN = safeRequire('./renewtrojan');
const pTOPUP       = safeRequire('./topup');
const pSALDO       = safeRequire('./ceksaldo');
const pADMIN       = safeRequire('./admin');
const pHISTORY       = safeRequire('./history');
const pTOPMANUAL       = safeRequire('./topupmanual');
const pCEKPENDING       = safeRequire('./checkPendingTopup');
const pDELVPS       = safeRequire('./deletevps');
const pADDSERVER       = safeRequire('./addserver');
const pBROADCAST       = safeRequire('./broadcast');
const pADDSALDO       = safeRequire('./addsaldo');
const pDATAUSER       = safeRequire('./datauser');

// ====== DB ======
const DB_PATH = path.resolve(process.cwd(), 'julak', 'wallet.db');
function openDB() {
  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        tg_id TEXT PRIMARY KEY,
        name TEXT,
        balance INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
    `);
    return db;
  } catch {
    return null;
  }
}
const db = openDB();
function getSaldo(tgId) {
  try {
    if (!db) return 0;
    const row = db.prepare(`SELECT balance FROM users WHERE tg_id=?`).get(String(tgId));
    return Number(row?.balance || 0);
  } catch { return 0; }
}
function countUsers() {
  try {
    if (!db) return 0;
    const row = db.prepare(`SELECT COUNT(*) AS n FROM users`).get();
    return Number(row?.n || 0);
  } catch { return 0; }
}

// ====== WIB helpers ======
function wibNow() {
  // konversi ke WIB (UTC+7) tanpa mengubah jam sistem
  const now = new Date();
  return new Date(now.getTime() + 7*60*60*1000);
}
function startEndOfDayWIB(dateWIB = wibNow()) {
  const d = new Date(dateWIB);
  d.setUTCHours(0,0,0,0);
  const start = new Date(d);
  const end   = new Date(d.getTime() + 24*60*60*1000);
  return { start, end };
}
function startEndOfWeekWIB(dateWIB = wibNow()) {
  // minggu dimulai Senin (ISO)
  const d = new Date(dateWIB);
  const day = (d.getUTCDay() + 6) % 7; // 0=Senin
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - day);
  start.setUTCHours(0,0,0,0);
  const end = new Date(start.getTime() + 7*24*60*60*1000);
  return { start, end };
}
function startEndOfMonthWIB(dateWIB = wibNow()) {
  const d = new Date(dateWIB);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0,0,0));
  const end   = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0,0,0));
  return { start, end };
}

// Konversi objek Date (WIB-virtual) ke ISO UTC string supaya sejalan dengan kolom created_at
function toISO(d) { return new Date(d.getTime() - 7*60*60*1000).toISOString(); }

// ====== Statistik dari purchase_logs ======
function getUserStats(tgId) {
  const zero = { day: 0, week: 0, month: 0 };
  if (!db) return zero;
  try {
    // pastikan tabel ada
    db.prepare(`SELECT 1 FROM purchase_logs LIMIT 1`).get();
  } catch { return zero; }

  const { start: dS, end: dE } = startEndOfDayWIB();
  const { start: wS, end: wE } = startEndOfWeekWIB();
  const { start: mS, end: mE } = startEndOfMonthWIB();

  const q = `SELECT COUNT(*) AS n FROM purchase_logs WHERE tg_id=? AND created_at>=? AND created_at<?`;
  const day  = db.prepare(q).get(String(tgId), toISO(dS), toISO(dE))?.n || 0;
  const week = db.prepare(q).get(String(tgId), toISO(wS), toISO(wE))?.n || 0;
  const month= db.prepare(q).get(String(tgId), toISO(mS), toISO(mE))?.n || 0;
  return { day, week, month };
}
function getGlobalStats() {
  const zero = { day: 0, week: 0, month: 0 };
  if (!db) return zero;
  try {
    db.prepare(`SELECT 1 FROM purchase_logs LIMIT 1`).get();
  } catch { return zero; }

  const { start: dS, end: dE } = startEndOfDayWIB();
  const { start: wS, end: wE } = startEndOfWeekWIB();
  const { start: mS, end: mE } = startEndOfMonthWIB();

  const q = `SELECT COUNT(*) AS n FROM purchase_logs WHERE created_at>=? AND created_at<?`;
  const day  = db.prepare(q).get(toISO(dS), toISO(dE))?.n || 0;
  const week = db.prepare(q).get(toISO(wS), toISO(wE))?.n || 0;
  const month= db.prepare(q).get(toISO(mS), toISO(mE))?.n || 0;
  return { day, week, month };
}

// ====== VPS status ======
function checkPort(host, port = 22, timeout = 2000) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let settled = false;
    const done = (ok) => {
      if (!settled) {
        settled = true;
        try { sock.destroy(); } catch {}
        resolve(ok);
      }
    };
    sock.setTimeout(timeout);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error',  () => done(false));
    try { sock.connect(port, host); } catch { done(false); }
  });
}
function loadVpsList() {
  const vpsPath = path.resolve(process.cwd(), 'julak', 'vps.json');
  if (!fs.existsSync(vpsPath)) return [];
  try {
    const list = JSON.parse(fs.readFileSync(vpsPath, 'utf-8'));
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
async function getVpsStatuses() {
  const list = loadVpsList();
  const results = await Promise.all(
    list.map(async (v) => {
      const host = v.host;
      const port = v.port || 22;
      const ok   = host ? await checkPort(host, port) : false;
      const name = v.name || v.id || (host ? `${host}:${port}` : 'unknown');
      return { name, online: ok };
    })
  );
  return { results, count: list.length };
}

// ====== Waktu, tanggal, uptime ======
const idr = (n) => Number(n||0).toLocaleString('id-ID');
function fmtUptime(sec) {
  const d = Math.floor(sec / 86400);
  sec -= d * 86400;
  const h = Math.floor(sec / 3600);
  sec -= h * 3600;
  const m = Math.floor(sec / 60);
  return `${d}d ${h}h ${m}m`;
}
function nowJakarta() {
  const wib = wibNow();
  const pad = (n)=>String(n).padStart(2,'0');
  const hh = pad(wib.getUTCHours());
  const mm = pad(wib.getUTCMinutes());
  const ss = pad(wib.getUTCSeconds());
  const dayNames = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
  const monthNames = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const dname = dayNames[wib.getUTCDay()];
  const date  = `${dname}, ${wib.getUTCDate()} ${monthNames[wib.getUTCMonth()]} ${wib.getUTCFullYear()}`;
  return { time: `${hh}:${mm}:${ss} WIB`, date };
}
function getUptimeSec() {
  const started = Number(global.__BOT_STARTED_AT || 0);
  if (started > 0) return Math.floor((Date.now() - started) / 1000);
  // fallback kalau global belum diset
  return Math.floor(process.uptime());
}

function fmtUptime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / 86400);
  sec -= d * 86400;
  const h = Math.floor(sec / 3600);
  sec -= h * 3600;
  const m = Math.floor(sec / 60);
  return `${d}d ${h}h ${m}m`;
}
// ====== Header kartu ======
async function buildHeaderText(msg) {
  const uid = msg.from?.id;
  const uname = msg.from?.username ? `@${msg.from.username}` : (msg.from?.first_name || 'User');
  const saldo = getSaldo(uid);
  const uptime = fmtUptime(getUptimeSec());
  const { count: vpsCount } = await getVpsStatuses();
  const totalUsers = countUsers();

  const meStat = getUserStats(uid);
  const glStat = getGlobalStats();
  const { time, date } = nowJakarta();
  const { results } = await getVpsStatuses();
  const statusLines = results.length
  ? results.map(s => `${s.name} ➡️ ${s.online ? '🟢 (Online)' : '🔴 (Offline)'}`)
  : ['_Tidak ada VPS terdaftar._'];

  return [
`🎉 *Selamat Datang di ${BRAND_NAME}* 🎉`,
'Bot otomatis untuk membeli Akun VPN dengan mudah dan cepat.',
'━━━━━━━━━━━━━━━━━━━━━━━━',
`👤 » Status: Member`,
`📋 » User ID: ${uid}`,
`🌐 » Username: ${uname}`,
`💲 Saldo : Rp.${idr(saldo)}`,
`♻️ » Bot Aktif: ${uptime}`,
`✨ » Trial 2x Sehari`,
`🥇 » Support Wildcard & Enhanced`,
'━━━━━━━━━━━━━━━━━━━━━━━━',
`🧭 » Waktu: ${time}`,
`🏷️ » Tanggal: ${date}`,
`🏷️ » Total Pengguna: ${totalUsers}`,
`☎️ » Contact Admin:`,
`💬 » Whatsapp: +6285166600428`,
`🗨️ » Telegram: ${CONTACT_ADM}`,
'━━━━━━━━━━━━━━━━━━━━━━━━',
`*Total Server :* [${vpsCount}]`,
'*Status Server :*',
...statusLines,
'━━━━━━━━━━━━━━━━━━━━━━━━'
  ].join('\n');
}

// ===== Keyboard =====
function buildMainKeyboard(isOwner) {
  const rows = [
    [
      { text: '🔰 SSH', callback_data: 'menu:submenu:ssh' },
      { text: '⚡ VMESS', callback_data: 'menu:submenu:vmess' }
    ],
    [
      { text: '🌀 VLESS', callback_data: 'menu:submenu:vless' },
      { text: '✴️ TROJAN', callback_data: 'menu:submenu:trojan' }
    ],
    [
      { text: '💰 CEK SALDO', callback_data: 'menu:run:ceksaldo' },
      { text: '💰 TOP UP SALDO', callback_data: 'menu:submenu:saldo' }
    ],
    [
      { text: '📜 RIWAYAT TRANSAKSI', callback_data: 'menu:run:history' }
    ]
  ];

  if (isOwner)
    rows.push([{ text: '🛡 ADMIN', callback_data: 'menu:submenu:admin' }]);

  rows.push([{ text: '🔄 Refresh', callback_data: 'menu:run:main' }]);
  return { inline_keyboard: rows };
}

function buildSubKeyboard(type) {
  const map = {
    ssh: [
      { text: '➕ Add SSH', callback_data: 'menu:run:addssh' },
      { text: '🆓 Trial SSH', callback_data: 'menu:run:trialssh' },
      { text: '♻️ Renew SSH', callback_data: 'menu:run:renewssh' }
    ],
    vmess: [
      { text: '➕ Add VMess', callback_data: 'menu:run:addvmess' },
      { text: '🆓 Trial VMess', callback_data: 'menu:run:trialvmess' },
      { text: '♻️ Renew VMess', callback_data: 'menu:run:renewvmess' }
    ],
    vless: [
      { text: '➕ Add VLess', callback_data: 'menu:run:addvless' },
      { text: '🆓 Trial VLess', callback_data: 'menu:run:trialvless' },
      { text: '♻️ Renew VLess', callback_data: 'menu:run:renewvless' }
    ],
    trojan: [
      { text: '➕ Add Trojan', callback_data: 'menu:run:addtrojan' },
      { text: '🆓 Trial Trojan', callback_data: 'menu:run:trialtrojan' },
      { text: '♻️ Renew Trojan', callback_data: 'menu:run:renewtrojan' }
    ],
    saldo: [
      { text: '💰 Topup Otomatis', callback_data: 'menu:run:topup' },
      { text: '💰 Topup Manual', callback_data: 'menu:run:topupmanual' },
    ],
    admin: [
      { text: '➕ Tambah VPS', callback_data: 'menu:run:addserver' },
      { text: '🗑 Hapus VPS', callback_data: 'menu:run:deletevps' },
      { text: '✏️ Edit Harga', callback_data: 'menu:run:admin:editharga' },
      { text: '📣 Broadcast', callback_data: 'menu:run:broadcast' },
      { text: '💸 Add Saldo', callback_data: 'menu:run:addsaldo' },
      { text: '📊 Data User', callback_data: 'menu:run:datauser' },
      { text: '⏳ Topup Pending', callback_data: 'menu:run:checkPendingTopup' }
    ]
  };

  const buttons = map[type] || [];
  buttons.push({ text: '🔙 Kembali', callback_data: 'menu:run:main' });

  return { inline_keyboard: buttons.map(b => [b]) };
}

// ===== Riwayat Transaksi =====
function getUserHistory(tgId, limit=10){
  return db.prepare(`
    SELECT kind AS type, days, vps_id, created_at
    FROM purchase_logs
    WHERE tg_id=?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(String(tgId), limit);
}

async function showUserHistory(bot, q){
  try{
    const rows = getUserHistory(q.from?.id, 10);
    if(rows.length === 0) return bot.editMessageText('📭 Belum ada riwayat transaksi.', { chat_id:q.message.chat.id, message_id:q.message.message_id });

    const lines = rows.map((r,i)=>`${i+1}. ${r.type.toUpperCase()} — VPS: ${r.vps_id||'-'}\n${r.days||0} hari\n🗓 ${r.created_at}`).join('\n\n');

    await bot.editMessageText(
      `📜 *10 Riwayat Transaksi Terbaru:*\n\n${lines}`,
      {
        chat_id:q.message.chat.id,
        message_id:q.message.message_id,
        parse_mode:'Markdown',
        reply_markup:{ inline_keyboard:[[ {text:'🔙 Kembali',callback_data:'menu:run:main'} ]] }
      }
    );
  }catch(e){
    console.error('showUserHistory error', e);
    await bot.sendMessage(q.message.chat.id,'❌ Gagal mengambil riwayat.');
  }
}

// ===== Export =====
module.exports = {
  name:'menubutton',
  aliases:['menu','help','start'],
  description:'Menampilkan menu utama dengan tombol interaktif',

  async execute(bot,msg){
    try{
      ensureUser(msg);
      const header = await buildHeaderText(msg);
      const kb = buildMainKeyboard(isOwnerMsg(msg));
      await bot.sendMessage(msg.chat.id, header, {
        parse_mode:'Markdown',
        reply_markup:kb
      });
    }catch(e){
      console.error('[menu] execute error:',e);
      await bot.sendMessage(msg.chat.id,'❌ Gagal menampilkan menu.');
    }
  },

  register(bot){
    if(bot.__menubutton_registered) return;
    bot.__menubutton_registered = true;

    bot.on('callback_query', async q=>{
      try{
        const data=q.data||''; const chatId=q.message.chat.id; const msgId=q.message.message_id;
        await bot.answerCallbackQuery(q.id);
        
        if(data==='menu:run:main'){
          const header='╭─ Bot VPN Premium dengan sistem otomatis\n├   Untuk pembelian Akun VPN Premium\n\nPilih layanan di bawah ini:';
          return bot.editMessageText(header,{
            chat_id:chatId, message_id:msgId, parse_mode:'Markdown',
            reply_markup:buildMainKeyboard(isOwnerMsg(q))
          });
        }
        if(data.startsWith('menu:submenu:')){
          const type=data.split(':')[2];
          const titleMap={ssh:'SSH MANAGER',vmess:'VMESS MANAGER',vless:'VLESS MANAGER',trojan:'TROJAN MANAGER',saldo:'TOPUP MANAGER\n\n🔹 Minimal Topup Manual : 1.000\n🔹 Minimal Topup Otomatis : 5000',admin:'ADMIN MANAGER'};
          const header=`*📋 MENU ${titleMap[type]||''}*`;
          return bot.editMessageText(header,{
            chat_id:chatId, message_id:msgId, parse_mode:'Markdown',
            reply_markup:buildSubKeyboard(type)
          });
        }
        
        if(data==='menu:run:history') return showUserHistory(bot,q);

        const map={
          trialssh:pTrialSSH, trialvmess:pTrialVMESS, trialvless:pTrialVLESS, trialtrojan:pTrialTROJAN,
          renewssh:pRenewSSH, renewvmess:pRenewVMESS, renewvless:pRenewVLESS, renewtrojan:pRenewTROJAN,
          addssh:pAddSSH, addvmess:pAddVMESS, addvless:pAddVLESS, addtrojan:pAddTROJAN,
          topup:pTOPUP, ceksaldo:pSALDO, history:pHISTORY, topupmanual:pTOPMANUAL,
          checkPendingTopup:pCEKPENDING, deletevps:pDELVPS, addserver:pADDSERVER,
          broadcast:pBROADCAST, addsaldo:pADDSALDO, datauser:pDATAUSER
        };
        const key=data.replace('menu:run:','');
        const plugin=map[key];
        if(plugin?.execute){
          await bot.editMessageText(`⏳ Menjalankan *${key}*...`,{chat_id:chatId,message_id:msgId,parse_mode:'Markdown'});
          const fakeMsg={...q.message,chat:q.message.chat,from:q.from,text:''};
          return plugin.execute(bot,fakeMsg,[]);
        }
      }catch(err){
        console.error('[menu] callback error:',err);
        await bot.sendMessage(q.message.chat.id,'❌ Terjadi kesalahan tombol.');
      }
    });
  }
};