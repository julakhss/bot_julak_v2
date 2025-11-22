// commands/ceksaldo.js
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// ===== Database Setup =====
const DB_PATH = path.resolve(process.cwd(), 'julak', 'wallet.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const idr = n => Number(n || 0).toLocaleString('id-ID');

// ====== Helper ======
function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString('id-ID', { hour12: false });
  } catch {
    return iso?.slice(0, 19)?.replace('T', ' ') || '-';
  }
}

function fullName(u) {
  return [u?.first_name, u?.last_name].filter(Boolean).join(' ') || u?.username || 'User';
}

// ====== Main Command ======
module.exports = {
  name: 'ceksaldo',
  aliases: ['saldo'],
  description: 'Cek saldo dan 5 transaksi terakhir pengguna',

  async execute(bot, msg) {
    try {
      const tgId = String(msg.from.id);
      const user = db.prepare(`SELECT tg_id, name, balance FROM users WHERE tg_id=?`).get(tgId);

      // === Auto-register user jika belum ada ===
      if (!user) {
        const name = fullName(msg.from);
        db.prepare(`INSERT OR IGNORE INTO users (tg_id, name, balance, created_at) VALUES (?, ?, 0, datetime('now'))`).run(tgId, name);
        return bot.sendMessage(msg.chat.id, ' Akun baru telah dibuat. Jalankan /ceksaldo lagi untuk melihat saldo Anda.');
      }

      // === Ambil histori transaksi QRIS ===
      const rows = db.prepare(`
        SELECT id, expected_amount, status, created_at
        FROM qris_payments
        WHERE tg_id=?
        ORDER BY id DESC
        LIMIT 5
      `).all(tgId);

      const hist = rows.length
        ? rows.map(r =>
            `#${r.id} • ${r.status.toUpperCase()} • Rp${idr(r.expected_amount)} • ${formatDate(r.created_at)}`
          ).join('\n')
        : 'Tidak ada riwayat transaksi.';

      // === Format pesan utama ===
      const text = [
        ` *CEK SALDO AKUN ANDA*`,
        ``,
        ` *Nama:* ${user.name}`,
        ` *Akun:* ${user.tg_id}`,
        ` *Saldo:* Rp${idr(user.balance)}`,
        ``,
        ` *5 Transaksi Terakhir:*`,
        hist
      ].join('\n');

      await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });

    } catch (err) {
      console.error('[ceksaldo error]', err);
      await bot.sendMessage(msg.chat.id, ' Terjadi kesalahan saat memproses data saldo.');
    }
  }
};