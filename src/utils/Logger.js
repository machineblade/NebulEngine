// ============================================================
//  src/utils/Logger.js — Engine Console Logger
// ============================================================

export class Logger {
  constructor (events) {
    this.events = events;
  }

  _write (msg, type = 'log') {
    // Native devtools console
    console[type === 'error' ? 'error' : type === 'warn' ? 'warn' : 'log']('[NebulEngine] ' + msg);

    // Everything else (timestamp, DOM write, filtering) is handled by the
    // UIBridge `logger:line` subscriber so there is a single writer.
    const now = new Date();
    const ts  = now.getHours()  .toString().padStart(2, '0') + ':' +
                now.getMinutes().toString().padStart(2, '0') + ':' +
                now.getSeconds().toString().padStart(2, '0');
    this.events?.emit('logger:line', { msg, type, ts });
  }

  log     (msg) { this._write(msg, 'log');     }
  info    (msg) { this._write(msg, 'info');    }
  warn    (msg) { this._write(msg, 'warn');    }
  error   (msg) { this._write(msg, 'error');   }
  success (msg) { this._write(msg, 'success'); }

  clear () {
    const el = document.getElementById('console-output');
    if (el) el.innerHTML = '';
  }
}