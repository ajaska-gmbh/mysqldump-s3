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

describe('S3Manager', () => {
  let s3Manager: S3Manager;
  const mockConfig = {
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
    bucket: 'test-bucket',
    region: 'us-east-1'
  };

  beforeEach(() => {
    s3Manager = new S3Manager(mockConfig);
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