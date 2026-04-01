// Leaflet map initialization, start point marker, trajectory drawing, legend
window.TopLand = window.TopLand || {};

TopLand.Map = (function() {
  var map;
  var startMarker = null;
  var headingArrow = null;
  var windArrow = null;
  var windHandle = null;
  var windLabel = null;
  var endpointMarker = null;
  var endpointArrow = null;
  var endpointLabel = null;
  var trajectoryLayers = [];
  var eventHandles = [];
  var hoverTooltip = null;
  var mapClickCount = 0; // 0: next=straight, >=1: next=turn, -1: done (brake set)
  var planUndoStack = []; // snapshots of { plan, heading, clickCount }

  function init() {
    var savedCenter = localStorage.getItem('topland_mapCenter');
    var savedZoom = localStorage.getItem('topland_mapZoom');
    var center = [36.5, 137.5];
    var zoom = 5;

    if (savedCenter && savedZoom) {
      try {
        center = JSON.parse(savedCenter);
        zoom = parseInt(savedZoom);
      } catch(e) { /* use defaults */ }
    }

    map = L.map('map').setView(center, zoom);

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri',
      maxZoom: 22,
      maxNativeZoom: 18
    }).addTo(map);

    map.on('moveend', function() {
      var c = map.getCenter();
      localStorage.setItem('topland_mapCenter', JSON.stringify([c.lat, c.lng]));
      localStorage.setItem('topland_mapZoom', map.getZoom());
    });

    map.on('click', function(e) {
      if (window.appState.start.lat == null) {
        setStartPoint(e.latlng.lat, e.latlng.lng, window.appState.start.heading);
      } else {
        addWaypoint(e.latlng.lat, e.latlng.lng);
      }
    });

    addLegend();
    return map;
  }

  function addLegend() {
    var legend = L.control({ position: 'bottomright' });
    legend.onAdd = function() {
      var div = L.DomUtil.create('div', 'legend');

      var title = document.createElement('div');
      title.className = 'legend-title';
      title.textContent = '対地速度 (km/h)';
      div.appendChild(title);

      var canvas = document.createElement('canvas');
      canvas.width = 120;
      canvas.height = 12;
      canvas.style.display = 'block';
      canvas.style.border = '1px solid #999';
      canvas.style.marginBottom = '2px';
      var ctx = canvas.getContext('2d');
      for (var i = 0; i < 120; i++) {
        var speed = (i / 120) * 8.33; // 0 to 30 km/h in m/s
        ctx.fillStyle = TopLand.speedToColor(speed);
        ctx.fillRect(i, 0, 1, 12);
      }
      div.appendChild(canvas);

      var labels = document.createElement('div');
      labels.className = 'labels';
      labels.innerHTML = '<span>0</span><span>8</span><span>12</span><span>20</span><span>30</span>';
      div.appendChild(labels);

      return div;
    };
    legend.addTo(map);
  }

  function setStartPoint(lat, lng, heading) {
    window.appState.start.lat = lat;
    window.appState.start.lng = lng;
    window.appState.start.heading = heading || 0;

    document.getElementById('startInfo').textContent =
      lat.toFixed(5) + ', ' + lng.toFixed(5);
    document.getElementById('startHeading').value =
      Math.round(window.appState.start.heading);

    if (startMarker) map.removeLayer(startMarker);
    if (headingArrow) map.removeLayer(headingArrow);

    var savedHandlePositions = [];
    startMarker = L.marker([lat, lng], { draggable: true }).addTo(map);

    startMarker.on('dragstart', function() {
      savedHandlePositions = eventHandles.map(function(h) {
        return h.getLatLng();
      });
    });

    startMarker.on('drag', function(e) {
      var pos = e.target.getLatLng();
      window.appState.start.lat = pos.lat;
      window.appState.start.lng = pos.lng;
      document.getElementById('startInfo').textContent =
        pos.lat.toFixed(5) + ', ' + pos.lng.toFixed(5);
      updateHeadingArrow();
      updateWindArrow();
    });

    startMarker.on('dragend', function() {
      if (savedHandlePositions.length > 0) {
        rebuildPlanFromPositions(savedHandlePositions);
        savedHandlePositions = [];
      } else {
        if (typeof autoSimulate === 'function') autoSimulate();
      }
    });

    updateHeadingArrow();
    updateWindArrow();
  }

  function updateHeadingArrow() {
    var lat = window.appState.start.lat;
    var lng = window.appState.start.lng;
    var heading = window.appState.start.heading;

    var arrowLen = 20;
    var mathAngle = (90 - heading) * Math.PI / 180;
    var dx = arrowLen * Math.cos(mathAngle);
    var dy = arrowLen * Math.sin(mathAngle);

    var latRad = lat * Math.PI / 180;
    var endLat = lat + dy / 111320;
    var endLng = lng + dx / (111320 * Math.cos(latRad));

    if (headingArrow) map.removeLayer(headingArrow);

    headingArrow = L.polyline(
      [[lat, lng], [endLat, endLng]],
      { color: 'rgb(24,95,165)', weight: 3 }
    ).addTo(map);
  }

  function updateWindArrow() {
    if (window.appState.start.lat == null) return;

    var lat = window.appState.start.lat;
    var lng = window.appState.start.lng;
    var windDir = window.appState.wind.direction;

    // Arrow points in the direction wind goes TO (180° from wind origin)
    var arrowLen = 30;
    var mathAngle = (90 - windDir - 180) * Math.PI / 180;
    var dx = arrowLen * Math.cos(mathAngle);
    var dy = arrowLen * Math.sin(mathAngle);

    var latRad = lat * Math.PI / 180;
    var cosLat = Math.cos(latRad);
    var endLat = lat + dy / 111320;
    var endLng = lng + dx / (111320 * cosLat);

    // Arrowhead wing points (two lines from tip going back ±25°)
    var wingLen = 10;
    var wingAngle = 25 * Math.PI / 180;
    var leftAngle = mathAngle + Math.PI - wingAngle;
    var rightAngle = mathAngle + Math.PI + wingAngle;
    var leftLat = endLat + wingLen * Math.sin(leftAngle) / 111320;
    var leftLng = endLng + wingLen * Math.cos(leftAngle) / (111320 * cosLat);
    var rightLat = endLat + wingLen * Math.sin(rightAngle) / 111320;
    var rightLng = endLng + wingLen * Math.cos(rightAngle) / (111320 * cosLat);

    if (windArrow) map.removeLayer(windArrow);
    if (windHandle) map.removeLayer(windHandle);
    if (windLabel) map.removeLayer(windLabel);

    windArrow = L.polyline(
      [[lat, lng], [endLat, endLng]],
      { color: 'rgb(220,120,20)', weight: 3, dashArray: '8, 6' }
    ).addTo(map);

    var midLat = (lat + endLat) / 2;
    var midLng = (lng + endLng) / 2;
    var labelIcon = L.divIcon({
      className: 'wind-label',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
      html: '<div style="color:rgb(220,120,20);font-weight:bold;font-size:12px;text-shadow:0 0 3px white,0 0 3px white">W</div>'
    });
    windLabel = L.marker([midLat, midLng], {
      icon: labelIcon,
      interactive: false
    }).addTo(map);

    // Arrowhead as drag handle
    var cssRotation = (windDir + 180) % 360;
    var handleIcon = L.divIcon({
      className: '',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      html: '<svg width="24" height="24" viewBox="0 0 24 24" style="transform:rotate(' + cssRotation + 'deg);cursor:grab;filter:drop-shadow(0 0 2px rgba(0,0,0,0.5))">' +
        '<polygon points="12,2 5,18 12,14 19,18" fill="rgb(220,120,20)" stroke="white" stroke-width="1.5" stroke-linejoin="round"/>' +
        '</svg>'
    });

    windHandle = L.marker([endLat, endLng], {
      icon: handleIcon,
      draggable: true
    }).addTo(map);

    windHandle.on('drag', function(e) {
      var handlePos = e.target.getLatLng();
      var startPos = startMarker.getLatLng();

      var dLat = handlePos.lat - startPos.lat;
      var dLng = handlePos.lng - startPos.lng;
      var dyM = dLat * 111320;
      var dxM = dLng * 111320 * Math.cos(startPos.lat * Math.PI / 180);

      // Arrow points where wind goes TO; wind.direction = where it comes FROM (+180°)
      var angle = Math.atan2(dyM, dxM);
      var newWindDir = 90 - angle * 180 / Math.PI + 180;
      newWindDir = ((newWindDir % 360) + 360) % 360;

      window.appState.wind.direction = newWindDir;
      document.getElementById('windDirection').value = Math.round(newWindDir);

      windArrow.setLatLngs([[startPos.lat, startPos.lng], [handlePos.lat, handlePos.lng]]);

      var mLat = (startPos.lat + handlePos.lat) / 2;
      var mLng = (startPos.lng + handlePos.lng) / 2;
      windLabel.setLatLng([mLat, mLng]);
    });

    windHandle.on('dragend', function() {
      updateWindArrow();
      if (typeof autoSimulate === 'function') autoSimulate();
    });
  }

  // Waypoint clicks: 0=straight, 1=regular turn, 2+=brake turn (auto)
  function addWaypoint(lat, lng) {
    if (mapClickCount === -1) return;

    var plan = window.appState.plan;

    // Save undo snapshot
    planUndoStack.push({
      plan: JSON.parse(JSON.stringify(plan)),
      heading: window.appState.start.heading,
      clickCount: mapClickCount
    });

    if (mapClickCount === 0) {
      // First click: set straight distance + heading
      var startLat = window.appState.start.lat;
      var startLng = window.appState.start.lng;
      var latRad = startLat * Math.PI / 180;
      var dxM = (lng - startLng) * 111320 * Math.cos(latRad);
      var dyM = (lat - startLat) * 111320;
      var distance = Math.sqrt(dxM * dxM + dyM * dyM);
      if (distance < 1) { planUndoStack.pop(); return; }

      var mathAngle = Math.atan2(dyM, dxM);
      var bearing = 90 - mathAngle * 180 / Math.PI;
      bearing = ((bearing % 360) + 360) % 360;

      var airspeed = window.appState.glider.trimSpeed / 3.6;
      var correctedHeading = bearingToHeading(bearing, airspeed,
        window.appState.wind.direction, window.appState.wind.speed);

      window.appState.start.heading = correctedHeading;
      document.getElementById('startHeading').value = Math.round(correctedHeading);
      updateHeadingArrow();
      updateWindArrow();

      plan.distance = Math.round(distance);
      plan.turns = [];
      plan.brakeTurn.enabled = false;
      mapClickCount = 1;
      updateSidebarClasses();

    } else {
      // Click after straight

      // If adding 2nd+ turn, promote old brake turn to regular turn first
      if (mapClickCount >= 2 && plan.brakeTurn.enabled) {
        var prevDir = plan.brakeTurn.direction || getLastTurnDirection();
        var prevAngle = Math.round(plan.brakeTurn.rate * plan.brakeTurn.time);
        plan.turns.push({ direction: prevDir, rate: plan.brakeTurn.rate, angle: Math.max(1, prevAngle) });
        plan.brakeTurn.enabled = false;
      }

      // Simulate to get reference point
      if (typeof generateEvents === 'function') generateEvents();
      var result = TopLand.simulate(window.appState);
      if (result.points.length < 2) { planUndoStack.pop(); return; }

      // Reference point = trajectory end (no brake event when not enabled)
      var refPt = result.points[result.points.length - 1];
      var refHeading = result.summary.finalHeading;
      var refSpeed = result.summary.finalAirspeed;

      var latRad = refPt.lat * Math.PI / 180;
      var dxM = (lng - refPt.lng) * 111320 * Math.cos(latRad);
      var dyM = (lat - refPt.lat) * 111320;
      var distance = Math.sqrt(dxM * dxM + dyM * dyM);
      if (distance < 1) { planUndoStack.pop(); return; }

      if (mapClickCount === 1) {
        // First turn: regular turn
        var best = findBestTurn(refHeading, refSpeed, 15, dxM, dyM);
        plan.turns.push({
          direction: best.direction, rate: best.rate, angle: best.angle
        });
      } else {
        // 2nd+ turn: brake turn (limited to 4 seconds by findBestBrakeTurn)
        var brakeResult = findBestBrakeTurn(refHeading, refSpeed, null, dxM, dyM);
        plan.brakeTurn.rate = brakeResult.rate;
        plan.brakeTurn.time = brakeResult.time;
        plan.brakeTurn.direction = brakeResult.direction;
        plan.brakeTurn.enabled = true;
      }
      mapClickCount++;
      updateSidebarClasses();
    }

    if (typeof generateEvents === 'function') generateEvents();
    TopLand.Events.render();
    if (typeof runSimulation === 'function') runSimulation();
  }

  function findBrakeBoundary(result) {
    for (var bi = 0; bi < result.eventBoundaries.length; bi++) {
      if (result.eventBoundaries[bi].type === 'brake_turn') {
        return result.eventBoundaries[bi];
      }
    }
    return null;
  }

  function getLastTurnDirection() {
    var turns = window.appState.plan.turns;
    for (var j = turns.length - 1; j >= 0; j--) {
      if (turns[j].angle > 0) return turns[j].direction;
    }
    return 'R';
  }

  // Rebuild plan from saved handle positions (used when start marker is dragged)
  // positions: [straightEnd, turn0End, turn1End, ..., brakeTurnEnd]
  function rebuildPlanFromPositions(positions) {
    var plan = window.appState.plan;

    if (positions.length >= 1) {
      // Position 0 = straight endpoint
      var startLat = window.appState.start.lat;
      var startLng = window.appState.start.lng;
      var pos = positions[0];
      var latRad = startLat * Math.PI / 180;
      var dxM = (pos.lng - startLng) * 111320 * Math.cos(latRad);
      var dyM = (pos.lat - startLat) * 111320;
      var distance = Math.sqrt(dxM * dxM + dyM * dyM);

      plan.distance = Math.max(1, Math.round(distance));

      var mathAngle = Math.atan2(dyM, dxM);
      var bearing = 90 - mathAngle * 180 / Math.PI;
      bearing = ((bearing % 360) + 360) % 360;

      var airspeed = window.appState.glider.trimSpeed / 3.6;
      var correctedHeading = bearingToHeading(bearing, airspeed,
        window.appState.wind.direction, window.appState.wind.speed);

      window.appState.start.heading = correctedHeading;
      document.getElementById('startHeading').value = Math.round(correctedHeading);
      updateHeadingArrow();
    }

    // Rebuild subsequent turns and brake turn from positions[1..]
    if (positions.length >= 2) {
      rebuildSubsequentFromPositions(0, positions.slice(1));
    }

    if (typeof generateEvents === 'function') generateEvents();
    TopLand.Events.render();
    updateWindArrow();
    if (typeof autoSimulate === 'function') autoSimulate();
  }

  // Rebuild turns[startTurnIdx..] and brake turn from saved positions
  function rebuildSubsequentFromPositions(startTurnIdx, positions) {
    var plan = window.appState.plan;

    for (var k = 0; k < positions.length; k++) {
      var turnIdx = startTurnIdx + k;

      if (turnIdx < plan.turns.length) {
        // Rebuild turn[turnIdx]
        if (typeof generateEvents === 'function') generateEvents();
        var result = TopLand.simulate(window.appState);

        // Boundary index = turnIdx + 1 (after straight)
        var boundIdx = turnIdx + 1;
        if (boundIdx >= result.eventBoundaries.length) break;
        var bound = result.eventBoundaries[boundIdx];

        var startPt = result.points[bound.startPointIdx];
        var lr = startPt.lat * Math.PI / 180;
        var ddx = (positions[k].lng - startPt.lng) * 111320 * Math.cos(lr);
        var ddy = (positions[k].lat - startPt.lat) * 111320;
        var b2 = findBestTurn(bound.headingAtStart, bound.speedAtStart,
          plan.turns[turnIdx].rate, ddx, ddy);
        plan.turns[turnIdx].direction = b2.direction;
        plan.turns[turnIdx].angle = b2.angle;
        plan.turns[turnIdx].rate = b2.rate;
      } else {
        // This is the brake turn position
        rebuildBrakeTurnFromPosition(positions[k]);
        break;
      }
    }
  }

  function undoWaypoint() {
    if (planUndoStack.length === 0) return;
    var snapshot = planUndoStack.pop();
    window.appState.plan = snapshot.plan;
    window.appState.start.heading = snapshot.heading;
    mapClickCount = snapshot.clickCount;
    updateSidebarClasses();

    document.getElementById('startHeading').value = Math.round(snapshot.heading);
    updateHeadingArrow();
    updateWindArrow();

    if (typeof generateEvents === 'function') generateEvents();
    TopLand.Events.render();

    if (window.appState.start.lat != null && mapClickCount > 0) {
      if (typeof autoSimulate === 'function') autoSimulate();
    } else {
      clearTrajectory();
      clearEndpointMarker();
      document.getElementById('resultSection').style.display = 'none';
    }
  }

  // Update sidebar CSS classes based on mapClickCount for progressive disclosure
  function updateSidebarClasses() {
    var sidebar = document.getElementById('sidebar');
    var active = mapClickCount >= 1 || mapClickCount === -1;
    var turns = mapClickCount >= 2 || mapClickCount === -1;
    var brake = mapClickCount >= 3 || mapClickCount === -1;
    sidebar.classList.toggle('has-straight', active);
    sidebar.classList.toggle('has-turns', turns);
    sidebar.classList.toggle('has-brake', brake);
  }

  function resetClickCount() {
    mapClickCount = -1;
    planUndoStack = [];
  }

  // Full reset: remove all map objects and internal state
  function clearAll() {
    clearTrajectory();
    clearEndpointMarker();
    if (startMarker) { map.removeLayer(startMarker); startMarker = null; }
    if (headingArrow) { map.removeLayer(headingArrow); headingArrow = null; }
    if (windArrow) { map.removeLayer(windArrow); windArrow = null; }
    if (windHandle) { map.removeLayer(windHandle); windHandle = null; }
    if (windLabel) { map.removeLayer(windLabel); windLabel = null; }
    mapClickCount = 0;
    planUndoStack = [];
  }

  function updateEndpointMarker(lat, lng, heading, speed) {
    clearEndpointMarker();

    endpointMarker = L.circleMarker([lat, lng], {
      radius: 6,
      color: '#22aa22',
      fillColor: '#22aa22',
      fillOpacity: 0.7,
      weight: 2
    }).addTo(map);

    if (heading != null) {
      var arrowLen = 15;
      var ma = (90 - heading) * Math.PI / 180;
      var dx = arrowLen * Math.cos(ma);
      var dy = arrowLen * Math.sin(ma);
      var latRad = lat * Math.PI / 180;
      var endLat = lat + dy / 111320;
      var endLng = lng + dx / (111320 * Math.cos(latRad));

      endpointArrow = L.polyline(
        [[lat, lng], [endLat, endLng]],
        { color: '#22aa22', weight: 3 }
      ).addTo(map);
    }

    if (speed != null) {
      var labelIcon = L.divIcon({
        className: 'endpoint-label',
        iconAnchor: [-8, 6],
        html: '<span>' + (speed * 3.6).toFixed(1) + ' km/h</span>'
      });
      endpointLabel = L.marker([lat, lng], {
        icon: labelIcon,
        interactive: false
      }).addTo(map);
    }
  }

  function clearEndpointMarker() {
    if (endpointMarker) { map.removeLayer(endpointMarker); endpointMarker = null; }
    if (endpointArrow) { map.removeLayer(endpointArrow); endpointArrow = null; }
    if (endpointLabel) { map.removeLayer(endpointLabel); endpointLabel = null; }
  }

  function drawTrajectory(result, dotInterval, eventBoundaries) {
    clearTrajectory();
    var points = result.points;
    if (points.length < 2) return;

    for (var i = 0; i < points.length - 1; i++) {
      var p1 = points[i];
      var p2 = points[i + 1];
      var avgSpeed = (p1.speed + p2.speed) / 2;
      var color = TopLand.speedToColor(avgSpeed);

      var line = L.polyline(
        [[p1.lat, p1.lng], [p2.lat, p2.lng]],
        { color: color, weight: 3 }
      ).addTo(map);
      trajectoryLayers.push(line);
    }

    var nextDotTime = dotInterval;
    for (var j = 0; j < points.length; j++) {
      var p = points[j];
      if (p.time >= nextDotTime) {
        var dot = L.circleMarker([p.lat, p.lng], {
          radius: 3,
          color: TopLand.speedToColor(p.speed),
          fillColor: TopLand.speedToColor(p.speed),
          fillOpacity: 1,
          weight: 0
        }).addTo(map);
        trajectoryLayers.push(dot);
        nextDotTime += dotInterval;
      }
    }

    // Invisible wide polyline for hover speed tooltip
    var hoverCoords = points.map(function(p) { return [p.lat, p.lng]; });
    var hoverLine = L.polyline(hoverCoords, {
      weight: 16, opacity: 0, interactive: true
    }).addTo(map);
    hoverLine._trajPoints = points;
    trajectoryLayers.push(hoverLine);

    hoverLine.on('mousemove', function(e) {
      var pts = this._trajPoints;
      var minDist = Infinity;
      var nearest = null;
      for (var k = 0; k < pts.length; k++) {
        var px = map.latLngToLayerPoint([pts[k].lat, pts[k].lng]);
        var dx = px.x - e.layerPoint.x;
        var dy = px.y - e.layerPoint.y;
        var d = dx * dx + dy * dy;
        if (d < minDist) { minDist = d; nearest = pts[k]; }
      }
      if (nearest) {
        if (!hoverTooltip) {
          hoverTooltip = L.tooltip({ className: 'speed-tooltip', offset: [0, -10] });
        }
        hoverTooltip
          .setLatLng([nearest.lat, nearest.lng])
          .setContent((nearest.speed * 3.6).toFixed(1) + ' km/h  ' + nearest.time.toFixed(1) + 's' +
            (nearest.brakePercent != null ? '  brake ' + nearest.brakePercent + '%' : ''));
        if (!map.hasLayer(hoverTooltip)) hoverTooltip.addTo(map);
      }
    });

    hoverLine.on('mouseout', function() {
      if (hoverTooltip && map.hasLayer(hoverTooltip)) {
        map.removeLayer(hoverTooltip);
      }
    });

    if (eventBoundaries) {
      addEventHandles(points, eventBoundaries);
    }
  }

  // Drag handles for straight, turn, and brake_turn events; updates plan on drag
  function addEventHandles(points, boundaries) {
    var turnIdx = 0;
    for (var i = 0; i < boundaries.length; i++) {
      var b = boundaries[i];
      if (b.type !== 'straight' && b.type !== 'turn' && b.type !== 'brake_turn') continue;
      // Only show brake_turn handle if explicitly positioned (shift+click)
      if (b.type === 'brake_turn' && !window.appState.plan.brakeTurn.enabled) continue;

      var startPt = points[b.startPointIdx];
      var endPt = points[b.endPointIdx];

      var handleIcon = L.divIcon({
        className: 'drag-handle',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
        html: ''
      });

      var handle = L.marker([endPt.lat, endPt.lng], {
        icon: handleIcon,
        draggable: true,
        zIndexOffset: 1000
      }).addTo(map);

      handle._eventType = b.type;
      handle._startLat = startPt.lat;
      handle._startLng = startPt.lng;
      handle._headingAtStart = b.headingAtStart;
      handle._speedAtStart = b.speedAtStart;
      if (b.type === 'turn') {
        handle._turnIndex = turnIdx;
        turnIdx++;
      }

      // Save subsequent handle positions on dragstart
      handle.on('dragstart', function(e) {
        var h = e.target;
        var myIdx = eventHandles.indexOf(h);
        h._savedSubsequentPositions = [];
        for (var k = myIdx + 1; k < eventHandles.length; k++) {
          h._savedSubsequentPositions.push(eventHandles[k].getLatLng());
        }
      });

      handle.on('dragend', function(e) {
        var h = e.target;
        var pos = h.getLatLng();
        var sLat = h._startLat;
        var sLng = h._startLng;
        var type = h._eventType;
        var plan = window.appState.plan;

        var latRad = sLat * Math.PI / 180;
        var cosLat = Math.cos(latRad);
        var dxM = (pos.lng - sLng) * 111320 * cosLat;
        var dyM = (pos.lat - sLat) * 111320;

        if (type === 'straight') {
          plan.distance = Math.max(1, Math.round(Math.sqrt(dxM * dxM + dyM * dyM)));

          var mathAngle = Math.atan2(dyM, dxM);
          var bearing = 90 - mathAngle * 180 / Math.PI;
          bearing = ((bearing % 360) + 360) % 360;

          var correctedHeading = bearingToHeading(bearing, h._speedAtStart,
            window.appState.wind.direction, window.appState.wind.speed);

          window.appState.start.heading = correctedHeading;
          document.getElementById('startHeading').value = Math.round(correctedHeading);
          updateHeadingArrow();
          updateWindArrow();

          // Chain-rebuild all subsequent turns + brake turn
          var savedPositions = h._savedSubsequentPositions || [];
          if (savedPositions.length > 0) {
            rebuildSubsequentFromPositions(0, savedPositions);
          }

        } else if (type === 'turn') {
          var ti = h._turnIndex;
          var best = findBestTurn(h._headingAtStart, h._speedAtStart,
            plan.turns[ti].rate, dxM, dyM);
          plan.turns[ti].direction = best.direction;
          plan.turns[ti].angle = best.angle;
          plan.turns[ti].rate = best.rate;

          // Chain-rebuild subsequent turns + brake turn
          var savedPositions = h._savedSubsequentPositions || [];
          if (savedPositions.length > 0) {
            rebuildSubsequentFromPositions(ti + 1, savedPositions);
          }

        } else if (type === 'brake_turn') {
          var brakeResult = findBestBrakeTurn(
            h._headingAtStart, h._speedAtStart,
            null, dxM, dyM);
          plan.brakeTurn.rate = brakeResult.rate;
          plan.brakeTurn.time = brakeResult.time;
          plan.brakeTurn.direction = brakeResult.direction;
        }

        if (typeof generateEvents === 'function') generateEvents();
        TopLand.Events.render();
        if (typeof autoSimulate === 'function') autoSimulate();
      });

      eventHandles.push(handle);
    }
  }

  // Rebuild brake turn rate from a saved brake endpoint position
  function rebuildBrakeTurnFromPosition(brakeTargetLatLng) {
    var plan = window.appState.plan;
    if (typeof generateEvents === 'function') generateEvents();
    var result = TopLand.simulate(window.appState);
    if (result.points.length < 2) return;

    var refPt, heading, speed;
    var brakeBound = findBrakeBoundary(result);
    if (brakeBound) {
      refPt = result.points[brakeBound.startPointIdx];
      heading = brakeBound.headingAtStart;
      speed = brakeBound.speedAtStart;
    } else {
      // Fallback: use trajectory endpoint
      refPt = result.points[result.points.length - 1];
      heading = result.summary.finalHeading;
      speed = result.summary.finalAirspeed;
    }

    var latRad = refPt.lat * Math.PI / 180;
    var dx = (brakeTargetLatLng.lng - refPt.lng) * 111320 * Math.cos(latRad);
    var dy = (brakeTargetLatLng.lat - refPt.lat) * 111320;
    var brakeResult = findBestBrakeTurn(
      heading, speed, null, dx, dy);
    plan.brakeTurn.rate = brakeResult.rate;
    plan.brakeTurn.time = brakeResult.time;
    plan.brakeTurn.direction = brakeResult.direction;
  }

  // Calculate heading needed to achieve desired ground track bearing,
  // compensating for crosswind (wind correction angle)
  function bearingToHeading(desiredBearing, airspeed, windDir, windSpeed) {
    if (windSpeed === 0) return desiredBearing;

    var alpha = (90 - desiredBearing) * Math.PI / 180;

    var windDirRad = windDir * Math.PI / 180;
    var windVx = -windSpeed * Math.sin(windDirRad);
    var windVy = -windSpeed * Math.cos(windDirRad);

    var crosswind = windVx * Math.sin(alpha) - windVy * Math.cos(alpha);

    var ratio = crosswind / airspeed;
    if (Math.abs(ratio) >= 1) {
      return desiredBearing;
    }

    var theta = alpha + Math.asin(ratio);
    var heading = 90 - theta * 180 / Math.PI;
    heading = ((heading % 360) + 360) % 360;
    return heading;
  }

  // Brute-force search: simulate R/L turns at various rates (1-30°/s)
  // and angles (1-360°) to find the combo whose endpoint is closest
  // to the target position (dxM, dyM in meters)
  function findBestTurn(headingAtStart, speedAtStart, turnRate, targetDx, targetDy) {
    var dt = 0.05;
    var windDirRad = window.appState.wind.direction * Math.PI / 180;
    var windVx = -window.appState.wind.speed * Math.sin(windDirRad);
    var windVy = -window.appState.wind.speed * Math.cos(windDirRad);

    var bestDist = Infinity;
    var bestAngle = 1;
    var bestDir = 'R';
    var bestRate = turnRate;
    var dirs = ['R', 'L'];

    for (var rate = 1; rate <= 30; rate++) {
      for (var d = 0; d < 2; d++) {
        var sign = dirs[d] === 'R' ? 1 : -1;
        var heading = headingAtStart;
        var x = 0, y = 0;
        var turned = 0;

        while (turned < 360) {
          heading += sign * rate * dt;
          heading = ((heading % 360) + 360) % 360;
          turned += rate * dt;

          var ma = (90 - heading) * Math.PI / 180;
          var gndVx = speedAtStart * Math.cos(ma) + windVx;
          var gndVy = speedAtStart * Math.sin(ma) + windVy;
          x += gndVx * dt;
          y += gndVy * dt;

          var ex = x - targetDx;
          var ey = y - targetDy;
          var dist2 = ex * ex + ey * ey;

          if (dist2 < bestDist) {
            bestDist = dist2;
            bestAngle = Math.round(turned);
            bestDir = dirs[d];
            bestRate = rate;
          }
        }
      }
    }

    return { direction: bestDir, angle: Math.max(1, bestAngle), rate: bestRate };
  }

  // Brute-force search: simulate brake_turn at various rates (1-30°/s)
  // and both directions (R/L). For each combo, find the time step where
  // trajectory passes closest to target.
  // Returns { direction, rate, time } with time rounded to 0.5s, minimum 0.5s.
  function findBestBrakeTurn(headingAtStart, speedAtStart, _unused, targetDx, targetDy) {
    var dt = 0.05;
    var windDirRad = window.appState.wind.direction * Math.PI / 180;
    var windVx = -window.appState.wind.speed * Math.sin(windDirRad);
    var windVy = -window.appState.wind.speed * Math.cos(windDirRad);

    var brakeSpeedMs = window.appState.glider.brakeSpeed / 3.6;
    var transitionTime = window.appState.glider.transitionTime;
    var maxTime = 4;
    var dirs = ['R', 'L'];

    var bestDist = Infinity;
    var bestDir = 'R';
    var bestRate = 15;
    var bestTime = 4;

    for (var d = 0; d < 2; d++) {
      var sign = dirs[d] === 'R' ? 1 : -1;
      for (var rate = 1; rate <= 30; rate++) {
        var heading = headingAtStart;
        var x = 0, y = 0;
        var elapsed = 0;

        while (elapsed < maxTime) {
          elapsed += dt;
          var t = Math.min(elapsed / transitionTime, 1);
          var speed = speedAtStart + (brakeSpeedMs - speedAtStart) * t;
          heading += sign * rate * dt;
          heading = ((heading % 360) + 360) % 360;

          var ma = (90 - heading) * Math.PI / 180;
          var gndVx = speed * Math.cos(ma) + windVx;
          var gndVy = speed * Math.sin(ma) + windVy;
          x += gndVx * dt;
          y += gndVy * dt;

          var ex = x - targetDx;
          var ey = y - targetDy;
          var dist2 = ex * ex + ey * ey;
          if (dist2 < bestDist) {
            bestDist = dist2;
            bestDir = dirs[d];
            bestRate = rate;
            bestTime = elapsed;
          }
        }
      }
    }

    // Round to nearest 0.1s, minimum 0.1s
    bestTime = Math.max(0.1, Math.round(bestTime * 10) / 10);
    return { direction: bestDir, rate: bestRate, time: bestTime };
  }

  function clearEventHandles() {
    for (var i = 0; i < eventHandles.length; i++) {
      map.removeLayer(eventHandles[i]);
    }
    eventHandles = [];
  }

  function clearTrajectory() {
    for (var i = 0; i < trajectoryLayers.length; i++) {
      map.removeLayer(trajectoryLayers[i]);
    }
    trajectoryLayers = [];
    if (hoverTooltip && map.hasLayer(hoverTooltip)) {
      map.removeLayer(hoverTooltip);
    }
    hoverTooltip = null;
    clearEventHandles();
  }

  function panTo(lat, lng) {
    map.setView([lat, lng], Math.max(map.getZoom(), 17));
  }

  return {
    init: init,
    setStartPoint: setStartPoint,
    drawTrajectory: drawTrajectory,
    clearTrajectory: clearTrajectory,
    panTo: panTo,
    updateHeadingArrow: updateHeadingArrow,
    updateWindArrow: updateWindArrow,
    updateEndpointMarker: updateEndpointMarker,
    clearEndpointMarker: clearEndpointMarker,
    undoWaypoint: undoWaypoint,
    resetClickCount: resetClickCount,
    updateSidebarClasses: updateSidebarClasses,
    hasWaypoints: function() { return mapClickCount > 0 || mapClickCount === -1; },
    clearAll: clearAll
  };
})();
