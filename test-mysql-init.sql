-- MySQL initialization script for integration tests
-- Grant testuser full permissions for testing

-- Create testuser for localhost connections (when exec-ing into container)
CREATE USER IF NOT EXISTS 'testuser'@'localhost' IDENTIFIED BY 'testpass';

-- Grant full privileges to testuser from any host (for network connections)
GRANT ALL PRIVILEGES ON *.* TO 'testuser'@'%' WITH GRANT OPTION;

-- Grant full privileges to testuser from localhost (for exec connections)
GRANT ALL PRIVILEGES ON *.* TO 'testuser'@'localhost' WITH GRANT OPTION;

-- Also grant specific permissions to ensure no issues
GRANT CREATE, DROP, ALTER, INDEX, REFERENCES ON *.* TO 'testuser'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON *.* TO 'testuser'@'%';
GRANT EXECUTE, CREATE ROUTINE, ALTER ROUTINE ON *.* TO 'testuser'@'%';
GRANT CREATE VIEW, SHOW VIEW, TRIGGER ON *.* TO 'testuser'@'%';

-- Same specific grants for localhost
GRANT CREATE, DROP, ALTER, INDEX, REFERENCES ON *.* TO 'testuser'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON *.* TO 'testuser'@'localhost';
GRANT EXECUTE, CREATE ROUTINE, ALTER ROUTINE ON *.* TO 'testuser'@'localhost';
GRANT CREATE VIEW, SHOW VIEW, TRIGGER ON *.* TO 'testuser'@'localhost';

-- Ensure changes take effect
FLUSH PRIVILEGES;