import { MySQLManager } from '../modules/mysql';
import { spawn } from 'child_process';
import { createConnection, Connection } from 'mysql2/promise';
import * as fs from 'fs';
import * as zlib from 'zlib';
import { PassThrough, Readable } from 'stream';
import { DatabaseConfig } from '../types';

jest.mock('child_process');
jest.mock('mysql2/promise');
jest.mock('fs');
jest.mock('zlib');

describe('MySQLManager', () => {
  let mysqlManager: MySQLManager;
  let mockConnection: jest.Mocked<Connection>;
  
  const mockConfig: DatabaseConfig = {
    host: 'localhost',
    port: 3306,
    user: 'testuser',
    password: 'testpass',
    database: 'testdb'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockConnection = {
      execute: jest.fn(),
      end: jest.fn().mockResolvedValue(undefined),
      ping: jest.fn().mockResolvedValue(undefined)
    } as any;
    
    (createConnection as jest.Mock).mockResolvedValue(mockConnection);
    
    mysqlManager = new MySQLManager(mockConfig);
  });

  describe('testConnection', () => {
    it('should successfully test connection', async () => {
      await expect(mysqlManager.testConnection()).resolves.toBeUndefined();
      
      expect(createConnection).toHaveBeenCalledWith({
        host: 'localhost',
        port: 3306,
        user: 'testuser',
        password: 'testpass',
        database: 'testdb'
      });
      expect(mockConnection.ping).toHaveBeenCalled();
      expect(mockConnection.end).toHaveBeenCalled();
    });

    it('should throw error when connection fails', async () => {
      const error = new Error('Connection refused');
      (createConnection as jest.Mock).mockRejectedValueOnce(error);

      await expect(mysqlManager.testConnection()).rejects.toThrow('Connection refused');
    });

    it('should throw error when ping fails', async () => {
      const error = new Error('Connection lost');
      mockConnection.ping.mockRejectedValueOnce(error);

      await expect(mysqlManager.testConnection()).rejects.toThrow('Connection lost');
    });
  });

  describe('trySetMaxAllowedPacket', () => {
    it('should return true when user has admin privileges', async () => {
      mockConnection.execute.mockResolvedValueOnce([[], []] as any);

      const result = await mysqlManager.trySetMaxAllowedPacket();

      expect(result).toBe(true);
      expect(mockConnection.execute).toHaveBeenCalledWith(
        'SET GLOBAL max_allowed_packet = 1073741824'
      );
      expect(mockConnection.end).toHaveBeenCalled();
    });

    it('should return false when user lacks SUPER privilege', async () => {
      const error = new Error('Access denied; you need the SUPER privilege for this operation');
      mockConnection.execute.mockRejectedValueOnce(error);

      const result = await mysqlManager.trySetMaxAllowedPacket();

      expect(result).toBe(false);
      expect(mockConnection.end).toHaveBeenCalled();
    });

    it('should return false when user lacks SYSTEM_VARIABLES_ADMIN privilege', async () => {
      const error = new Error('Access denied; you need SYSTEM_VARIABLES_ADMIN privilege');
      mockConnection.execute.mockRejectedValueOnce(error);

      const result = await mysqlManager.trySetMaxAllowedPacket();

      expect(result).toBe(false);
      expect(mockConnection.end).toHaveBeenCalled();
    });

    it('should return false on general access denied error', async () => {
      const error = new Error('Access denied for user');
      mockConnection.execute.mockRejectedValueOnce(error);

      const result = await mysqlManager.trySetMaxAllowedPacket();

      expect(result).toBe(false);
      expect(mockConnection.end).toHaveBeenCalled();
    });

    it('should return false and log warning on other errors', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const error = new Error('Connection timeout');
      mockConnection.execute.mockRejectedValueOnce(error);

      const result = await mysqlManager.trySetMaxAllowedPacket();

      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Warning: Could not set max_allowed_packet')
      );
      expect(mockConnection.end).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should close connection even on error', async () => {
      const error = new Error('Access denied');
      mockConnection.execute.mockRejectedValueOnce(error);

      await mysqlManager.trySetMaxAllowedPacket();

      expect(mockConnection.end).toHaveBeenCalled();
    });
  });

  describe('listDatabases', () => {
    it('should list databases excluding system databases', async () => {
      const mockRows = [
        { Database: 'mydb1' },
        { Database: 'mydb2' },
        { Database: 'information_schema' },
        { Database: 'performance_schema' },
        { Database: 'mysql' },
        { Database: 'sys' },
        { Database: 'userdb' }
      ];
      
      mockConnection.execute.mockResolvedValueOnce([mockRows, []] as any);

      const databases = await mysqlManager.listDatabases();

      expect(databases).toEqual(['mydb1', 'mydb2', 'userdb']);
      expect(mockConnection.execute).toHaveBeenCalledWith('SHOW DATABASES');
      expect(mockConnection.end).toHaveBeenCalled();
    });

    it('should handle empty database list', async () => {
      mockConnection.execute.mockResolvedValueOnce([[], []] as any);

      const databases = await mysqlManager.listDatabases();

      expect(databases).toEqual([]);
    });

    it('should close connection even on error', async () => {
      const error = new Error('Query failed');
      mockConnection.execute.mockRejectedValueOnce(error);

      await expect(mysqlManager.listDatabases()).rejects.toThrow('Query failed');
      expect(mockConnection.end).toHaveBeenCalled();
    });
  });

  describe('createBackup', () => {
    let mockMysqldump: any;
    let mockGzip: any;
    let mockOutputStream: any;

    beforeEach(() => {
      mockMysqldump = {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        on: jest.fn(),
        kill: jest.fn()
      };

      mockGzip = new PassThrough();
      (zlib.createGzip as jest.Mock).mockReturnValue(mockGzip);

      mockOutputStream = new PassThrough();
      (fs.createWriteStream as jest.Mock).mockReturnValue(mockOutputStream);

      (spawn as jest.Mock).mockReturnValue(mockMysqldump);
    });

    it('should create backup with specific database', async () => {
      mockMysqldump.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'close') {
          setTimeout(() => handler(0), 10);
        }
        return mockMysqldump;
      });

      const backupPromise = mysqlManager.createBackup('/tmp/backup.sql.gz');
      
      // Simulate successful completion
      setImmediate(() => {
        mockOutputStream.emit('finish');
      });

      await expect(backupPromise).resolves.toBeUndefined();

      // Verify mysqldump was called with large database optimizations
      expect(spawn).toHaveBeenCalledWith('mysqldump', expect.arrayContaining([
        '-h', 'localhost',
        '-P', '3306',
        '-u', 'testuser',
        '-ptestpass',
        '--max_allowed_packet=1G',
        '--quick',
        '--single-transaction',
        '--routines',
        '--triggers',
        'testdb'
      ]), expect.anything());
    });

    it('should create backup with multiple schemas', async () => {
      const configWithSchemas = { ...mockConfig, schemas: ['db1', 'db2', 'db3'] };
      mysqlManager = new MySQLManager(configWithSchemas);

      mockMysqldump.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'close') {
          setTimeout(() => handler(0), 10);
        }
        return mockMysqldump;
      });

      const backupPromise = mysqlManager.createBackup('/tmp/backup.sql.gz');
      
      setImmediate(() => {
        mockOutputStream.emit('finish');
      });

      await expect(backupPromise).resolves.toBeUndefined();

      expect(spawn).toHaveBeenCalledWith('mysqldump', expect.arrayContaining([
        '--databases', 'db1', 'db2', 'db3'
      ]), expect.anything());
    });

    it('should create backup with all databases when no database specified', async () => {
      const configWithoutDb = { ...mockConfig, database: undefined };
      mysqlManager = new MySQLManager(configWithoutDb);

      mockMysqldump.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'close') {
          setTimeout(() => handler(0), 10);
        }
        return mockMysqldump;
      });

      const backupPromise = mysqlManager.createBackup('/tmp/backup.sql.gz');
      
      setImmediate(() => {
        mockOutputStream.emit('finish');
      });

      await expect(backupPromise).resolves.toBeUndefined();

      expect(spawn).toHaveBeenCalledWith('mysqldump', expect.arrayContaining([
        '--all-databases'
      ]), expect.anything());
    });

    it('should handle mysqldump spawn error', async () => {
      const error = new Error('mysqldump not found');
      mockMysqldump.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'error') {
          setImmediate(() => handler(error));
        }
        return mockMysqldump;
      });

      await expect(mysqlManager.createBackup('/tmp/backup.sql.gz'))
        .rejects.toThrow('Failed to start mysqldump: mysqldump not found');
    });

    it('should handle mysqldump non-zero exit code', async () => {
      mockMysqldump.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'close') {
          mockMysqldump.stderr.push('Access denied');
          setTimeout(() => handler(1), 10);
        }
        return mockMysqldump;
      });

      await expect(mysqlManager.createBackup('/tmp/backup.sql.gz'))
        .rejects.toThrow('mysqldump exited with code 1');
    });

    it('should handle gzip error', async () => {
      mockMysqldump.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'close') {
          setTimeout(() => handler(0), 10);
        }
        return mockMysqldump;
      });

      const backupPromise = mysqlManager.createBackup('/tmp/backup.sql.gz');
      
      setImmediate(() => {
        mockGzip.emit('error', new Error('Compression failed'));
      });

      await expect(backupPromise).rejects.toThrow('Compression failed');
    });

    it('should handle output stream error', async () => {
      mockMysqldump.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'close') {
          setTimeout(() => handler(0), 10);
        }
        return mockMysqldump;
      });

      const backupPromise = mysqlManager.createBackup('/tmp/backup.sql.gz');
      
      setImmediate(() => {
        mockOutputStream.emit('error', new Error('Disk full'));
      });

      await expect(backupPromise).rejects.toThrow('Failed to write backup file: Disk full');
    });

    it('should track progress during backup', async () => {
      const progressCallback = jest.fn();
      
      mockMysqldump.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'close') {
          setTimeout(() => handler(0), 10);
        }
        return mockMysqldump;
      });

      const backupPromise = mysqlManager.createBackup('/tmp/backup.sql.gz', progressCallback);
      
      // Simulate data chunks
      mockGzip.push(Buffer.alloc(1024));
      mockGzip.push(Buffer.alloc(2048));
      
      setImmediate(() => {
        mockOutputStream.emit('finish');
      });

      await expect(backupPromise).resolves.toBeUndefined();

      expect(progressCallback).toHaveBeenCalledWith(expect.objectContaining({
        loaded: expect.any(Number)
      }));
      expect(progressCallback).toHaveBeenCalledWith(expect.objectContaining({
        percentage: 100
      }));
    });
  });

  describe('createDatabase', () => {
    it('should create database successfully', async () => {
      mockConnection.execute.mockResolvedValueOnce([[], []] as any);

      await expect(mysqlManager.createDatabase('newdb')).resolves.toBeUndefined();

      expect(createConnection).toHaveBeenCalledWith({
        host: 'localhost',
        port: 3306,
        user: 'testuser',
        password: 'testpass',
        multipleStatements: true
      });
      expect(mockConnection.execute).toHaveBeenCalledWith(
        'CREATE DATABASE IF NOT EXISTS `newdb`'
      );
      expect(mockConnection.end).toHaveBeenCalled();
    });

    it('should handle special characters in database name', async () => {
      mockConnection.execute.mockResolvedValueOnce([[], []] as any);

      await expect(mysqlManager.createDatabase('my-db-2023')).resolves.toBeUndefined();

      expect(mockConnection.execute).toHaveBeenCalledWith(
        'CREATE DATABASE IF NOT EXISTS `my-db-2023`'
      );
    });

    it('should throw error when creation fails', async () => {
      const error = new Error('Access denied');
      mockConnection.execute.mockRejectedValueOnce(error);

      await expect(mysqlManager.createDatabase('newdb'))
        .rejects.toThrow("Failed to create database 'newdb': Access denied");
      
      expect(mockConnection.end).toHaveBeenCalled();
    });

    it('should handle non-Error objects', async () => {
      mockConnection.execute.mockRejectedValueOnce('String error');

      await expect(mysqlManager.createDatabase('newdb'))
        .rejects.toThrow("Failed to create database 'newdb': String error");
      
      expect(mockConnection.end).toHaveBeenCalled();
    });
  });

  describe('databaseExists', () => {
    it('should return true when database exists', async () => {
      mockConnection.execute.mockResolvedValueOnce([[{ SCHEMA_NAME: 'testdb' }], []] as any);

      const exists = await mysqlManager.databaseExists('testdb');

      expect(exists).toBe(true);
      expect(mockConnection.execute).toHaveBeenCalledWith(
        'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?',
        ['testdb']
      );
      expect(mockConnection.end).toHaveBeenCalled();
    });

    it('should return false when database does not exist', async () => {
      mockConnection.execute.mockResolvedValueOnce([[], []] as any);

      const exists = await mysqlManager.databaseExists('nonexistent');

      expect(exists).toBe(false);
    });

    it('should close connection even on error', async () => {
      const error = new Error('Query failed');
      mockConnection.execute.mockRejectedValueOnce(error);

      await expect(mysqlManager.databaseExists('testdb')).rejects.toThrow('Query failed');
      expect(mockConnection.end).toHaveBeenCalled();
    });
  });

  describe('restoreBackup edge cases', () => {
    let mockMysql: any;
    let mockGunzip: any;
    let mockInputStream: any;

    beforeEach(() => {
      mockMysql = {
        stdin: new PassThrough(),
        stderr: new PassThrough(),
        on: jest.fn(),
        kill: jest.fn()
      };

      mockGunzip = new PassThrough();
      (zlib.createGunzip as jest.Mock).mockReturnValue(mockGunzip);

      mockInputStream = new Readable({ read() {} });
      (fs.createReadStream as jest.Mock).mockReturnValue(mockInputStream);
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({ size: 10240 });

      (spawn as jest.Mock).mockReturnValue(mockMysql);

      // Mock databaseExists to return true so we skip database creation
      mockConnection.execute.mockResolvedValue([[{ SCHEMA_NAME: 'testdb' }], []] as never);
    });

    it('should use admin privileges init-command when trySetMaxAllowedPacket succeeds', async () => {
      jest.spyOn(mysqlManager, 'databaseExists').mockResolvedValue(true);
      jest.spyOn(mysqlManager, 'trySetMaxAllowedPacket').mockResolvedValue(true);

      mockMysql.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'close') {
          setTimeout(() => handler(0), 10);
        }
        return mockMysql;
      });

      const restorePromise = mysqlManager.restoreBackup('/tmp/backup.sql.gz', 'testdb');

      setImmediate(() => {
        mockGunzip.emit('end');
        mockMysql.stdin.emit('finish');
      });

      await restorePromise;

      expect(spawn).toHaveBeenCalledWith('mysql', expect.arrayContaining([
        expect.stringContaining('SET max_allowed_packet=1073741824')
      ]), expect.anything());
    });

    it('should use fallback init-command when trySetMaxAllowedPacket fails', async () => {
      jest.spyOn(mysqlManager, 'databaseExists').mockResolvedValue(true);
      jest.spyOn(mysqlManager, 'trySetMaxAllowedPacket').mockResolvedValue(false);

      mockMysql.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'close') {
          setTimeout(() => handler(0), 10);
        }
        return mockMysql;
      });

      const restorePromise = mysqlManager.restoreBackup('/tmp/backup.sql.gz', 'testdb');

      setImmediate(() => {
        mockGunzip.emit('end');
        mockMysql.stdin.emit('finish');
      });

      await restorePromise;

      // Should NOT contain SET max_allowed_packet in init-command
      const spawnCall = (spawn as jest.Mock).mock.calls[0];
      const initCommandArg = spawnCall[1].find((arg: string) => arg.startsWith('--init-command='));
      expect(initCommandArg).not.toContain('max_allowed_packet');
    });

    it('should handle restore timeout', async () => {
      jest.useFakeTimers();

      // Mock databaseExists and trySetMaxAllowedPacket to skip async checks
      jest.spyOn(mysqlManager, 'databaseExists').mockResolvedValue(true);
      jest.spyOn(mysqlManager, 'trySetMaxAllowedPacket').mockResolvedValue(true);

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      mockMysql.on.mockImplementation((_event: string, _handler: (...args: unknown[]) => void) => {
        // Don't trigger close event, let it timeout
        return mockMysql;
      });

      const restorePromise = mysqlManager.restoreBackup('/tmp/backup.sql.gz', 'testdb');

      // Flush promises to complete databaseExists and trySetMaxAllowedPacket
      await Promise.resolve();
      await Promise.resolve();

      // Fast forward past the 30-minute timeout
      jest.advanceTimersByTime(31 * 60 * 1000);

      await expect(restorePromise).rejects.toThrow('Restore operation timed out after 30 minutes');

      expect(mockMysql.kill).toHaveBeenCalledWith('SIGTERM');

      jest.useRealTimers();
    });

    it('should handle backup file not found', async () => {
      jest.spyOn(mysqlManager, 'databaseExists').mockResolvedValue(true);
      jest.spyOn(mysqlManager, 'trySetMaxAllowedPacket').mockResolvedValue(true);
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await expect(mysqlManager.restoreBackup('/tmp/nonexistent.sql.gz', 'testdb'))
        .rejects.toThrow('Backup file not found: /tmp/nonexistent.sql.gz');
    });

    it('should handle gunzip error', async () => {
      jest.spyOn(mysqlManager, 'databaseExists').mockResolvedValue(true);
      jest.spyOn(mysqlManager, 'trySetMaxAllowedPacket').mockResolvedValue(true);

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      mockMysql.on.mockImplementation((_event: string, _handler: (...args: unknown[]) => void) => {
        return mockMysql;
      });

      const restorePromise = mysqlManager.restoreBackup('/tmp/backup.sql.gz', 'testdb');

      setImmediate(() => {
        mockGunzip.emit('error', new Error('Invalid gzip data'));
      });

      await expect(restorePromise).rejects.toThrow('Decompression failed: Invalid gzip data');
    });

    it('should handle input stream read error', async () => {
      jest.spyOn(mysqlManager, 'databaseExists').mockResolvedValue(true);
      jest.spyOn(mysqlManager, 'trySetMaxAllowedPacket').mockResolvedValue(true);

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      mockMysql.on.mockImplementation((_event: string, _handler: (...args: unknown[]) => void) => {
        return mockMysql;
      });

      const restorePromise = mysqlManager.restoreBackup('/tmp/backup.sql.gz', 'testdb');

      setImmediate(() => {
        mockInputStream.emit('error', new Error('Read permission denied'));
      });

      await expect(restorePromise).rejects.toThrow('Failed to read backup file: Read permission denied');
    });

    it('should handle database preparation failure', async () => {
      const error = new Error('Cannot check database');
      jest.spyOn(mysqlManager, 'databaseExists').mockRejectedValueOnce(error);

      await expect(mysqlManager.restoreBackup('/tmp/backup.sql.gz', 'testdb'))
        .rejects.toThrow('Database preparation failed: Cannot check database');
    });

    it('should handle failed database creation', async () => {
      jest.spyOn(mysqlManager, 'databaseExists')
        .mockResolvedValueOnce(false)  // First check: doesn't exist
        .mockResolvedValueOnce(false); // After creation: still doesn't exist
      
      jest.spyOn(mysqlManager, 'createDatabase').mockResolvedValueOnce(undefined);

      await expect(mysqlManager.restoreBackup('/tmp/backup.sql.gz', 'newdb'))
        .rejects.toThrow("Failed to create database 'newdb'");
    });

    it('should throttle progress updates', async () => {
      jest.useFakeTimers();
      jest.spyOn(mysqlManager, 'databaseExists').mockResolvedValue(true);
      jest.spyOn(mysqlManager, 'trySetMaxAllowedPacket').mockResolvedValue(true);
      const progressCallback = jest.fn();

      mockMysql.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'close') {
          setTimeout(() => handler(0), 1000);
        }
        return mockMysql;
      });

      const restorePromise = mysqlManager.restoreBackup('/tmp/backup.sql.gz', 'testdb', progressCallback);

      // Flush promises for databaseExists and trySetMaxAllowedPacket
      await Promise.resolve();
      await Promise.resolve();

      // Simulate rapid data chunks
      for (let i = 0; i < 20; i++) {
        mockInputStream.emit('data', Buffer.alloc(100));
        jest.advanceTimersByTime(10); // 10ms between chunks
      }

      // Complete the restore
      jest.advanceTimersByTime(1000);
      mockGunzip.emit('end');
      mockMysql.stdin.emit('finish');

      // Trigger close event
      jest.runAllTimers();

      await restorePromise;

      // Should have throttled updates (not 20 calls)
      expect(progressCallback.mock.calls.length).toBeLessThan(20);
      expect(progressCallback).toHaveBeenCalledWith(expect.objectContaining({
        percentage: 100
      }));

      jest.useRealTimers();
    });

    it('should handle mysql spawn error', async () => {
      // Mock databaseExists and trySetMaxAllowedPacket to skip database creation
      jest.spyOn(mysqlManager, 'databaseExists').mockResolvedValueOnce(true);
      jest.spyOn(mysqlManager, 'trySetMaxAllowedPacket').mockResolvedValue(true);

      const error = new Error('mysql not found');
      mockMysql.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'error') {
          setImmediate(() => handler(error));
        }
        return mockMysql;
      });

      await expect(mysqlManager.restoreBackup('/tmp/backup.sql.gz', 'testdb'))
        .rejects.toThrow('Failed to start mysql: mysql not found');
    });

    it('should handle mysql stderr output', async () => {
      // Mock databaseExists and trySetMaxAllowedPacket to skip database creation
      jest.spyOn(mysqlManager, 'databaseExists').mockResolvedValueOnce(true);
      jest.spyOn(mysqlManager, 'trySetMaxAllowedPacket').mockResolvedValue(true);

      mockMysql.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'close') {
          setTimeout(() => {
            mockMysql.stderr.push('Warning: Using a password on the command line');
            handler(1);
          }, 10);
        }
        return mockMysql;
      });

      await expect(mysqlManager.restoreBackup('/tmp/backup.sql.gz', 'testdb'))
        .rejects.toThrow('MySQL process failed: mysql exited with code 1');
    });
  });
});