import { listCommand } from '../commands/list';
import { ConfigManager } from '../modules/config';
import { S3Manager } from '../modules/s3';
import chalk from 'chalk';
import { ListOptions, BackupInfo } from '../types';

jest.mock('../modules/config');
jest.mock('../modules/s3');
jest.mock('chalk', () => ({
  blue: jest.fn((str: string) => str),
  gray: jest.fn((str: string) => str),
  yellow: jest.fn((str: string) => str),
  green: jest.fn((str: string) => str),
  red: jest.fn((str: string) => str),
  cyan: { bold: jest.fn((str: string) => str) },
  bold: jest.fn((str: string) => str),
  white: jest.fn((str: string) => str)
}));

describe('listCommand', () => {
  let mockConfigManager: jest.Mocked<ConfigManager>;
  let mockS3Manager: jest.Mocked<S3Manager>;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  const mockConfig = {
    database: {
      host: 'localhost',
      port: 3306,
      user: 'testuser',
      password: 'testpass'
    },
    s3: {
      bucket: 'test-bucket',
      region: 'us-east-1',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret'
    }
  };

  const mockBackups: BackupInfo[] = [
    {
      key: 'backup-2023-12-02T10-00-00-000Z.sql.gz',
      displayName: 'backup (2023-12-02 10:00:00)',
      lastModified: new Date('2023-12-02T10:00:00Z'),
      size: 2048
    },
    {
      key: 'backup-2023-12-01T10-00-00-000Z.sql.gz',
      displayName: 'backup (2023-12-01 10:00:00)',
      lastModified: new Date('2023-12-01T10:00:00Z'),
      size: 1024
    }
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    mockConfigManager = {
      loadConfig: jest.fn().mockReturnValue(mockConfig),
      getInstance: jest.fn()
    } as any;

    (ConfigManager.getInstance as jest.Mock).mockReturnValue(mockConfigManager);

    mockS3Manager = {
      listBackups: jest.fn(),
      formatFileSize: jest.fn((bytes: number) => {
        if (bytes === 1024) return '1 KB';
        if (bytes === 2048) return '2 KB';
        return `${bytes} Bytes`;
      })
    } as any;

    (S3Manager as jest.Mock).mockImplementation(() => mockS3Manager);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe('successful listing', () => {
    it('should list backups in table format (default)', async () => {
      mockS3Manager.listBackups.mockResolvedValue(mockBackups);

      const options: ListOptions = {
        format: 'table',
        verbose: false
      };

      await listCommand(options);

      expect(mockConfigManager.loadConfig).toHaveBeenCalledWith(undefined, { 
        requireDatabase: false, 
        requireS3: true 
      });
      expect(mockS3Manager.listBackups).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Found 2 backups'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Available Backups:'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('backup (2023-12-02 10:00:00)'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('backup (2023-12-01 10:00:00)'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Total: 2 backups'));
      expect(processExitSpy).not.toHaveBeenCalled();
    });

    it('should list backups in JSON format', async () => {
      mockS3Manager.listBackups.mockResolvedValue(mockBackups);

      const options: ListOptions = {
        format: 'json',
        verbose: false
      };

      await listCommand(options);
      await listCommand(options);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('"key"'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('"displayName"'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('"sizeFormatted"'));
    });

    it('should show verbose output when requested', async () => {
      mockS3Manager.listBackups.mockResolvedValue(mockBackups);
      mockS3Manager.formatFileSize.mockImplementation((bytes: number) => {
        if (bytes === 3072) return '3 KB';
        return `${bytes} Bytes`;
      });

      const options: ListOptions = {
        format: 'table',
        verbose: true
      };

      await listCommand(options);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Configuration loaded successfully'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('S3 Bucket: test-bucket'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Total size:'));
    });

    it('should show verbose output with S3 endpoint when configured', async () => {
      const configWithEndpoint = {
        database: mockConfig.database,
        s3: {
          ...mockConfig.s3,
          endpointUrl: 'http://localhost:9000'
        }
      };
      mockConfigManager.loadConfig.mockReturnValue(configWithEndpoint);
      mockS3Manager.listBackups.mockResolvedValue(mockBackups);

      const options: ListOptions = {
        format: 'table',
        verbose: true
      };

      await listCommand(options);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('S3 Endpoint: http://localhost:9000'));
    });

    it('should handle single backup correctly', async () => {
      mockS3Manager.listBackups.mockResolvedValue([mockBackups[0]]);

      const options: ListOptions = {
        format: 'table',
        verbose: false
      };

      await listCommand(options);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Found 1 backup'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Total: 1 backup'));
    });

    it('should handle empty backup list', async () => {
      mockS3Manager.listBackups.mockResolvedValue([]);

      const options: ListOptions = {
        format: 'table',
        verbose: false
      };

      await listCommand(options);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('No backups found in the S3 bucket'));
      expect(processExitSpy).not.toHaveBeenCalled();
    });

    it('should use custom config file when provided', async () => {
      mockS3Manager.listBackups.mockResolvedValue(mockBackups);

      const options: ListOptions = {
        format: 'table',
        verbose: false,
        configFile: '/custom/config.json'
      };

      await listCommand(options);

      expect(mockConfigManager.loadConfig).toHaveBeenCalledWith('/custom/config.json', { 
        requireDatabase: false, 
        requireS3: true 
      });
    });

    it('should format table with correct column widths', async () => {
      const longNameBackup: BackupInfo = {
        key: 'very-long-database-name-backup-2023-12-03T10-00-00-000Z.sql.gz',
        displayName: 'very-long-database-name-backup (2023-12-03 10:00:00)',
        lastModified: new Date('2023-12-03T10:00:00Z'),
        size: 1048576
      };

      mockS3Manager.listBackups.mockResolvedValue([...mockBackups, longNameBackup]);
      mockS3Manager.formatFileSize.mockImplementation((bytes: number) => {
        if (bytes === 1048576) return '1 MB';
        if (bytes === 1024) return '1 KB';
        if (bytes === 2048) return '2 KB';
        return `${bytes} Bytes`;
      });

      const options: ListOptions = {
        format: 'table',
        verbose: false
      };

      await listCommand(options);

      // Check that the table is formatted with proper padding
      const calls = consoleLogSpy.mock.calls;
      const tableRows = calls.filter(call => 
        call[0].includes('backup') && call[0].includes('|')
      );
      
      // Each row should have the same structure with pipes as separators
      tableRows.forEach(row => {
        expect(row[0]).toMatch(/.*\|.*\|.*/);
      });
    });

    it('should apply alternating row colors in table format', async () => {
      mockS3Manager.listBackups.mockResolvedValue(mockBackups);
      
      const options: ListOptions = {
        format: 'table',
        verbose: false
      };

      await listCommand(options);

      // Verify chalk.white and chalk.gray were called for alternating rows
      expect(chalk.white).toHaveBeenCalled();
      expect(chalk.gray).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle S3 listing errors', async () => {
      mockS3Manager.listBackups.mockRejectedValue(new Error('S3 access denied'));

      const options: ListOptions = {
        format: 'table',
        verbose: false
      };

      await listCommand(options);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to list backups:'),
        'S3 access denied'
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle config loading errors', async () => {
      mockConfigManager.loadConfig.mockImplementation(() => {
        throw new Error('Invalid configuration');
      });

      const options: ListOptions = {
        format: 'table',
        verbose: false
      };

      await listCommand(options);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to list backups:'),
        'Invalid configuration'
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should show stack trace in verbose mode', async () => {
      const error = new Error('S3 error');
      error.stack = 'Error: S3 error\n  at someFunction\n  at anotherFunction';
      mockS3Manager.listBackups.mockRejectedValue(error);

      const options: ListOptions = {
        format: 'table',
        verbose: true
      };

      await listCommand(options);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error: S3 error')
      );
    });

    it('should handle non-Error objects', async () => {
      mockS3Manager.listBackups.mockRejectedValue('String error');

      const options: ListOptions = {
        format: 'table',
        verbose: false
      };

      await listCommand(options);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to list backups:'),
        'String error'
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('JSON format edge cases', () => {
    it('should handle backups with special characters in JSON format', async () => {
      const specialBackup: BackupInfo = {
        key: 'backup-"special"-2023-12-01T10-00-00-000Z.sql.gz',
        displayName: 'backup "special" (2023-12-01 10:00:00)',
        lastModified: new Date('2023-12-01T10:00:00Z'),
        size: 1024
      };

      mockS3Manager.listBackups.mockResolvedValue([specialBackup]);

      const options: ListOptions = {
        format: 'json',
        verbose: false
      };

      await listCommand(options);

      // JSON.stringify should properly escape special characters
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('\\"special\\"'));
    });

    it('should include ISO date format in JSON output', async () => {
      mockS3Manager.listBackups.mockResolvedValue(mockBackups);

      const options: ListOptions = {
        format: 'json',
        verbose: false
      };

      await listCommand(options);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('2023-12-02T10:00:00.000Z')
      );
    });
  });
});