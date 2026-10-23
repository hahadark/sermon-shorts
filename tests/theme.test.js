const test = require('node:test');
const assert = require('node:assert');
const theme = require('../src/shared/theme');

test('normalizeTheme: returns defaults for null', () => {
  const t = theme.normalizeTheme(null);
  assert.strictEqual(t.canvas.background, '#000000');
  assert.strictEqual(t.title.show, true);
  assert.strictEqual(t.title.align, 'center');
});

test('normalizeTheme: merges provided values', () => {
  const t = theme.normalizeTheme({ id: 'test', canvas: { background: '#ff0000' } });
  assert.strictEqual(t.id, 'test');
  assert.strictEqual(t.canvas.background, '#ff0000');
  assert.strictEqual(t.title.show, true); // Still has default
});

test('themeFromLegacyTemplate: converts legacy fields', () => {
  const legacy = {
    titleY: 210,
    fontTitleVerse: 'Yeon Sung',
    colorTitleVerse: '#123456',
    churchName: 'Test Church'
  };
  const t = theme.themeFromLegacyTemplate(legacy);
  assert.strictEqual(t.id, 'daegu-sarang');
  assert.strictEqual(t.title.y, 210);
  assert.strictEqual(t.title.font, 'Yeon Sung');
  assert.strictEqual(t.title.color, '#123456');
  assert.strictEqual(t.churchName.text, 'Test Church');
});
