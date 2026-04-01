// Physics simulation engine for paraglider top-landing approach
window.TopLand = window.TopLand || {};

// Map ground speed (m/s) to RGB color string
// 0~2.22 m/s (0~8 km/h): blue — walkable
// 2.22~3.33 m/s (8~12 km/h): blue -> green — jogging
// 3.33~5.56 m/s (12~20 km/h): green -> yellow-orange — runnable limit
// 5.56~8.33 m/s (20~30 km/h): yellow-orange -> red — too fast
// 8.33+ m/s (30+ km/h): red
TopLand.speedToColor = function(speed) {
  var r, g, b;
  var s1 = 2.22;  // 8 km/h
  var s2 = 3.33;  // 12 km/h
  var s3 = 5.56;  // 20 km/h
  var s4 = 8.33;  // 30 km/h
  if (speed <= s1) {
    return 'rgb(50,120,220)';
  } else if (speed <= s2) {
    var t = (speed - s1) / (s2 - s1);
    r = Math.round(50 - 50 * t);
    g = Math.round(120 + (180 - 120) * t);
    b = Math.round(220 - 180 * t);
  } else if (speed <= s3) {
    var t = (speed - s2) / (s3 - s2);
    r = Math.round(0 + 255 * t);
    g = Math.round(180 + (180 - 180) * t);
    b = Math.round(40 - 40 * t);
  } else if (speed <= s4) {
    var t = (speed - s3) / (s4 - s3);
    r = Math.round(255 + (220 - 255) * t);
    g = Math.round(180 - 140 * t);
    b = Math.round(0 + 40 * t);
  } else {
    return 'rgb(220,40,40)';
  }
  return 'rgb(' + r + ',' + g + ',' + b + ')';
};

// Run simulation and return trajectory points + summary
TopLand.simulate = function(state) {
  var dt = 0.05;       // seconds
  var maxTime = 300;    // seconds

  var trimSpeedMs = state.glider.trimSpeed / 3.6;
  var brakeSpeedMs = state.glider.brakeSpeed / 3.6;
  var transitionTime = state.glider.transitionTime;

  // Wind vector (internal coords: x=east, y=north)
  // Wind direction = where wind comes FROM, so we negate
  var windDirRad = state.wind.direction * Math.PI / 180;
  var windVx = -state.wind.speed * Math.sin(windDirRad);
  var windVy = -state.wind.speed * Math.cos(windDirRad);

  var startLat = state.start.lat;
  var startLng = state.start.lng;
  var latRad = startLat * Math.PI / 180;
  var cosLat = Math.cos(latRad);

  var x = 0, y = 0;
  var heading = state.start.heading;
  var currentSpeed = trimSpeedMs;
  var braking = false;
  var brakeElapsed = 0;
  var time = 0;
  var truncated = false;

  // Initial ground speed
  var initMathAngle = (90 - heading) * Math.PI / 180;
  var initGndVx = currentSpeed * Math.cos(initMathAngle) + windVx;
  var initGndVy = currentSpeed * Math.sin(initMathAngle) + windVy;
  var initGndSpeed = Math.sqrt(initGndVx * initGndVx + initGndVy * initGndVy);

  var points = [{
    lat: startLat, lng: startLng,
    speed: initGndSpeed, time: 0
  }];
  var minSpeed = initGndSpeed;
  var maxSpeed = initGndSpeed;

  // Single timestep: update speed, compute vectors, move position
  function step() {
    if (braking) {
      brakeElapsed += dt;
      var t = Math.min(brakeElapsed / transitionTime, 1);
      currentSpeed = trimSpeedMs + (brakeSpeedMs - trimSpeedMs) * t;
    }

    var mathAngle = (90 - heading) * Math.PI / 180;
    var airVx = currentSpeed * Math.cos(mathAngle);
    var airVy = currentSpeed * Math.sin(mathAngle);

    var gndVx = airVx + windVx;
    var gndVy = airVy + windVy;
    var gndSpeed = Math.sqrt(gndVx * gndVx + gndVy * gndVy);

    x += gndVx * dt;
    y += gndVy * dt;
    time += dt;

    var lat = startLat + y / 111320;
    var lng = startLng + x / (111320 * cosLat);

    var pt = { lat: lat, lng: lng, speed: gndSpeed, time: time };
    if (braking) {
      pt.brakePercent = Math.min(100, Math.round(brakeElapsed / transitionTime * 100));
    }
    points.push(pt);
    if (gndSpeed < minSpeed) minSpeed = gndSpeed;
    if (gndSpeed > maxSpeed) maxSpeed = gndSpeed;

    return gndSpeed;
  }

  var eventBoundaries = [];

  for (var ei = 0; ei < state.events.length; ei++) {
    var event = state.events[ei];
    if (time >= maxTime) { truncated = true; break; }

    var startIdx = points.length - 1;
    var headingAtStart = heading;
    var speedAtStart = currentSpeed;

    if (event.type === 'straight') {
      var distTraveled = 0;
      while (distTraveled < event.distance) {
        if (time >= maxTime) { truncated = true; break; }
        var gndSpeed = step();
        distTraveled += gndSpeed * dt;
      }
    }

    if (event.type === 'turn') {
      var turnRate = event.rate;
      var totalAngle = event.angle;
      var turned = 0;
      var dir = event.direction === 'R' ? 1 : -1;

      while (turned < totalAngle) {
        if (time >= maxTime) { truncated = true; break; }
        heading += dir * turnRate * dt;
        heading = ((heading % 360) + 360) % 360;
        turned += turnRate * dt;
        step();
      }
    }

    if (event.type === 'brake_turn') {
      braking = true;
      var brakeTurnRate = event.rate;
      var brakeTurnDir = event.direction === 'R' ? 1 : -1;
      var brakeFlightTime = Math.min(event.time || (state.glider.transitionTime + 2), 4);
      var brakeTimeElapsed = 0;
      while (brakeTimeElapsed < brakeFlightTime) {
        if (time >= maxTime) { truncated = true; break; }
        heading += brakeTurnDir * brakeTurnRate * dt;
        heading = ((heading % 360) + 360) % 360;
        step();
        brakeTimeElapsed += dt;
      }
    }

    eventBoundaries.push({ eventIndex: ei, type: event.type, startPointIdx: startIdx, endPointIdx: points.length - 1, headingAtStart: headingAtStart, speedAtStart: speedAtStart });

    if (event.type === 'brake_turn') {
      break; // simulation ends — landed
    }
  }

  return {
    points: points,
    eventBoundaries: eventBoundaries,
    summary: {
      totalTime: Math.round(time * 100) / 100,
      minSpeed: Math.round(minSpeed * 100) / 100,
      maxSpeed: Math.round(maxSpeed * 100) / 100,
      finalHeading: Math.round(heading),
      finalAirspeed: currentSpeed,
      truncated: truncated
    }
  };
};
