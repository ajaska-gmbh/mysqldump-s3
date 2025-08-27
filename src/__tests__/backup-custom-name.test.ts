import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import { backupCommand } from '../commands/backup';
import { ConfigManager } from '../modules/config';
import { MySQLManager } from '../modules/mysql';
import { S3Manager } from '../modules/s3';

// Mock dependencies
jest.mock('../modules/mysql');
jest.mock('../modules/s3');
jest.mock('../modules/progress', () => ({
  progressTracker: {
    createStreamProgressBar: jest.fn(() => jest.fn()),
    createProgressBar: jest.fn(() => jest.fn()),
    stop: jest.fn()
  }
}));

// Mock fs module
jest.mock('fs', () => {
  const originalModule = jest.requireActual('fs') as any;
  return {
    ...originalModule,
    statSync: jest.fn(),
    existsSync: jest.fn(),
    unlinkSync: jest.fn(),
    writeFileSync: jest.fn()
  };
});

// Mock chalk
jest.mock('chalk', () => {
  const mockChalk = {
    blue: jest.fn((str: string) => str),
    green: jest.fn((str: string) => str),
    gray: jest.fn((str: string) => str),
    red: jest.fn((str: string) => str),
    cyan: jest.fn((str: string) => str),
    bold: {
      green: jest.fn((str: string) => str)
    }
  };
  return {
    default: mockChalk,
    ...mockChalk
  };
});

describe('Backup Command - Custom Name', () => {
  let mockMySQLManager: jest.Mocked<MySQLManager>;
  let mockS3Manager: jest.Mocked<S3Manager>;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock console methods
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    
    // Reset ConfigManager singleton
    ConfigManager.getInstance().reset();
    
    // Set up environment variables
    process.env.DB_HOST = 'localhost';
    process.env.DB_USER = 'testuser';
    process.env.DB_PASSWORD = 'testpass';
    process.env.DB_NAME = 'testdb';
    process.env.S3_ACCESS_KEY_ID = 'test-key';
    process.env.S3_SECRET_ACCESS_KEY = 'test-secret';
    process.env.S3_BUCKET = 'test-bucket';
    
    // Mock MySQLManager
    mockMySQLManager = new MySQLManager({} as any) as jest.Mocked<MySQLManager>;
    mockMySQLManager.testConnection = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    mockMySQLManager.createBackup = jest.fn<(outputPath: string, progressCallback?: any) => Promise<void>>()
      .mockImplementation(async () => {
        // Mock implementation
      });
    (MySQLManager as jest.MockedClass<typeof MySQLManager>).mockImplementation(() => mockMySQLManager);
    
    // Mock S3Manager
    mockS3Manager = new S3Manager({} as any) as jest.Mocked<S3Manager>;
    mockS3Manager.formatFileSize = jest.fn<(bytes: number) => string>().mockReturnValue('1.5 MB');
    mockS3Manager.uploadFile = jest.fn<(filePath: string, key: string, progressCallback?: any) => Promise<void>>()
      .mockResolvedValue(undefined);
    (S3Manager as jest.MockedClass<typeof S3Manager>).mockImplementation(() => mockS3Manager);
    
    // Setup fs mocks
    (fs.statSync as jest.Mock).mockReturnValue({ size: 1572864 });
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.unlinkSync as jest.Mock).mockImplementation(() => {});
    (fs.writeFileSync as jest.Mock).mockImplementation(() => {});
  });

  afterEach(() => {
    // Clean up environment variables
    delete process.env.DB_HOST;
    delete process.env.DB_USER;
    delete process.env.DB_PASSWORD;
    delete process.env.DB_NAME;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    delete process.env.S3_BUCKET;
    
    // Restore mocks
    jest.restoreAllMocks();
  });

  it('should use custom backup name when provided via CLI option', async () => {
    const customName = 'my-custom-backup';
    
    await backupCommand({
      name: customName,
      verbose: false
    });
    
    // Verify the S3 upload was called with the custom name
    expect(mockS3Manager.uploadFile).toHaveBeenCalledWith(
      expect.any(String),
      `${customName}.sql.gz`,
      expect.any(Function)
    );
  });

  it('should use timestamp-based name when no custom name is provided', async () => {
    await backupCommand({
      verbose: false
    });
    
    // Verify the S3 upload was called with a timestamp-based name
    expect(mockS3Manager.uploadFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringMatching(/^testdb-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.sql\.gz$/),
      expect.any(Function)
    );
  });

  it('should use S3 key from config with timestamp when provided', async () => {
    // Set S3_KEY environment variable
    process.env.S3_KEY = 'my-prefix';
    
    // Reset ConfigManager to pick up new env var
    ConfigManager.getInstance().reset();
    
    await backupCommand({
      verbose: false
    });
    
    // Verify the S3 upload was called with the prefixed name
    expect(mockS3Manager.uploadFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringMatching(/^my-prefix-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.sql\.gz$/),
      expect.any(Function)
    );
    
    delete process.env.S3_KEY;
  });

  it('should prioritize custom name over S3 key from config', async () => {
    const customName = 'priority-test-backup';
    
    // Set S3_KEY environment variable
    process.env.S3_KEY = 'should-be-ignored';
    
    // Reset ConfigManager to pick up new env var
    ConfigManager.getInstance().reset();
    
    await backupCommand({
      name: customName,
      verbose: false
    });
    
    // Verify the custom name was used, not the S3_KEY
    expect(mockS3Manager.uploadFile).toHaveBeenCalledWith(
      expect.any(String),
      `${customName}.sql.gz`,
      expect.any(Function)
    );
    
    delete process.env.S3_KEY;
  });

  it('should handle custom name with special characters', async () => {
    const customName = 'backup_2024-01-15_production';
    
    await backupCommand({
      name: customName,
      verbose: false
    });
    
    // Verify the S3 upload was called with the custom name preserved
    expect(mockS3Manager.uploadFile).toHaveBeenCalledWith(
      expect.any(String),
      `${customName}.sql.gz`,
      expect.any(Function)
    );
  });

  it('should display custom name in verbose output', async () => {
    const customName = 'verbose-test-backup';
    
    await backupCommand({
      name: customName,
      verbose: true
    });
    
    // Verify the S3 upload was called with the custom name even in verbose mode
    expect(mockS3Manager.uploadFile).toHaveBeenCalledWith(
      expect.any(String),
      `${customName}.sql.gz`,
      expect.any(Function)
    );
  });

  it('should auto-generate name based on schemas when provided', async () => {
    await backupCommand({
      schemas: 'schema1,schema2,schema3',
      verbose: false
    });
    
    // Verify the S3 upload was called with a schema-based name
    expect(mockS3Manager.uploadFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringMatching(/^schema1-schema2-schema3-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.sql\.gz$/),
      expect.any(Function)
    );
  });

  it('should use custom name even when schemas are specified', async () => {
    const customName = 'multi-schema-backup';
    
    await backupCommand({
      name: customName,
      schemas: 'schema1,schema2',
      verbose: false
    });
    
    // Verify the custom name was used instead of schema-based name
    expect(mockS3Manager.uploadFile).toHaveBeenCalledWith(
      expect.any(String),
      `${customName}.sql.gz`,
      expect.any(Function)
    );
  });
});