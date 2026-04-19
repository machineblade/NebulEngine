// ============================================================
//  src/utils/Logger.js — Engine Console Logger
// ============================================================

export class Logger {
  constructor (events) {
    this.events  = events;
    this._outEl  = null;
    this._lines  = 0;
    this._maxLines = 200;

    window.addEventListener('DOMContentLoaded', () => {
      this._outEl = document.getElementById('console-output');
    });
  }

  _write (msg, type = 'log') {
    // Native console too
    console[type === 'error' ? 'error' : type === 'warn' ? 'warn' : 'log']('[NebulEngine] ' + msg);

    const el = this._outEl || document.getElementById('console-output');
    if (!el) return;

    // Prune old lines
    if (this._lines >= this._maxLines) {
      el.removeChild(el.firstChild);
    }

    const now     = new Date();
    const ts      = now.getHours().toString().padStart(2,'0') + ':' +
                    now.getMinutes().toString().padStart(2,'0') + ':' +
                    now.getSeconds().toString().padStart(2,'0');
    const prefix  = { info: '›', warn: '⚠', error: '✖', success: '✔' }[type] || '·';

    const line = document.createElement('div');
    line.className = 'log-line ' + type;
    line.innerHTML = `<span class="log-timestamp">${ts}</span><span class="log-prefix">${prefix}</span>${this._esc(msg)}`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
    this._lines++;

    this.events?.emit('logger:line', { msg, type, ts });
  }

  _esc (str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  log     (msg) { this._write(msg, 'log');     }
  info    (msg) { this._write(msg, 'info');    }
  warn    (msg) { this._write(msg, 'warn');    }
  error   (msg) { this._write(msg, 'error');   }
  success (msg) { this._write(msg, 'success'); }

  clear () {
    const el = this._outEl || document.getElementById('console-output');
    if (el) el.innerHTML = '';
    this._lines = 0;
  }
}