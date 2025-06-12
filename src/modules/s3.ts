import { 
  S3Client, 
  PutObjectCommand, 
  GetObjectCommand, 
  ListObjectsV2Command,
  HeadObjectCommand 
} from '@aws-sdk/client-s3';
import * as fs from 'fs';
import { S3Config, BackupInfo, ProgressCallback } from '../types';

export class S3Manager {
  private s3Client: S3Client;

  constructor(private config: S3Config) {
    const clientConfig: any = {
      region: config.region || 'us-east-1',
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    };

    if (config.endpointUrl) {
      clientConfig.endpoint = config.endpointUrl;
      clientConfig.forcePathStyle = true;
    }

    this.s3Client = new S3Client(clientConfig);
  }

  public async uploadFile(
    filePath: string, 
    key: string, 
    progressCallback?: ProgressCallback
  ): Promise<void> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const stats = fs.statSync(filePath);
    const fileSize = stats.size;
    const fileStream = fs.createReadStream(filePath);

    let uploadedBytes = 0;

    if (progressCallback) {
      fileStream.on('data', (chunk) => {
        uploadedBytes += chunk.length;
        const percentage = (uploadedBytes / fileSize) * 100;
        progressCallback({
          loaded: uploadedBytes,
          total: fileSize,
          percentage
        });
      });
    }

    const uploadCommand = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: fileStream,
      ContentType: 'application/gzip'
    });

    try {
      await this.s3Client.send(uploadCommand);
      if (progressCallback) {
        progressCallback({ loaded: fileSize, total: fileSize, percentage: 100 });
      }
    } catch (error) {
      throw new Error(`Failed to upload to S3: ${error}`);
    }
  }

  public async downloadFile(
    key: string, 
    outputPath: string, 
    progressCallback?: ProgressCallback
  ): Promise<void> {
    try {
      // Get object size first
      const headCommand = new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: key
      });
      
      const headResponse = await this.s3Client.send(headCommand);
      const totalSize = headResponse.ContentLength || 0;

      // Download object
      const downloadCommand = new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key
      });

      const response = await this.s3Client.send(downloadCommand);
      
      if (!response.Body) {
        throw new Error('Empty response body from S3');
      }

      const writeStream = fs.createWriteStream(outputPath);
      let downloadedBytes = 0;

      return new Promise((resolve, reject) => {
        const readableStream = response.Body as NodeJS.ReadableStream;

        readableStream.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (progressCallback && totalSize > 0) {
            const percentage = (downloadedBytes / totalSize) * 100;
            progressCallback({
              loaded: downloadedBytes,
              total: totalSize,
              percentage
            });
          }
        });

        readableStream.on('error', (error) => {
          reject(new Error(`Failed to download from S3: ${error}`));
        });

        readableStream.on('end', () => {
          if (progressCallback) {
            progressCallback({ 
              loaded: downloadedBytes, 
              total: totalSize, 
              percentage: 100 
            });
          }
          resolve();
        });

        writeStream.on('error', (error) => {
          reject(new Error(`Failed to write file: ${error}`));
        });

        readableStream.pipe(writeStream);
      });
    } catch (error) {
      throw new Error(`Failed to download from S3: ${error}`);
    }
  }

  public async listBackups(prefix?: string): Promise<BackupInfo[]> {
    try {
      const listCommand = new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: prefix
      });

      const response = await this.s3Client.send(listCommand);
      const objects = response.Contents || [];

      return objects
        .filter(obj => obj.Key?.endsWith('.sql.gz'))
        .map(obj => ({
          key: obj.Key!,
          lastModified: obj.LastModified!,
          size: obj.Size || 0,
          displayName: this.extractDisplayName(obj.Key!)
        }))
        .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
    } catch (error) {
      throw new Error(`Failed to list backups from S3: ${error}`);
    }
  }

  public async backupExists(key: string): Promise<boolean> {
    try {
      const headCommand = new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: key
      });
      
      await this.s3Client.send(headCommand);
      return true;
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw new Error(`Failed to check if backup exists: ${error}`);
    }
  }

  public async getBackupInfo(key: string): Promise<BackupInfo> {
    try {
      const headCommand = new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: key
      });
      
      const response = await this.s3Client.send(headCommand);
      
      return {
        key,
        lastModified: response.LastModified!,
        size: response.ContentLength || 0,
        displayName: this.extractDisplayName(key)
      };
    } catch (error) {
      throw new Error(`Failed to get backup info: ${error}`);
    }
  }

  private extractDisplayName(key: string): string {
    // Extract meaningful name from S3 key
    // e.g., "mydb-2023-12-01T10-30-00Z.sql.gz" -> "mydb (2023-12-01 10:30:00)"
    const basename = key.split('/').pop() || key;
    const match = basename.match(/^(.+)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)\.sql\.gz$/);
    
    if (match) {
      const [, dbName, timestamp] = match;
      const date = timestamp.replace(/T(\d{2})-(\d{2})-(\d{2})Z/, ' $1:$2:$3');
      return `${dbName} (${date})`;
    }
    
    return basename;
  }

  public formatFileSize(bytes: number): string {
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }
}