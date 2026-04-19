// ============================================================
//  src/ui/UIBridge.js — Editor UI ↔ Engine Bridge
// ============================================================

export class UIBridge {
  constructor (engine, events, logger) {
    this.engine  = engine;
    this.events  = events;
    this.logger  = logger;
    this._selected = null;

    this._hierarchyEl  = document.getElementById('hierarchy-list');
    this._inspectorEl  = document.getElementById('inspector-content');
    this._statusEntEl  = document.getElementById('status-entities');
    this._statusTimeEl = document.getElementById('status-time');

    this._scripts      = new Map();
    this._activeScript = null;

    this._bindEvents();
    this._setupWorkspace();
    this._setupHierarchyResizer();
    this._setupConsole();
  }

  _bindEvents () {
    this.events.on('scene:entityAdded',       (e)  => this._onEntityAdded(e));
    this.events.on('scene:entityRemoved',     (e)  => this._onEntityRemoved(e));
    this.events.on('scene:cleared',           ()   => this._onSceneCleared());
    this.events.on('scene:updated',           ()   => this._refreshInspector());
    this.events.on('ui:entitySelected',       (id) => this._selectEntity(id));
    this.events.on('editor:spaceModeChanged', ({local}) => this._setSpaceMode(local));
    // Mirror logger lines into the console panel
    this.events.on('logger:line', ({msg, type, ts}) => this._appendConsoleLine(msg, type, ts));
  }

  // ── Console Panel ─────────────────────────────────────────
  _setupConsole () {
    this._consoleEl      = document.getElementById('console-output');
    this._consoleFilter  = 'all';   // all | info | warn | error | success

    const clearBtn = document.getElementById('btn-console-clear');
    clearBtn?.addEventListener('click', () => {
      if (this._consoleEl) this._consoleEl.innerHTML = '';
      this.logger.clear();
    });

    // Filter buttons
    document.querySelectorAll('.console-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._consoleFilter = btn.dataset.filter || 'all';
        document.querySelectorAll('.console-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._applyConsoleFilter();
      });
    });
  }

  _appendConsoleLine (msg, type, ts) {
    const el = this._consoleEl;
    if (!el) return;
    const prefix = { info: '›', warn: '⚠', error: '✖', success: '✔' }[type] || '·';
    const line = document.createElement('div');
    line.className    = 'log-line ' + type;
    line.dataset.type = type;
    line.innerHTML    = `<span class="log-timestamp">${ts}</span><span class="log-prefix">${prefix}</span>${this._esc(msg)}`;
    // Apply current filter
    if (this._consoleFilter !== 'all' && type !== this._consoleFilter) {
      line.style.display = 'none';
    }
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }

  _applyConsoleFilter () {
    if (!this._consoleEl) return;
    for (const line of this._consoleEl.querySelectorAll('.log-line')) {
      const t = line.dataset.type;
      line.style.display = (this._consoleFilter === 'all' || t === this._consoleFilter) ? '' : 'none';
    }
  }

  _esc (str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Hierarchy ─────────────────────────────────────────────
  _onEntityAdded (entity) {
    const li = document.createElement('li');
    li.className  = 'hierarchy-item';
    li.dataset.id = entity.id;

    const spr   = entity.getComponent('sprite');
    const icon  = this._shapeIcon(spr?.shape);
    const color = spr ? '#' + spr.color.toString(16).padStart(6, '0') : '#ffffff';

    li.innerHTML = `
      <span class="ent-icon" style="color:${color}">${icon}</span>
      <span class="ent-name">${entity.name}</span>
      <span class="ent-id">#${entity.id}</span>
    `;
    li.addEventListener('click', () => this.engine.setSelectedEntity(entity.id));
    this._hierarchyEl.appendChild(li);
  }

  _onEntityRemoved (entity) {
    const li = this._hierarchyEl.querySelector(`[data-id="${entity.id}"]`);
    if (li) li.remove();
    if (this._selected === entity.id) {
      this._selected = null;
      this.engine.setSelectedEntity(null);
      this._showInspectorEmpty();
      this._updateWorkspaceSelection(null);
    }
  }

  _onSceneCleared () {
    this._hierarchyEl.innerHTML = '';
    this._selected = null;
    this.engine.setSelectedEntity(null);
    this._showInspectorEmpty();
    this._updateWorkspaceSelection(null);
  }

  // ── Selection ─────────────────────────────────────────────
  _selectEntity (id) {
    this._selected = id;
    this._highlightHierarchy(id);
    this.engine.audio.playSfx('select');
    this._renderInspector(id);
    this._updateWorkspaceSelection(id);
  }

  _highlightHierarchy (id) {
    for (const li of this._hierarchyEl.querySelectorAll('.hierarchy-item')) {
      li.classList.toggle('selected', li.dataset.id == id);
    }
  }

  _setSpaceMode (local) {
    const label = document.getElementById('workspace-space-mode');
    if (label) label.textContent = local ? 'Local' : 'Global';
  }

  // ── Workspace (Script Editor) ──────────────────────────────
  _setupWorkspace () {
    this._scriptListEl   = document.getElementById('script-list');
    this._scriptEditorEl = document.getElementById('script-editor');
    this._workspaceSelEl = document.getElementById('workspace-selected-entity');
    this._workspaceStatus = document.getElementById('workspace-status');

    this._scriptTabsBar = document.getElementById('script-tabs-bar');
    this._scriptTabsContainer = document.getElementById('script-tabs-container');
    this._openScriptTabs = new Map(); // name -> {tab, textarea}
    this._activeTab = 'Default Script';

    // Auto-save script on input
    this._scriptEditorEl?.addEventListener('input', () => {
      if (this._activeTab && this._activeTab !== 'Default Script') {
        this._scripts.set(this._activeTab, this._scriptEditorEl.value);
      }
    });

    // Make inspector droppable for script assignment
    const inspector = document.getElementById('panel-inspector');
    inspector.addEventListener('dragover', (e) => {
      if (this._draggedScriptName) {
        e.preventDefault();
        inspector.style.borderLeft = '3px solid var(--accent)';
      }
    });
    inspector.addEventListener('dragleave', () => {
      inspector.style.borderLeft = '';
    });
    inspector.addEventListener('drop', (e) => {
      e.preventDefault();
      inspector.style.borderLeft = '';
      if (this._draggedScriptName) {
        this._activeScript = this._draggedScriptName;
        this._assignScript();
        this._draggedScriptName = null;
      }
    });

    // Bottom panel drag-resize
    this._bottomPanel       = document.getElementById('bottom-panel');
    this._bottomPanelHeader = document.getElementById('bottom-panel-header');
    this._draggingPanel     = false;
    this._startDragY        = 0;
    this._startPanelHeight  = 240;

    if (this._bottomPanelHeader && this._bottomPanel) {
      this._bottomPanelHeader.addEventListener('pointerdown', (e) => {
        this._draggingPanel    = true;
        this._startDragY       = e.clientY;
        this._startPanelHeight = this._bottomPanel.offsetHeight;
        document.body.style.cursor = 'ns-resize';
        e.preventDefault();
      });
      window.addEventListener('pointermove', (e) => {
        if (!this._draggingPanel) return;
        const delta = this._startDragY - e.clientY;
        const h = Math.min(Math.max(this._startPanelHeight + delta, 140), window.innerHeight * 0.6);
        this._bottomPanel.style.height = h + 'px';
      });
      window.addEventListener('pointerup', () => {
        if (!this._draggingPanel) return;
        this._draggingPanel = false;
        document.body.style.cursor = '';
      });
    }

    this._draggedScriptName = null;
    this._registerDefaultScript();
  }

  _setupHierarchyResizer () {
    this._hierarchyPanel   = document.getElementById('panel-hierarchy');
    this._hierarchyResizer = document.getElementById('hierarchy-resizer');
    this._draggingHierarchy = false;
    this._startDragX        = 0;
    this._startHierarchyWidth = 220;

    if (this._hierarchyResizer && this._hierarchyPanel) {
      this._hierarchyResizer.addEventListener('pointerdown', (e) => {
        this._draggingHierarchy  = true;
        this._startDragX         = e.clientX;
        this._startHierarchyWidth = this._hierarchyPanel.offsetWidth;
        document.body.style.cursor = 'ew-resize';
        e.preventDefault();
      });
      window.addEventListener('pointermove', (e) => {
        if (!this._draggingHierarchy) return;
        const delta = e.clientX - this._startDragX;
        const w = Math.min(Math.max(this._startHierarchyWidth + delta, 150), 400);
        this._hierarchyPanel.style.width = w + 'px';
        this.engine._onResize();
      });
      window.addEventListener('pointerup', () => {
        if (!this._draggingHierarchy) return;
        this._draggingHierarchy = false;
        document.body.style.cursor = '';
      });
    }
  }

  _registerDefaultScript () {
    if (this._scripts.size > 0) return;
    // Updated default template that uses the correct physics-aware API
    const template =
`({
  onStart(entity) {
    // Runs once when assigned. Use this.x to store state across frames.
    this.ph = entity.getComponent('physics');
  },
  onUpdate(entity, dt, elapsed, bounds) {
    // ph.rotate(speed, dt)  — spin using physics angular velocity
    // ph.setRotationSpeed(rad/s) — set a continuous spin once
    // Matter.Body.setVelocity(ph.body, {x, y}) — set velocity
    // ph.applyForce(fx, fy, dt) — push the body
    // ph.enabled = false — freeze physics
    if (this.ph) this.ph.rotate(2, dt);
  }
})`;
    this._scripts.set('Default Script', template);
    this._activeScript = 'Default Script';
    this._updateScriptList();
    this._scriptEditorEl.value  = template;
  }

  _updateWorkspaceSelection (id) {
    if (this._workspaceSelEl) {
      const entity = this.engine.scene.getEntity(id);
      this._workspaceSelEl.textContent = entity ? `${entity.name} (#${entity.id})` : 'None';
    }
  }

  _saveScript () {
    // Auto-save is now handled by _setupWorkspace input listener
  }

  _loadSelectedScript () {
    if (!this._scriptEditorEl) return;
    const name = this._activeScript;
    this._scriptEditorEl.value  = this._scripts.get(name) || '';
  }

  _updateScriptList () {
    if (!this._scriptListEl) return;
    this._scriptListEl.innerHTML = '';
    for (const name of this._scripts.keys()) {
      const item = document.createElement('div');
      item.className = 'script-item';
      if (name === this._activeScript) item.classList.add('selected');
      item.draggable = true;
      item.dataset.scriptName = name;

      const iconSpan = document.createElement('span');
      iconSpan.className = 'script-icon';
      iconSpan.textContent = '📄';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'script-name';
      nameSpan.textContent = name;

      item.appendChild(iconSpan);
      item.appendChild(nameSpan);

      // Helper to open script in new window
      const openScriptEditor = () => {
        const scriptContent = this._scripts.get(name);
        const newWindow = window.open('', 'script_' + name, 'width=800,height=600');
        if (!newWindow) {
          this.logger.error('Could not open new window - pop-ups may be blocked');
          return;
        }
        newWindow.document.title = 'Script: ' + name;
        newWindow.document.body.innerHTML = `
          <style>
            body { font-family: 'Share Tech Mono', monospace; background: #080c10; color: #c9d8e8; padding: 20px; margin: 0; line-height: 1.6; }
            textarea { width: 100%; height: calc(100vh - 60px); background: #0d1117; border: 1px solid #2e4d6d; color: #c9d8e8; font-family: inherit; padding: 10px; font-size: 12px; }
          </style>
          <textarea id="scriptContent"></textarea>
        `;
        newWindow.document.getElementById('scriptContent').value = scriptContent;
        this.logger.info('Opened script in new window: ' + name);
      };

      // Double-click icon or item to open in new window
      iconSpan.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        openScriptEditor();
      });

      item.addEventListener('dblclick', (e) => {
        if (e.target === nameSpan) return; // Don't open if double-clicking name (that's for rename)
        e.stopPropagation();
        openScriptEditor();
      });

      // Double-click name to rename script
      nameSpan.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const input = document.createElement('input');
        input.type = 'text';
        input.value = name;
        input.className = 'script-name editable';
        nameSpan.replaceWith(input);
        input.focus();
        input.select();

        const finishRename = () => {
          const newName = input.value.trim() || name;
          if (newName !== name && !this._scripts.has(newName)) {
            const script = this._scripts.get(name);
            this._scripts.delete(name);
            this._scripts.set(newName, script);
            if (this._activeScript === name) this._activeScript = newName;
            this._updateScriptList();
            this.logger.info('Script renamed: ' + name + ' → ' + newName);
          } else {
            this._updateScriptList();
          }
        };

        input.addEventListener('blur', finishRename);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') finishRename();
          if (e.key === 'Escape') this._updateScriptList();
        });
      });

      item.addEventListener('dragstart', (e) => {
        this._draggedScriptName = name;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'copy';
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
      });
      item.addEventListener('click', (e) => {
        if (e.target !== nameSpan) {
          this._activeScript = name;
          this._updateScriptList();
          this._loadSelectedScript();
        }
      });

      this._scriptListEl.appendChild(item);
    }
  }

  _assignScript () {
    if (!this._activeScript) { this.logger.warn('No script selected'); return; }
    const entity = this.engine.scene.getEntity(this._selected);
    if (!entity) { this.logger.warn('Select an entity first'); return; }
    const source = this._scripts.get(this._activeScript);
    if (!source)  { this.logger.warn('Script source not found'); return; }

    let scriptObj;
    try { scriptObj = (new Function('return (' + source + ');'))(); }
    catch (err) { this.logger.error('Script compile error: ' + err.message); return; }

    if (!scriptObj || typeof scriptObj !== 'object') {
      this.logger.error('Script must return an object with onStart/onUpdate hooks');
      return;
    }

    const scriptComp = entity.getComponent('script');
    if (scriptComp?.setScript) {
      scriptComp._logger = this.logger;    // ensure errors surface in engine console
      scriptComp.setScript(scriptObj);
      this.logger.info(`Assigned '${this._activeScript}' → ${entity.name}`);
    } else {
      this.logger.warn('Entity has no script component');
    }
  }

  // ── Inspector ──────────────────────────────────────────────
  _refreshInspector () {
    if (this._selected) this._renderInspector(this._selected);
  }

  _renderInspector (id) {
    const entity = this.engine.scene.getEntity(id);
    if (!entity) { this._showInspectorEmpty(); return; }

    const spr = entity.getComponent('sprite');
    const ph  = entity.getComponent('physics');
    const sc  = entity.getComponent('script');

    const colorHex  = spr ? '#' + spr.color.toString(16).padStart(6, '0') : '#ffffff';
    const xValue    = spr && Number.isFinite(spr.x)        ? spr.x.toFixed(1)                          : 'n/a';
    const yValue    = spr && Number.isFinite(spr.y)        ? spr.y.toFixed(1)                          : 'n/a';
    const rotValue  = spr && Number.isFinite(spr.rotation) ? (spr.rotation * 180 / Math.PI).toFixed(1) + '°' : 'n/a';
    const alphaVal  = spr && Number.isFinite(spr.alpha)    ? spr.alpha.toFixed(2)                       : 'n/a';

    const velX   = ph ? (ph.body?.velocity?.x ?? 0) : 0;
    const velY   = ph ? (ph.body?.velocity?.y ?? 0) : 0;
    const spd    = ph ? ph.speed() : 0;
    const mass   = ph ? (ph.body?.mass ?? 'n/a')    : 'n/a';
    const drag   = ph ? ph.frictionAir.toFixed(3)   : 'n/a';
    const grav   = ph ? ph.gravity                  : 'n/a';
    const phEn   = ph ? ph.enabled                  : false;

    this._inspectorEl.innerHTML = `
      <div class="insp-section">
        <div class="insp-section-title">IDENTITY</div>
        <div class="insp-row"><span class="insp-label">Name</span><span class="insp-value">${entity.name}</span></div>
        <div class="insp-row"><span class="insp-label">ID</span><span class="insp-value">#${entity.id}</span></div>
        <div class="insp-row"><span class="insp-label">Active</span><span class="insp-value" style="color:var(--green)">${entity.active}</span></div>
        <div class="insp-row"><span class="insp-label">Tags</span>
          <span class="insp-value">${[...entity.tags].map(t => `<span class="insp-tag">${t}</span>`).join('')}</span>
        </div>
      </div>

      ${spr ? `
      <div class="insp-section">
        <div class="insp-section-title">TRANSFORM</div>
        <div class="insp-row"><span class="insp-label">X</span><span class="insp-value">${xValue}</span></div>
        <div class="insp-row"><span class="insp-label">Y</span><span class="insp-value">${yValue}</span></div>
        <div class="insp-row"><span class="insp-label">Rotation</span><span class="insp-value">${rotValue}</span></div>
        <div class="insp-row"><span class="insp-label">Shape</span><span class="insp-value">${spr.shape}</span></div>
        <div class="insp-row"><span class="insp-label">Color</span>
          <span class="insp-value"><span class="insp-color-dot" style="background:${colorHex}"></span> ${colorHex}</span>
        </div>
        <div class="insp-row"><span class="insp-label">Alpha</span><span class="insp-value">${alphaVal}</span></div>
      </div>` : ''}

      ${ph ? `
      <div class="insp-section">
        <div class="insp-section-title">PHYSICS
          <button class="insp-toggle-btn" id="insp-toggle-physics">${phEn ? '⏸ Disable' : '▶ Enable'}</button>
        </div>
        <div class="insp-row"><span class="insp-label">Enabled</span><span class="insp-value" style="color:${phEn ? 'var(--green)' : 'var(--red)'}">${phEn}</span></div>
        <div class="insp-row"><span class="insp-label">Vel X</span><span class="insp-value">${Number.isFinite(velX) ? velX.toFixed(1) : 'n/a'}</span></div>
        <div class="insp-row"><span class="insp-label">Vel Y</span><span class="insp-value">${Number.isFinite(velY) ? velY.toFixed(1) : 'n/a'}</span></div>
        <div class="insp-row"><span class="insp-label">Speed</span><span class="insp-value">${Number.isFinite(spd) ? spd.toFixed(1) : 'n/a'}</span></div>
        <div class="insp-row"><span class="insp-label">Mass</span><span class="insp-value">${mass}</span></div>
        <div class="insp-row"><span class="insp-label">Drag</span><span class="insp-value">${drag}</span></div>
        <div class="insp-row"><span class="insp-label">Gravity</span><span class="insp-value">${grav}</span></div>
      </div>` : ''}

      ${sc ? `
      <div class="insp-section">
        <div class="insp-section-title">SCRIPT</div>
        <div class="insp-row"><span class="insp-label">Started</span><span class="insp-value" style="color:${sc._started ? 'var(--green)' : 'var(--text-muted)'}">${sc._started}</span></div>
        <div class="insp-row"><span class="insp-label">Has onStart</span><span class="insp-value">${!!sc._script?.onStart}</span></div>
        <div class="insp-row"><span class="insp-label">Has onUpdate</span><span class="insp-value">${!!sc._script?.onUpdate}</span></div>
      </div>` : ''}

      <button class="insp-remove-btn" id="insp-remove-btn">⚠ REMOVE ENTITY</button>
    `;

    document.getElementById('insp-toggle-physics')?.addEventListener('click', () => {
      if (ph) {
        ph.enabled = !ph.enabled;
        this.logger.info(`Physics ${ph.enabled ? 'enabled' : 'disabled'} on ${entity.name}`);
        this._renderInspector(id);
      }
    });

    document.getElementById('insp-remove-btn')?.addEventListener('click', () => {
      this.engine.scene.removeEntity(id);
      this.logger.warn('Entity removed: ' + entity.name);
    });
  }

  _showInspectorEmpty () {
    this._inspectorEl.innerHTML = '<div class="inspector-empty">Select an entity to inspect</div>';
  }

  // ── Status Bar ────────────────────────────────────────────
  updateStatus (count, elapsed) {
    this._statusEntEl.textContent  = 'Entities: ' + count;
    this._statusTimeEl.textContent = 'T: ' + elapsed.toFixed(2) + 's';
  }

  // ── Helpers ───────────────────────────────────────────────
  _shapeIcon (shape) {
    switch (shape) {
      case 'rect':    return '▬';
      case 'diamond': return '◆';
      case 'star':    return '★';
      default:        return '●';
    }
  }
}