#!/usr/bin/env node

/**
 * Verification script to check if database restore was successful
 * This script connects to the database and verifies that all expected data is present
 */

const mysql = require('mysql2/promise');

async function verifyRestore() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'testuser',
    password: process.env.DB_PASSWORD || 'testpass',
    database: process.env.DB_NAME || 'testdb'
  });

  try {
    console.log('Connecting to database...');
    
    // Check tables exist
    console.log('\n1. Checking tables...');
    const [tables] = await connection.execute(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name",
      [process.env.DB_NAME || 'testdb']
    );
    
    const expectedTables = ['activity_logs', 'order_items', 'order_summary', 'orders', 'products', 'users'];
    const actualTables = tables.map(t => t.table_name);
    
    console.log(`   Expected tables: ${expectedTables.join(', ')}`);
    console.log(`   Found tables: ${actualTables.join(', ')}`);
    
    for (const table of expectedTables) {
      if (!actualTables.includes(table)) {
        throw new Error(`Missing table: ${table}`);
      }
    }
    console.log('   ✓ All expected tables found');

    // Check row counts
    console.log('\n2. Checking row counts...');
    const expectedCounts = {
      users: 7,  // 5 initial + 2 with special characters
      products: 11,  // 10 initial + 1 with long description
      orders: 5,
      order_items: 10,
      activity_logs: 6
    };

    for (const [table, expectedCount] of Object.entries(expectedCounts)) {
      const [[{ count }]] = await connection.execute(
        `SELECT COUNT(*) as count FROM ${table}`
      );
      console.log(`   ${table}: ${count} rows (expected: ${expectedCount})`);
      if (count !== expectedCount) {
        throw new Error(`Row count mismatch for ${table}: expected ${expectedCount}, got ${count}`);
      }
    }
    console.log('   ✓ All row counts match');

    // Check specific data integrity
    console.log('\n3. Checking data integrity...');
    
    // Check user with unicode
    const [unicodeUser] = await connection.execute(
      "SELECT * FROM users WHERE username = 'test_unicode'"
    );
    if (unicodeUser.length === 0) {
      throw new Error('Unicode user not found');
    }
    if (!unicodeUser[0].full_name.includes('测试用户')) {
      throw new Error('Unicode data not preserved correctly');
    }
    console.log('   ✓ Unicode data preserved correctly');

    // Check JSON data in activity_logs
    const [jsonLogs] = await connection.execute(
      "SELECT * FROM activity_logs WHERE action = 'login' LIMIT 1"
    );
    if (jsonLogs.length === 0) {
      throw new Error('Activity logs not found');
    }
    const details = JSON.parse(jsonLogs[0].details);
    if (!details.browser || !details.platform) {
      throw new Error('JSON data not preserved correctly');
    }
    console.log('   ✓ JSON data preserved correctly');

    // Check foreign key relationships
    const [orderWithItems] = await connection.execute(`
      SELECT o.id, o.order_number, COUNT(oi.id) as item_count
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      GROUP BY o.id
      HAVING item_count > 0
      LIMIT 1
    `);
    if (orderWithItems.length === 0) {
      throw new Error('Foreign key relationships not preserved');
    }
    console.log('   ✓ Foreign key relationships intact');

    // Check view exists and works
    const [viewData] = await connection.execute(
      "SELECT * FROM order_summary LIMIT 1"
    );
    if (viewData.length === 0) {
      throw new Error('View order_summary not working');
    }
    console.log('   ✓ Database view working correctly');

    // Check stored procedure exists
    const [procedures] = await connection.execute(
      "SELECT routine_name FROM information_schema.routines WHERE routine_schema = ? AND routine_type = 'PROCEDURE'",
      [process.env.DB_NAME || 'testdb']
    );
    const procedureNames = procedures.map(p => p.routine_name);
    if (!procedureNames.includes('GetUserStatistics')) {
      throw new Error('Stored procedure GetUserStatistics not found');
    }
    console.log('   ✓ Stored procedure found');

    // Check trigger exists
    const [triggers] = await connection.execute(
      "SELECT trigger_name FROM information_schema.triggers WHERE trigger_schema = ?",
      [process.env.DB_NAME || 'testdb']
    );
    const triggerNames = triggers.map(t => t.trigger_name);
    if (!triggerNames.includes('update_product_stock_on_order')) {
      throw new Error('Trigger update_product_stock_on_order not found');
    }
    console.log('   ✓ Database trigger found');

    // Check data with special characters
    const [specialUser] = await connection.execute(
      "SELECT * FROM users WHERE username = 'special_chars'"
    );
    if (specialUser.length === 0) {
      throw new Error('User with special characters not found');
    }
    if (!specialUser[0].full_name.includes('!@#$%^&*()')) {
      throw new Error('Special characters not preserved correctly');
    }
    console.log('   ✓ Special characters preserved correctly');

    // Final summary
    console.log('\n✅ All verification checks passed!');
    console.log('The database restore was successful and all data integrity checks passed.');

  } catch (error) {
    console.error('\n❌ Verification failed:', error.message);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

// Run verification
verifyRestore().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});