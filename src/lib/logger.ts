// Logger utility to handle application logging with different levels based on environment
import { createLogger, format, transports } from 'winston';
import 'winston-daily-rotate-file';
import * as fs from 'fs';
import * as path from 'path';
import config from './config';

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Ensure log directory exists if logging to files is enabled
if (config.LOG_TO_FILE && !fs.existsSync(config.LOG_DIR)) {
  fs.mkdirSync(config.LOG_DIR, { recursive: true });
}

// Get appropriate log level from config
const level = () => {
  return config.LOG_LEVEL;
};

// Define production log format - more concise and structured
const productionLogFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'label'] }),
  format.printf((info) => {
    // Base log entry format
    let logEntry = `${info.timestamp} ${info.level}`;
    
    // Add category if available
    if ((info.metadata as any).category) {
      logEntry += ` [${(info.metadata as any).category}]`;
    }
    
    // Add request ID if available
    if ((info.metadata as any).requestId) {
      logEntry += ` [req:${(info.metadata as any).requestId}]`;
    }
    
    // Add IP address if available
    if ((info.metadata as any).ip) {
      logEntry += ` [ip:${(info.metadata as any).ip}]`;
    }
    
    // Add message
    logEntry += `: ${info.message}`;
    
    // Add metadata, but filter out already-used properties
    const metadataToLog = { ...(info.metadata as any) };
    delete metadataToLog.category;
    delete metadataToLog.requestId;
    delete metadataToLog.ip;
    
    if (Object.keys(metadataToLog).length > 0) {
      logEntry += ` ${JSON.stringify(metadataToLog)}`;
    }
    
    return logEntry;
  })
);

// Define development log format - more detailed
const developmentLogFormat = format.combine(
  format.colorize(),
  format.timestamp({ format: 'HH:mm:ss' }),
  format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'label'] }),
  format.printf((info) => {
    return `${info.timestamp} ${info.level} ${(info.metadata as any).category ? `[${(info.metadata as any).category}]` : ''}${(info.metadata as any).requestId ? ` [req:${(info.metadata as any).requestId}]` : ''}${(info.metadata as any).ip ? ` [ip:${(info.metadata as any).ip}]` : ''}: ${info.message} ${(Object.keys(info.metadata as any).length > 0 ? JSON.stringify(info.metadata as any) : '')}`;
  })
);

// Choose log format based on environment
const logFormat = config.NODE_ENV === 'production' ? productionLogFormat : developmentLogFormat;

// Create the logger with appropriate transports based on config
const transportsList: Array<any> = [new transports.Console()];

// Add file transports if enabled
if (config.LOG_TO_FILE) {
  // Configure error log rotation
  const errorRotateTransport = new (transports as any).DailyRotateFile({
    filename: path.join(config.LOG_DIR, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    level: 'error',
    maxSize: config.LOG_ROTATE_MAX_SIZE,
    maxFiles: config.LOG_ROTATE_MAX_FILES,
    zippedArchive: true,
    format: format.combine(
      format.timestamp(),
      format.json()
    )
  });

  // Configure combined log rotation
  const combinedRotateTransport = new (transports as any).DailyRotateFile({
    filename: path.join(config.LOG_DIR, 'combined-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: config.LOG_ROTATE_MAX_SIZE,
    maxFiles: config.LOG_ROTATE_MAX_FILES,
    zippedArchive: true,
    format: format.combine(
      format.timestamp(),
      format.json()
    )
  });

  // Add error handling for the rotate transports
  errorRotateTransport.on('rotate', (oldFilename: string, newFilename: string) => {
    logger?.info('Rotating error log file', { oldFilename, newFilename });
  });

  combinedRotateTransport.on('rotate', (oldFilename: string, newFilename: string) => {
    logger?.info('Rotating combined log file', { oldFilename, newFilename });
  });

  transportsList.push(errorRotateTransport, combinedRotateTransport);
}

// Create the logger
const logger = createLogger({
  level: level(),
  levels,
  format: logFormat,
  transports: transportsList,
});

// Add IP logging capability
/**
 * Enhanced log function with IP address, request ID, and category tracking.
 * In production, reducing verbosity by limiting what gets logged.
 * 
 * @param level - Log level (error, warn, info, http, debug)
 * @param message - Log message
 * @param ip - IP address (optional)
 * @param metadata - Additional fields (requestId, category, etc)
 */
export const logWithIP = (level: string, message: string, ip?: string, metadata: Record<string, any> = {}) => {
  // Skip http logs in production unless explicitly configured
  if (config.NODE_ENV === 'production' && level === 'http' && config.LOG_LEVEL !== 'http' && config.LOG_LEVEL !== 'debug') {
    return;
  }
  
  const logData = { ...metadata };
  
  // Add IP address if provided
  if (ip) {
    // Sanitize IP address (remove ports, etc.)
    const sanitizedIp = ip.toString().split(':')[0].split(',')[0].trim();
    logData.ip = sanitizedIp;
  }
  
  // Add category and request ID if available
  if (metadata.category) {
    logData.category = metadata.category;
  }
  if (metadata.requestId) {
    logData.requestId = metadata.requestId;
  }
  
  // Remove sensitive data
  const sensitiveFields = ['password', 'token', 'secret', 'key', 'credential', 'authorization'];
  for (const field of sensitiveFields) {
    if (field in logData) {
      delete logData[field];
    }
  }
  
  // Log at the appropriate level
  switch (level) {
    case 'error':
      logger.error(message, logData);
      break;
    case 'warn':
      logger.warn(message, logData);
      break;
    case 'info':
      logger.info(message, logData);
      break;
    case 'http':
      logger.http(message, logData);
      break;
    case 'debug':
      logger.debug(message, logData);
      break;
    default:
      // Default to info level if an invalid level is provided
      logger.info(`[UNKNOWN_LEVEL:${level}] ${message}`, logData);
  }
};

export default logger;
