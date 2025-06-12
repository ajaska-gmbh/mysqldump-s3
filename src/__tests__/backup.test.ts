// Mock AWS SDK before importing anything
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
  ListObjectsV2Command: jest.fn(),
  HeadObjectCommand: jest.fn()
}));

import { backupCommand } from '../commands/backup';

// Mock dependencies
jest.mock('../modules/config');
jest.mock('../modules/mysql');
jest.mock('../modules/s3');
jest.mock('../modules/progress');
jest.mock('chalk', () => {
  const mockFn = jest.fn((text) => text);
  const mockGreen = Object.assign(jest.fn((text) => text), {
    bold: jest.fn((text) => text)
  });
  
  return {
    red: mockFn,
    green: mockGreen,
    blue: mockFn,
    cyan: mockFn,
    gray: mockFn,
    yellow: mockFn
  };
});
jest.mock('fs');
jest.mock('os');
jest.mock('path');

describe('Backup Command', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should export backupCommand function', () => {
    expect(typeof backupCommand).toBe('function');
  });

  it('should handle successful backup', async () => {
    const { ConfigManager } = require('../modules/config');
    const { MySQLManager } = require('../modules/mysql');
    const { S3Manager } = require('../modules/s3');
    const { progressTracker } = require('../modules/progress');

    const mockConfig = {
      database: { host: 'localhost', port: 3306, user: 'root', password: 'pass', database: 'testdb' },
      s3: { bucket: 'test-bucket', accessKeyId: 'key', secretAccessKey: 'secret' }
    };

    ConfigManager.getInstance = jest.fn().mockReturnValue({
      loadConfig: jest.fn().mockReturnValue(mockConfig),
      generateS3Key: jest.fn().mockReturnValue('test-backup.sql.gz')
    });

    MySQLManager.mockImplementation(() => ({
      testConnection: jest.fn().mockResolvedValue(undefined),
      createBackup: jest.fn().mockResolvedValue(undefined)
    }));

    S3Manager.mockImplementation(() => ({
      uploadFile: jest.fn().mockResolvedValue(undefined),
      formatFileSize: jest.fn().mockReturnValue('1.5 MB')
    }));

    progressTracker.createProgressBar = jest.fn().mockReturnValue(jest.fn());
    progressTracker.stop = jest.fn();

    const fs = require('fs');
    fs.existsSync = jest.fn().mockReturnValue(true);
    fs.statSync = jest.fn().mockReturnValue({ size: 1572864 });
    fs.unlinkSync = jest.fn();

    const os = require('os');
    os.tmpdir = jest.fn().mockReturnValue('/tmp');

    const path = require('path');
    path.join = jest.fn().mockReturnValue('/tmp/backup-123.sql.gz');

    await backupCommand({ verbose: true });

    // Check that the backup workflow completed (no process.exit called)
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('should handle configuration errors', async () => {
    const { ConfigManager } = require('../modules/config');

    ConfigManager.getInstance = jest.fn().mockReturnValue({
      loadConfig: jest.fn().mockImplementation(() => {
        throw new Error('Configuration failed');
      })
    });

    await backupCommand({});

    const chalk = require('chalk');
    expect(chalk.red).toHaveBeenCalledWith('✗ Backup failed:');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should handle MySQL connection errors', async () => {
    const { ConfigManager } = require('../modules/config');
    const { MySQLManager } = require('../modules/mysql');

    const mockConfig = {
      database: { host: 'localhost', port: 3306, user: 'root', password: 'pass' },
      s3: { bucket: 'test-bucket', accessKeyId: 'key', secretAccessKey: 'secret' }
    };

    ConfigManager.getInstance = jest.fn().mockReturnValue({
      loadConfig: jest.fn().mockReturnValue(mockConfig)
    });

    MySQLManager.mockImplementation(() => ({
      testConnection: jest.fn().mockRejectedValue(new Error('Connection failed'))
    }));

    await backupCommand({});

    expect(console.error).toHaveBeenCalledWith('✗ Backup failed:', 'Connection failed');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should handle S3 upload errors', async () => {
    const { ConfigManager } = require('../modules/config');
    const { MySQLManager } = require('../modules/mysql');
    const { S3Manager } = require('../modules/s3');
    const { progressTracker } = require('../modules/progress');

    const mockConfig = {
      database: { host: 'localhost', port: 3306, user: 'root', password: 'pass' },
      s3: { bucket: 'test-bucket', accessKeyId: 'key', secretAccessKey: 'secret' }
    };

    ConfigManager.getInstance = jest.fn().mockReturnValue({
      loadConfig: jest.fn().mockReturnValue(mockConfig),
      generateS3Key: jest.fn().mockReturnValue('test-backup.sql.gz')
    });

    MySQLManager.mockImplementation(() => ({
      testConnection: jest.fn().mockResolvedValue(undefined),
      createBackup: jest.fn().mockResolvedValue(undefined)
    }));

    S3Manager.mockImplementation(() => ({
      uploadFile: jest.fn().mockRejectedValue(new Error('Upload failed')),
      formatFileSize: jest.fn().mockReturnValue('1.5 MB')
    }));

    progressTracker.createProgressBar = jest.fn().mockReturnValue(jest.fn());
    progressTracker.stop = jest.fn();

    const fs = require('fs');
    fs.existsSync = jest.fn().mockReturnValue(true);
    fs.statSync = jest.fn().mockReturnValue({ size: 1572864 });
    fs.unlinkSync = jest.fn();

    const os = require('os');
    os.tmpdir = jest.fn().mockReturnValue('/tmp');

    const path = require('path');
    path.join = jest.fn().mockReturnValue('/tmp/backup-123.sql.gz');

    await backupCommand({});

    expect(console.error).toHaveBeenCalledWith('✗ Backup failed:', 'Upload failed');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});