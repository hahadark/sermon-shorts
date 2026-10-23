(function() {
  'use strict';
  const SS = (window.SS = window.SS || {});

  // Call this whenever time changes or state changes
  SS.updateTemplatePreview = function() {
    if (!SS.state || !SS.state.settings || !SS.drawTemplate) return;
    
    const canvas = document.getElementById('tplCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    let subtitleText = '';
    // Find active subtitle text for current time
    if (SS.preview && SS.state.words) {
      const curT = SS.preview.currentTime;
      // We need lines built by EDL
      if (!SS._cachedLines || SS._linesDirty) {
        const segs = SS.edl.buildSegments(SS.state.words, SS.state.settings, SS.state.overrides, SS.state.source.duration);
        SS._cachedLines = SS.edl.buildLines(SS.state.words, segs, SS.state.settings);
        SS._linesDirty = false;
      }
      const line = SS._cachedLines.find(l => curT >= l.outStart && curT <= l.outEnd);
      if (line) subtitleText = line.text;
    }
    
    const params = {
      title: SS.state.meta ? SS.state.meta.title : '',
      verse: SS.state.meta ? SS.state.meta.verse : '',
      speaker: SS.state.meta ? SS.state.meta.speaker : '',
      subtitleText: subtitleText,
      settings: SS.state.settings.template || {}
    };
    
    SS.drawTemplate(ctx, ['all'], params);
  };
})();