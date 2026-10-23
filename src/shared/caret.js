(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.Caret = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {

    function getNextAlive(words, startIdx, dir) {
        let i = startIdx;
        while (i >= 0 && i < words.length) {
            if (!words[i].del) return i;
            i += dir;
        }
        return -1;
    }

    function backspaceAt(words, caret) {
        if (caret === 0) return { deleteIds: [], newCaret: caret };
        const targetIdx = getNextAlive(words, caret - 1, -1);
        if (targetIdx === -1) return { deleteIds: [], newCaret: caret };
        return {
            deleteIds: [words[targetIdx].id],
            newCaret: targetIdx
        };
    }

    function deleteAt(words, caret) {
        if (caret === words.length) return { deleteIds: [], newCaret: caret };
        const targetIdx = getNextAlive(words, caret, 1);
        if (targetIdx === -1) return { deleteIds: [], newCaret: caret };
        return {
            deleteIds: [words[targetIdx].id],
            newCaret: caret
        };
    }

    function deleteToSentence(words, caret, dir) {
        const deleteIds = [];
        let newCaret = caret;
        if (dir === -1) {
            let i = caret - 1;
            while (i >= 0) {
                const w = words[i];
                if (!w.del) {
                    deleteIds.push(w.id);
                }
                newCaret = i;
                if (w.br || /[.?!]/.test(w.text)) {
                    break;
                }
                i--;
            }
        } else {
            let i = caret;
            while (i < words.length) {
                const w = words[i];
                if (!w.del) {
                    deleteIds.push(w.id);
                }
                if (w.br || /[.?!]/.test(w.text)) {
                    break;
                }
                i++;
            }
        }
        return { deleteIds, newCaret };
    }

    function restoreAt(words, caret, selection) {
        if (selection && selection[0] !== selection[1]) {
            let a = Math.min(selection[0], selection[1]);
            let b = Math.max(selection[0], selection[1]);
            const ids = [];
            for (let i = a; i < b; i++) {
                if (words[i].del) ids.push(words[i].id);
            }
            return ids;
        }
        
        let ids = [];
        let left = caret - 1;
        while (left >= 0 && words[left].del) {
            ids.push(words[left].id);
            left--;
        }
        let right = caret;
        while (right < words.length && words[right].del) {
            ids.push(words[right].id);
            right++;
        }
        return ids;
    }

    function runsOf(words) {
        const runs = [];
        let inRun = false;
        let start = -1;
        for (let i = 0; i <= words.length; i++) {
            const isDel = i < words.length && words[i].del;
            if (isDel && !inRun) {
                inRun = true;
                start = i;
            } else if (!isDel && inRun) {
                inRun = false;
                runs.push([start, i]);
            }
        }
        return runs;
    }

    function caretFromClick(index, side) {
        return side === 'left' ? index : index + 1;
    }

    return {
        backspaceAt,
        deleteAt,
        deleteToSentence,
        restoreAt,
        runsOf,
        caretFromClick
    };
}));
