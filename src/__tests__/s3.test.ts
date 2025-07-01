import { S3Manager } from '../modules/s3';

// Mock AWS SDK
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn()
  })),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
  ListObjectsV2Command: jest.fn(),
  HeadObjectCommand: jest.fn()
}));

jest.mock('@aws-sdk/lib-storage', () => ({
  Upload: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    done: jest.fn()
  }))
}));

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  statSync: jest.fn(),
  createReadStream: jest.fn(),
  createWriteStream: jest.fn()
}));

describe('S3Manager', () => {
  let s3Manager: S3Manager;
  let mockS3Client: any;
  const mockConfig = {
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
    bucket: 'test-bucket',
    region: 'us-east-1'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    const { S3Client } = require('@aws-sdk/client-s3');
    mockS3Client = {
      send: jest.fn()
    };
    S3Client.mockImplementation(() => mockS3Client);
    
    s3Manager = new S3Manager(mockConfig);
  });

  describe('constructor', () => {
    it('should create S3 client with proper configuration', () => {
      expect(require('@aws-sdk/client-s3').S3Client).toHaveBeenCalledWith({
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret'
        }
      });
    });

    it('should configure custom endpoint if provided', () => {
      const configWithEndpoint = {
        ...mockConfig,
        endpointUrl: 'https://custom-s3.example.com'
      };
      
      new S3Manager(configWithEndpoint);

      expect(require('@aws-sdk/client-s3').S3Client).toHaveBeenCalledWith({
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret'
        },
        endpoint: 'https://custom-s3.example.com',
        forcePathStyle: true
      });
    });
  });

  describe('uploadFile', () => {
    it('should upload file successfully', async () => {
      const fs = require('fs');
      const { Upload } = require('@aws-sdk/lib-storage');
      
      const mockReadStream = {
        on: jest.fn(),
        pipe: jest.fn()
      };

      const mockUpload = {
        on: jest.fn((event, callback) => {
          if (event === 'httpUploadProgress') {
            setTimeout(() => callback({ loaded: 512, total: 1024 }), 10);
          }
        }),
        done: jest.fn().mockResolvedValue({})
      };

      Upload.mockImplementation(() => mockUpload);

      fs.existsSync.mockReturnValue(true);
      fs.statSync.mockReturnValue({ size: 1024 });
      fs.createReadStream.mockReturnValue(mockReadStream);

      const progressCallback = jest.fn();

      await s3Manager.uploadFile('/path/to/file.sql.gz', 'backup.sql.gz', progressCallback);

      expect(Upload).toHaveBeenCalledWith({
        client: mockS3Client,
        params: {
          Bucket: 'test-bucket',
          Key: 'backup.sql.gz',
          Body: mockReadStream,
          ContentType: 'application/gzip'
        }
      });
      expect(mockUpload.done).toHaveBeenCalled();
      expect(fs.existsSync).toHaveBeenCalledWith('/path/to/file.sql.gz');
    });

    it('should throw error if file does not exist', async () => {
      const fs = require('fs');
      fs.existsSync.mockReturnValue(false);

      await expect(s3Manager.uploadFile('/nonexistent/file.sql.gz', 'backup.sql.gz'))
        .rejects.toThrow('File not found: /nonexistent/file.sql.gz');
    });

    it('should handle upload errors', async () => {
      const fs = require('fs');
      const { Upload } = require('@aws-sdk/lib-storage');
      
      const mockReadStream = {
        on: jest.fn(),
        pipe: jest.fn()
      };

      const mockUpload = {
        on: jest.fn(),
        done: jest.fn().mockRejectedValue(new Error('Upload failed'))
      };

      Upload.mockImplementation(() => mockUpload);

      fs.existsSync.mockReturnValue(true);
      fs.statSync.mockReturnValue({ size: 1024 });
      fs.createReadStream.mockReturnValue(mockReadStream);

      await expect(s3Manager.uploadFile('/path/to/file.sql.gz', 'backup.sql.gz'))
        .rejects.toThrow('Failed to upload to S3: Error: Upload failed');
    });
  });

  describe('downloadFile', () => {
    it('should download file successfully', async () => {
      const mockWriteStream = {
        on: jest.fn()
      };
      const mockReadableStream = {
        on: jest.fn((event, callback) => {
          if (event === 'data') {
            setTimeout(() => callback(Buffer.alloc(512)), 10);
          } else if (event === 'end') {
            setTimeout(() => callback(), 20);
          }
        }),
        pipe: jest.fn()
      };

      mockS3Client.send
        .mockResolvedValueOnce({ ContentLength: 1024 }) // HEAD request
        .mockResolvedValueOnce({ Body: mockReadableStream }); // GET request

      const fs = require('fs');
      fs.createWriteStream.mockReturnValue(mockWriteStream);

      const progressCallback = jest.fn();

      await s3Manager.downloadFile('backup.sql.gz', '/tmp/backup.sql.gz', progressCallback);

      expect(mockS3Client.send).toHaveBeenCalledTimes(2);
    });

    it('should handle download errors', async () => {
      mockS3Client.send.mockRejectedValue(new Error('Download failed'));

      await expect(s3Manager.downloadFile('backup.sql.gz', '/tmp/backup.sql.gz'))
        .rejects.toThrow('Failed to download from S3: Error: Download failed');
    });
  });

  describe('listBackups', () => {
    it('should list backups successfully', async () => {
      const mockResponse = {
        Contents: [
          {
            Key: 'mydb-2023-12-01T10-30-00-000Z.sql.gz',
            LastModified: new Date('2023-12-01T10:30:00Z'),
            Size: 1572864
          },
          {
            Key: 'otherdb-2023-12-02T11-30-00-000Z.sql.gz',
            LastModified: new Date('2023-12-02T11:30:00Z'),
            Size: 2097152
          },
          {
            Key: 'notabackup.txt',
            LastModified: new Date('2023-12-01T10:30:00Z'),
            Size: 100
          }
        ]
      };

      mockS3Client.send.mockResolvedValue(mockResponse);

      const backups = await s3Manager.listBackups();

      expect(backups).toHaveLength(2); // Should exclude non-.sql.gz files
      expect(backups[0].key).toBe('otherdb-2023-12-02T11-30-00-000Z.sql.gz'); // Should be sorted by date desc
      expect(backups[1].key).toBe('mydb-2023-12-01T10-30-00-000Z.sql.gz');
    });

    it('should handle empty bucket', async () => {
      mockS3Client.send.mockResolvedValue({ Contents: [] });

      const backups = await s3Manager.listBackups();

      expect(backups).toEqual([]);
    });

    it('should handle list errors', async () => {
      mockS3Client.send.mockRejectedValue(new Error('List failed'));

      await expect(s3Manager.listBackups())
        .rejects.toThrow('Failed to list backups from S3: Error: List failed');
    });
  });

  describe('backupExists', () => {
    it('should return true if backup exists', async () => {
      mockS3Client.send.mockResolvedValue({});

      const exists = await s3Manager.backupExists('backup.sql.gz');

      expect(exists).toBe(true);
    });

    it('should return false if backup does not exist', async () => {
      const error = new Error('Not found');
      error.name = 'NotFound';
      mockS3Client.send.mockRejectedValue(error);

      const exists = await s3Manager.backupExists('nonexistent.sql.gz');

      expect(exists).toBe(false);
    });

    it('should return false for 404 status code', async () => {
      const error = new Error('Not found');
      (error as any).$metadata = { httpStatusCode: 404 };
      mockS3Client.send.mockRejectedValue(error);

      const exists = await s3Manager.backupExists('nonexistent.sql.gz');

      expect(exists).toBe(false);
    });

    it('should rethrow other errors', async () => {
      const error = new Error('Access denied');
      mockS3Client.send.mockRejectedValue(error);

      await expect(s3Manager.backupExists('backup.sql.gz'))
        .rejects.toThrow('Failed to check if backup exists: Error: Access denied');
    });
  });

  describe('extractDisplayName', () => {
    it('should extract display name from S3 key', () => {
      const testCases = [
        {
          key: 'mydb-2023-12-01T10-30-00-000Z.sql.gz',
          expected: 'mydb (2023-12-01 10:30:00)'
        },
        {
          key: 'all-2023-12-01T10-30-00-000Z.sql.gz',
          expected: 'all (2023-12-01 10:30:00)'
        },
        {
          key: 'custom-backup.sql.gz',
          expected: 'custom-backup.sql.gz'
        }
      ];

      testCases.forEach(({ key, expected }) => {
        const displayName = (s3Manager as any).extractDisplayName(key);
        expect(displayName).toBe(expected);
      });
    });
  });

  describe('formatFileSize', () => {
    it('should format file sizes correctly', () => {
      const testCases = [
        { bytes: 0, expected: '0 Bytes' },
        { bytes: 1024, expected: '1 KB' },
        { bytes: 1048576, expected: '1 MB' },
        { bytes: 1073741824, expected: '1 GB' },
        { bytes: 1536, expected: '1.5 KB' }
      ];

      testCases.forEach(({ bytes, expected }) => {
        const formatted = s3Manager.formatFileSize(bytes);
        expect(formatted).toBe(expected);
      });
    });
  });
});