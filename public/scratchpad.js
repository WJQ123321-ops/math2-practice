// Temporary, per-question ink. Nothing is written to storage or sent to the server.
export function createScratchpad() {
  const root = document.createElement('section');
  root.className = 'scratchpad';
  root.setAttribute('aria-label', '临时草稿区');
  root.innerHTML = `<button type="button" class="scratchpad-toggle" aria-expanded="false" aria-controls="scratchpad-body">打开草稿区</button>
    <div id="scratchpad-body" hidden>
      <div class="scratchpad-toolbar" role="group" aria-label="草稿工具">
        <button type="button" data-tool="pen" aria-pressed="true">黑笔</button>
        <button type="button" data-tool="eraser" aria-pressed="false">橡皮</button>
        <button type="button" data-action="undo" disabled>撤销</button>
        <button type="button" data-action="clear" disabled>清空</button>
        <span class="scratchpad-hint" id="scratchpad-hint">用鼠标、手指或触控笔演算 · 切题或刷新即清空</span>
      </div>
      <div class="scratchpad-paper"><canvas aria-label="临时演算画布" aria-describedby="scratchpad-hint"></canvas></div>
    </div>`;
  const toggle = root.querySelector('.scratchpad-toggle');
  const body = root.querySelector('#scratchpad-body');
  const canvas = root.querySelector('canvas');
  const context = canvas.getContext('2d', {desynchronized: true});
  const undo = root.querySelector('[data-action="undo"]');
  const clear = root.querySelector('[data-action="clear"]');
  let questionId, strokes = [], active = null, tool = 'pen', width = 0, height = 0;
  let rect = null, pixelRatio = 0;
  const moveEvent = window.isSecureContext && 'onpointerrawupdate' in window ? 'pointerrawupdate' : 'pointermove';

  function updateButtons() {
    undo.disabled = clear.disabled = strokes.length === 0;
  }
  function setBrush(stroke) {
    context.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
    context.strokeStyle = context.fillStyle = '#20334b';
    context.lineWidth = stroke.tool === 'eraser' ? 22 : 2;
    context.lineCap = context.lineJoin = 'round';
  }
  function drawSegment(stroke, from, to) {
    context.beginPath();
    if (from === to) {
      context.arc(to.x * width, to.y * height, context.lineWidth / 2, 0, Math.PI * 2);
      context.fill();
    } else {
      context.moveTo(from.x * width, from.y * height);
      context.lineTo(to.x * width, to.y * height);
      context.stroke();
    }
  }
  function redraw() {
    context.clearRect(0, 0, width, height);
    for (const stroke of strokes) {
      setBrush(stroke);
      drawSegment(stroke, stroke.points[0], stroke.points[0]);
      for (let i = 1; i < stroke.points.length; i++) drawSegment(stroke, stroke.points[i - 1], stroke.points[i]);
    }
  }
  function resize() {
    rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const scale = window.devicePixelRatio || 1;
    if (width === rect.width && height === rect.height && pixelRatio === scale) return;
    width = rect.width;
    height = rect.height;
    pixelRatio = scale;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    context.setTransform(scale, 0, 0, scale, 0, 0);
    redraw();
  }
  function finish() {
    if (!active) return;
    const pointerId = active.pointerId;
    active = null;
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  }
  function point(event) {
    if (!rect) rect = canvas.getBoundingClientRect();
    return {x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height};
  }
  toggle.addEventListener('click', () => {
    finish();
    body.hidden = !body.hidden;
    toggle.setAttribute('aria-expanded', String(!body.hidden));
    toggle.textContent = body.hidden ? '打开草稿区' : '收起草稿区';
    if (!body.hidden) resize();
  });
  for (const button of root.querySelectorAll('[data-tool]')) button.addEventListener('click', () => {
    tool = button.dataset.tool;
    for (const other of root.querySelectorAll('[data-tool]')) other.setAttribute('aria-pressed', String(other === button));
    canvas.classList.toggle('is-eraser', tool === 'eraser');
  });
  undo.addEventListener('click', () => { finish(); strokes.pop(); redraw(); updateButtons(); });
  clear.addEventListener('click', () => { finish(); strokes = []; redraw(); updateButtons(); });
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || active) return;
    event.preventDefault();
    rect = canvas.getBoundingClientRect();
    const stroke = {tool, points: [point(event)]};
    strokes.push(stroke);
    active = {pointerId: event.pointerId, stroke};
    canvas.setPointerCapture(event.pointerId);
    setBrush(stroke);
    drawSegment(stroke, stroke.points[0], stroke.points[0]);
    updateButtons();
  });
  function appendPoint(event) {
    const next = point(event), points = active.stroke.points;
    const previous = points[points.length - 1];
    if (next.x === previous.x && next.y === previous.y) return;
    drawSegment(active.stroke, previous, next);
    points.push(next);
  }
  // Draw immediately; scheduling another animation frame would add latency.
  canvas.addEventListener(moveEvent, event => {
    if (!active || event.pointerId !== active.pointerId) return;
    const samples = event.getCoalescedEvents?.();
    if (samples?.length) {
      for (const sample of samples) appendPoint(sample);
    } else appendPoint(event);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, event => {
    if (event.pointerId !== active?.pointerId) return;
    if (type === 'pointerup') appendPoint(event);
    finish();
  });
  // Capture also catches scrolling of an ancestor; refresh lazily on the next sample.
  window.addEventListener('scroll', () => { rect = null; }, {capture: true, passive: true});
  new ResizeObserver(resize).observe(canvas);
  return {
    element: root,
    setQuestion(id) {
      finish();
      if (id === questionId) return;
      questionId = id;
      strokes = [];
      redraw();
      updateButtons();
    }
  };
}

