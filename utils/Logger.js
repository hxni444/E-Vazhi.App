import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppConfig } from '../config';
const LOG_FILE_PATH = FileSystem.documentDirectory + 'app.log';
const LAST_LOG_DATE_KEY = '@last_log_date';

class Logger {
  constructor() {
    this.originalConsoleLog = console.log;
    this.originalConsoleWarn = console.warn;
    this.originalConsoleError = console.error;
    
    this.logQueue = [];
    this.isWriting = false;
  }

  async init() {
    // Override global console methods
    console.log = (...args) => {
      this.originalConsoleLog.apply(console, args);
      this._queueLog('INFO', args);
    };

    console.warn = (...args) => {
      this.originalConsoleWarn.apply(console, args);
      this._queueLog('WARN', args);
    };

    console.error = (...args) => {
      this.originalConsoleError.apply(console, args);
      this._queueLog('ERROR', args);
    };

    await this._checkRollover();
  }

  _formatArgs(args) {
    return args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg);
        } catch (e) {
          return '[Circular or Unserializable Object]';
        }
      }
      return String(arg);
    }).join(' ');
  }

  _queueLog(level, args) {
    const timestamp = new Date().toISOString();
    const formattedArgs = this._formatArgs(args);
    const message = `[${timestamp}] [${level}] ${formattedArgs}\n`;
    this.logQueue.push({ timestamp, level, message: formattedArgs, rawStr: message });
    this._processQueue();
  }

  async _processQueue() {
    if (this.isWriting || this.logQueue.length === 0) return;
    this.isWriting = true;

    try {
      await this._checkRollover();

      const logsToProcess = this.logQueue.splice(0, this.logQueue.length);
      const messagesToWrite = logsToProcess.map(l => l.rawStr).join('');
      
      const fileInfo = await FileSystem.getInfoAsync(LOG_FILE_PATH);
      if (!fileInfo.exists) {
        await FileSystem.writeAsStringAsync(LOG_FILE_PATH, messagesToWrite);
      } else {
        const existingContent = await FileSystem.readAsStringAsync(LOG_FILE_PATH);
        // Keep logs from growing infinitely (e.g. max 1MB). If getting too large, we could truncate, but rollover should prevent this.
        await FileSystem.writeAsStringAsync(LOG_FILE_PATH, existingContent + messagesToWrite);
      }

      // Axiom Sync (Fire and forget background network request)
      if (AppConfig.AXIOM_API_TOKEN && AppConfig.AXIOM_DATASET) {
        try {
          const axiomPayload = logsToProcess.map(l => ({ _time: l.timestamp, level: l.level, message: l.message }));
          fetch(`https://api.axiom.co/v1/datasets/${AppConfig.AXIOM_DATASET}/ingest`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${AppConfig.AXIOM_API_TOKEN}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(axiomPayload)
          }).catch(e => {
            // Ignore background fetch errors to prevent loops
          });
        } catch (e) {}
      }
    } catch (e) {
      // Fallback to original console to prevent infinite loop
      this.originalConsoleError.call(console, 'Logger Error: Failed to write to file', e);
    } finally {
      this.isWriting = false;
      if (this.logQueue.length > 0) {
        this._processQueue();
      }
    }
  }

  async _checkRollover() {
    try {
      const today = new Date().toDateString();
      const lastLogDate = await AsyncStorage.getItem(LAST_LOG_DATE_KEY);

      if (lastLogDate !== today) {
        // It's a new day! Clear the log file.
        const fileInfo = await FileSystem.getInfoAsync(LOG_FILE_PATH);
        if (fileInfo.exists) {
          await FileSystem.deleteAsync(LOG_FILE_PATH, { idempotent: true });
        }
        await AsyncStorage.setItem(LAST_LOG_DATE_KEY, today);
        this._queueLog('INFO', ['--- New Day Log Rollover ---']);
      }
    } catch (e) {
      this.originalConsoleError.call(console, 'Logger Error: Failed rollover check', e);
    }
  }

  async clearLogs() {
    try {
      await FileSystem.deleteAsync(LOG_FILE_PATH, { idempotent: true });
      this._queueLog('INFO', ['--- Logs Cleared Manually ---']);
    } catch (e) {
      console.error('Failed to clear logs:', e);
    }
  }
}

export default new Logger();
