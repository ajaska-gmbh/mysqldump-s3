module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/dist'],
  testMatch: ['**/__tests__/**/*.integration.test.js'],
  testTimeout: 180000, // 3 minutes for comprehensive tests
  forceExit: true,
  verbose: true,
  maxWorkers: 1 // Run tests sequentially to avoid database conflicts
};