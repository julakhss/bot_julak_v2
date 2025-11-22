// commands/addssh.js
const { createAddSshPlugin } = require('../lib/addBaseSSH');

module.exports = createAddSshPlugin({
  name: 'addssh',
  aliases: ['add-ssh'],
  title: 'Tambah Akun SSH',
  commandTpl: '/usr/local/sbin/bot-addssh {USER} {PASS} {EXP}',
  expMode: 'days'
});
