const { query } = require('./src/config/db');
const ProblemModel = require('./src/models/problemModel');

async function testCreate() {
  try {
    const user = (await query("SELECT id FROM users LIMIT 1")).rows[0];
    const prob = await ProblemModel.createProblem({
      title: 'Diagnostic Problem ' + Date.now(),
      description: 'Some description test',
      difficulty: 'easy',
      createdBy: user.id
    });
    console.log('Created prob successfully:', prob);
    process.exit(0);
  } catch (e) {
    console.error('Error in ProblemModel.createProblem:', e);
    process.exit(1);
  }
}
testCreate();