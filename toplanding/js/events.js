// Dynamic plan UI: straight + N turns + brake turn
window.TopLand = window.TopLand || {};

TopLand.Events = (function() {
  var circled = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩',
                 '⑪','⑫','⑬','⑭','⑮','⑯','⑰','⑱','⑲','⑳'];

  function cn(n) { return n <= 20 ? circled[n - 1] : '(' + n + ')'; }

  function init() {
    // Bind planDistance
    bindInput('planDistance', function(val) {
      window.appState.plan.distance = val;
    });

    // Bind planBrakeTurnRate
    bindInput('planBrakeTurnRate', function(val) {
      window.appState.plan.brakeTurn.rate = val;
    });

    // Bind planBrakeTurnTime
    bindInput('planBrakeTurnTime', function(val) {
      window.appState.plan.brakeTurn.time = val;
    });

    // Add turn button
    var addBtn = document.getElementById('btnAddTurn');
    if (addBtn) {
      addBtn.addEventListener('click', function() {
        var plan = window.appState.plan;
        var lastDir = 'R';
        if (plan.turns.length > 0) {
          lastDir = plan.turns[plan.turns.length - 1].direction;
        }
        plan.turns.push({
          direction: lastDir,
          rate: 15,
          angle: 90
        });
        render();
        if (typeof generateEvents === 'function') generateEvents();
        if (typeof autoSimulate === 'function') autoSimulate();
      });
    }

    render();
  }

  function bindInput(id, setter) {
    var el = document.getElementById(id);
    if (!el) return;
    var handler = function() {
      var val = parseFloat(this.value);
      if (isNaN(val)) return;
      setter(val);
      if (typeof generateEvents === 'function') generateEvents();
      if (typeof autoSimulate === 'function') autoSimulate();
    };
    el.addEventListener('change', handler);
    el.addEventListener('input', handler);
  }

  function render() {
    var plan = window.appState.plan;
    var container = document.getElementById('turnsContainer');
    if (!container) return;

    // Sync distance
    document.getElementById('planDistance').value = plan.distance;
    // Sync brake turn
    document.getElementById('planBrakeTurnRate').value = plan.brakeTurn.rate;
    document.getElementById('planBrakeTurnTime').value = plan.brakeTurn.time;

    // Render turns
    container.innerHTML = '';
    for (var i = 0; i < plan.turns.length; i++) {
      container.appendChild(createTurnGroup(i, plan));
    }

    // Update brake turn header number
    var brakeHeader = document.getElementById('brakeTurnHeader');
    if (brakeHeader) {
      brakeHeader.textContent = cn(plan.turns.length + 2) + ' ブレーク旋回';
    }
  }

  function createTurnGroup(idx, plan) {
    var turn = plan.turns[idx];
    var div = document.createElement('div');
    div.className = 'plan-group';

    // Header with delete button
    var h4 = document.createElement('h4');
    h4.textContent = cn(idx + 2) + ' 旋回' + (plan.turns.length > 1 ? ' ' + (idx + 1) : '');
    var delBtn = document.createElement('button');
    delBtn.className = 'delete-turn';
    delBtn.textContent = '×';
    delBtn.title = '削除';
    delBtn.addEventListener('click', function() {
      plan.turns.splice(idx, 1);
      render();
      if (typeof generateEvents === 'function') generateEvents();
      if (typeof autoSimulate === 'function') autoSimulate();
    });
    h4.appendChild(delBtn);
    div.appendChild(h4);

    // Direction
    var dirLabel = document.createElement('label');
    dirLabel.textContent = '方向 ';
    var dirSelect = document.createElement('select');
    dirSelect.innerHTML = '<option value="L"' + (turn.direction === 'L' ? ' selected' : '') + '>L</option>' +
                          '<option value="R"' + (turn.direction === 'R' ? ' selected' : '') + '>R</option>';
    dirSelect.addEventListener('change', function() {
      turn.direction = this.value;
      if (typeof generateEvents === 'function') generateEvents();
      if (typeof autoSimulate === 'function') autoSimulate();
    });
    dirLabel.appendChild(dirSelect);
    div.appendChild(dirLabel);

    // Rate
    addNumberInput(div, '角速度 (°/s) ', turn.rate, 1, 60, 1, function(val) {
      turn.rate = val;
    });

    // Angle
    addNumberInput(div, '角度 (°) ', turn.angle, 0, 720, 10, function(val) {
      turn.angle = val;
    });

    return div;
  }

  function addNumberInput(parent, labelText, value, min, max, step, setter) {
    var label = document.createElement('label');
    label.textContent = labelText;
    var input = document.createElement('input');
    input.type = 'number';
    input.value = value;
    input.min = min;
    input.max = max;
    input.step = step;
    var handler = function() {
      var val = parseFloat(input.value);
      if (isNaN(val)) return;
      setter(val);
      if (typeof generateEvents === 'function') generateEvents();
      if (typeof autoSimulate === 'function') autoSimulate();
    };
    input.addEventListener('change', handler);
    input.addEventListener('input', handler);
    label.appendChild(input);
    parent.appendChild(label);
  }

  return { init: init, render: render };
})();
