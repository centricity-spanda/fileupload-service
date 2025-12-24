const StorageProviderFactory = require('../providers/storage-provider-factory');

// Mock the provider classes
jest.mock('../providers/azure-storage-provider');
jest.mock('../providers/aws-s3-provider');

const AzureStorageProvider = require('../providers/azure-storage-provider');
const AWSS3StorageProvider = require('../providers/aws-s3-provider');

describe('StorageProviderFactory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createProvider', () => {
    test('should create Azure provider for "azure" type', () => {
      const mockConfig = { connectionString: 'test-connection' };
      const mockProvider = { getProviderName: () => 'azure' };
      
      AzureStorageProvider.mockImplementation(() => mockProvider);
      
      const provider = StorageProviderFactory.createProvider('azure', mockConfig);
      
      expect(AzureStorageProvider).toHaveBeenCalledWith(mockConfig);
      expect(provider).toBe(mockProvider);
    });

    test('should create AWS provider for "aws" type', () => {
      const mockConfig = { accessKeyId: 'test-key', secretAccessKey: 'test-secret' };
      const mockProvider = { getProviderName: () => 'aws' };
      
      AWSS3StorageProvider.mockImplementation(() => mockProvider);
      
      const provider = StorageProviderFactory.createProvider('aws', mockConfig);
      
      expect(AWSS3StorageProvider).toHaveBeenCalledWith(mockConfig);
      expect(provider).toBe(mockProvider);
    });

    test('should create AWS provider for "s3" type', () => {
      const mockConfig = { accessKeyId: 'test-key', secretAccessKey: 'test-secret' };
      const mockProvider = { getProviderName: () => 's3' };
      
      AWSS3StorageProvider.mockImplementation(() => mockProvider);
      
      const provider = StorageProviderFactory.createProvider('s3', mockConfig);
      
      expect(AWSS3StorageProvider).toHaveBeenCalledWith(mockConfig);
      expect(provider).toBe(mockProvider);
    });

    test('should handle case-insensitive provider type', () => {
      const mockConfig = { connectionString: 'test-connection' };
      const mockProvider = { getProviderName: () => 'azure' };
      
      AzureStorageProvider.mockImplementation(() => mockProvider);
      
      const provider = StorageProviderFactory.createProvider('AZURE', mockConfig);
      
      expect(AzureStorageProvider).toHaveBeenCalledWith(mockConfig);
      expect(provider).toBe(mockProvider);
    });

    test('should throw error for unsupported provider type', () => {
      const mockConfig = {};
      
      expect(() => {
        StorageProviderFactory.createProvider('unsupported', mockConfig);
      }).toThrow('Unsupported storage provider: unsupported');
    });
  });
});

