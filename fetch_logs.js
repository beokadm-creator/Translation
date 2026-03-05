const cp = require('child_process');
const log = cp.execSync('npx firebase functions:log --lines 400', { encoding: 'utf8' });
const lines = log.split('\n');
const recent = lines.filter(l => l.includes('Gemini') || l.includes('Error') || l.includes('onRefine') || l.includes('FATAL') || l.includes('Warn'));
console.log(recent.join('\n'));
