const platformConfig = require('../config/platform-config');

describe('platform-config', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getPlatformConfig', () => {
    test('should return config for valid platform and environment', () => {
      const config = platformConfig.getPlatformConfig('onedigital', 'uat');
      expect(config).toBeDefined();
      expect(config.provider).toBe('azure');
      expect(config.platformName).toBe('OneDigital');
    });

    test('should return config for different platforms', () => {
      const invictusConfig = platformConfig.getPlatformConfig('invictus', 'uat');
      expect(invictusConfig).toBeDefined();
      expect(invictusConfig.provider).toBe('s3');
      expect(invictusConfig.platformName).toBe('Invictus');

      const brokerageConfig = platformConfig.getPlatformConfig('brokerage', 'prod');
      expect(brokerageConfig).toBeDefined();
      expect(brokerageConfig.provider).toBe('azure');
      expect(brokerageConfig.platformName).toBe('Brokerage');
    });

    test('should throw error for invalid platform', () => {
      expect(() => {
        platformConfig.getPlatformConfig('invalid-platform', 'uat');
      }).toThrow("Platform 'invalid-platform' not found");
    });

    test('should throw error for invalid environment', () => {
      expect(() => {
        platformConfig.getPlatformConfig('onedigital', 'invalid-env');
      }).toThrow("Environment 'invalid-env' not found for platform 'onedigital'");
    });

    test('should handle different environments for same platform', () => {
      const uatConfig = platformConfig.getPlatformConfig('onedigital', 'uat');
      const prodConfig = platformConfig.getPlatformConfig('onedigital', 'prod');
      
      expect(uatConfig.provider).toBe('azure');
      expect(prodConfig.provider).toBe('s3');
    });
  });


});

