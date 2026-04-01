// JSON export / import
window.TopLand = window.TopLand || {};

TopLand.IO = (function() {
  function collectState() {
    var s = window.appState;
    return {
      version: 2,
      glider: {
        trimSpeed: s.glider.trimSpeed,
        brakeSpeed: s.glider.brakeSpeed,
        transitionTime: s.glider.transitionTime
      },
      wind: {
        direction: s.wind.direction,
        speed: s.wind.speed
      },
      start: {
        lat: s.start.lat,
        lng: s.start.lng,
        heading: s.start.heading
      },
      plan: {
        distance: s.plan.distance,
        turns: s.plan.turns.map(function(t) {
          return { direction: t.direction, rate: t.rate, angle: t.angle };
        }),
        brakeTurn: {
          rate: s.plan.brakeTurn.rate,
          time: s.plan.brakeTurn.time,
          direction: s.plan.brakeTurn.direction
        }
      },
      display: {
        dotInterval: s.display.dotInterval
      }
    };
  }

  function exportJSON() {
    var data = collectState();
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'topland-plan.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  // Apply parsed JSON data to appState (shared by importJSON and decodeFromURL)
  function applyState(data) {
    if (data.version !== 1 && data.version !== 2) {
      throw new Error('Invalid version');
    }

    var s = window.appState;
    if (data.glider) {
      s.glider.trimSpeed = data.glider.trimSpeed;
      s.glider.brakeSpeed = data.glider.brakeSpeed;
      s.glider.transitionTime = data.glider.transitionTime;
    }
    if (data.wind) {
      s.wind.direction = data.wind.direction;
      s.wind.speed = data.wind.speed;
    }
    if (data.start) {
      s.start.lat = data.start.lat;
      s.start.lng = data.start.lng;
      s.start.heading = data.start.heading;
    }
    if (data.display) {
      s.display.dotInterval = data.display.dotInterval;
    }

    // Version 2: load plan
    if (data.version === 2 && data.plan) {
      s.plan.distance = data.plan.distance;
      if (data.plan.turns) {
        s.plan.turns = data.plan.turns;
      } else if (data.plan.turn) {
        s.plan.turns = [data.plan.turn];
      }
      if (data.plan.brakeTurn) {
        s.plan.brakeTurn.rate = data.plan.brakeTurn.rate;
        s.plan.brakeTurn.time = data.plan.brakeTurn.time || (s.glider.transitionTime + 2);
        s.plan.brakeTurn.direction = data.plan.brakeTurn.direction || 'R';
        s.plan.brakeTurn.enabled = true;
      }
    }

    // Version 1: convert events array to plan
    if (data.version === 1 && data.events) {
      s.plan.turns = [];
      for (var i = 0; i < data.events.length; i++) {
        var ev = data.events[i];
        if (ev.type === 'straight') {
          s.plan.distance = ev.distance;
        } else if (ev.type === 'turn') {
          s.plan.turns.push({
            direction: ev.direction,
            rate: ev.rate,
            angle: ev.angle
          });
          s.plan.brakeTurn.rate = ev.rate;
        }
      }
      if (s.plan.turns.length === 0) {
        s.plan.turns = [{ direction: 'R', rate: 15, angle: 90 }];
      }
      s.plan.brakeTurn.enabled = true;
    }
  }

  function importJSON(file, callback) {
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var data = JSON.parse(e.target.result);
        applyState(data);
        callback();
      } catch(err) {
        alert('JSONの形式が正しくありません');
      }
    };
    reader.readAsText(file);
  }

  function encodeToURL() {
    var data = collectState();
    var json = JSON.stringify(data);
    var encoded = btoa(unescape(encodeURIComponent(json)));
    location.hash = encoded;
    navigator.clipboard.writeText(location.href).then(function() {
      alert('URLをクリップボードにコピーしました');
    }, function() {
      alert('URLが更新されました（クリップボードへのコピーに失敗）');
    });
  }

  // Returns true if state was restored from URL hash
  function decodeFromURL() {
    var hash = location.hash.slice(1);
    if (!hash) return false;
    try {
      var json = decodeURIComponent(escape(atob(hash)));
      var data = JSON.parse(json);
      applyState(data);
      return true;
    } catch(err) {
      return false;
    }
  }

  return {
    exportJSON: exportJSON,
    importJSON: importJSON,
    encodeToURL: encodeToURL,
    decodeFromURL: decodeFromURL
  };
})();
