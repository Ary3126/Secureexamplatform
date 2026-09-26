const b = require('bcryptjs');
const hash = '$2b$10$ijtM2yzyoTI0BYON0MjWbONxMQAJeaelegLsfC6IouXP2kDFNp0a6';
const candidates = ['Admin@1234', 'password', 'Password@1234', '123456', 'admin', 'test', 'secret', 'Password1', 'pass@123', 'Secure@123'];
Promise.all(candidates.map(p => b.compare(p, hash).then(r => ({ p, r })))).then(results => {
  results.forEach(({ p, r }) => console.log(`${p}: ${r}`));
});
