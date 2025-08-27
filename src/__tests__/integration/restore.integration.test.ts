import { MySQLManager } from '../../modules/mysql';
import { S3Manager } from '../../modules/s3';
import { restoreCommand } from '../../commands/restore';
import { backupCommand } from '../../commands/backup';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createConnection, Connection } from 'mysql2/promise';

// Integration test timeout: 2 minutes
jest.setTimeout(120000);

describe('MySQL Restore Integration Tests', () => {
  let connection: Connection;
  let mysqlManager: MySQLManager;
  let s3Manager: S3Manager;
  
  // Integration tests always run in Docker containers
  // Environment variables are set by docker-compose.test.yml
  const testConfig = {
    database: {
      host: process.env.MYSQL_HOST!,
      port: parseInt(process.env.MYSQL_PORT!),
      user: process.env.MYSQL_USER!,
      password: process.env.MYSQL_PASSWORD!,
      database: process.env.MYSQL_DATABASE!
    },
    s3: {
      bucket: process.env.S3_BUCKET!,
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      endpointUrl: process.env.S3_ENDPOINT_URL!,
      forcePathStyle: true
    }
  };

  beforeAll(async () => {
    // Initialize S3 manager first for service checking
    s3Manager = new S3Manager(testConfig.s3);
    
    // Wait for services to be ready
    await waitForServices();
    
    // Initialize MySQL manager
    mysqlManager = new MySQLManager(testConfig.database);
    
    // Create root connection for database management
    connection = await createConnection({
      host: testConfig.database.host,
      port: testConfig.database.port,
      user: 'root',
      password: process.env.MYSQL_ROOT_PASSWORD!
    });
  });

  afterAll(async () => {
    if (connection) {
      await connection.end();
    }
  });

  beforeEach(async () => {
    // Clean up test databases
    await cleanupTestDatabases();
    
    // Clean up S3 bucket
    await cleanupS3Bucket();
  });

  describe('Database Creation on Restore', () => {
    it('should automatically create database if it does not exist', async () => {
      const testDbName = 'restore_test_new_db';
      const backupKey = `test-backup-${Date.now()}.sql.gz`;
      
      // Step 1: Create a source database with test data
      await connection.execute(`CREATE DATABASE IF NOT EXISTS source_db`);
      await connection.query(`USE source_db`);
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id INT PRIMARY KEY AUTO_INCREMENT,
          name VARCHAR(100),
          email VARCHAR(100)
        )
      `);
      await connection.execute(`
        INSERT INTO users (name, email) VALUES 
        ('John Doe', 'john@example.com'),
        ('Jane Smith', 'jane@example.com')
      `);

      // Step 2: Create a backup
      const tempBackupPath = path.join(os.tmpdir(), `backup-${Date.now()}.sql.gz`);
      const sourceManager = new MySQLManager({
        ...testConfig.database,
        database: 'source_db'
      });
      
      await sourceManager.createBackup(tempBackupPath);
      
      // Step 3: Upload backup to S3
      await s3Manager.uploadFile(tempBackupPath, backupKey);
      fs.unlinkSync(tempBackupPath);

      // Step 4: Verify target database does NOT exist
      const [dbCheckBefore] = await connection.execute(
        'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?',
        [testDbName]
      );
      expect((dbCheckBefore as any[]).length).toBe(0);

      // Step 5: Restore to non-existent database
      const restoreManager = new MySQLManager({
        ...testConfig.database,
        database: testDbName
      });
      
      const tempRestorePath = path.join(os.tmpdir(), `restore-${Date.now()}.sql.gz`);
      await s3Manager.downloadFile(backupKey, tempRestorePath);
      
      // This should create the database automatically
      await restoreManager.restoreBackup(tempRestorePath, testDbName);
      fs.unlinkSync(tempRestorePath);

      // Step 6: Verify database was created and data restored
      const [dbCheckAfter] = await connection.execute(
        'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?',
        [testDbName]
      );
      expect((dbCheckAfter as any[]).length).toBe(1);

      // Verify data was restored
      const [rows] = await connection.execute(`
        SELECT * FROM ${testDbName}.users ORDER BY id
      `);
      expect((rows as any[]).length).toBe(2);
      expect((rows as any[])[0].name).toBe('John Doe');
      expect((rows as any[])[1].name).toBe('Jane Smith');
    });

    it('should restore to existing database without error', async () => {
      const testDbName = 'restore_test_existing_db';
      const backupKey = `test-backup-existing-${Date.now()}.sql.gz`;
      
      // Step 1: Create source and target databases
      await connection.execute(`CREATE DATABASE IF NOT EXISTS source_db2`);
      await connection.execute(`CREATE DATABASE IF NOT EXISTS ${testDbName}`);
      
      // Add test data to source
      await connection.query(`USE source_db2`);
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS products (
          id INT PRIMARY KEY AUTO_INCREMENT,
          name VARCHAR(100),
          price DECIMAL(10, 2)
        )
      `);
      await connection.execute(`
        INSERT INTO products (name, price) VALUES 
        ('Product A', 99.99),
        ('Product B', 149.99)
      `);

      // Step 2: Create and upload backup
      const tempBackupPath = path.join(os.tmpdir(), `backup-${Date.now()}.sql.gz`);
      const sourceManager = new MySQLManager({
        ...testConfig.database,
        database: 'source_db2'
      });
      
      await sourceManager.createBackup(tempBackupPath);
      await s3Manager.uploadFile(tempBackupPath, backupKey);
      fs.unlinkSync(tempBackupPath);

      // Step 3: Restore to existing database
      const restoreManager = new MySQLManager({
        ...testConfig.database,
        database: testDbName
      });
      
      const tempRestorePath = path.join(os.tmpdir(), `restore-${Date.now()}.sql.gz`);
      await s3Manager.downloadFile(backupKey, tempRestorePath);
      
      // Should work without error
      await restoreManager.restoreBackup(tempRestorePath, testDbName);
      fs.unlinkSync(tempRestorePath);

      // Step 4: Verify data was restored
      const [rows] = await connection.execute(`
        SELECT * FROM ${testDbName}.products ORDER BY id
      `);
      expect((rows as any[]).length).toBe(2);
      expect((rows as any[])[0].name).toBe('Product A');
    });
  });

  describe('Full Backup and Restore Cycle', () => {
    it('should handle complete backup and restore workflow with CLI commands', async () => {
      const sourceDb = 'cli_source_db';
      const targetDb = 'cli_target_db';
      
      // Create source database with test data
      await connection.execute(`CREATE DATABASE IF NOT EXISTS ${sourceDb}`);
      await connection.query(`USE ${sourceDb}`);
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS test_data (
          id INT PRIMARY KEY AUTO_INCREMENT,
          value VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await connection.execute(`
        INSERT INTO test_data (value) VALUES 
        ('Test Value 1'),
        ('Test Value 2'),
        ('Test Value 3')
      `);

      // Use CLI backup command with custom name
      // Create a temp config file for testing
      const tempConfigPath = path.join(os.tmpdir(), 'test-config.json');
      fs.writeFileSync(tempConfigPath, JSON.stringify({
        ...testConfig,
        database: { ...testConfig.database, database: sourceDb }
      }));
      
      const customBackupName = `integration-test-${Date.now()}`;
      await backupCommand({
        configFile: tempConfigPath,
        name: customBackupName,
        verbose: false
      });
      
      fs.unlinkSync(tempConfigPath);

      // List backups to verify our custom-named backup exists
      const backups = await s3Manager.listBackups();
      const latestBackup = backups.find(b => b.key === `${customBackupName}.sql.gz`);
      expect(latestBackup).toBeDefined();

      // Use CLI restore command with non-existent target database
      const tempRestoreConfigPath = path.join(os.tmpdir(), 'test-restore-config.json');
      fs.writeFileSync(tempRestoreConfigPath, JSON.stringify(testConfig));
      
      await restoreCommand({
        configFile: tempRestoreConfigPath,
        verbose: false,
        interactive: false,
        backup: latestBackup!.key,
        database: targetDb,
        force: true
      });
      
      fs.unlinkSync(tempRestoreConfigPath);

      // Verify target database was created and data restored
      const [dbCheck] = await connection.execute(
        'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?',
        [targetDb]
      );
      expect((dbCheck as any[]).length).toBe(1);

      // Switch to target database and verify data
      await connection.query(`USE ${targetDb}`);
      const [rows] = await connection.execute(`
        SELECT * FROM test_data ORDER BY id
      `);
      expect((rows as any[]).length).toBe(3);
      expect((rows as any[])[0].value).toBe('Test Value 1');
    });

    it('should handle large database backup and restore', async () => {
      const sourceDb = 'large_db';
      const targetDb = 'large_db_restored';
      
      // Create source database with larger dataset
      await connection.execute(`CREATE DATABASE IF NOT EXISTS ${sourceDb}`);
      await connection.query(`USE ${sourceDb}`);
      
      // Create multiple tables
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS customers (
          id INT PRIMARY KEY AUTO_INCREMENT,
          name VARCHAR(100),
          email VARCHAR(100),
          phone VARCHAR(20),
          address TEXT
        )
      `);
      
      await connection.execute(`
        CREATE TABLE IF NOT EXISTS orders (
          id INT PRIMARY KEY AUTO_INCREMENT,
          customer_id INT,
          order_date DATETIME,
          total DECIMAL(10, 2),
          status VARCHAR(50)
        )
      `);
      
      // Insert bulk data
      const customerValues = [];
      const orderValues = [];
      
      for (let i = 1; i <= 1000; i++) {
        customerValues.push(`('Customer ${i}', 'customer${i}@example.com', '555-${String(i).padStart(4, '0')}', 'Address ${i}')`);
        
        // Each customer has 2-3 orders
        const numOrders = Math.floor(Math.random() * 2) + 2;
        for (let j = 0; j < numOrders; j++) {
          orderValues.push(`(${i}, NOW() - INTERVAL ${j} DAY, ${(Math.random() * 1000).toFixed(2)}, 'completed')`);
        }
      }
      
      // Batch insert customers
      const customerBatches = [];
      for (let i = 0; i < customerValues.length; i += 100) {
        customerBatches.push(customerValues.slice(i, i + 100));
      }
      
      for (const batch of customerBatches) {
        await connection.execute(`
          INSERT INTO customers (name, email, phone, address) VALUES ${batch.join(', ')}
        `);
      }
      
      // Batch insert orders
      const orderBatches = [];
      for (let i = 0; i < orderValues.length; i += 100) {
        orderBatches.push(orderValues.slice(i, i + 100));
      }
      
      for (const batch of orderBatches) {
        await connection.execute(`
          INSERT INTO orders (customer_id, order_date, total, status) VALUES ${batch.join(', ')}
        `);
      }

      // Create backup
      const tempBackupPath = path.join(os.tmpdir(), `large-backup-${Date.now()}.sql.gz`);
      const sourceManager = new MySQLManager({
        ...testConfig.database,
        database: sourceDb
      });
      
      const backupProgress = jest.fn();
      await sourceManager.createBackup(tempBackupPath, backupProgress);
      
      // Verify backup was created and has reasonable size
      const backupStats = fs.statSync(tempBackupPath);
      expect(backupStats.size).toBeGreaterThan(10000); // At least 10KB
      
      // Upload to S3
      const backupKey = `large-test-${Date.now()}.sql.gz`;
      const uploadProgress = jest.fn();
      await s3Manager.uploadFile(tempBackupPath, backupKey, uploadProgress);
      fs.unlinkSync(tempBackupPath);
      
      // Download and restore
      const tempRestorePath = path.join(os.tmpdir(), `large-restore-${Date.now()}.sql.gz`);
      const downloadProgress = jest.fn();
      await s3Manager.downloadFile(backupKey, tempRestorePath, downloadProgress);
      
      const restoreManager = new MySQLManager({
        ...testConfig.database,
        database: targetDb
      });
      
      const restoreProgress = jest.fn();
      await restoreManager.restoreBackup(tempRestorePath, targetDb, restoreProgress);
      fs.unlinkSync(tempRestorePath);
      
      // Verify all progress callbacks were called
      expect(backupProgress).toHaveBeenCalled();
      expect(uploadProgress).toHaveBeenCalled();
      expect(downloadProgress).toHaveBeenCalled();
      expect(restoreProgress).toHaveBeenCalled();
      
      // Verify data integrity - switch to target database first
      await connection.query(`USE ${targetDb}`);
      const [customerCount] = await connection.execute(`
        SELECT COUNT(*) as count FROM customers
      `);
      expect((customerCount as any[])[0].count).toBe(1000);
      
      const [orderCount] = await connection.execute(`
        SELECT COUNT(*) as count FROM orders
      `);
      expect((orderCount as any[])[0].count).toBeGreaterThanOrEqual(2000);
    });
  });

  // Helper functions
  async function waitForServices(maxRetries = 30, interval = 2000): Promise<void> {
    console.log('Waiting for services to be ready...');
    console.log(`MySQL: ${testConfig.database.host}:${testConfig.database.port}`);
    console.log(`S3: ${testConfig.s3.endpointUrl}`);
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        // Check MySQL connectivity
        const testConnection = await createConnection({
          host: testConfig.database.host,
          port: testConfig.database.port,
          user: testConfig.database.user,
          password: testConfig.database.password,
          connectTimeout: 5000
        });
        await testConnection.ping();
        await testConnection.end();
        
        // Check S3 connectivity
        if (!s3Manager) {
          throw new Error('S3Manager not initialized');
        }
        await s3Manager.listBackups();
        
        console.log('✓ All services ready');
        return;
      } catch (error) {
        if (i === maxRetries - 1) {
          console.error('Service check failed:', error);
        }
        console.log(`Waiting... (${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, interval));
      }
    }
    
    throw new Error('Services did not become ready within timeout');
  }

  async function cleanupTestDatabases(): Promise<void> {
    try {
      const [databases] = await connection.execute('SHOW DATABASES');
      const testDbs = (databases as any[])
        .map(row => row.Database)
        .filter(db => 
          db.startsWith('restore_test_') || 
          db.startsWith('cli_') || 
          db.startsWith('source_db') ||
          db.startsWith('large_db')
        );
      
      for (const db of testDbs) {
        await connection.execute(`DROP DATABASE IF EXISTS ${db}`);
      }
    } catch (error) {
      console.error('Error cleaning up databases:', error);
    }
  }

  async function cleanupS3Bucket(): Promise<void> {
    try {
      const backups = await s3Manager.listBackups();
      for (const backup of backups) {
        if (backup.key.includes('test')) {
          // Delete file from S3 (method to be implemented if needed)
          // For now, we'll leave test backups in place
        }
      }
    } catch (error) {
      console.error('Error cleaning up S3 bucket:', error);
    }
  }
});