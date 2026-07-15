module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/dist'],
  testMatch: ['**/__tests__/**/*.integration.test.js'],
  testTimeout: 60000,
  forceExit: true,
  verbose: true
};