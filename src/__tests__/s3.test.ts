import { S3Client, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import { Readable, Writable } from 'stream';
import { S3Config } from '../types';

// Store mock upload for test access
let mockUploadInstance: { on: jest.Mock; done: jest.Mock };

jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/lib-storage', () => ({
  Upload: jest.fn().mockImplementation(() => {
    mockUploadInstance = {
      on: jest.fn().mockReturnThis(),
      done: jest.fn().mockResolvedValue({})
    };
    return mockUploadInstance;
  })
}));
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  statSync: jest.fn(),
  readFileSync: jest.fn(),
  createReadStream: jest.fn(),
  createWriteStream: jest.fn(),
  unlinkSync: jest.fn(),
  promises: jest.requireActual('fs').promises
}));

// Import S3Manager after mocks are set up
import { S3Manager } from '../modules/s3';

describe('S3Manager', () => {
  let s3Manager: S3Manager;
  let mockS3Client: jest.Mocked<S3Client>;
  const mockConfig: S3Config = {
    bucket: 'test-bucket',
    region: 'us-west-2',
    accessKeyId: 'test-access-key',
    secretAccessKey: 'test-secret-key'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockS3Client = {
      send: jest.fn()
    } as any;
    (S3Client as jest.Mock).mockImplementation(() => mockS3Client);
    s3Manager = new S3Manager(mockConfig);
  });

  describe('constructor', () => {
    it('should initialize S3Client with basic config', () => {
      new S3Manager(mockConfig);
      expect(S3Client).toHaveBeenCalledWith({
        region: 'us-west-2',
        credentials: {
          accessKeyId: 'test-access-key',
          secretAccessKey: 'test-secret-key'
        }
      });
    });

    it('should use default region when not specified', () => {
      const configWithoutRegion = { ...mockConfig, region: undefined };
      new S3Manager(configWithoutRegion);
      expect(S3Client).toHaveBeenCalledWith({
        region: 'us-east-1',
        credentials: expect.any(Object)
      });
    });

    it('should configure endpoint and forcePathStyle for custom endpoints', () => {
      const configWithEndpoint: S3Config = {
        ...mockConfig,
        endpointUrl: 'http://localhost:9000'
      };
      new S3Manager(configWithEndpoint);
      expect(S3Client).toHaveBeenCalledWith({
        region: 'us-west-2',
        credentials: expect.any(Object),
        endpoint: 'http://localhost:9000',
        forcePathStyle: true
      });
    });
  });

  describe('uploadFile', () => {
    const testFilePath = '/test/file.sql.gz';
    const testKey = 'backups/test.sql.gz';
    let mockReadStream: any;

    beforeEach(() => {
      mockReadStream = { destroy: jest.fn() };
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.statSync as jest.Mock).mockReturnValue({ size: 1024 });
      (fs.createReadStream as jest.Mock).mockReturnValue(mockReadStream);
    });

    it('should upload file successfully', async () => {
      await s3Manager.uploadFile(testFilePath, testKey);

      expect(fs.existsSync).toHaveBeenCalledWith(testFilePath);
      expect(fs.statSync).toHaveBeenCalledWith(testFilePath);
      expect(fs.createReadStream).toHaveBeenCalledWith(testFilePath);
      expect(mockUploadInstance.done).toHaveBeenCalled();
    });

    it('should throw error when file does not exist', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await expect(s3Manager.uploadFile(testFilePath, testKey))
        .rejects.toThrow('File not found: /test/file.sql.gz');
    });

    it('should report progress during upload', async () => {
      const progressCallback = jest.fn();

      await s3Manager.uploadFile(testFilePath, testKey, progressCallback);

      // Initial progress should be reported
      expect(progressCallback).toHaveBeenCalledWith({
        loaded: 0,
        total: 1024,
        percentage: 0
      });
      // Completion progress should be reported
      expect(progressCallback).toHaveBeenCalledWith({
        loaded: 1024,
        total: 1024,
        percentage: 100
      });
    });

    it('should handle upload errors', async () => {
      // Import Upload to configure the mock for this specific test
      const { Upload } = require('@aws-sdk/lib-storage');
      Upload.mockImplementationOnce(() => ({
        on: jest.fn().mockReturnThis(),
        done: jest.fn().mockRejectedValue(new Error('Network error'))
      }));

      await expect(s3Manager.uploadFile(testFilePath, testKey))
        .rejects.toThrow('Failed to upload to S3: Error: Network error');
    });

    it('should configure Upload with correct parameters', async () => {
      const { Upload } = require('@aws-sdk/lib-storage');

      await s3Manager.uploadFile(testFilePath, testKey);

      expect(Upload).toHaveBeenCalledWith(expect.objectContaining({
        params: expect.objectContaining({
          Bucket: 'test-bucket',
          Key: testKey,
          ContentType: 'application/gzip'
        })
      }));
    });
  });

  describe('downloadFile', () => {
    const testKey = 'backups/test.sql.gz';
    const outputPath = '/tmp/output.sql.gz';

    it('should download file successfully', async () => {
      const mockStream = new Readable();
      mockStream.push('test data chunk 1');
      mockStream.push('test data chunk 2');
      mockStream.push(null);

      (mockS3Client.send as jest.Mock)
        .mockResolvedValueOnce({ ContentLength: 33 }) // HeadObjectCommand
        .mockResolvedValueOnce({ Body: mockStream }); // GetObjectCommand

      const mockWriteStream = new Writable({
        write(chunk, encoding, callback) {
          callback();
        }
      });
      (fs.createWriteStream as jest.Mock).mockReturnValue(mockWriteStream);

      const downloadPromise = s3Manager.downloadFile(testKey, outputPath);
      
      // Simulate successful write
      setImmediate(() => {
        mockWriteStream.emit('finish');
      });

      await downloadPromise;

      expect(mockS3Client.send as jest.Mock).toHaveBeenCalledTimes(2);
      expect(fs.createWriteStream).toHaveBeenCalledWith(outputPath);
    });

    it('should report download progress', async () => {
      const progressCallback = jest.fn();
      const mockStream = new Readable();
      
      (mockS3Client.send as jest.Mock)
        .mockResolvedValueOnce({ ContentLength: 100 })
        .mockResolvedValueOnce({ Body: mockStream });

      const mockWriteStream = new Writable({
        write(chunk, encoding, callback) {
          callback();
        }
      });
      (fs.createWriteStream as jest.Mock).mockReturnValue(mockWriteStream);

      const downloadPromise = s3Manager.downloadFile(testKey, outputPath, progressCallback);

      // Simulate data chunks
      mockStream.push(Buffer.alloc(50));
      mockStream.push(Buffer.alloc(50));
      mockStream.push(null);

      setImmediate(() => {
        mockWriteStream.emit('finish');
      });

      await downloadPromise;

      expect(progressCallback).toHaveBeenCalledWith(expect.objectContaining({
        percentage: 100
      }));
    });

    it('should handle missing response body', async () => {
      (mockS3Client.send as jest.Mock)
        .mockResolvedValueOnce({ ContentLength: 100 })
        .mockResolvedValueOnce({ Body: null });

      await expect(s3Manager.downloadFile(testKey, outputPath))
        .rejects.toThrow('Empty response body from S3');
    });

    it('should handle download errors', async () => {
      (mockS3Client.send as jest.Mock).mockRejectedValueOnce(new Error('Access denied'));

      await expect(s3Manager.downloadFile(testKey, outputPath))
        .rejects.toThrow('Failed to download from S3: Error: Access denied');
    });

    it('should handle stream errors', async () => {
      const mockStream = new Readable({ read() {} });
      (mockS3Client.send as jest.Mock)
        .mockResolvedValueOnce({ ContentLength: 100 })
        .mockResolvedValueOnce({ Body: mockStream });

      const mockWriteStream = new Writable({ write(chunk, enc, cb) { cb(); } });
      (fs.createWriteStream as jest.Mock).mockReturnValue(mockWriteStream);

      const downloadPromise = s3Manager.downloadFile(testKey, outputPath);

      setImmediate(() => {
        mockStream.destroy(new Error('Stream error'));
      });

      await expect(downloadPromise).rejects.toThrow('Failed to download from S3: Error: Stream error');
    });

    it('should handle write stream errors', async () => {
      const mockStream = new Readable({ read() {} });
      (mockS3Client.send as jest.Mock)
        .mockResolvedValueOnce({ ContentLength: 100 })
        .mockResolvedValueOnce({ Body: mockStream });

      const mockWriteStream = new Writable({ write(chunk, enc, cb) { cb(); } });
      (fs.createWriteStream as jest.Mock).mockReturnValue(mockWriteStream);

      const downloadPromise = s3Manager.downloadFile(testKey, outputPath);

      setImmediate(() => {
        mockWriteStream.destroy(new Error('Disk full'));
      });

      await expect(downloadPromise).rejects.toThrow('Failed to write file: Error: Disk full');
    });
  });

  describe('listBackups', () => {
    it('should list backups sorted by date', async () => {
      const mockObjects = {
        Contents: [
          {
            Key: 'backup-2023-01-01T10-00-00-000Z.sql.gz',
            LastModified: new Date('2023-01-01'),
            Size: 1024
          },
          {
            Key: 'backup-2023-01-02T10-00-00-000Z.sql.gz',
            LastModified: new Date('2023-01-02'),
            Size: 2048
          },
          {
            Key: 'test.txt', // Should be filtered out
            LastModified: new Date('2023-01-03'),
            Size: 512
          }
        ]
      };

      (mockS3Client.send as jest.Mock).mockResolvedValueOnce(mockObjects);

      const backups = await s3Manager.listBackups('backup');

      expect(backups).toHaveLength(2);
      expect(backups[0].key).toBe('backup-2023-01-02T10-00-00-000Z.sql.gz');
      expect(backups[1].key).toBe('backup-2023-01-01T10-00-00-000Z.sql.gz');
      expect(mockS3Client.send as jest.Mock).toHaveBeenCalledWith(expect.any(ListObjectsV2Command));
    });

    it('should handle empty bucket', async () => {
      (mockS3Client.send as jest.Mock).mockResolvedValueOnce({ Contents: [] });

      const backups = await s3Manager.listBackups();

      expect(backups).toEqual([]);
    });

    it('should handle undefined Contents', async () => {
      (mockS3Client.send as jest.Mock).mockResolvedValueOnce({});

      const backups = await s3Manager.listBackups();

      expect(backups).toEqual([]);
    });

    it('should extract display names correctly', async () => {
      const mockObjects = {
        Contents: [
          {
            Key: 'mydb-2023-12-01T10-30-00-000Z.sql.gz',
            LastModified: new Date('2023-12-01'),
            Size: 1024
          }
        ]
      };

      (mockS3Client.send as jest.Mock).mockResolvedValueOnce(mockObjects);

      const backups = await s3Manager.listBackups();

      expect(backups[0].displayName).toBe('mydb (2023-12-01 10:30:00)');
    });

    it('should handle list errors', async () => {
      (mockS3Client.send as jest.Mock).mockRejectedValueOnce(new Error('Bucket not found'));

      await expect(s3Manager.listBackups())
        .rejects.toThrow('Failed to list backups from S3: Error: Bucket not found');
    });

    it('should use prefix when provided', async () => {
      (mockS3Client.send as jest.Mock).mockResolvedValueOnce({ Contents: [] });

      await s3Manager.listBackups('prod/');

      // Verify ListObjectsV2Command was called with correct parameters
      expect(ListObjectsV2Command).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Prefix: 'prod/'
      });
    });
  });

  describe('backupExists', () => {
    const testKey = 'backups/test.sql.gz';

    it('should return true when backup exists', async () => {
      (mockS3Client.send as jest.Mock).mockResolvedValueOnce({});

      const exists = await s3Manager.backupExists(testKey);

      expect(exists).toBe(true);
      expect(mockS3Client.send as jest.Mock).toHaveBeenCalledWith(expect.any(HeadObjectCommand));
    });

    it('should return false for NotFound error', async () => {
      const error = { name: 'NotFound' };
      (mockS3Client.send as jest.Mock).mockRejectedValueOnce(error);

      const exists = await s3Manager.backupExists(testKey);

      expect(exists).toBe(false);
    });

    it('should return false for 404 status code', async () => {
      const error = { 
        $metadata: { httpStatusCode: 404 } 
      };
      (mockS3Client.send as jest.Mock).mockRejectedValueOnce(error);

      const exists = await s3Manager.backupExists(testKey);

      expect(exists).toBe(false);
    });

    it('should rethrow other errors', async () => {
      (mockS3Client.send as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      await expect(s3Manager.backupExists(testKey))
        .rejects.toThrow('Failed to check if backup exists: Error: Network error');
    });
  });

  describe('getBackupInfo', () => {
    const testKey = 'mydb-2023-12-01T10-30-00-000Z.sql.gz';

    it('should get backup info successfully', async () => {
      const mockResponse = {
        LastModified: new Date('2023-12-01'),
        ContentLength: 2048
      };
      (mockS3Client.send as jest.Mock).mockResolvedValueOnce(mockResponse);

      const info = await s3Manager.getBackupInfo(testKey);

      expect(info).toEqual({
        key: testKey,
        lastModified: new Date('2023-12-01'),
        size: 2048,
        displayName: 'mydb (2023-12-01 10:30:00)'
      });
    });

    it('should handle missing content length', async () => {
      const mockResponse = {
        LastModified: new Date('2023-12-01'),
        ContentLength: undefined
      };
      (mockS3Client.send as jest.Mock).mockResolvedValueOnce(mockResponse);

      const info = await s3Manager.getBackupInfo(testKey);

      expect(info.size).toBe(0);
    });

    it('should handle errors', async () => {
      (mockS3Client.send as jest.Mock).mockRejectedValueOnce(new Error('Access denied'));

      await expect(s3Manager.getBackupInfo(testKey))
        .rejects.toThrow('Failed to get backup info: Error: Access denied');
    });
  });

  describe('formatFileSize', () => {
    it('should format bytes correctly', () => {
      expect(s3Manager.formatFileSize(0)).toBe('0 Bytes');
      expect(s3Manager.formatFileSize(512)).toBe('512 Bytes');
      expect(s3Manager.formatFileSize(1024)).toBe('1 KB');
      expect(s3Manager.formatFileSize(1536)).toBe('1.5 KB');
      expect(s3Manager.formatFileSize(1048576)).toBe('1 MB');
      expect(s3Manager.formatFileSize(1073741824)).toBe('1 GB');
      expect(s3Manager.formatFileSize(1099511627776)).toBe('1 TB');
    });
  });

  describe('extractDisplayName', () => {
    it('should extract display name from standard format', () => {
      const key = 'mydb-2023-12-01T10-30-00-000Z.sql.gz';
      // @ts-expect-error - accessing private method for testing
      const displayName = s3Manager.extractDisplayName(key);
      expect(displayName).toBe('mydb (2023-12-01 10:30:00)');
    });

    it('should handle nested paths', () => {
      const key = 'backups/prod/mydb-2023-12-01T10-30-00-000Z.sql.gz';
      // @ts-expect-error - accessing private method for testing
      const displayName = s3Manager.extractDisplayName(key);
      expect(displayName).toBe('mydb (2023-12-01 10:30:00)');
    });

    it('should return basename for non-standard format', () => {
      const key = 'custom-backup.sql.gz';
      // @ts-expect-error - accessing private method for testing
      const displayName = s3Manager.extractDisplayName(key);
      expect(displayName).toBe('custom-backup.sql.gz');
    });

    it('should handle empty key', () => {
      // @ts-expect-error - accessing private method for testing
      const displayName = s3Manager.extractDisplayName('');
      expect(displayName).toBe('');
    });
  });
});