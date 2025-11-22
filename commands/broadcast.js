// commands/broadcast.js
const path = require('path');
const Database = require('better-sqlite3');
const { addMetaLog } = require('../lib/db');

const db = new Database(path.resolve(process.cwd(), 'julak', 'wallet.db'));
const session = new Map(); // simpan state input admin

function isOwner(msg) {
  const ownerEnv = process.env.OWNER_ID;
  if (!ownerEnv) return true;
  const owner = parseInt(ownerEnv, 10);
  return msg?.from?.id === owner;
}

async function execute(bot, msg) {
  const chatId = msg.chat.id;
  if (!isOwner(msg)) return bot.sendMessage(chatId, '⛔ Hanya owner yang bisa kirim broadcast.');

  session.set(msg.from.id, { step: 'await_message' });
  return bot.sendMessage(chatId, '📝 Silakan kirim teks atau media yang ingin di-broadcast ke semua user.');
}

async function handleMessage(bot, msg) {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const state = session.get(userId);
  if (!state) return false; // tidak sedang dalam sesi broadcast

  if (state.step === 'await_message') {
    session.delete(userId);
    await bot.sendMessage(chatId, '📣 Mengirim broadcast...');

    const users = db.prepare('SELECT tg_id FROM users').all();
    const total = users.length;
    let sent = 0;

    // Siapkan konten
    const text = msg.caption || msg.text || '';
    const media = msg.photo?.pop() || msg.video || msg.document;

    for (const u of users) {
      try {
        if (media) {
          if (msg.photo) await bot.sendPhoto(u.tg_id, media.file_id, { caption: text });
          else if (msg.video) await bot.sendVideo(u.tg_id, media.file_id, { caption: text });
          else if (msg.document) await bot.sendDocument(u.tg_id, media.file_id, { caption: text });
        } else {
          await bot.sendMessage(u.tg_id, text, { parse_mode: 'Markdown' });
        }
        sent++;
      } catch (e) {
        console.warn(`Gagal kirim ke ${u.tg_id}: ${e.message}`);
      }
    }

    addMetaLog('broadcast', `Broadcast dikirim ke ${sent}/${total} user`, msg.from.id);

    await bot.sendMessage(chatId, `✅ Broadcast selesai!\nTerkirim ke ${sent}/${total} user.`);
    return true;
  }

  return false;
}

module.exports = {
  name: 'broadcast',
  description: 'Kirim broadcast ke semua user (support teks, foto, video, dokumen)',
  execute,
  handleMessage,
};