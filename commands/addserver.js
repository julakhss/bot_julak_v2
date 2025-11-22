// commands/addserver.js
// Tambah VPS baru ke file julak/vps.json
// Menggunakan alur interaktif dengan sesi admin

const fs = require('fs');
const path = require('path');

const VPS_PATH = path.resolve(process.cwd(), 'julak', 'vps.json');
const addSessions = new Map();
global.__addserver_sessions = addSessions;

// ===== Helper baca & tulis file =====
function readVpsFile() {
  if (!fs.existsSync(VPS_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(VPS_PATH, 'utf-8'));
  } catch (e) {
    console.error('❌ Gagal baca vps.json:', e);
    return [];
  }
}

function saveVpsFile(data) {
  fs.mkdirSync(path.dirname(VPS_PATH), { recursive: true });
  fs.writeFileSync(VPS_PATH, JSON.stringify(data, null, 2));
}

// ===== Fungsi utama =====
async function execute(bot, msg, args) {
  const chatId = msg.chat.id;
  addSessions.set(msg.from.id, { step: 'id' });

  await bot.sendMessage(
    chatId,
    `🆕 <b>Tambah VPS Baru</b>\n\nMasukkan <b>ID VPS</b> (contoh: SG1):`,
    { parse_mode: 'HTML' }
  );
}

// ===== Handler pesan masuk =====
async function handleMessage(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text?.trim();
  if (!text) return false;

  // ==== CEK GLOBAL BATAL ====
  // Jika global session kosong atau user sudah tidak ada di sesi
  if (!global.__addserver_sessions || !global.__addserver_sessions.has(userId)) {
    return false; // keluar tanpa lanjut step
  }

  // ==== Dapatkan session user ====
  const session = global.__addserver_sessions.get(userId);

  // === Deteksi /batal manual ===
  if (text === '/batal') {
    global.__addserver_sessions.delete(userId);
    return bot.sendMessage(chatId, '❌ Sesi tambah VPS dibatalkan.');
  }

  switch (session.step) {
    case 'id':
      session.id = text;
      session.step = 'host';
      return bot.sendMessage(chatId, `🌐 Masukkan <b>Host VPS</b>:\n\nKetik /batal untuk membatalkan.`, { parse_mode: 'HTML' });

    case 'host':
      session.host = text;
      session.step = 'port';
      return bot.sendMessage(chatId, `🔌 Masukkan <b>Port VPS</b> (contoh: 22):\n\nKetik /batal untuk membatalkan.`, { parse_mode: 'HTML' });

    case 'port':
      if (isNaN(Number(text))) return bot.sendMessage(chatId, `⚠️ Port harus berupa angka!`);
      session.port = Number(text);
      session.step = 'username';
      return bot.sendMessage(chatId, `👤 Masukkan <b>Username</b> login VPS:\n\nKetik /batal untuk membatalkan.`, { parse_mode: 'HTML' });

    case 'username':
      session.username = text;
      session.step = 'password';
      return bot.sendMessage(chatId, `🔑 Masukkan <b>Password VPS</b>:\n\nKetik /batal untuk membatalkan.`, { parse_mode: 'HTML' });

    case 'password':
      session.password = text;
      session.step = 'harga';
      return bot.sendMessage(chatId, `💰 Masukkan <b>Harga per hari</b> (contoh: 500):\n\nKetik /batal untuk membatalkan.`, { parse_mode: 'HTML' });

    case 'harga':
      if (isNaN(Number(text))) return bot.sendMessage(chatId, `⚠️ Harga harus berupa angka!`);
      session.harga_per_hari = Number(text);
      session.step = 'limit';
      return bot.sendMessage(chatId, `📦 Masukkan <b>Limit Add</b> (contoh: 20):\n\nKetik /batal untuk membatalkan.`, { parse_mode: 'HTML' });

    case 'limit':
      if (isNaN(Number(text))) return bot.sendMessage(chatId, `⚠️ Limit harus berupa angka!`);
      session.limit_add = Number(text);

      const newVps = {
        id: session.id,
        host: session.host,
        port: session.port,
        username: session.username,
        password: session.password,
        harga_per_hari: session.harga_per_hari,
        limit_add: session.limit_add,
      };

      const vpsList = readVpsFile();
      if (vpsList.find(v => v.id.toLowerCase() === newVps.id.toLowerCase())) {
        global.__addserver_sessions.delete(userId);
        return bot.sendMessage(chatId, `⚠️ VPS dengan ID <b>${newVps.id}</b> sudah ada!`, { parse_mode: 'HTML' });
      }

      vpsList.push(newVps);
      saveVpsFile(vpsList);
      global.__addserver_sessions.delete(userId);

      return bot.sendMessage(
        chatId,
        `✅ VPS baru berhasil ditambahkan:\n\n🖥️ <b>ID:</b> ${newVps.id}\n🌐 <b>Host:</b> ${newVps.host}\n💰 <b>Harga/hari:</b> ${newVps.harga_per_hari}\n📦 <b>Limit Add:</b> ${newVps.limit_add}`,
        { parse_mode: 'HTML' }
      );
  }
}

module.exports = {
  name: 'addserver',
  description: 'Tambah server baru ke vps.json',
  execute,
  handleMessage,
};