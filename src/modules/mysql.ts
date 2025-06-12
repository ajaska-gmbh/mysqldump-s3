import { spawn, ChildProcess } from 'child_process';
import { createConnection, Connection } from 'mysql2/promise';
import * as zlib from 'zlib';
import * as fs from 'fs';
import * as path from 'path';
import { DatabaseConfig, ProgressCallback } from '../types';
import { progressTracker } from './progress';

export class MySQLManager {
  constructor(private config: DatabaseConfig) {}

  public async testConnection(): Promise<void> {
    const connection = await createConnection({
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database
    });
    
    await connection.ping();
    await connection.end();
  }

  public async listDatabases(): Promise<string[]> {
    const connection = await createConnection({
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password
    });

    try {
      const [rows] = await connection.execute('SHOW DATABASES');
      const databases = (rows as any[])
        .map(row => row.Database)
        .filter(db => !['information_schema', 'performance_schema', 'mysql', 'sys'].includes(db));
      
      return databases;
    } finally {
      await connection.end();
    }
  }

  public async createBackup(outputPath: string, progressCallback?: ProgressCallback): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        '-h', this.config.host,
        '-P', this.config.port.toString(),
        '-u', this.config.user,
        `-p${this.config.password}`,
        '--compress',
        '--verbose',
        '--lock-tables=false'
      ];

      if (this.config.database) {
        args.push(this.config.database);
      } else {
        args.push('--all-databases');
      }

      const mysqldump = spawn('mysqldump', args);
      const gzip = zlib.createGzip();
      const output = fs.createWriteStream(outputPath);

      let totalBytes = 0;
      let error = '';

      // Track progress if callback provided
      if (progressCallback) {
        gzip.on('data', (chunk) => {
          totalBytes += chunk.length;
          progressCallback({ loaded: totalBytes });
        });
      }

      // Handle mysqldump errors
      mysqldump.stderr.on('data', (data) => {
        error += data.toString();
      });

      mysqldump.on('error', (err) => {
        reject(new Error(`Failed to start mysqldump: ${err.message}`));
      });

      mysqldump.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`mysqldump exited with code ${code}: ${error}`));
        }
      });

      // Handle gzip errors
      gzip.on('error', (err) => {
        reject(new Error(`Compression failed: ${err.message}`));
      });

      // Handle output file errors
      output.on('error', (err) => {
        reject(new Error(`Failed to write backup file: ${err.message}`));
      });

      output.on('finish', () => {
        if (progressCallback) {
          progressCallback({ loaded: totalBytes, percentage: 100 });
        }
        resolve();
      });

      // Pipe data through compression to output file
      mysqldump.stdout.pipe(gzip).pipe(output);
    });
  }

  public async restoreBackup(backupPath: string, targetDatabase: string, progressCallback?: ProgressCallback): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(backupPath)) {
        reject(new Error(`Backup file not found: ${backupPath}`));
        return;
      }

      const stats = fs.statSync(backupPath);
      const totalSize = stats.size;
      let processedBytes = 0;

      const gunzip = zlib.createGunzip();
      const mysql = spawn('mysql', [
        '-h', this.config.host,
        '-P', this.config.port.toString(),
        '-u', this.config.user,
        `-p${this.config.password}`,
        targetDatabase
      ]);

      const input = fs.createReadStream(backupPath);
      let error = '';

      // Track progress if callback provided
      if (progressCallback) {
        input.on('data', (chunk) => {
          processedBytes += chunk.length;
          const percentage = (processedBytes / totalSize) * 100;
          progressCallback({ 
            loaded: processedBytes, 
            total: totalSize, 
            percentage 
          });
        });
      }

      // Handle mysql errors
      mysql.stderr.on('data', (data) => {
        error += data.toString();
      });

      mysql.on('error', (err) => {
        reject(new Error(`Failed to start mysql: ${err.message}`));
      });

      mysql.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`mysql exited with code ${code}: ${error}`));
        } else {
          if (progressCallback) {
            progressCallback({ loaded: totalSize, total: totalSize, percentage: 100 });
          }
          resolve();
        }
      });

      // Handle gunzip errors
      gunzip.on('error', (err) => {
        reject(new Error(`Decompression failed: ${err.message}`));
      });

      // Handle input file errors
      input.on('error', (err) => {
        reject(new Error(`Failed to read backup file: ${err.message}`));
      });

      // Pipe data through decompression to mysql
      input.pipe(gunzip).pipe(mysql.stdin);
    });
  }

  public async databaseExists(databaseName: string): Promise<boolean> {
    const connection = await createConnection({
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password
    });

    try {
      const [rows] = await connection.execute(
        'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?',
        [databaseName]
      );
      return (rows as any[]).length > 0;
    } finally {
      await connection.end();
    }
  }
}