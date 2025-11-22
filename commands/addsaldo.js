// commands/addsaldo.js
const { getUser, updateBalance, addMetaLog } = require('../lib/db');
const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.resolve(process.cwd(), 'julak', 'wallet.db'));

// ===== STATE =====
const session = new Map(); // key: admin_id, value: { step, targetId }

function isOwner(msg) {
  const ownerEnv = process.env.OWNER_ID;
  if (!ownerEnv) return true;
  return msg.from.id === parseInt(ownerEnv);
}

// ====== Fungsi bantu DB ======
function getUserByTgId(tg_id) {
  return db.prepare('SELECT * FROM users WHERE tg_id = ?').get(tg_id);
}

function addSaldo(tg_id, amount) {
  db.prepare('UPDATE users SET balance = balance + ? WHERE tg_id = ?').run(amount, tg_id);
}

// ====== Handler utama ======
async function execute(bot, msg) {
  if (!isOwner(msg)) return bot.sendMessage(msg.chat.id, '⛔ Hanya owner yang bisa menambah saldo.');

  const adminId = msg.from.id;
  session.set(adminId, { step: 'await_user' });
  return bot.sendMessage(msg.chat.id, '💰 Masukkan *ID Telegram user* yang ingin ditambah saldo:', { parse_mode: 'Markdown' });
}

// ====== Handler interaktif ======
async function handleMessage(bot, msg) {
  const adminId = msg.from.id;
  const s = session.get(adminId);
  if (!s) return false; // tidak sedang dalam sesi addsaldo

  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();

  // Step 1: tunggu ID user
  if (s.step === 'await_user') {
    const user = getUserByTgId(text);
    if (!user) {
      session.delete(adminId);
      return bot.sendMessage(chatId, `⚠️ User dengan ID *${text}* tidak ditemukan.`, { parse_mode: 'Markdown' });
    }

    session.set(adminId, { step: 'await_amount', targetId: text });
    return bot.sendMessage(chatId, `✅ User ditemukan: *${user.name || '-'}*\n💸 Masukkan jumlah saldo yang ingin ditambahkan:`, { parse_mode: 'Markdown' });
  }

  // Step 2: tunggu jumlah saldo
  if (s.step === 'await_amount') {
    const amount = parseInt(text);
    if (isNaN(amount) || amount <= 0) {
      return bot.sendMessage(chatId, '⚠️ Masukkan angka saldo yang valid.');
    }

    try {
      addSaldo(s.targetId, amount);
      addMetaLog('addsaldo', `Admin ${msg.from.username || msg.from.id} menambah saldo +${amount} ke user ${s.targetId}`);

      session.delete(adminId);
      await bot.sendMessage(chatId, `✅ Saldo sebesar *${amount}* berhasil ditambahkan ke user *${s.targetId}*`, { parse_mode: 'Markdown' });

      // kirim notifikasi ke user
      try {
        await bot.sendMessage(s.targetId, `💰 Saldo kamu bertambah *${amount}* oleh admin.`);
      } catch (e) {
        console.warn('Tidak bisa kirim pesan ke user:', e.message);
      }
    } catch (err) {
      session.delete(adminId);
      await bot.sendMessage(chatId, `❌ Gagal menambah saldo: ${err.message}`);
    }
  }

  return true;
}

// ===== EXPORT =====
module.exports = {
  name: 'addsaldo',
  description: 'Tambah saldo user secara manual oleh admin.',
  execute,
  handleMessage,
};