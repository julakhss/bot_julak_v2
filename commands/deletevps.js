// commands/deletevps.js
const fs = require('fs');
const path = require('path');
const { addMetaLog } = require('../lib/db');

// Path utama
const VPS_PATH = path.resolve(process.cwd(), 'julak', 'vps.json');
const BACKUP_DIR = path.resolve(process.cwd(), 'julak', 'backups');

// ===== Utilities =====
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function atomicWriteFileSync(filePath, data) {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp`);
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, filePath);
}

function readVpsFile() {
  if (!fs.existsSync(VPS_PATH)) return [];
  const raw = fs.readFileSync(VPS_PATH, 'utf8');
  return raw.trim() ? JSON.parse(raw) : [];
}

function backupVpsFile() {
  ensureDir(BACKUP_DIR);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `vps-${ts}.json`);
  fs.copyFileSync(VPS_PATH, backupPath);
  return backupPath;
}

function isOwner(msg) {
  const ownerEnv = process.env.OWNER_ID;
  if (!ownerEnv) return true;
  const owner = parseInt(ownerEnv, 10);
  return msg?.from?.id === owner;
}

// ====== SESSION STATE ======
const deleteSession = new Map(); // key: userId, value: { step, targetId }

// ===== Helper utama =====
async function handleDelete(bot, msg, targetId) {
  const chatId = msg.chat.id;
  let vpsList;

  try {
    vpsList = readVpsFile();
  } catch (e) {
    return bot.sendMessage(chatId, `❌ Gagal membaca vps.json: ${e.message}`);
  }

  const idx = vpsList.findIndex(v => v.id.toLowerCase() === targetId.toLowerCase());
  if (idx === -1) {
    deleteSession.delete(msg.from.id);
    return bot.sendMessage(chatId, `⚠️ VPS dengan ID "${targetId}" tidak ditemukan.`);
  }

  // Konfirmasi
  deleteSession.set(msg.from.id, { step: 'confirm', targetId });
  const vps = vpsList[idx];
  return bot.sendMessage(
    chatId,
    `⚠️ Yakin ingin menghapus VPS berikut?\n\n🖥️ ID: ${vps.id}\n🌐 Host: ${vps.host}\n💰 Harga/hari: ${vps.harga_per_hari || '-'}\n\nKetik *ya* untuk konfirmasi, atau *batal* untuk membatalkan.`,
    { parse_mode: 'Markdown' }
  );
}

// ===== Handler utama =====
async function execute(bot, msg, args = []) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (process.env.OWNER_ID && !isOwner(msg)) {
    return bot.sendMessage(chatId, '⛔ Perintah ini hanya untuk owner.');
  }

  if (args.length > 0) {
    return handleDelete(bot, msg, args[0]);
  }

  deleteSession.set(userId, { step: 'await_id' });
  return bot.sendMessage(chatId, '🗑️ Masukkan *ID VPS* yang ingin dihapus:', {
    parse_mode: 'Markdown',
  });
}

// ====== Listener interaktif ======
async function continueHandler(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const session = deleteSession.get(userId);
  if (!session) return;

  const text = (msg.text || '').trim().toLowerCase();

  // Step 1: input ID VPS
  if (session.step === 'await_id') {
    deleteSession.set(userId, { step: 'confirm', targetId: text });
    return handleDelete(bot, msg, text);
  }

  // Step 2: konfirmasi
  if (session.step === 'confirm') {
    if (text === 'ya') {
      try {
        const vpsList = readVpsFile();
        const idx = vpsList.findIndex(v => v.id.toLowerCase() === session.targetId.toLowerCase());
        if (idx === -1) {
          deleteSession.delete(userId);
          return bot.sendMessage(chatId, '⚠️ VPS sudah tidak ada di file.');
        }

        const removed = vpsList.splice(idx, 1)[0];
        const backup = backupVpsFile();
        atomicWriteFileSync(VPS_PATH, JSON.stringify(vpsList, null, 2));

        // ✅ Simpan ke meta_log
        addMetaLog(
          'delete_vps',
          `VPS ${removed.id} dihapus oleh ${msg.from.username || msg.from.first_name || msg.from.id}`,
          msg.from.id
        );
        
    // === KIRIM FILE BACKUP OTOMATIS KE ADMIN ===
    const ownerId = process.env.OWNER_ID ? parseInt(process.env.OWNER_ID) : userId;
    try {
      await bot.sendDocument(ownerId, backup, {
        caption: `🗑️ VPS *${removed.id}* telah dihapus.\n\n📦 Backup tersimpan di:\n\`${backup}\``,
        parse_mode: 'Markdown',
      });
    } catch (e) {
      console.error('Gagal kirim file backup:', e.message);
      await bot.sendMessage(chatId, `✅ VPS *${removed.id}* berhasil dihapus.\n(⚠️ Backup gagal dikirim ke admin, tapi tersimpan di server.)`, { parse_mode: 'Markdown' });
      deleteSession.delete(userId);
      return;
    }

        deleteSession.delete(userId);
        return bot.sendMessage(
          chatId,
          `✅ VPS *${removed.id}* berhasil dihapus.\nBackup disimpan di: \`${backup}\``,
          { parse_mode: 'Markdown' }
        );
      } catch (err) {
        deleteSession.delete(userId);
        return bot.sendMessage(chatId, `❌ Gagal menghapus VPS: ${err.message}`);
      }
    } else {
      deleteSession.delete(userId);
      return bot.sendMessage(chatId, '❌ Dibatalkan.');
    }
  }
}

// ===== Export =====
module.exports = {
  name: 'deletevps',
  description: 'Hapus VPS dari daftar (julak/vps.json).',
  execute,
  continue: continueHandler,
};