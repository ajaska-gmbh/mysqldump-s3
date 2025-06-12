import { listCommand } from '../commands/list';

// Mock dependencies
jest.mock('../modules/config');
jest.mock('../modules/s3');
jest.mock('chalk', () => ({
  red: jest.fn((text) => text),
  green: jest.fn((text) => text),
  blue: jest.fn((text) => text),
  cyan: jest.fn((text) => text),
  gray: jest.fn((text) => text),
  yellow: jest.fn((text) => text)
}));

describe('List Command', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'table').mockImplementation();
    jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should export listCommand function', () => {
    expect(typeof listCommand).toBe('function');
  });

  it('should handle successful backup listing', async () => {
    const { ConfigManager } = require('../modules/config');
    const { S3Manager } = require('../modules/s3');

    const mockConfig = {
      s3: { bucket: 'test-bucket', accessKeyId: 'key', secretAccessKey: 'secret' }
    };

    const mockBackups = [
      {
        key: 'backup1.sql.gz',
        displayName: 'backup1 (2023-12-01 10:30:00)',
        lastModified: new Date('2023-12-01T10:30:00Z'),
        size: 1572864
      }
    ];

    ConfigManager.getInstance = jest.fn().mockReturnValue({
      loadConfig: jest.fn().mockReturnValue(mockConfig)
    });

    S3Manager.mockImplementation(() => ({
      listBackups: jest.fn().mockResolvedValue(mockBackups),
      formatFileSize: jest.fn().mockReturnValue('1.5 MB')
    }));

    await listCommand({ format: 'table' });

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Found 1 backup'));
  });

  it('should handle empty backup list', async () => {
    const { ConfigManager } = require('../modules/config');
    const { S3Manager } = require('../modules/s3');

    ConfigManager.getInstance = jest.fn().mockReturnValue({
      loadConfig: jest.fn().mockReturnValue({
        s3: { bucket: 'test-bucket', accessKeyId: 'key', secretAccessKey: 'secret' }
      })
    });

    S3Manager.mockImplementation(() => ({
      listBackups: jest.fn().mockResolvedValue([])
    }));

    await listCommand({});

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No backups found'));
  });

  it('should handle JSON format output', async () => {
    const { ConfigManager } = require('../modules/config');
    const { S3Manager } = require('../modules/s3');

    const mockBackups = [{ 
      key: 'test.sql.gz', 
      displayName: 'test', 
      lastModified: new Date('2023-01-01T12:00:00Z'), 
      size: 100 
    }];

    ConfigManager.getInstance = jest.fn().mockReturnValue({
      loadConfig: jest.fn().mockReturnValue({ s3: {} })
    });

    S3Manager.mockImplementation(() => ({
      listBackups: jest.fn().mockResolvedValue(mockBackups),
      formatFileSize: jest.fn().mockReturnValue('100 Bytes')
    }));

    await listCommand({ format: 'json' });

    const expectedJson = [{
      key: 'test.sql.gz',
      displayName: 'test',
      lastModified: '2023-01-01T12:00:00.000Z',
      size: 100,
      sizeFormatted: '100 Bytes'
    }];

    // Check that JSON output is somewhere in the console.log calls
    const logCalls = (console.log as jest.Mock).mock.calls;
    const jsonCall = logCalls.find(call => 
      call[0] && typeof call[0] === 'string' && call[0].startsWith('[')
    );
    
    expect(jsonCall).toBeDefined();
    expect(jsonCall[0]).toBe(JSON.stringify(expectedJson, null, 2));
  });

  it('should handle configuration errors', async () => {
    const { ConfigManager } = require('../modules/config');

    ConfigManager.getInstance = jest.fn().mockReturnValue({
      loadConfig: jest.fn().mockImplementation(() => {
        throw new Error('Configuration failed');
      })
    });

    await listCommand({});

    expect(console.error).toHaveBeenCalledWith('✗ Failed to list backups:', 'Configuration failed');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should handle S3 listing errors', async () => {
    const { ConfigManager } = require('../modules/config');
    const { S3Manager } = require('../modules/s3');

    ConfigManager.getInstance = jest.fn().mockReturnValue({
      loadConfig: jest.fn().mockReturnValue({ s3: {} })
    });

    S3Manager.mockImplementation(() => ({
      listBackups: jest.fn().mockRejectedValue(new Error('S3 error'))
    }));

    await listCommand({});

    expect(console.error).toHaveBeenCalledWith('✗ Failed to list backups:', 'S3 error');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});