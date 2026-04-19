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
    this._ctxMenuEl    = document.getElementById('hier-ctx-menu');

    this._scripts      = new Map();
    this._activeScript = null;

    // Floating script editor windows — keyed by script name.
    this._floatingEditors = new Map();
    this._floatingZ       = 1000;

    // Folder model — folders are UI-only (not scene entities):
    //   _folders        id → { id, name, expanded }
    //   _entityFolder   entityId → folderId (or undefined when top-level)
    //   _folderNextId   monotonically-increasing id generator
    this._folders       = new Map();
    this._entityFolder  = new Map();
    this._folderNextId  = 1;

    this._bindEvents();
    this._setupWorkspace();
    this._setupHierarchyResizer();
    this._setupConsole();
    this._setupHierarchyContextMenu();
  }

  _bindEvents () {
    this.events.on('scene:entityAdded',       (e)  => this._onEntityAdded(e));
    this.events.on('scene:entityRemoved',     (e)  => this._onEntityRemoved(e));
    this.events.on('scene:cleared',           ()   => this._onSceneCleared());
    this.events.on('scene:updated',           ()   => this._refreshInspector());
    this.events.on('ui:entitySelected',       (id) => this._selectEntity(id));
    this.events.on('editor:spaceModeChanged', ({local}) => this._setSpaceMode(local));
    // Refresh the inspector on explicit edits even when the scene loop isn't
    // running (gizmo drags, body drags, inspector edits, undo/redo, STOP revert).
    this.events.on('ui:inspectorDirty',       (id) => { if (id === this._selected) this._refreshInspector(); });
    // Rebuild after STOP because a revert may have changed many fields at once.
    this.events.on('engine:stop',             ()   => { if (this._selected) this._renderInspector(this._selected); });
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
    // Cap the panel so very chatty scenes don't leak DOM nodes forever.
    const MAX_LINES = 200;
    while (el.childElementCount > MAX_LINES) el.removeChild(el.firstChild);
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

  // ── Hierarchy (tree with folders) ─────────────────────────
  _onEntityAdded (entity) {
    this._rebuildHierarchy();
  }

  _onEntityRemoved (entity) {
    this._entityFolder.delete(entity.id);
    if (this._selected === entity.id) {
      this._selected = null;
      this.engine.setSelectedEntity(null);
      this._showInspectorEmpty();
      this._updateWorkspaceSelection(null);
    }
    this._rebuildHierarchy();
  }

  _onSceneCleared () {
    this._entityFolder.clear();
    this._selected = null;
    this.engine.setSelectedEntity(null);
    this._showInspectorEmpty();
    this._updateWorkspaceSelection(null);
    this._rebuildHierarchy();
  }

  /**
   * Rebuild the hierarchy DOM from the current entities + folder model.
   * Cheap enough for the kinds of scenes this editor supports (dozens of
   * entities); if we ever outgrow that we'd switch to incremental patches.
   */
  _rebuildHierarchy () {
    if (!this._hierarchyEl) return;
    this._hierarchyEl.innerHTML = '';

    // Folders first (sorted by creation order = numeric id).
    const folderIds = [...this._folders.keys()].sort((a, b) => a - b);
    for (const fid of folderIds) {
      const folder = this._folders.get(fid);
      this._hierarchyEl.appendChild(this._renderFolderNode(folder));
    }

    // Then top-level entities (not inside any folder).
    for (const entity of this.engine.scene.getAllEntities()) {
      if (this._entityFolder.has(entity.id)) continue;
      this._hierarchyEl.appendChild(this._renderEntityNode(entity));
    }

    this._highlightHierarchy(this._selected);
  }

  _renderEntityNode (entity) {
    const li = document.createElement('li');
    li.className  = 'hierarchy-item';
    li.dataset.id = entity.id;
    li.dataset.kind = 'entity';
    li.draggable = true;

    const spr   = entity.getComponent('sprite');
    const icon  = this._shapeIcon(spr?.shape);
    const color = spr ? '#' + spr.color.toString(16).padStart(6, '0') : '#ffffff';

    li.innerHTML = `
      <span class="ent-icon" style="color:${color}">${icon}</span>
      <span class="ent-name">${this._esc(entity.name)}</span>
      <span class="ent-id">#${entity.id}</span>
    `;
    li.addEventListener('click', () => this.engine.setSelectedEntity(entity.id));

    // Drag entity → folder = reparent. Drag entity → blank list = unparent.
    li.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      e.dataTransfer.setData('application/x-nebul-entity', String(entity.id));
      e.dataTransfer.effectAllowed = 'move';
    });

    return li;
  }

  _renderFolderNode (folder) {
    const wrapper = document.createElement('li');
    wrapper.className = 'hierarchy-folder';
    wrapper.dataset.folderId = folder.id;
    wrapper.dataset.kind = 'folder';

    const header = document.createElement('div');
    header.className = 'folder-header';
    if (folder.expanded === false) header.classList.add('collapsed');

    const chev = document.createElement('span');
    chev.className = 'folder-chev';
    chev.textContent = folder.expanded === false ? '▸' : '▾';

    const icon = document.createElement('span');
    icon.className = 'ent-icon';
    icon.textContent = '📁';

    const nameEl = document.createElement('span');
    nameEl.className = 'ent-name folder-name';
    nameEl.textContent = folder.name;

    header.appendChild(chev);
    header.appendChild(icon);
    header.appendChild(nameEl);

    // Click chevron / header → toggle expand/collapse (but skip when clicking
    // directly on the name so double-click-to-rename still works).
    header.addEventListener('click', (e) => {
      if (e.target === nameEl) return;
      folder.expanded = folder.expanded === false ? true : false;
      this._rebuildHierarchy();
    });

    // Double-click name → inline rename; Enter commits, Escape reverts.
    nameEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this._beginFolderRename(folder, nameEl);
    });

    // Drop target for entity reparenting.
    header.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('application/x-nebul-entity')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      header.classList.add('drag-over');
    });
    header.addEventListener('dragleave', () => header.classList.remove('drag-over'));
    header.addEventListener('drop', (e) => {
      header.classList.remove('drag-over');
      const entId = parseInt(e.dataTransfer.getData('application/x-nebul-entity'), 10);
      if (!Number.isFinite(entId)) return;
      e.preventDefault();
      this._setEntityFolder(entId, folder.id);
    });

    wrapper.appendChild(header);

    if (folder.expanded !== false) {
      const childList = document.createElement('ul');
      childList.className = 'folder-children';
      for (const entity of this.engine.scene.getAllEntities()) {
        if (this._entityFolder.get(entity.id) !== folder.id) continue;
        childList.appendChild(this._renderEntityNode(entity));
      }
      wrapper.appendChild(childList);
    }

    return wrapper;
  }

  _beginFolderRename (folder, nameEl) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = folder.name;
    input.className = 'folder-name-input';
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    const commit = (save) => {
      if (save) {
        const v = input.value.trim();
        if (v) folder.name = v;
      }
      this._rebuildHierarchy();
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter')  { ev.preventDefault(); commit(true); }
      if (ev.key === 'Escape') { ev.preventDefault(); commit(false); }
    });
    input.addEventListener('blur', () => commit(true));
  }

  _setEntityFolder (entityId, folderId) {
    if (folderId == null) this._entityFolder.delete(entityId);
    else                  this._entityFolder.set(entityId, folderId);
    this._rebuildHierarchy();
    const ent = this.engine.scene.getEntity(entityId);
    const fol = folderId != null ? this._folders.get(folderId) : null;
    if (ent && fol) this.logger.info(`Moved ${ent.name} → ${fol.name}`);
    else if (ent)   this.logger.info(`Moved ${ent.name} → (root)`);
  }

  _createFolder (name = 'New Folder') {
    const id = this._folderNextId++;
    this._folders.set(id, { id, name, expanded: true });
    this._rebuildHierarchy();
    this.logger.info('Folder created: ' + name);
    return id;
  }

  _removeFolder (folderId) {
    if (!this._folders.has(folderId)) return;
    // Move any children back to the root rather than deleting them.
    for (const [entId, fid] of this._entityFolder) {
      if (fid === folderId) this._entityFolder.delete(entId);
    }
    this._folders.delete(folderId);
    this._rebuildHierarchy();
  }

  // ── Hierarchy Context Menu ────────────────────────────────
  _setupHierarchyContextMenu () {
    if (!this._hierarchyEl || !this._ctxMenuEl) return;

    // Suppress the browser's native menu and route to our custom one.
    this._hierarchyEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();

      // Find the clicked row (if any) by walking up to a folder header or
      // entity row. Clicking outside both opens the empty-space menu.
      const folderHeader = e.target.closest('.folder-header');
      const entityRow    = e.target.closest('.hierarchy-item');

      if (folderHeader) {
        const wrapper = folderHeader.closest('.hierarchy-folder');
        const fid = parseInt(wrapper?.dataset.folderId, 10);
        this._openCtxMenu(e.clientX, e.clientY, this._folderMenuItems(fid));
      } else if (entityRow) {
        const id = parseInt(entityRow.dataset.id, 10);
        this._openCtxMenu(e.clientX, e.clientY, this._entityMenuItems(id));
      } else {
        this._openCtxMenu(e.clientX, e.clientY, this._emptyMenuItems());
      }
    });

    // Drop on blank hierarchy space → unparent the entity (move to root).
    this._hierarchyEl.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('application/x-nebul-entity')) return;
      if (e.target.closest('.folder-header')) return;    // folder handles its own
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    this._hierarchyEl.addEventListener('drop', (e) => {
      if (e.target.closest('.folder-header')) return;
      const entId = parseInt(e.dataTransfer.getData('application/x-nebul-entity'), 10);
      if (!Number.isFinite(entId)) return;
      e.preventDefault();
      this._setEntityFolder(entId, null);
    });

    // Dismiss on outside-click / scroll / Escape.
    document.addEventListener('click', (e) => {
      if (!this._ctxMenuEl.classList.contains('open')) return;
      if (this._ctxMenuEl.contains(e.target)) return;
      this._closeCtxMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this._ctxMenuEl.classList.contains('open')) {
        this._closeCtxMenu();
      }
    });
    window.addEventListener('blur',   () => this._closeCtxMenu());
    window.addEventListener('resize', () => this._closeCtxMenu());
  }

  /** Build the menu shown on empty hierarchy space. */
  _emptyMenuItems () {
    return [
      {
        label: 'New Object',
        submenu: [
          { label: 'Star',           action: () => this.engine.spawnEntity('star') },
          { label: 'Circle',         action: () => this.engine.spawnEntity('circle') },
          { label: 'Square',         action: () => this.engine.spawnEntity('square') },
          { label: 'Rounded Star',   action: () => this.engine.spawnEntity('rstar') },
          { label: 'Rounded Square', action: () => this.engine.spawnEntity('rsquare') },
        ],
      },
      {
        label: 'New Folder',
        action: () => this._createFolder('New Folder'),
      },
    ];
  }

  /** Build the menu shown when right-clicking a specific entity. */
  _entityMenuItems (entityId) {
    const entity = this.engine.scene.getEntity(entityId);
    if (!entity) return [];
    const ph = entity.getComponent('physics');
    const pinned = !!ph?.pinned;

    const folderList = [...this._folders.values()].sort((a, b) => a.id - b.id);
    const setParentItems = [
      {
        label: '(Root)',
        action: () => this._setEntityFolder(entityId, null),
      },
      ...folderList.map(f => ({
        label: f.name,
        action: () => this._setEntityFolder(entityId, f.id),
      })),
    ];

    return [
      {
        label: 'Remove',
        action: () => {
          this.engine.scene.removeEntity(entityId);
          this.logger.warn('Removed entity: ' + entity.name);
        },
      },
      {
        label: 'Gravity',
        submenu: [
          {
            label: pinned ? 'Pin ✓' : 'Pin',
            action: () => {
              if (!ph?.body) return;
              ph.pinned = !pinned;
              Matter.Body.setStatic(ph.body, ph.pinned);
              if (ph.pinned) {
                Matter.Body.setVelocity(ph.body, { x: 0, y: 0 });
                Matter.Body.setAngularVelocity(ph.body, 0);
              }
              this.events.emit('ui:inspectorDirty', entityId);
              this.logger.info(`${ph.pinned ? 'Pinned' : 'Unpinned'}: ${entity.name}`);
            },
          },
        ],
      },
      {
        label: 'Set Parent',
        submenu: setParentItems,
      },
    ];
  }

  /** Build the menu shown when right-clicking a folder header. */
  _folderMenuItems (folderId) {
    const folder = this._folders.get(folderId);
    if (!folder) return [];
    return [
      {
        label: 'Rename',
        action: () => {
          // Schedule so the menu-close listeners finish before we mount the input.
          setTimeout(() => {
            const nameEl = this._hierarchyEl.querySelector(
              `.hierarchy-folder[data-folder-id="${folderId}"] .folder-name`,
            );
            if (nameEl) this._beginFolderRename(folder, nameEl);
          }, 0);
        },
      },
      {
        label: 'Remove Folder',
        action: () => this._removeFolder(folderId),
      },
    ];
  }

  _openCtxMenu (x, y, items) {
    const m = this._ctxMenuEl;
    if (!m) return;
    m.innerHTML = '';
    m.appendChild(this._buildCtxItems(items));

    // Open first so we can measure it, then clamp to viewport bounds.
    m.classList.add('open');
    m.setAttribute('aria-hidden', 'false');
    const rect = m.getBoundingClientRect();
    const maxX = window.innerWidth  - rect.width  - 4;
    const maxY = window.innerHeight - rect.height - 4;
    m.style.left = Math.min(x, Math.max(0, maxX)) + 'px';
    m.style.top  = Math.min(y, Math.max(0, maxY)) + 'px';
  }

  _closeCtxMenu () {
    const m = this._ctxMenuEl;
    if (!m) return;
    m.classList.remove('open');
    m.setAttribute('aria-hidden', 'true');
    m.innerHTML = '';
  }

  /**
   * Recursively render a list of ctx-menu items. Items may have either an
   * `action` (leaf) or a `submenu` (nested list). Clicking an action closes
   * the menu and invokes the handler. Hovering a submenu item expands it
   * inline (CSS `:hover` + absolutely-positioned child).
   */
  _buildCtxItems (items) {
    const list = document.createElement('ul');
    list.className = 'ctx-list';
    for (const it of items) {
      const li = document.createElement('li');
      li.className = 'ctx-item';
      if (it.submenu) li.classList.add('has-submenu');

      const label = document.createElement('span');
      label.className = 'ctx-label';
      label.textContent = it.label;
      li.appendChild(label);

      if (it.submenu) {
        const chev = document.createElement('span');
        chev.className = 'ctx-chev';
        chev.textContent = '▸';
        li.appendChild(chev);

        const sub = this._buildCtxItems(it.submenu);
        sub.classList.add('ctx-submenu');
        li.appendChild(sub);
      } else if (typeof it.action === 'function') {
        li.addEventListener('click', (e) => {
          e.stopPropagation();
          this._closeCtxMenu();
          try { it.action(); }
          catch (err) { this.logger.error('Menu action failed: ' + err.message); }
        });
      }

      list.appendChild(li);
    }
    return list;
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
    this._scriptListEl    = document.getElementById('script-list');
    this._workspaceSelEl  = document.getElementById('workspace-selected-entity');
    this._workspaceStatus = document.getElementById('workspace-status');

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

    // F2 — rename the currently active script. Ignored while typing in any
    // other input / textarea / contenteditable.
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'F2' || !this._activeScript) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      const item = this._scriptListEl?.querySelector(
        `.script-item[data-script-name="${CSS.escape(this._activeScript)}"]`);
      if (item?._startRename) { e.preventDefault(); item._startRename(); }
    });

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
    // ph.rotate(speed, dt)         — spin using physics angular velocity
    // ph.setRotationSpeed(rad/s)   — set a continuous spin once
    // Matter.Body.setVelocity(ph.body, {x, y}) — set velocity
    // ph.applyForce(fx, fy, dt)    — push the body
    // ph.enabled = false           — freeze physics
    // ph.pinned = true             — lock the body in place (total motion lock)
    // ph.gravity.enabled = false   — ignore world + local gravity
    // ph.gravity.force   = 5       — extra per-entity gravity force
    // this.world.settings.gravity.strength = 2  — change world gravity
    if (this.ph) this.ph.rotate(2, dt);
  }
})`;
    this._scripts.set('Default Script', template);
    this._activeScript = 'Default Script';
    this._updateScriptList();
  }

  _updateWorkspaceSelection (id) {
    if (this._workspaceSelEl) {
      const entity = this.engine.scene.getEntity(id);
      this._workspaceSelEl.textContent = entity ? `${entity.name} (#${entity.id})` : 'None';
    }
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

      // Helper to open the script in a draggable in-page window.
      const openScriptEditor = () => this._openFloatingScriptEditor(name);

      // Double-click opens the floating script window. We do this via manual
      // click-timestamp detection on the `click` event rather than the native
      // `dblclick` event, because Firefox swallows `dblclick` on elements with
      // `draggable="true"` (the script card needs to be draggable so it can be
      // dropped onto an entity in the Inspector). Tracking the timestamp on
      // the UIBridge instance keeps it alive across `_updateScriptList()`
      // rebuilds, which destroy and recreate these DOM nodes on every click.
      item.addEventListener('dblclick', (e) => {
        // Still handle the native event in Chromium for immediate feedback.
        e.stopPropagation();
        openScriptEditor();
      });

      // Rename: use the keyboard (F2 / Enter) while the script is selected,
      // or the right-click context menu — double-click is reserved for
      // opening the script window (matches Unity / Godot / VS Code).
      const startRename = () => {
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
            // Re-key the open floating window under the new name, if any.
            const openWin = this._floatingEditors.get(name);
            if (openWin) {
              this._floatingEditors.delete(name);
              this._floatingEditors.set(newName, openWin);
              openWin.dataset.scriptName = newName;
              const titleEl = openWin.querySelector('.fw-title');
              if (titleEl) titleEl.textContent = '📄 ' + newName;
            }
            this._updateScriptList();
            this.logger.info('Script renamed: ' + name + ' → ' + newName);
          } else {
            this._updateScriptList();
          }
        };

        input.addEventListener('blur', finishRename);
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter')  { ev.preventDefault(); finishRename(); }
          if (ev.key === 'Escape') { ev.preventDefault(); this._updateScriptList(); }
        });
      };
      item._startRename = startRename;

      // Right-click → rename.
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this._activeScript = name;
        startRename();
      });

      item.addEventListener('dragstart', (e) => {
        this._draggedScriptName = name;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'copy';
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
      });
      item.addEventListener('click', () => {
        const now = Date.now();
        const DOUBLE_CLICK_MS = 400;
        const isDouble =
          this._lastScriptClickName === name &&
          (now - (this._lastScriptClickTime || 0)) < DOUBLE_CLICK_MS;
        // Reset on match so a triple-click doesn't immediately re-open.
        this._lastScriptClickName = isDouble ? null : name;
        this._lastScriptClickTime = isDouble ? 0 : now;

        this._activeScript = name;
        this._updateScriptList();

        if (isDouble) openScriptEditor();
      });

      this._scriptListEl.appendChild(item);
    }
  }

  // ── Floating Script Editor ────────────────────────────────
  /**
   * Open (or focus) a draggable/resizable/fullscreen/minimize/close window
   * containing the source of the named script. Edits inside the window are
   * mirrored back into `this._scripts` live, so closing the window doesn't
   * lose work.
   */
  _openFloatingScriptEditor (name) {
    if (!this._scripts.has(name)) {
      this.logger.warn('Script not found: ' + name);
      return;
    }

    // If already open, just bring it to front / un-minimize.
    const existing = this._floatingEditors.get(name);
    if (existing) {
      existing.style.display = 'flex';
      existing.classList.remove('minimized');
      existing.style.zIndex = ++this._floatingZ;
      existing.querySelector('textarea')?.focus();
      return;
    }

    const layer = document.getElementById('script-windows-layer') || document.body;
    const win = document.createElement('div');
    win.className = 'floating-window script-editor-window';
    win.dataset.scriptName = name;
    win.style.zIndex = ++this._floatingZ;

    // Initial geometry — cascade new windows so stacked opens don't overlap.
    const offset = this._floatingEditors.size * 24;
    win.style.left   = (80 + offset) + 'px';
    win.style.top    = (80 + offset) + 'px';
    win.style.width  = '560px';
    win.style.height = '420px';

    win.innerHTML = `
      <div class="fw-header">
        <span class="fw-title">📄 ${this._esc(name)}</span>
        <div class="fw-actions">
          <button class="fw-btn fw-min"  title="Minimize">—</button>
          <button class="fw-btn fw-full" title="Toggle fullscreen">⛶</button>
          <button class="fw-btn fw-close" title="Close">✕</button>
        </div>
      </div>
      <textarea class="fw-textarea" spellcheck="false"></textarea>
      <div class="fw-resize" title="Drag to resize"></div>
    `;

    const ta = win.querySelector('textarea');
    ta.value = this._scripts.get(name);
    // All handlers read the *current* name from `win.dataset.scriptName` rather
    // than the parameter captured at creation time, so a rename while the
    // window is open doesn't leave these closures writing to a ghost key.
    ta.addEventListener('input', () => {
      const curName = win.dataset.scriptName;
      this._scripts.set(curName, ta.value);
    });

    // Focus-to-front
    win.addEventListener('pointerdown', () => {
      win.style.zIndex = ++this._floatingZ;
    });

    // Drag from header
    const header = win.querySelector('.fw-header');
    header.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.fw-btn')) return;
      if (win.classList.contains('fullscreen')) return;
      const startX = e.clientX, startY = e.clientY;
      const startL = win.offsetLeft, startT = win.offsetTop;
      const onMove = (ev) => {
        win.style.left = (startL + ev.clientX - startX) + 'px';
        win.style.top  = Math.max(0, startT + ev.clientY - startY) + 'px';
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup',   onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup',   onUp);
      e.preventDefault();
    });

    // Resize from bottom-right grip
    const grip = win.querySelector('.fw-resize');
    grip.addEventListener('pointerdown', (e) => {
      if (win.classList.contains('fullscreen')) return;
      const startX = e.clientX, startY = e.clientY;
      const startW = win.offsetWidth, startH = win.offsetHeight;
      const onMove = (ev) => {
        win.style.width  = Math.max(260, startW + ev.clientX - startX) + 'px';
        win.style.height = Math.max(160, startH + ev.clientY - startY) + 'px';
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup',   onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup',   onUp);
      e.stopPropagation();
      e.preventDefault();
    });

    // Buttons
    win.querySelector('.fw-close').addEventListener('click', () => {
      const curName = win.dataset.scriptName;
      win.remove();
      this._floatingEditors.delete(curName);
      this.logger.info('Closed script window: ' + curName);
    });
    win.querySelector('.fw-min').addEventListener('click', () => {
      win.classList.toggle('minimized');
    });
    win.querySelector('.fw-full').addEventListener('click', () => {
      win.classList.toggle('fullscreen');
    });

    // Double-click header to toggle fullscreen (familiar desktop behavior).
    header.addEventListener('dblclick', (e) => {
      if (e.target.closest('.fw-btn')) return;
      win.classList.toggle('fullscreen');
    });

    layer.appendChild(win);
    this._floatingEditors.set(name, win);
    ta.focus();
    this.logger.info('Opened script window: ' + name);
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
    if (!this._selected) return;
    // Don't destroy the DOM while the user is actively editing a field —
    // just push live values into read-only rows.
    const focused = this._inspectorEl?.contains(document.activeElement);
    if (focused) { this._syncInspectorLiveValues(this._selected); return; }
    this._renderInspector(this._selected);
  }

  /** Update read-only numeric rows without rebuilding the DOM. */
  _syncInspectorLiveValues (id) {
    const entity = this.engine.scene.getEntity(id);
    if (!entity) return;
    const ph = entity.getComponent('physics');
    if (!ph) return;
    const set = (sel, v) => {
      const el = this._inspectorEl.querySelector(sel);
      if (el) el.textContent = v;
    };
    const velX = ph.body?.velocity?.x ?? 0;
    const velY = ph.body?.velocity?.y ?? 0;
    set('[data-live="velX"]',  Number.isFinite(velX) ? velX.toFixed(1) : 'n/a');
    set('[data-live="velY"]',  Number.isFinite(velY) ? velY.toFixed(1) : 'n/a');
    set('[data-live="speed"]', Number.isFinite(ph.speed()) ? ph.speed().toFixed(1) : 'n/a');
    set('[data-live="mass"]',  ph.body?.mass?.toFixed ? ph.body.mass.toFixed(2) : (ph.body?.mass ?? 'n/a'));
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
    const gravObj  = ph && ph.gravity && typeof ph.gravity === 'object'
      ? ph.gravity
      : { enabled: true, force: (typeof ph?.gravity === 'number' ? ph.gravity : 0) };
    const gravEn   = gravObj.enabled !== false;
    const gravForce = Number.isFinite(gravObj.force) ? gravObj.force : 0;
    const pinned = ph ? !!ph.pinned                 : false;
    const phEn   = ph ? ph.enabled                  : false;

    const rotDeg = spr && Number.isFinite(spr.rotation) ? (spr.rotation * 180 / Math.PI).toFixed(1) : '0';

    this._inspectorEl.innerHTML = `
      <div class="insp-section">
        <div class="insp-section-title">IDENTITY</div>
        <div class="insp-row"><span class="insp-label">Name</span>
          <input class="insp-input" data-field="name" value="${this._esc(entity.name)}" />
        </div>
        <div class="insp-row"><span class="insp-label">ID</span><span class="insp-value">#${entity.id}</span></div>
        <div class="insp-row"><span class="insp-label">Active</span><span class="insp-value" style="color:var(--green)">${entity.active}</span></div>
        <div class="insp-row"><span class="insp-label">Tags</span>
          <span class="insp-value">${[...entity.tags].map(t => `<span class="insp-tag">${t}</span>`).join('')}</span>
        </div>
      </div>

      ${spr ? `
      <div class="insp-section">
        <div class="insp-section-title">TRANSFORM</div>
        <div class="insp-row"><span class="insp-label">X</span>
          <input class="insp-input insp-num" data-field="x" type="number" step="1" value="${xValue}" />
        </div>
        <div class="insp-row"><span class="insp-label">Y</span>
          <input class="insp-input insp-num" data-field="y" type="number" step="1" value="${yValue}" />
        </div>
        <div class="insp-row"><span class="insp-label">Rotation°</span>
          <input class="insp-input insp-num" data-field="rotation" type="number" step="1" value="${rotDeg}" />
        </div>
        <div class="insp-row"><span class="insp-label">Shape</span><span class="insp-value">${spr.shape}</span></div>
        <div class="insp-row"><span class="insp-label">Color</span>
          <input class="insp-color" data-field="color" type="color" value="${colorHex}" />
        </div>
        <div class="insp-row"><span class="insp-label">Alpha</span>
          <input class="insp-input insp-num" data-field="alpha" type="number" step="0.05" min="0" max="1" value="${alphaVal}" />
        </div>
      </div>` : ''}

      ${ph ? `
      <div class="insp-section">
        <div class="insp-section-title">PHYSICS
          <button class="insp-toggle-btn" id="insp-toggle-physics">${phEn ? '⏸ Disable' : '▶ Enable'}</button>
        </div>
        <div class="insp-row"><span class="insp-label">Enabled</span><span class="insp-value" style="color:${phEn ? 'var(--green)' : 'var(--red)'}">${phEn}</span></div>
        <div class="insp-row"><span class="insp-label">Pinned</span>
          <input class="insp-check" data-field="pinned" type="checkbox" ${pinned ? 'checked' : ''} title="Locks the body in place; zeroes velocity every frame" />
        </div>
        <div class="insp-row"><span class="insp-label">Vel X</span><span class="insp-value" data-live="velX">${Number.isFinite(velX) ? velX.toFixed(1) : 'n/a'}</span></div>
        <div class="insp-row"><span class="insp-label">Vel Y</span><span class="insp-value" data-live="velY">${Number.isFinite(velY) ? velY.toFixed(1) : 'n/a'}</span></div>
        <div class="insp-row"><span class="insp-label">Speed</span><span class="insp-value" data-live="speed">${Number.isFinite(spd) ? spd.toFixed(1) : 'n/a'}</span></div>
        <div class="insp-row"><span class="insp-label">Mass</span><span class="insp-value" data-live="mass">${typeof mass === 'number' ? mass.toFixed(2) : mass}</span></div>
        <div class="insp-row"><span class="insp-label">Drag</span>
          <input class="insp-input insp-num" data-field="frictionAir" type="number" step="0.005" min="0" max="1" value="${drag}" />
        </div>
        <div class="insp-row"><span class="insp-label">Bounce</span>
          <input class="insp-input insp-num" data-field="restitution" type="number" step="0.05" min="0" max="2" value="${ph.restitution.toFixed(2)}" />
        </div>
        <div class="insp-row"><span class="insp-label">Gravity</span>
          <input class="insp-check" data-field="gravityEnabled" type="checkbox" ${gravEn ? 'checked' : ''} title="When off, entity ignores both world and local gravity" />
        </div>
        <div class="insp-row"><span class="insp-label">⤷ Force</span>
          <input class="insp-input insp-num" data-field="gravityForce" type="number" step="10" value="${gravForce}" ${gravEn ? '' : 'disabled'} />
        </div>
      </div>` : ''}

      ${sc ? `
      <div class="insp-section">
        <div class="insp-section-title">SCRIPT</div>
        <div class="insp-row"><span class="insp-label">Started</span><span class="insp-value" style="color:${sc._started ? 'var(--green)' : 'var(--text-muted)'}">${sc._started}</span></div>
        <div class="insp-row"><span class="insp-label">Has onStart</span><span class="insp-value">${!!sc._script?.onStart}</span></div>
        <div class="insp-row"><span class="insp-label">Has onUpdate</span><span class="insp-value">${!!sc._script?.onUpdate}</span></div>
      </div>` : ''}

      <div class="insp-btn-row">
        <button class="insp-action-btn" id="insp-duplicate-btn" title="Duplicate (Ctrl+D)">⎘ DUPLICATE</button>
        <button class="insp-remove-btn" id="insp-remove-btn" title="Remove (Del)">⚠ REMOVE</button>
      </div>
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

    document.getElementById('insp-duplicate-btn')?.addEventListener('click', () => {
      this.engine._duplicateSelected();
    });

    // Hook up editable fields.
    this._inspectorEl.querySelectorAll('[data-field]').forEach(input => {
      input.addEventListener('change', () => this._applyInspectorField(id, input));
      if (input.tagName === 'INPUT' && input.type !== 'checkbox' && input.type !== 'color') {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter')  { input.blur(); }
          if (e.key === 'Escape') { this._renderInspector(id); }
        });
      }
    });
  }

  /** Write a value from an inspector input back to the entity. */
  _applyInspectorField (id, input) {
    const entity = this.engine.scene.getEntity(id);
    if (!entity) return;
    const spr = entity.getComponent('sprite');
    const ph  = entity.getComponent('physics');
    const field = input.dataset.field;
    const raw   = input.type === 'checkbox' ? input.checked : input.value;

    switch (field) {
      case 'name': {
        const name = String(raw).trim() || entity.name;
        entity.name = name;
        const nameEl = this._hierarchyEl.querySelector(`[data-id="${id}"] .ent-name`);
        if (nameEl) nameEl.textContent = name;
        this._updateWorkspaceSelection(id);
        break;
      }
      case 'x': case 'y': {
        if (!spr) break;
        const v = parseFloat(raw); if (!Number.isFinite(v)) break;
        const before = { [field]: spr[field] };
        spr[field] = v;
        if (ph?.body) {
          Matter.Body.setPosition(ph.body, { x: spr.x, y: spr.y });
          Matter.Body.setVelocity(ph.body, { x: 0, y: 0 });
        }
        spr.syncGraphics();
        this.engine._recordHistory({ kind: 'transform', id, from: before, to: { [field]: v } });
        break;
      }
      case 'rotation': {
        if (!spr) break;
        const v = parseFloat(raw); if (!Number.isFinite(v)) break;
        const before = { rotation: spr.rotation };
        spr.rotation = v * Math.PI / 180;
        if (ph?.body) Matter.Body.setAngle(ph.body, spr.rotation);
        spr.syncGraphics();
        this.engine._recordHistory({ kind: 'transform', id, from: before, to: { rotation: spr.rotation } });
        break;
      }
      case 'alpha': {
        if (!spr) break;
        const v = Math.max(0, Math.min(1, parseFloat(raw)));
        if (!Number.isFinite(v)) break;
        spr.setAlpha(v);
        break;
      }
      case 'color': {
        if (!spr) break;
        const hex = String(raw).replace('#', '');
        const num = parseInt(hex, 16);
        if (!Number.isNaN(num)) {
          spr.setColor(num);
          const icon = this._hierarchyEl.querySelector(`[data-id="${id}"] .ent-icon`);
          if (icon) icon.style.color = '#' + hex.padStart(6, '0');
        }
        break;
      }
      case 'pinned':
      // Legacy save/load fields (anchored / fixed) still accepted — both
      // forward to the unified `pinned` flag.
      case 'anchored':
      case 'fixed': {
        if (!ph?.body) break;
        ph.pinned = !!raw;
        if (ph.body.isStatic !== ph.pinned) Matter.Body.setStatic(ph.body, ph.pinned);
        if (ph.pinned) {
          Matter.Body.setVelocity(ph.body, { x: 0, y: 0 });
          Matter.Body.setAngularVelocity(ph.body, 0);
        }
        break;
      }
      case 'frictionAir': case 'restitution': {
        if (!ph?.body) break;
        const v = parseFloat(raw); if (!Number.isFinite(v)) break;
        ph[field] = v;
        ph.body[field] = v;
        break;
      }
      case 'gravityEnabled': {
        if (!ph) break;
        if (typeof ph.gravity !== 'object' || ph.gravity === null) {
          ph.gravity = { enabled: true, force: typeof ph.gravity === 'number' ? ph.gravity : 0 };
        }
        ph.gravity.enabled = !!raw;
        if (ph.body) ph.body.gravityScale = ph.gravity.enabled ? 1 : 0;
        // Re-render so the Force input's disabled state updates.
        this._renderInspector(id);
        break;
      }
      case 'gravityForce': {
        if (!ph) break;
        const v = parseFloat(raw); if (!Number.isFinite(v)) break;
        if (typeof ph.gravity !== 'object' || ph.gravity === null) {
          ph.gravity = { enabled: true, force: 0 };
        }
        ph.gravity.force = v;
        break;
      }
    }
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
      case 'rect':
      case 'rsquare': return '▢';
      case 'square':  return '■';
      case 'diamond': return '◆';
      case 'star':    return '★';
      case 'rstar':   return '✦';
      default:        return '●';
    }
  }
}