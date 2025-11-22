// commands/datauser.js
// ==================================================
// Admin Data User — versi kompatibel node-telegram-bot-api
// ==================================================

const path = require('path');
const Database = require('better-sqlite3');
const db = new Database(path.resolve(process.cwd(), 'julak', 'wallet.db'));

const adminSession = new Map(); // sesi interaktif admin

// === CONFIG OWNER ===
function isOwner(msg) {
  const ownerEnv = process.env.OWNER_ID;
  if (!ownerEnv) return true;
  return msg?.from?.id === parseInt(ownerEnv, 10);
}

// === DB Helper ===
function getAllUsers(limit = 20) {
  return db.prepare('SELECT tg_id, name, balance, created_at FROM users ORDER BY created_at DESC LIMIT ?').all(limit);
}

function getUser(tg_id) {
  return db.prepare('SELECT * FROM users WHERE tg_id = ?').get(tg_id);
}

function deleteUser(tg_id) {
  return db.prepare('DELETE FROM users WHERE tg_id = ?').run(tg_id);
}

function resetSaldo(tg_id) {
  return db.prepare('UPDATE users SET balance = 0 WHERE tg_id = ?').run(tg_id);
}

// === UTAMA: handleMessage ===
async function handleMessage(bot, msg) {
  const text = msg.text ? msg.text.trim() : '';
  const userId = msg.from.id;

  if (!isOwner(msg)) return false;
  if (text !== '/datauser') return false;

  const users = getAllUsers(20);
  if (users.length === 0) {
    await bot.sendMessage(userId, '📭 Belum ada user di database.');
    return true;
  }

  const inline_keyboard = users.map((u) => [
    {
      text: `${u.name || u.tg_id} (Rp${u.balance})`,
      callback_data: `datauser_view_${u.tg_id}`,
    },
  ]);

  await bot.sendMessage(userId, `👥 *Daftar User (${users.length})*`, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard },
  });

  return true;
}

// === HANDLE CALLBACK ===
async function handleCallback(bot, query) {
  const data = query.data;
  const fromId = query.from.id;
  if (!isOwner(query)) return false;

  // Detail user
  if (data.startsWith('datauser_view_')) {
    const tg_id = data.replace('datauser_view_', '');
    const u = getUser(tg_id);
    if (!u) {
      await bot.answerCallbackQuery(query.id, { text: 'User tidak ditemukan', show_alert: true });
      return true;
    }

    const inline_keyboard = [
      [
        { text: '🧾 Reset Saldo', callback_data: `datauser_reset_${tg_id}` },
        { text: '🗑️ Hapus User', callback_data: `datauser_delete_${tg_id}` },
      ],
      [{ text: '⬅️ Kembali', callback_data: 'datauser_back' }],
    ];

    const info = `👤 *Detail User*\n\n🆔 ID: \`${u.tg_id}\`\n📛 Nama: ${u.name || '-'}\n💰 Saldo: Rp${u.balance}\n🕒 Dibuat: ${u.created_at}`;
    await bot.editMessageText(info, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard },
    });
    return true;
  }

  // Reset saldo
  if (data.startsWith('datauser_reset_')) {
    const tg_id = data.replace('datauser_reset_', '');
    resetSaldo(tg_id);
    await bot.answerCallbackQuery(query.id, { text: 'Saldo direset ✅' });
    await bot.sendMessage(fromId, `💰 Saldo user \`${tg_id}\` telah direset ke 0.`, { parse_mode: 'Markdown' });
    return true;
  }

  // Hapus user
  if (data.startsWith('datauser_delete_')) {
    const tg_id = data.replace('datauser_delete_', '');
    adminSession.set(fromId, { step: 'confirm_delete', targetId: tg_id });
    await bot.sendMessage(fromId, `⚠️ Ketik *ya* untuk konfirmasi hapus user \`${tg_id}\`.`, { parse_mode: 'Markdown' });
    return true;
  }

  // Kembali ke daftar
  if (data === 'datauser_back') {
    const users = getAllUsers(20);
    const inline_keyboard = users.map((u) => [
      {
        text: `${u.name || u.tg_id} (Rp${u.balance})`,
        callback_data: `datauser_view_${u.tg_id}`,
      },
    ]);

    await bot.editMessageText(`👥 *Daftar User (${users.length})*`, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard },
    });
    return true;
  }

  return false;
}

// === LANJUTAN (Konfirmasi Hapus) ===
async function continueHandler(bot, msg) {
  const userId = msg.from.id;
  const text = msg.text ? msg.text.trim().toLowerCase() : '';
  const session = adminSession.get(userId);
  if (!session) return false;

  if (session.step === 'confirm_delete') {
    if (text === 'ya') {
      deleteUser(session.targetId);
      await bot.sendMessage(userId, `🗑️ User \`${session.targetId}\` berhasil dihapus.`, { parse_mode: 'Markdown' });
    } else {
      await bot.sendMessage(userId, '❎ Dibatalkan.');
    }
    adminSession.delete(userId);
    return true;
  }

  return false;
}

// === EXPORT STANDAR ===
module.exports = {
  name: 'datauser',
  description: 'Menampilkan daftar user dan aksi admin',
  execute: handleMessage,
  onCallback: handleCallback,
  onContinue: continueHandler,
};