'use strict';
const youtube = require('../src/main/youtube');
const ai = require('../src/main/ai');
const fs = require('fs');
const path = require('path');

// Mock Electron app for tools.js if needed (tools.js uses app.getAppPath)
// But since I'm running in Node, I might need to mock it.
// Let's check tools.js first.
async function run() {
  const url = 'https://www.youtube.com/watch?v=9Tmjg3ESEyc';
  console.log('--- Step 1: YouTube Info & Subs ---');
  const info = await youtube.fetchInfo(url);
  const subs = await youtube.fetchAutoSubs(url);
  console.log('Title:', info.title);
  console.log('Subs count:', subs.lines.length);

  console.log('\n--- Step 2: analyzeSermon ---');
  const analysis = await ai.analyzeSermon(subs.lines, {
    videoTitle: info.title,
    description: info.description,
    count: 3
  });
  console.log('Sermon:', JSON.stringify(analysis.sermon, null, 2));
  console.log('Candidates:', analysis.candidates.length);
  analysis.candidates.forEach((c, i) => {
    console.log(`[${i+1}] ${c.shortsTitle} (${c.score}) ${c.start}-${c.end}`);
  });
  console.log('Usage:', analysis.usage);

  console.log('\n--- Step 3: correctTerms ---');
  const testSermon = JSON.parse(fs.readFileSync('cache/test_sermon_261016.json', 'utf8'));
  const words = testSermon.words.filter(w => w.start >= 1400 && w.start <= 1460);
  console.log('Original words sample:', words.slice(0, 5).map(w => w.text).join(', '));
  
  const corrected = await ai.correctTerms(words.map(w => ({ id: w.id, text: w.text })), {
    title: analysis.sermon.title,
    scripture: analysis.sermon.scripture
  });
  
  const changes = [];
  corrected.forEach(c => {
    const orig = words.find(w => w.id === c.id);
    if (orig && orig.text !== c.text) {
      changes.push(`${orig.text} -> ${c.text}`);
    }
  });
  console.log('Changed words:', changes);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
