const http = require('http');
const { app } = require('./src/server');
const UserModel = require('./src/models/userModel');
const { generateToken, hashPassword } = require('./src/services/authService');
const { query } = require('./src/config/db');

async function test() {
  const server = app.listen(0, async () => {
    const port = server.address().port;
    try {
      const hash = await hashPassword('Password123!');
      await query("DELETE FROM users WHERE email = 'test_diag_prof@test.com'");
      const prof = await UserModel.createUser({
        username: 'prof_diag',
        email: 'test_diag_prof@test.com',
        passwordHash: hash,
        fullName: 'Diag Prof',
        role: 'professor'
      });
      const token = generateToken(prof);

      const postData = JSON.stringify({
        title: 'Add Two Numbers Test',
        description: 'Read two integers a and b from standard input and print their sum.',
        difficulty: 'easy'
      });

      const req = http.request({
        hostname: 'localhost',
        port,
        path: '/api/problems',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          console.log('Status:', res.statusCode);
          console.log('Body:', data);
          server.close();
          process.exit(0);
        });
      });

      req.on('error', (err) => {
        console.error('Req error:', err);
        server.close();
        process.exit(1);
      });

      req.write(postData);
      req.end();
    } catch (e) {
      console.error('Setup error:', e);
      server.close();
      process.exit(1);
    }
  });
}
test();