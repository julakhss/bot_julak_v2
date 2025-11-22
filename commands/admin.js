// commands/admin.js
// Admin panel (owner only) dengan sesi input: tambah/hapus VPS, edit harga, broadcast, addsaldo

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const os = require('os');

/* ========= OWNER GUARD ========= */
function isOwnerMsg(msgOrQuery) {
  const allowed = ['2118266757']; // <-- hardcode ID owner di sini
  const uid = String(
    msgOrQuery?.from?.id ||
    msgOrQuery?.message?.from?.id ||
    ''
  );
  return allowed.includes(uid);
}

/* ========= UTIL ========= */
const send = (bot, chatId, text, opt = {}) =>
  bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...opt });

const vpsPath   = () => path.resolve(process.cwd(), 'julak', 'vps.json');
const hargaPath = () => path.resolve(process.cwd(), 'julak', 'harga.json');
const logPath   = () => path.resolve(process.cwd(), 'julak', 'admin.log');

function readJSON(p, fb) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return fb; }
}
function writeJSON(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

const idr = (n) => Number(n || 0).toLocaleString('id-ID');

function logAdmin(action, detail = {}) {
  try {
    const line = `${new Date().toISOString()} | ${action} | ${JSON.stringify(detail)}${os.EOL}`;
    fs.appendFileSync(logPath(), line);
  } catch {}
}

/* ========= DB USERS ========= */
const db = new Database(path.resolve(process.cwd(), 'julak', 'wallet.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    tg_id TEXT PRIMARY KEY,
    name  TEXT,
    balance INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
`);

const stmtAddBalance = db.prepare(`UPDATE users SET balance = balance + ? WHERE tg_id=?`);
const stmtGetUser    = db.prepare(`SELECT tg_id,name,balance FROM users WHERE tg_id=?`);
const stmtUpsertUser = db.prepare(`
  INSERT INTO users (tg_id, name, balance, created_at)
  VALUES (@tg_id, @name, 0, @created_at)
  ON CONFLICT(tg_id) DO UPDATE SET name = COALESCE(excluded.name, users.name)
`);

/* ========= SESSION ========= */
function sessKey(msg){ return `${msg.chat.id}:${msg.from.id}`; }

function getS(msg){
  global.__admin_sessions ??= Object.create(null);
  return global.__admin_sessions[sessKey(msg)];
}

function setS(bot, msg, data, ttlMs = 180_000){
  global.__admin_sessions ??= Object.create(null);
  const key = sessKey(msg);
  if (global.__admin_sessions[key]?._timeout) clearTimeout(global.__admin_sessions[key]._timeout);
  const chatId = msg.chat.id;
  const timeout = setTimeout(() => {
    try { send(bot, chatId, '⏳ Sesi admin timeout.'); } catch {}
    delete global.__admin_sessions[key];
  }, ttlMs);
  global.__admin_sessions[key] = { ...data, _timeout: timeout };
}

function clearS(msg){
  const S = getS(msg);
  if (S?._timeout) clearTimeout(S._timeout);
  global.__admin_sessions && delete global.__admin_sessions[sessKey(msg)];
}

/* ========= HELPERS ========= */
function formatDateISO(d) {
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth()+1).padStart(2,'0');
  const day = String(dt.getDate()).padStart(2,'0');
  const h = String(dt.getHours()).padStart(2,'0');
  const min = String(dt.getMinutes()).padStart(2,'0');
  return `${y}-${m}-${day} ${h}:${min}`;
}

/* ========= PLUGIN ========= */
module.exports = {
  name: 'admin',
  aliases: [],
  description: 'Panel admin (owner only) dengan sesi input',

  async execute(bot, msg) {
    if (!isOwnerMsg(msg)) {
      return send(bot, msg.chat.id, '❌ Menu ini hanya untuk admin/owner.');
    }

    const harga = readJSON(hargaPath(), {});
    const tampilHarga = Object.entries(harga)
      .map(([d,h]) => `• ${d} hari → Rp${idr(h)}`)
      .sort((a,b) => parseInt(a.split(' ')[1])-parseInt(b.split(' ')[1]))
      .join('\n') || '_Belum ada harga_';

    const txt =
`*🛡 ADMIN MENU*
Balas angka untuk memilih aksi:

1. ➕ Tambah VPS
2. 🗑 Hapus VPS
3. ✏️ Edit Harga
4. 📣 Broadcast
5. 💸 Add Saldo Manual

*Harga saat ini:*
${tampilHarga}

Ketik */batal* untuk membatalkan.`;
    await send(bot, msg.chat.id, txt);
    setS(bot, msg, { step: 'main' });
  },

  async continue(bot, msg) {
    if (!isOwnerMsg(msg)) return false;
    const S = getS(msg);
    if (!S) return false;
    const t = String(msg.text || '').trim();
    if (!t) return true;

    // batal universal
    if (/^([./])?batal$/i.test(t)) {
      clearS(msg);
      await send(bot, msg.chat.id, '✅ Sesi admin dibatalkan.');
      return true;
    }

    /* ===== MAIN MENU ===== */
    if (S.step === 'main') {
      switch(t){
        case '1': return this.startAddVps(bot, msg);
        case '2': return this.startDelVps(bot, msg);
        case '3': return this.startEditHarga(bot, msg);
        case '4': return this.startBroadcast(bot, msg);
        case '5': return this.startAddSaldo(bot, msg);
        default: return true;
      }
    }

    /* ===== ADD VPS ===== */
if (S.step === 'addvps') {
  const parts = t.split('|').map(s => s.trim());
  if (parts.length < 7) {
    await send(bot, msg.chat.id,
      '⚠️ Format salah. Gunakan:\n' +
      '`id|host|port|username|password|harga_per_hari|limit_add`'
    );
    return true;
  }

  const [id, host, portStr, username, password, hargaStr, limitStr] = parts;
  const port = parseInt(portStr, 10) || 22;
  const harga_per_hari = parseInt(hargaStr, 10) || 0;
  const limit_add = parseInt(limitStr, 10) || 0;

  const list = readJSON(vpsPath(), []);
  const exists = list.find(v => v.id === id || v.host === host);
  if (exists) {
    await send(bot, msg.chat.id, `⚠️ VPS dengan ID *${id}* sudah ada.`);
    return true;
  }

  list.push({ id, host, port, username, password, harga_per_hari, limit_add });
  writeJSON(vpsPath(), list);

  await send(bot, msg.chat.id, `✅ VPS *${id}* berhasil ditambahkan.\n💰 Harga: Rp${idr(harga_per_hari)}\n👥 Limit Add: ${limit_add}`);
  logAdmin('addvps', { admin: msg.from.id, id, host, port, harga_per_hari, limit_add });
  clearS(msg);
  return true;
}

    /* ===== DELETE VPS ===== */
    if (S.step === 'delvps') {
      if (!S.list || !S.list.length) { clearS(msg); return true; }
      const idx = parseInt(t,10)-1;
      if (isNaN(idx) || idx<0 || idx>=S.list.length) {
        await send(bot, msg.chat.id, '⚠️ Pilihan tidak valid. Balas *angka* yang ada di daftar.');
        return true;
      }
      const target = S.list[idx];
      if(!S.confirmed){
        setS(bot,msg,{...S, confirmed:true, targetIdx:idx});
        await send(bot,msg.chat.id,`⚠️ Konfirmasi: Hapus VPS *${target.id||target.host}*?\nBalas 'ya' untuk konfirmasi atau 'tidak' untuk batal.`);
        return true;
      }
      if(/^(ya|yes)$/i.test(t)){
        const list = readJSON(vpsPath(), []);
        const removed = list.splice(idx,1)[0];
        writeJSON(vpsPath(), list);
        await send(bot,msg.chat.id,`🗑 VPS *${removed.id||removed.host}* dihapus.`);
        logAdmin('delvps',{admin: msg.from.id, target: removed});
        clearS(msg);
        return true;
      }
      await send(bot,msg.chat.id,'✅ Hapus VPS dibatalkan.'); clearS(msg); return true;
    }

    /* ===== EDIT HARGA ===== */
if (S.step === 'editharga') {
  const list = readJSON(vpsPath(), []);
  const pairs = (t || '').split(/[\s\n]+/).filter(Boolean);
  let changed = 0;

  for (const p of pairs) {
    const m = p.match(/^(.+?)=(\d{1,})$/); // idVPS=harga
    if (!m) continue;
    const id = m[1].trim();
    const val = parseInt(m[2], 10);
    const vps = list.find(v => v.id === id);
    if (vps && val >= 0) {
      vps.harga_per_hari = val;
      changed++;
    }
  }

  writeJSON(vpsPath(), list);
  await send(bot, msg.chat.id, `✅ Harga VPS berhasil di-update (${changed} item).`);
  logAdmin('editharga', { admin: msg.from.id, changed });
  clearS(msg);
  return true;
}

    /* ===== BROADCAST ===== */
    if (S.step === 'broadcast') {
      const users = db.prepare('SELECT tg_id FROM users').all();
      if(!users.length){ await send(bot,msg.chat.id,'ℹ️ Tidak ada user.'); clearS(msg); return true; }
      let ok=0, fail=0;
      for(const u of users){
        try{ await send(bot,u.tg_id,t); ok++; } catch{ fail++; }
      }
      await send(bot,msg.chat.id,`📣 Broadcast selesai. Berhasil: ${ok}, Gagal: ${fail}.`);
      logAdmin('broadcast',{admin: msg.from.id, ok, fail});
      clearS(msg); return true;
    }

    /* ===== ADD SALDO MANUAL ===== */
    if (S.step === 'addsaldo') {
      const parts = t.split('|').map(s=>s.trim());
      if(parts.length<2){ await send(bot,msg.chat.id,'⚠️ Format salah. Gunakan: `userId|nominal`'); return true; }
      const [uid, amountStr] = parts;
      const amount = parseInt(amountStr,10);
      if(!uid || isNaN(amount)){ await send(bot,msg.chat.id,'⚠️ Format salah. Contoh: `5736569839|10000`'); return true; }
      if(!S.confirmed){
        setS(bot,msg,{...S, confirmed:true, targetUid:uid, targetAmount:amount});
        await send(bot,msg.chat.id,`⚠️ Konfirmasi: Tambah saldo Rp${idr(amount)} ke user *${uid}*?\nBalas 'ya' untuk konfirmasi atau 'tidak' untuk batal.`);
        return true;
      }
      if(/^(ya|yes)$/i.test(t)){
        stmtUpsertUser.run({ tg_id:String(uid), name:null, created_at: new Date().toISOString() });
        stmtAddBalance.run(amount,String(uid));
        const u = stmtGetUser.get(String(uid));
        await send(bot,msg.chat.id,`✅ Saldo user *${uid}* ditambah Rp${idr(amount)}.\nSaldo sekarang: *Rp${idr(u?.balance||0)}*`);
        logAdmin('addsaldo',{admin: msg.from.id, uid, amount});
        clearS(msg); return true;
      }
      await send(bot,msg.chat.id,'✅ Add saldo dibatalkan.'); clearS(msg); return true;
    }

    return true;
  },

  /* ===== START HELPERS ===== */
  async startAddVps(bot, msg) {
  await send(bot, msg.chat.id,
`*Tambah VPS*
Kirim *1 baris* dengan format:
\`id|host|port|username|password|harga_per_hari|limit_add\`

Contoh:
\`Julak|123.123.123.123|22|root|rahasia|500|50\``);
  setS(bot, msg, { step: 'addvps' });
},

  async startDelVps(bot,msg){
    const list = readJSON(vpsPath(),[]);
    if(!list.length){ await send(bot,msg.chat.id,'ℹ️ Tidak ada VPS.'); clearS(msg); return; }
    const rows = list.map((v,i)=>`${i+1}. ${v.id || v.host}`).join('\n');
    await send(bot, msg.chat.id, `*Hapus VPS*\nBalas ANGKA untuk menghapus:\n\n${rows}`);
    setS(bot, msg, { step: 'delvps', list });
  },

  /* ===== START EDIT HARGA ===== */
async startEditHarga(bot, msg) {
  const list = readJSON(vpsPath(), []);
  if (!list.length) {
    await send(bot, msg.chat.id, 'ℹ️ Belum ada VPS.');
    return;
  }

  // Tampilkan daftar VPS + harga
  const rows = list.map(v => `• ${v.id} → Rp${idr(v.harga_per_hari)}`).join('\n');
  await send(bot, msg.chat.id,
`*Edit Harga VPS*
Berikut daftar VPS saat ini beserta harga per hari:

${rows}

Kirim pasangan *idVPS=harga* (bisa lebih dari satu, pisah spasi atau baris).
Contoh:
\`VPS1=500 VPS2=1000\``);

  setS(bot, msg, { step: 'editharga' });
},

  async startBroadcast(bot,msg){
    await send(bot,msg.chat.id, '*Broadcast*\nKirim teks yang akan disiarkan ke *semua user*.');
    setS(bot,msg,{step:'broadcast'});
  },

  async startAddSaldo(bot,msg){
    await send(bot,msg.chat.id,
`*Add Saldo Manual*
Format: \`userId|nominal\`

Contoh:
\`5736569839|10000\``);
    setS(bot,msg,{step:'addsaldo'});
  }
};
