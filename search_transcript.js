const fs = require('fs');

const logPath = 'C:\\Users\\Gaurav Yadav\\.gemini\\antigravity\\brain\\47f33b09-1e28-45a9-8524-f795f381e74c\\.system_generated\\logs\\transcript.jsonl';
const content = fs.readFileSync(logPath, 'utf8');
const lines = content.split('\n');

lines.forEach((line, index) => {
  if (!line.trim()) return;
  try {
    const obj = JSON.parse(line);
    // Print all steps that contain commands or user requests or database queries or setup
    const text = JSON.stringify(obj);
    if (obj.source === 'USER_EXPLICIT' || (obj.type === 'RUN_COMMAND' && obj.content && (obj.content.includes('mysql') || obj.content.includes('db') || obj.content.includes('error')))) {
      console.log(`Step ${obj.step_index}: Source=${obj.source}, Type=${obj.type}`);
      if (obj.content) {
        console.log('--- Content ---');
        console.log(obj.content.substring(0, 500));
      }
      console.log('====================================');
    }
  } catch (e) {
    // ignore
  }
});
