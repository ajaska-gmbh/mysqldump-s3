-- Test data for integration testing
-- This script creates sample tables and data to verify backup/restore functionality

-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    full_name VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    INDEX idx_username (username),
    INDEX idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create products table
CREATE TABLE IF NOT EXISTS products (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    stock_quantity INT NOT NULL DEFAULT 0,
    category VARCHAR(50),
    sku VARCHAR(50) UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_category (category),
    INDEX idx_sku (sku)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create orders table
CREATE TABLE IF NOT EXISTS orders (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    order_number VARCHAR(50) NOT NULL UNIQUE,
    status ENUM('pending', 'processing', 'shipped', 'delivered', 'cancelled') DEFAULT 'pending',
    total_amount DECIMAL(10, 2) NOT NULL,
    shipping_address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_order_number (order_number),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create order_items table
CREATE TABLE IF NOT EXISTS order_items (
    id INT PRIMARY KEY AUTO_INCREMENT,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL,
    unit_price DECIMAL(10, 2) NOT NULL,
    total_price DECIMAL(10, 2) NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    INDEX idx_order_id (order_id),
    INDEX idx_product_id (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create logs table with different data types
CREATE TABLE IF NOT EXISTS activity_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id INT,
    action VARCHAR(100) NOT NULL,
    details JSON,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_user_action (user_id, action),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert test users
INSERT INTO users (username, email, full_name, is_active) VALUES
('john_doe', 'john@example.com', 'John Doe', TRUE),
('jane_smith', 'jane@example.com', 'Jane Smith', TRUE),
('bob_wilson', 'bob@example.com', 'Bob Wilson', TRUE),
('alice_jones', 'alice@example.com', 'Alice Jones', FALSE),
('charlie_brown', 'charlie@example.com', 'Charlie Brown', TRUE);

-- Insert test products
INSERT INTO products (name, description, price, stock_quantity, category, sku) VALUES
('Laptop Pro 15', 'High-performance laptop with 15-inch display', 1299.99, 25, 'Electronics', 'LAP-PRO-15'),
('Wireless Mouse', 'Ergonomic wireless mouse with precision tracking', 49.99, 150, 'Electronics', 'MS-WL-001'),
('Office Chair', 'Comfortable ergonomic office chair with lumbar support', 299.99, 40, 'Furniture', 'CHR-OFF-001'),
('Standing Desk', 'Adjustable height standing desk', 599.99, 20, 'Furniture', 'DSK-STD-001'),
('USB-C Hub', '7-in-1 USB-C hub with multiple ports', 79.99, 200, 'Electronics', 'HUB-USBC-001'),
('Mechanical Keyboard', 'RGB mechanical keyboard with Cherry MX switches', 149.99, 75, 'Electronics', 'KB-MECH-001'),
('Monitor 27"', '4K UHD monitor with HDR support', 449.99, 35, 'Electronics', 'MON-27-4K'),
('Desk Lamp', 'LED desk lamp with adjustable brightness', 39.99, 100, 'Furniture', 'LMP-DSK-001'),
('Webcam HD', '1080p HD webcam with noise cancellation', 89.99, 80, 'Electronics', 'CAM-HD-001'),
('Notebook Set', 'Premium notebook set with pen', 24.99, 300, 'Stationery', 'NB-SET-001');

-- Insert test orders
INSERT INTO orders (user_id, order_number, status, total_amount, shipping_address) VALUES
(1, 'ORD-2024-0001', 'delivered', 1349.98, '123 Main St, New York, NY 10001'),
(2, 'ORD-2024-0002', 'shipped', 679.98, '456 Oak Ave, Los Angeles, CA 90001'),
(1, 'ORD-2024-0003', 'processing', 229.97, '123 Main St, New York, NY 10001'),
(3, 'ORD-2024-0004', 'pending', 899.98, '789 Pine Rd, Chicago, IL 60601'),
(2, 'ORD-2024-0005', 'delivered', 449.99, '456 Oak Ave, Los Angeles, CA 90001');

-- Insert test order items
INSERT INTO order_items (order_id, product_id, quantity, unit_price, total_price) VALUES
(1, 1, 1, 1299.99, 1299.99),
(1, 2, 1, 49.99, 49.99),
(2, 3, 1, 299.99, 299.99),
(2, 5, 1, 79.99, 79.99),
(2, 8, 1, 39.99, 39.99),
(3, 6, 1, 149.99, 149.99),
(3, 5, 1, 79.99, 79.99),
(4, 4, 1, 599.99, 599.99),
(4, 3, 1, 299.99, 299.99),
(5, 7, 1, 449.99, 449.99);

-- Insert test activity logs with JSON data
INSERT INTO activity_logs (user_id, action, details, ip_address, user_agent) VALUES
(1, 'login', '{"browser": "Chrome", "version": "120.0", "platform": "Windows"}', '192.168.1.100', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0'),
(1, 'view_product', '{"product_id": 1, "duration_seconds": 45}', '192.168.1.100', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0'),
(2, 'login', '{"browser": "Safari", "version": "17.0", "platform": "macOS"}', '192.168.1.101', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/17.0'),
(2, 'purchase', '{"order_id": 2, "payment_method": "credit_card"}', '192.168.1.101', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/17.0'),
(3, 'login', '{"browser": "Firefox", "version": "121.0", "platform": "Linux"}', '192.168.1.102', 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Firefox/121.0'),
(NULL, 'system_event', '{"event": "backup_completed", "duration": 3.5}', '127.0.0.1', 'System');

-- Create a view for reporting
CREATE VIEW order_summary AS
SELECT 
    o.id AS order_id,
    o.order_number,
    u.username,
    u.email,
    o.status,
    o.total_amount,
    COUNT(oi.id) AS item_count,
    o.created_at
FROM orders o
JOIN users u ON o.user_id = u.id
LEFT JOIN order_items oi ON o.id = oi.order_id
GROUP BY o.id;

-- Create stored procedure for getting user statistics
DELIMITER //
CREATE PROCEDURE GetUserStatistics(IN userId INT)
BEGIN
    SELECT 
        u.id,
        u.username,
        u.email,
        COUNT(DISTINCT o.id) AS total_orders,
        COALESCE(SUM(o.total_amount), 0) AS total_spent,
        COUNT(DISTINCT al.id) AS activity_count
    FROM users u
    LEFT JOIN orders o ON u.id = o.user_id
    LEFT JOIN activity_logs al ON u.id = al.user_id
    WHERE u.id = userId
    GROUP BY u.id;
END //
DELIMITER ;

-- Create a trigger for updating product stock
DELIMITER //
CREATE TRIGGER update_product_stock_on_order
AFTER INSERT ON order_items
FOR EACH ROW
BEGIN
    UPDATE products 
    SET stock_quantity = stock_quantity - NEW.quantity
    WHERE id = NEW.product_id;
END //
DELIMITER ;

-- Add some special characters and unicode data to test encoding
INSERT INTO users (username, email, full_name) VALUES
('test_unicode', 'unicode@example.com', 'Tëst Üñíçödé 测试用户 🎉'),
('special_chars', 'special@example.com', 'Special!@#$%^&*()_+-={}[]|\\:";''<>?,./');

-- Add a large text entry to test BLOB/TEXT handling
INSERT INTO products (name, description, price, stock_quantity, category, sku) VALUES
('Test Product with Long Description', REPEAT('This is a very long description. ', 100), 99.99, 10, 'Test', 'TST-LONG-001');

-- Final statistics
SELECT 'Test Data Summary' AS Info;
SELECT CONCAT('Total Users: ', COUNT(*)) AS Count FROM users;
SELECT CONCAT('Total Products: ', COUNT(*)) AS Count FROM products;
SELECT CONCAT('Total Orders: ', COUNT(*)) AS Count FROM orders;
SELECT CONCAT('Total Order Items: ', COUNT(*)) AS Count FROM order_items;
SELECT CONCAT('Total Activity Logs: ', COUNT(*)) AS Count FROM activity_logs;