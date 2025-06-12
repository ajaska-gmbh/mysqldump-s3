// Mock AWS SDK before importing anything
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
  ListObjectsV2Command: jest.fn(),
  HeadObjectCommand: jest.fn()
}));

import { restoreCommand } from '../commands/restore';

// Mock dependencies
jest.mock('../modules/config');
jest.mock('../modules/mysql');
jest.mock('../modules/s3');
jest.mock('../modules/progress');
jest.mock('inquirer');
jest.mock('chalk', () => ({
  red: jest.fn((text) => text),
  green: jest.fn((text) => text),
  blue: jest.fn((text) => text),
  cyan: jest.fn((text) => text),
  gray: jest.fn((text) => text),
  yellow: jest.fn((text) => text),
  bold: jest.fn((text) => text)
}));
jest.mock('fs');
jest.mock('os');
jest.mock('path');

describe('Restore Command', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should export restoreCommand function', () => {
    expect(typeof restoreCommand).toBe('function');
  });

  it('should handle non-interactive restore successfully', async () => {
    const { ConfigManager } = require('../modules/config');
    const { MySQLManager } = require('../modules/mysql');
    const { S3Manager } = require('../modules/s3');
    const { progressTracker } = require('../modules/progress');

    const mockConfig = {
      database: { host: 'localhost', port: 3306, user: 'root', password: 'pass' },
      s3: { bucket: 'test-bucket', accessKeyId: 'key', secretAccessKey: 'secret' }
    };

    ConfigManager.getInstance = jest.fn().mockReturnValue({
      loadConfig: jest.fn().mockReturnValue(mockConfig)
    });

    MySQLManager.mockImplementation(() => ({
      testConnection: jest.fn().mockResolvedValue(undefined),
      databaseExists: jest.fn().mockResolvedValue(true),
      restoreBackup: jest.fn().mockResolvedValue(undefined)
    }));

    S3Manager.mockImplementation(() => ({
      backupExists: jest.fn().mockResolvedValue(true),
      downloadFile: jest.fn().mockResolvedValue(undefined)
    }));

    progressTracker.createProgressBar = jest.fn().mockReturnValue(jest.fn());
    progressTracker.stop = jest.fn();

    const fs = require('fs');
    fs.existsSync = jest.fn().mockReturnValue(true);
    fs.unlinkSync = jest.fn();

    const os = require('os');
    os.tmpdir = jest.fn().mockReturnValue('/tmp');

    const path = require('path');
    path.join = jest.fn().mockReturnValue('/tmp/restore-123.sql.gz');

    await restoreCommand({
      backup: 'test-backup.sql.gz',
      database: 'testdb',
      interactive: false,
      force: true
    });

    const chalk = require('chalk');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Restore completed successfully'));
  });

  it('should handle missing backup file', async () => {
    const { ConfigManager } = require('../modules/config');
    const { S3Manager } = require('../modules/s3');

    ConfigManager.getInstance = jest.fn().mockReturnValue({
      loadConfig: jest.fn().mockReturnValue({
        s3: { bucket: 'test-bucket', accessKeyId: 'key', secretAccessKey: 'secret' }
      })
    });

    S3Manager.mockImplementation(() => ({
      backupExists: jest.fn().mockResolvedValue(false)
    }));

    await restoreCommand({
      backup: 'nonexistent.sql.gz',
      database: 'testdb',
      interactive: false,
      force: true
    });

    expect(console.error).toHaveBeenCalledWith('✗ Backup not found: nonexistent.sql.gz');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should handle non-existent target database', async () => {
    const { ConfigManager } = require('../modules/config');
    const { MySQLManager } = require('../modules/mysql');
    const { S3Manager } = require('../modules/s3');

    ConfigManager.getInstance = jest.fn().mockReturnValue({
      loadConfig: jest.fn().mockReturnValue({
        database: { host: 'localhost', port: 3306, user: 'root', password: 'pass' },
        s3: { bucket: 'test-bucket', accessKeyId: 'key', secretAccessKey: 'secret' }
      })
    });

    MySQLManager.mockImplementation(() => ({
      testConnection: jest.fn().mockResolvedValue(undefined),
      databaseExists: jest.fn().mockResolvedValue(false)
    }));

    S3Manager.mockImplementation(() => ({
      backupExists: jest.fn().mockResolvedValue(true)
    }));

    await restoreCommand({
      backup: 'test-backup.sql.gz',
      database: 'nonexistent_db',
      interactive: false,
      force: true
    });

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Database does not exist'));
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should handle configuration errors', async () => {
    const { ConfigManager } = require('../modules/config');

    ConfigManager.getInstance = jest.fn().mockReturnValue({
      loadConfig: jest.fn().mockImplementation(() => {
        throw new Error('Configuration failed');
      })
    });

    await restoreCommand({
      backup: 'test-backup.sql.gz',
      database: 'testdb',
      interactive: false
    });

    expect(console.error).toHaveBeenCalledWith('✗ Restore failed:', 'Configuration failed');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should require backup and database for non-interactive mode', async () => {
    await restoreCommand({
      interactive: false
    });

    expect(console.error).toHaveBeenCalledWith('✗ Backup key is required in non-interactive mode');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should handle download errors', async () => {
    const { ConfigManager } = require('../modules/config');
    const { MySQLManager } = require('../modules/mysql');
    const { S3Manager } = require('../modules/s3');
    const { progressTracker } = require('../modules/progress');

    ConfigManager.getInstance = jest.fn().mockReturnValue({
      loadConfig: jest.fn().mockReturnValue({
        database: { host: 'localhost', port: 3306, user: 'root', password: 'pass' },
        s3: { bucket: 'test-bucket', accessKeyId: 'key', secretAccessKey: 'secret' }
      })
    });

    MySQLManager.mockImplementation(() => ({
      testConnection: jest.fn().mockResolvedValue(undefined),
      databaseExists: jest.fn().mockResolvedValue(true)
    }));

    S3Manager.mockImplementation(() => ({
      backupExists: jest.fn().mockResolvedValue(true),
      downloadFile: jest.fn().mockRejectedValue(new Error('Download failed'))
    }));

    progressTracker.createProgressBar = jest.fn().mockReturnValue(jest.fn());
    progressTracker.stop = jest.fn();

    const os = require('os');
    os.tmpdir = jest.fn().mockReturnValue('/tmp');

    const path = require('path');
    path.join = jest.fn().mockReturnValue('/tmp/restore-123.sql.gz');

    await restoreCommand({
      backup: 'test-backup.sql.gz',
      database: 'testdb',
      interactive: false,
      force: true
    });

    expect(console.error).toHaveBeenCalledWith('✗ Restore failed:', 'Download failed');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});