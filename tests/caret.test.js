const assert = require('assert');
const test = require('node:test');
const Caret = require('../src/shared/caret.js');

test('Caret logic', async (t) => {
    const words = [
        { id: 0, text: 'A', del: false },
        { id: 1, text: 'B', del: false },
        { id: 2, text: 'C', del: true },
        { id: 3, text: 'D', del: false },
        { id: 4, text: 'E.', del: false },
        { id: 5, text: 'F', del: false }
    ];

    await t.test('backspaceAt', () => {
        let res = Caret.backspaceAt(words, 3);
        assert.deepStrictEqual(res.deleteIds, [1]); // skips C (id=2) which is already deleted
        assert.strictEqual(res.newCaret, 1);
    });

    await t.test('deleteAt', () => {
        let res = Caret.deleteAt(words, 1);
        assert.deepStrictEqual(res.deleteIds, [1]);
        assert.strictEqual(res.newCaret, 1);
    });

    await t.test('deleteToSentence', () => {
        let res = Caret.deleteToSentence(words, 5, -1);
        assert.deepStrictEqual(res.deleteIds, [4]);
        assert.strictEqual(res.newCaret, 4);
    });

    await t.test('runsOf', () => {
        const words2 = [
            { del: true }, { del: true }, { del: false }, { del: true }
        ];
        const runs = Caret.runsOf(words2);
        assert.deepStrictEqual(runs, [[0, 2], [3, 4]]);
    });

    await t.test('caretFromClick', () => {
        assert.strictEqual(Caret.caretFromClick(5, 'left'), 5);
        assert.strictEqual(Caret.caretFromClick(5, 'right'), 6);
    });
});

test('Caret boundaries and no-op restore', () => {
    const ws = [{id:0,text:'A',del:false},{id:1,text:'B',del:true},{id:2,text:'C',del:true},{id:3,text:'D',del:false}];
    assert.deepStrictEqual(Caret.backspaceAt(ws,0),{deleteIds:[],newCaret:0});
    assert.deepStrictEqual(Caret.deleteAt(ws,4),{deleteIds:[],newCaret:4});
    assert.deepStrictEqual(Caret.restoreAt(ws,2,null).sort(),[1,2]);
    assert.deepStrictEqual(Caret.restoreAt(ws,0,null),[]);
    assert.deepStrictEqual(Caret.restoreAt(ws,4,[3,1]),[1,2]);
    assert.deepStrictEqual(Caret.restoreAt(ws,0,[0,1]),[]);
    assert.deepStrictEqual(Caret.runsOf([]),[]);
});

test('Caret forward sentence delete skips deleted words and includes boundary', () => {
    const ws = [{id:0,text:'A',del:false},{id:1,text:'B',del:true},{id:2,text:'C!',del:false},{id:3,text:'D',del:false}];
    assert.deepStrictEqual(Caret.deleteToSentence(ws,0,1),{deleteIds:[0,2],newCaret:0});
    assert.deepStrictEqual(Caret.deleteToSentence(ws,4,1),{deleteIds:[],newCaret:4});
});
