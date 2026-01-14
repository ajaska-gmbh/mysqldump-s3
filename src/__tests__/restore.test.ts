import { restoreCommand } from '../commands/restore';
import { ConfigManager } from '../modules/config';
import { MySQLManager } from '../modules/mysql';
import { S3Manager } from '../modules/s3';
import { progressTracker } from '../modules/progress';
import * as inquirer from 'inquirer';
import * as fs from 'fs';
import * as os from 'os';
import { RestoreOptions, BackupInfo } from '../types';

jest.mock('../modules/config');
jest.mock('../modules/mysql');
jest.mock('../modules/s3');
jest.mock('../modules/progress');
jest.mock('inquirer');
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  unlinkSync: jest.fn(),
  promises: jest.requireActual('fs').promises
}));
jest.mock('os');
jest.mock('chalk', () => ({
  blue: jest.fn((str: string) => str),
  gray: jest.fn((str: string) => str),
  green: Object.assign(jest.fn((str: string) => str), { 
    bold: jest.fn((str: string) => str) 
  }),
  yellow: Object.assign(jest.fn((str: string) => str), { 
    bold: jest.fn((str: string) => str) 
  }),
  red: jest.fn((str: string) => str),
  cyan: jest.fn((str: string) => str)
}));

describe('restoreCommand', () => {
  let mockConfigManager: jest.Mocked<ConfigManager>;
  let mockMySQLManager: jest.Mocked<MySQLManager>;
  let mockS3Manager: jest.Mocked<S3Manager>;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  const mockConfig = {
    database: {
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: 'password',
      database: 'testdb'
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

  const mockProgressBar = jest.fn();

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

    mockMySQLManager = {
      testConnection: jest.fn().mockResolvedValue(undefined),
      listDatabases: jest.fn().mockResolvedValue(['db1', 'db2', 'testdb']),
      databaseExists: jest.fn(),
      createDatabase: jest.fn().mockResolvedValue(undefined),
      restoreBackup: jest.fn().mockResolvedValue(undefined)
    } as any;

    (MySQLManager as jest.Mock).mockImplementation(() => mockMySQLManager);

    mockS3Manager = {
      listBackups: jest.fn().mockResolvedValue(mockBackups),
      backupExists: jest.fn().mockResolvedValue(true),
      downloadFile: jest.fn().mockResolvedValue(undefined),
      formatFileSize: jest.fn((bytes: number) => `${bytes} Bytes`)
    } as any;

    (S3Manager as jest.Mock).mockImplementation(() => mockS3Manager);

    (progressTracker.createProgressBar as jest.Mock).mockReturnValue(mockProgressBar);
    (progressTracker.stop as jest.Mock).mockImplementation();

    (os.tmpdir as jest.Mock).mockReturnValue('/tmp');
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (fs.unlinkSync as jest.Mock).mockImplementation();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe('interactive mode', () => {
    it('should restore backup interactively with existing database', async () => {
      mockMySQLManager.databaseExists.mockResolvedValue(true);
      
      (inquirer.prompt as unknown as jest.Mock)
        .mockResolvedValueOnce({ backup: mockBackups[0].key })
        .mockResolvedValueOnce({ database: 'testdb' })
        .mockResolvedValueOnce({ proceed: true });

      const options: RestoreOptions = {
        interactive: true,
        force: false,
        verbose: false
      };

      await restoreCommand(options);

      expect(mockMySQLManager.testConnection).toHaveBeenCalled();
      expect(mockS3Manager.listBackups).toHaveBeenCalled();
      expect(mockMySQLManager.listDatabases).toHaveBeenCalled();
      expect(mockS3Manager.downloadFile).toHaveBeenCalledWith(
        mockBackups[0].key,
        expect.stringContaining('/tmp/restore-'),
        mockProgressBar
      );
      expect(mockMySQLManager.restoreBackup).toHaveBeenCalledWith(
        expect.stringContaining('/tmp/restore-'),
        'testdb',
        mockProgressBar
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Restore completed successfully!'));
      expect(processExitSpy).not.toHaveBeenCalled();
    });

    it('should create new database if it does not exist', async () => {
      mockMySQLManager.databaseExists.mockResolvedValue(false);
      
      (inquirer.prompt as unknown as jest.Mock)
        .mockResolvedValueOnce({ backup: mockBackups[0].key })
        .mockResolvedValueOnce({ database: 'custom' })
        .mockResolvedValueOnce({ database: 'newdb' })
        .mockResolvedValueOnce({ proceed: true });

      const options: RestoreOptions = {
        interactive: true,
        force: false,
        verbose: false
      };

      await restoreCommand(options);

      expect(mockMySQLManager.databaseExists).toHaveBeenCalledWith('newdb');
      expect(mockMySQLManager.createDatabase).toHaveBeenCalledWith('newdb');
      expect(mockMySQLManager.restoreBackup).toHaveBeenCalledWith(
        expect.any(String),
        'newdb',
        expect.any(Function)
      );
    });

    it('should handle cancellation', async () => {
      mockMySQLManager.databaseExists.mockResolvedValue(true);
      
      (inquirer.prompt as unknown as jest.Mock)
        .mockResolvedValueOnce({ backup: mockBackups[0].key })
        .mockResolvedValueOnce({ database: 'testdb' })
        .mockResolvedValueOnce({ proceed: false });

      const options: RestoreOptions = {
        interactive: true,
        force: false,
        verbose: false
      };

      await restoreCommand(options);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Restoration cancelled'));
      expect(mockS3Manager.downloadFile).not.toHaveBeenCalled();
      expect(mockMySQLManager.restoreBackup).not.toHaveBeenCalled();
      expect(processExitSpy).not.toHaveBeenCalled();
    });

    it('should skip confirmation with force flag', async () => {
      mockMySQLManager.databaseExists.mockResolvedValue(true);
      
      (inquirer.prompt as unknown as jest.Mock)
        .mockResolvedValueOnce({ backup: mockBackups[0].key })
        .mockResolvedValueOnce({ database: 'testdb' });

      const options: RestoreOptions = {
        interactive: true,
        force: true,
        verbose: false
      };

      await restoreCommand(options);

      expect(inquirer.prompt).toHaveBeenCalledTimes(2); // Only backup and database prompts
      expect(mockMySQLManager.restoreBackup).toHaveBeenCalled();
    });

    it('should handle empty backup list', async () => {
      mockS3Manager.listBackups.mockResolvedValue([]);

      const options: RestoreOptions = {
        interactive: true,
        force: false,
        verbose: false
      };

      await restoreCommand(options);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('No backups found in the S3 bucket')
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should clean up temp file after restore', async () => {
      mockMySQLManager.databaseExists.mockResolvedValue(true);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      
      (inquirer.prompt as unknown as jest.Mock)
        .mockResolvedValueOnce({ backup: mockBackups[0].key })
        .mockResolvedValueOnce({ database: 'testdb' })
        .mockResolvedValueOnce({ proceed: true });

      const options: RestoreOptions = {
        interactive: true,
        force: false,
        verbose: false
      };

      await restoreCommand(options);

      expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('/tmp/restore-'));
    });

    it('should show verbose output when requested', async () => {
      mockMySQLManager.databaseExists.mockResolvedValue(true);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      
      const configWithEndpoint = {
        ...mockConfig,
        s3: {
          ...mockConfig.s3,
          endpointUrl: 'http://localhost:9000'
        }
      };
      mockConfigManager.loadConfig.mockReturnValue(configWithEndpoint);
      
      (inquirer.prompt as unknown as jest.Mock)
        .mockResolvedValueOnce({ backup: mockBackups[0].key })
        .mockResolvedValueOnce({ database: 'testdb' })
        .mockResolvedValueOnce({ proceed: true });

      const options: RestoreOptions = {
        interactive: true,
        force: false,
        verbose: true
      };

      await restoreCommand(options);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Configuration loaded successfully'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Database: localhost:3306'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('S3 Bucket: test-bucket'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('S3 Endpoint: http://localhost:9000'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Database \'testdb\' already exists'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Temporary backup file cleaned up'));
    });
  });

  describe('non-interactive mode', () => {
    it('should restore backup non-interactively', async () => {
      mockMySQLManager.databaseExists.mockResolvedValue(true);

      const options: RestoreOptions = {
        interactive: false,
        backup: 'backup-2023-12-01T10-00-00-000Z.sql.gz',
        database: 'targetdb',
        force: true,
        verbose: false
      };

      await restoreCommand(options);

      expect(mockS3Manager.backupExists).toHaveBeenCalledWith('backup-2023-12-01T10-00-00-000Z.sql.gz');
      expect(mockMySQLManager.restoreBackup).toHaveBeenCalledWith(
        expect.any(String),
        'targetdb',
        expect.any(Function)
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Restore completed successfully!'));
    });

    it('should require backup key in non-interactive mode', async () => {
      const options: RestoreOptions = {
        interactive: false,
        database: 'targetdb',
        force: true,
        verbose: false
      };

      await restoreCommand(options);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Backup key is required in non-interactive mode')
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should require database in non-interactive mode', async () => {
      const options: RestoreOptions = {
        interactive: false,
        backup: 'backup-2023-12-01T10-00-00-000Z.sql.gz',
        force: true,
        verbose: false
      };

      await restoreCommand(options);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Target database is required in non-interactive mode')
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should require force flag in non-interactive mode', async () => {
      mockMySQLManager.databaseExists.mockResolvedValue(true);

      const options: RestoreOptions = {
        interactive: false,
        backup: 'backup-2023-12-01T10-00-00-000Z.sql.gz',
        database: 'targetdb',
        force: false,
        verbose: false
      };

      await restoreCommand(options);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('WARNING: This will overwrite data in the target database!')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Use --force flag to skip this confirmation')
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle backup not found', async () => {
      mockS3Manager.backupExists.mockResolvedValue(false);

      const options: RestoreOptions = {
        interactive: false,
        backup: 'non-existent.sql.gz',
        database: 'targetdb',
        force: true,
        verbose: false
      };

      await restoreCommand(options);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Backup not found: non-existent.sql.gz')
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('error handling', () => {
    it('should handle database connection failure', async () => {
      mockMySQLManager.testConnection.mockRejectedValue(new Error('Connection refused'));

      const options: RestoreOptions = {
        interactive: false,
        backup: 'backup.sql.gz',
        database: 'targetdb',
        force: true,
        verbose: false
      };

      await restoreCommand(options);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Restore failed:'),
        'Connection refused'
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle download failure', async () => {
      mockMySQLManager.databaseExists.mockResolvedValue(true);
      mockS3Manager.downloadFile.mockRejectedValue(new Error('S3 download failed'));

      const options: RestoreOptions = {
        interactive: false,
        backup: 'backup.sql.gz',
        database: 'targetdb',
        force: true,
        verbose: false
      };

      await restoreCommand(options);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Restore failed:'),
        'S3 download failed'
      );
      expect(progressTracker.stop).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle restore failure', async () => {
      mockMySQLManager.databaseExists.mockResolvedValue(true);
      mockMySQLManager.restoreBackup.mockRejectedValue(new Error('MySQL restore error'));

      const options: RestoreOptions = {
        interactive: false,
        backup: 'backup.sql.gz',
        database: 'targetdb',
        force: true,
        verbose: false
      };

      await restoreCommand(options);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Restore failed:'),
        'MySQL restore error'
      );
      expect(progressTracker.stop).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle database creation failure', async () => {
      mockMySQLManager.databaseExists.mockResolvedValue(false);
      mockMySQLManager.createDatabase.mockRejectedValue(new Error('Access denied'));

      (inquirer.prompt as unknown as jest.Mock)
        .mockResolvedValueOnce({ backup: mockBackups[0].key })
        .mockResolvedValueOnce({ database: 'newdb' })
        .mockResolvedValueOnce({ proceed: true });

      const options: RestoreOptions = {
        interactive: true,
        force: false,
        verbose: false
      };

      await restoreCommand(options);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to check/create database: Access denied')
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should show stack trace in verbose mode', async () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n  at someFunction\n  at anotherFunction';
      mockMySQLManager.testConnection.mockRejectedValue(error);

      const options: RestoreOptions = {
        interactive: false,
        backup: 'backup.sql.gz',
        database: 'targetdb',
        force: true,
        verbose: true
      };

      await restoreCommand(options);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error: Test error')
      );
    });

    it('should handle database check error with verbose stack trace', async () => {
      const error = new Error('Database check error');
      error.stack = 'Error: Database check error\n  at checkDatabase';
      mockMySQLManager.databaseExists.mockRejectedValue(error);

      (inquirer.prompt as unknown as jest.Mock)
        .mockResolvedValueOnce({ backup: mockBackups[0].key })
        .mockResolvedValueOnce({ database: 'testdb' })
        .mockResolvedValueOnce({ proceed: true });

      const options: RestoreOptions = {
        interactive: true,
        force: false,
        verbose: true
      };

      await restoreCommand(options);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to check/create database: Database check error')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error: Database check error')
      );
    });

    it('should clean up temp file even on failure', async () => {
      mockMySQLManager.databaseExists.mockResolvedValue(true);
      mockMySQLManager.restoreBackup.mockRejectedValue(new Error('Restore failed'));
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const options: RestoreOptions = {
        interactive: false,
        backup: 'backup.sql.gz',
        database: 'targetdb',
        force: true,
        verbose: false
      };

      await restoreCommand(options);

      expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('/tmp/restore-'));
    });
  });

  describe('custom database input validation', () => {
    it('should validate custom database name is not empty', async () => {
      (inquirer.prompt as unknown as jest.Mock).mockImplementation((questions: any[]) => {
        const question = questions[0];
        
        if (question.name === 'backup') {
          return Promise.resolve({ backup: mockBackups[0].key });
        } else if (question.name === 'database' && question.type === 'list') {
          return Promise.resolve({ database: 'custom' });
        } else if (question.name === 'database' && question.type === 'input') {
          // Test validation function
          expect(question.validate('')).toBe('Database name cannot be empty');
          expect(question.validate('  ')).toBe('Database name cannot be empty');
          expect(question.validate('validdb')).toBe(true);
          return Promise.resolve({ database: 'validdb' });
        } else if (question.name === 'proceed') {
          return Promise.resolve({ proceed: true });
        }
        
        return Promise.resolve({});
      });

      mockMySQLManager.databaseExists.mockResolvedValue(true);

      const options: RestoreOptions = {
        interactive: true,
        force: false,
        verbose: false
      };

      await restoreCommand(options);

      expect(mockMySQLManager.restoreBackup).toHaveBeenCalledWith(
        expect.any(String),
        'validdb',
        expect.any(Function)
      );
    });
  });

  describe('configuration file usage', () => {
    it('should use custom config file when provided', async () => {
      mockMySQLManager.databaseExists.mockResolvedValue(true);

      const options: RestoreOptions = {
        interactive: false,
        backup: 'backup.sql.gz',
        database: 'targetdb',
        force: true,
        verbose: false,
        configFile: '/custom/config.json'
      };

      await restoreCommand(options);

      expect(mockConfigManager.loadConfig).toHaveBeenCalledWith('/custom/config.json', {
        requireDatabase: true,
        requireS3: true
      });
    });
  });
});