/**
 * Configuration management for the Startup Manager
 * Provides type-safe access to environment variables with defaults
 * 
 * For production deployment, set these in a .env file or environment variables
 * Required production variables:
 *   - ADMIN_USERNAME/ADMIN_PASSWORD: Change from defaults
 *   - ALLOWED_ORIGINS: Set to your domain in production
 */

interface Config {
  // Server configuration
  PORT: number;
  HOST: string;
  NODE_ENV: 'development' | 'production' | 'test';

  // Security configuration
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD: string;
  ALLOWED_ORIGINS: string[];
  RATE_LIMIT_WINDOW_MINUTES: number;
  RATE_LIMIT_MAX_REQUESTS: number;

  // Logging configuration
  LOG_LEVEL: 'error' | 'warn' | 'info' | 'http' | 'debug';
  LOG_TO_FILE: boolean;
  LOG_DIR: string;
  LOG_ROTATE_MAX_SIZE: string; // e.g., '10m'
  LOG_ROTATE_MAX_FILES: string; // e.g., '7d'

  // Program configuration
  CONFIG_PATH: string;
}

/**
 * Get configuration from environment variables with sensible defaults
 */
export const getConfig = (): Config => {
  // Load .env file if available
  try {
    require('dotenv').config();
  } catch (error) {
    // Silently continue if dotenv is not available
  }

  // Helper function to parse comma-separated string to array
  const parseArray = (str: string | undefined, defaultVal: string[]): string[] => {
    if (!str) return defaultVal;
    return str.split(',').map(item => item.trim()).filter(Boolean);
  };

  // Get config from environment variables with defaults
  return {
    // Server
    PORT: parseInt(process.env.PORT || '3000', 10),
    HOST: process.env.HOST || 'localhost',
    NODE_ENV: (process.env.NODE_ENV as Config['NODE_ENV']) || 'development',

    // Security
    ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'password',
    ALLOWED_ORIGINS: parseArray(process.env.ALLOWED_ORIGINS, ['http://localhost:3000']),
    RATE_LIMIT_WINDOW_MINUTES: parseInt(process.env.RATE_LIMIT_WINDOW_MINUTES || '15', 10), // 15 minutes
    RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '5', 10),

    // Logging
    LOG_LEVEL: (process.env.LOG_LEVEL as Config['LOG_LEVEL']) || 'info',
    LOG_TO_FILE: process.env.LOG_TO_FILE === 'true',
    LOG_DIR: process.env.LOG_DIR || 'logs',
    LOG_ROTATE_MAX_SIZE: process.env.LOG_ROTATE_MAX_SIZE || '10m',
    LOG_ROTATE_MAX_FILES: process.env.LOG_ROTATE_MAX_FILES || '7d',

    // Program
    CONFIG_PATH: process.env.CONFIG_PATH || require('path').join(require('os').homedir(), '.startup-manager', 'programs.json'),

  };

};

// Export a singleton instance for easy access throughout the application
export const config = getConfig();

export default config;
