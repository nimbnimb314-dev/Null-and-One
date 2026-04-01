// Entry point: state initialization, UI wiring, localStorage
window.appState = {
  glider: { trimSpeed: 40, brakeSpeed: 25, transitionTime: 2 },
  wind: { direction: 0, speed: 0 },
  start: { lat: null, lng: null, heading: 0 },
  plan: {
    distance: 50,
    turns: [{ direction: 'R', rate: 15, angle: 90 }],
    brakeTurn: { rate: 15, time: 4, direction: 'R', enabled: false }
  },
  events: [],
  display: { dotInterval: 0.1 }
};

// Generate events array from plan
function generateEvents() {
  var plan = appState.plan;
  appState.events = [
    { type: 'straight', distance: plan.distance }
  ];
  for (var i = 0; i < plan.turns.length; i++) {
    var t = plan.turns[i];
    appState.events.push({
      type: 'turn', direction: t.direction, rate: t.rate, angle: t.angle
    });
  }
  if (plan.brakeTurn.enabled) {
    appState.events.push({
      type: 'brake_turn', direction: plan.brakeTurn.direction || 'R',
      rate: plan.brakeTurn.rate, time: plan.brakeTurn.time
    });
  }
}

document.addEventListener('DOMContentLoaded', function() {
  TopLand.Map.init();
  TopLand.Events.init();
  generateEvents();

  // Bind glider setting inputs
  var gliderIds = ['trimSpeed', 'brakeSpeed', 'transitionTime'];
  var gliderKeys = ['trimSpeed', 'brakeSpeed', 'transitionTime'];
  for (var i = 0; i < gliderIds.length; i++) {
    (function(id, key) {
      document.getElementById(id).addEventListener('change', function() {
        appState.glider[key] = parseFloat(this.value);
        autoSimulate();
      });
    })(gliderIds[i], gliderKeys[i]);
  }

  // Bind wind inputs
  var windDirInput = document.getElementById('windDirection');
  function onWindDirChange() {
    var val = parseFloat(windDirInput.value);
    if (isNaN(val)) return;
    appState.wind.direction = val;
    TopLand.Map.updateWindArrow();
    autoSimulate();
  }
  windDirInput.addEventListener('change', onWindDirChange);
  windDirInput.addEventListener('input', onWindDirChange);
  document.getElementById('windSpeed').addEventListener('change', function() {
    appState.wind.speed = parseFloat(this.value);
    autoSimulate();
  });

  // Bind display settings
  document.getElementById('dotInterval').addEventListener('change', function() {
    appState.display.dotInterval = parseFloat(this.value);
    autoSimulate();
  });

  // Simulate
  document.getElementById('btnSimulate').addEventListener('click', runSimulation);

  // Clear
  document.getElementById('btnClear').addEventListener('click', function() {
    TopLand.Map.clearAll();
    appState.start = { lat: null, lng: null, heading: 0 };
    appState.plan = {
      distance: 50,
      turns: [{ direction: 'R', rate: 15, angle: 90 }],
      brakeTurn: { rate: 15, time: 4, direction: 'R', enabled: false }
    };
    document.getElementById('startInfo').textContent = '地図をクリックして設定';
    document.getElementById('startHeading').value = 0;
    document.getElementById('resultSection').style.display = 'none';
    var sidebar = document.getElementById('sidebar');
    sidebar.classList.remove('has-straight', 'has-turns', 'has-brake');
    TopLand.Events.render();
  });

  // Ctrl+Z to undo last waypoint click
  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      TopLand.Map.undoWaypoint();
    }
  });

  // URL share
  document.getElementById('btnShareURL').addEventListener('click', function() {
    TopLand.IO.encodeToURL();
  });

  // Export
  document.getElementById('btnExport').addEventListener('click', function() {
    TopLand.IO.exportJSON();
  });

  // Import
  document.getElementById('btnImport').addEventListener('click', function() {
    document.getElementById('fileInput').click();
  });
  document.getElementById('fileInput').addEventListener('change', function(e) {
    if (e.target.files.length > 0) {
      TopLand.IO.importJSON(e.target.files[0], function() {
        restoreUI();
      });
      e.target.value = '';
    }
  });

  // Restore from URL hash if present
  if (TopLand.IO.decodeFromURL()) {
    restoreUI();
  }
});

function restoreUI() {
  updateUIFromState();
  TopLand.Events.render();
  generateEvents();

  if (appState.start.lat != null) {
    TopLand.Map.setStartPoint(appState.start.lat, appState.start.lng, appState.start.heading);
    TopLand.Map.panTo(appState.start.lat, appState.start.lng);
  }

  TopLand.Map.resetClickCount();
  var sidebar = document.getElementById('sidebar');
  sidebar.classList.add('has-straight');
  if (appState.plan.turns.length > 0) {
    sidebar.classList.add('has-turns');
  }
  if (appState.plan.brakeTurn.enabled || appState.plan.turns.length >= 2) {
    sidebar.classList.add('has-brake');
  }
  runSimulation();
}

function updateUIFromState() {
  document.getElementById('trimSpeed').value = appState.glider.trimSpeed;
  document.getElementById('brakeSpeed').value = appState.glider.brakeSpeed;
  document.getElementById('transitionTime').value = appState.glider.transitionTime;

  document.getElementById('windDirection').value = appState.wind.direction;
  document.getElementById('windSpeed').value = appState.wind.speed;
  document.getElementById('dotInterval').value = appState.display.dotInterval;
  if (appState.start.lat != null) {
    document.getElementById('startHeading').value = Math.round(appState.start.heading);
  }
}

function doSimulate() {
  var result = TopLand.simulate(appState);

  TopLand.Map.drawTrajectory(result, appState.display.dotInterval, result.eventBoundaries);

  if (result.points.length > 0) {
    var last = result.points[result.points.length - 1];
    TopLand.Map.updateEndpointMarker(last.lat, last.lng, result.summary.finalHeading, last.speed);
  }

  var sec = document.getElementById('resultSection');
  sec.style.display = '';
  var sum = result.summary;
  var html = '総所要時間: ' + sum.totalTime + ' 秒<br>';
  html += '最小対地速度: ' + (sum.minSpeed * 3.6).toFixed(1) + ' km/h<br>';
  html += '最大対地速度: ' + (sum.maxSpeed * 3.6).toFixed(1) + ' km/h';
  if (sum.truncated) {
    html += '<br><span class="warning">※最大時間に達したため打ち切り</span>';
  }
  document.getElementById('resultSummary').innerHTML = html;
}

// Manual simulate (with alerts)
function runSimulation() {
  if (appState.start.lat == null) {
    alert('開始点を地図上でクリックして設定してください');
    return;
  }
  generateEvents();
  doSimulate();
}

// Auto simulate (silent, called on any parameter change)
function autoSimulate() {
  if (appState.start.lat == null) return;
  if (!TopLand.Map.hasWaypoints()) return;
  generateEvents();
  doSimulate();
}
