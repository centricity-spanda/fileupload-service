const MultiTenantStorageService = require('../service/multi-tenant-storage-service');
const StorageProviderFactory = require('../providers/storage-provider-factory');
const platformConfig = require('../config/platform-config');

// Mock dependencies
jest.mock('../providers/storage-provider-factory');
jest.mock('../config/platform-config');

describe('MultiTenantStorageService', () => {
  let mockProvider;
  let mockPlatformConfig;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset provider cache on the singleton to avoid cross-test contamination
    MultiTenantStorageService.providerCache = new Map();

    // Mock provider
    mockProvider = {
      uploadFile: jest.fn(),
      generateDownloadUrl: jest.fn(),
      deleteFile: jest.fn(),
      deleteFileByBucketKey: jest.fn(),
      getFileMetadata: jest.fn(),
      fileExists: jest.fn(),
      getProviderName: jest.fn().mockReturnValue('s3'),
    };

    // Mock platform config
    mockPlatformConfig = {
      provider: 's3',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      region: 'ap-south-1',
    };

    platformConfig.getPlatformConfig.mockReturnValue(mockPlatformConfig);
    StorageProviderFactory.createProvider.mockReturnValue(mockProvider);
  });

  describe('getStorageProvider', () => {
    test('should create and cache provider for platform-environment', () => {
      const provider1 = MultiTenantStorageService.getStorageProvider('test-platform', 'uat');
      const provider2 = MultiTenantStorageService.getStorageProvider('test-platform', 'uat');

      expect(platformConfig.getPlatformConfig).toHaveBeenCalledWith('test-platform', 'uat');
      expect(StorageProviderFactory.createProvider).toHaveBeenCalledWith(
        's3',
        mockPlatformConfig
      );
      expect(provider1).toBe(provider2); // Same instance (cached)
      expect(StorageProviderFactory.createProvider).toHaveBeenCalledTimes(1);
    });

    test('should create separate providers for different platform-environment combinations', () => {
      MultiTenantStorageService.getStorageProvider('platform1', 'uat');
      MultiTenantStorageService.getStorageProvider('platform2', 'uat');

      // We care that the factory is invoked for each unique platform-env pair,
      // even if the factory chooses to return the same instance.
      expect(StorageProviderFactory.createProvider).toHaveBeenCalledTimes(2);
    });

    test('should create separate providers for different environments', () => {
      MultiTenantStorageService.getStorageProvider('platform', 'uat');
      MultiTenantStorageService.getStorageProvider('platform', 'prod');

      expect(StorageProviderFactory.createProvider).toHaveBeenCalledTimes(2);
    });
  });

  describe('uploadFile', () => {
    const platformId = 'test-platform';
    const environment = 'uat';
    const bucketName = 'documents';
    const prefix = 'invoices';
    const access = 'private';
    const fileData = Buffer.from('test content');
    const fileName = 'test-file.pdf';
    const metadata = { userId: '123' };

    test('should upload file with enriched metadata', async () => {
      const permanentUrl = 'https://bucket.s3.region.amazonaws.com/documents/invoices/test-file.pdf';
      mockProvider.uploadFile.mockResolvedValue(permanentUrl);

      const result = await MultiTenantStorageService.uploadFile(
        platformId,
        environment,
        bucketName,
        prefix,
        access,
        fileData,
        fileName,
        metadata
      );

      expect(mockProvider.uploadFile).toHaveBeenCalledWith(
        bucketName,
        fileData,
        prefix,
        fileName,
        expect.objectContaining({
          platformId,
          environment,
          provider: 's3',
          userId: '123',
        }),
        access
      );

      expect(result).toEqual({
        fileUrl: permanentUrl,
        bucketName,
        prefix,
        fileName,
        access,
        isPublic: false,
      });
    });

    test('should mark as public when access is public', async () => {
      const permanentUrl = 'https://bucket.s3.region.amazonaws.com/file.pdf';
      mockProvider.uploadFile.mockResolvedValue(permanentUrl);

      const result = await MultiTenantStorageService.uploadFile(
        platformId,
        environment,
        bucketName,
        null,
        'public',
        fileData,
        fileName,
        {}
      );

      expect(result.isPublic).toBe(true);
    });

    test('should handle upload without prefix', async () => {
      const permanentUrl = 'https://bucket.s3.region.amazonaws.com/documents/test-file.pdf';
      mockProvider.uploadFile.mockResolvedValue(permanentUrl);

      const result = await MultiTenantStorageService.uploadFile(
        platformId,
        environment,
        bucketName,
        null,
        access,
        fileData,
        fileName,
        metadata
      );

      expect(mockProvider.uploadFile).toHaveBeenCalledWith(
        bucketName,
        fileData,
        null,
        fileName,
        expect.anything(),
        access
      );

      expect(result.prefix).toBeNull();
    });

    test('should throw error if upload fails', async () => {
      const error = new Error('Upload failed');
      mockProvider.uploadFile.mockRejectedValue(error);

      await expect(
        MultiTenantStorageService.uploadFile(
          platformId,
          environment,
          bucketName,
          prefix,
          access,
          fileData,
          fileName,
          metadata
        )
      ).rejects.toThrow('Upload failed: Upload failed');
    });
  });

  describe('generateDownloadUrl', () => {
    const platformId = 'test-platform';
    const environment = 'uat';
    const permanentUrl = 'https://bucket.s3.region.amazonaws.com/file.pdf';
    const options = { expiryMinutes: 30 };

    test('should generate download URL', async () => {
      const mockDownloadResult = {
        downloadUrl: 'https://signed-url.com/file.pdf',
        expiresAt: '2024-01-01T12:00:00Z',
        requiresSAS: true,
      };
      mockProvider.generateDownloadUrl.mockResolvedValue(mockDownloadResult);

      const result = await MultiTenantStorageService.generateDownloadUrl(
        platformId,
        environment,
        permanentUrl,
        options
      );

      expect(mockProvider.generateDownloadUrl).toHaveBeenCalledWith(permanentUrl, options);
      expect(result).toBe(mockDownloadResult);
    });

    test('should use default options if not provided', async () => {
      const mockDownloadResult = {
        downloadUrl: 'https://signed-url.com/file.pdf',
        expiresAt: '2024-01-01T12:00:00Z',
        requiresSAS: true,
      };
      mockProvider.generateDownloadUrl.mockResolvedValue(mockDownloadResult);

      await MultiTenantStorageService.generateDownloadUrl(
        platformId,
        environment,
        permanentUrl
      );

      expect(mockProvider.generateDownloadUrl).toHaveBeenCalledWith(permanentUrl, {});
    });

    test('should throw error if download URL generation fails', async () => {
      const error = new Error('URL generation failed');
      mockProvider.generateDownloadUrl.mockRejectedValue(error);

      await expect(
        MultiTenantStorageService.generateDownloadUrl(
          platformId,
          environment,
          permanentUrl,
          options
        )
      ).rejects.toThrow('Download URL generation failed: URL generation failed');
    });
  });

  describe('deleteFile', () => {
    const platformId = 'test-platform';
    const environment = 'uat';
    const fileUrl = 'https://bucket.s3.region.amazonaws.com/file.pdf';

    test('should delete file by URL', async () => {
      mockProvider.deleteFile.mockResolvedValue(true);

      const result = await MultiTenantStorageService.deleteFile(
        platformId,
        environment,
        fileUrl
      );

      expect(mockProvider.deleteFile).toHaveBeenCalledWith(fileUrl);
      expect(result).toBe(true);
    });

    test('should throw error if delete fails', async () => {
      const error = new Error('Delete failed');
      mockProvider.deleteFile.mockRejectedValue(error);

      await expect(
        MultiTenantStorageService.deleteFile(platformId, environment, fileUrl)
      ).rejects.toThrow('Delete failed: Delete failed');
    });
  });

  describe('deleteFileByBucketKey', () => {
    const platformId = 'test-platform';
    const environment = 'uat';
    const bucketName = 'documents';
    const key = 'invoices/file.pdf';

    test('should delete file by bucket name and key', async () => {
      mockProvider.deleteFileByBucketKey.mockResolvedValue(true);

      const result = await MultiTenantStorageService.deleteFileByBucketKey(
        platformId,
        environment,
        bucketName,
        key
      );

      expect(mockProvider.deleteFileByBucketKey).toHaveBeenCalledWith(
        bucketName,
        key,
        {
          platformId,
          environment,
        }
      );
      expect(result).toBe(true);
    });

    test('should throw error if delete fails', async () => {
      const error = new Error('Delete failed');
      mockProvider.deleteFileByBucketKey.mockRejectedValue(error);

      await expect(
        MultiTenantStorageService.deleteFileByBucketKey(
          platformId,
          environment,
          bucketName,
          key
        )
      ).rejects.toThrow('Delete by bucket key failed: Delete failed');
    });
  });

  describe('getFileMetadata', () => {
    const platformId = 'test-platform';
    const environment = 'uat';
    const fileUrl = 'https://bucket.s3.region.amazonaws.com/file.pdf';

    test('should get file metadata', async () => {
      const mockMetadata = {
        contentType: 'application/pdf',
        contentLength: 1024,
        lastModified: new Date(),
        provider: 's3',
      };
      mockProvider.getFileMetadata.mockResolvedValue(mockMetadata);

      const result = await MultiTenantStorageService.getFileMetadata(
        platformId,
        environment,
        fileUrl
      );

      expect(mockProvider.getFileMetadata).toHaveBeenCalledWith(fileUrl);
      expect(result).toBe(mockMetadata);
    });

    test('should throw error if metadata fetch fails', async () => {
      const error = new Error('Metadata fetch failed');
      mockProvider.getFileMetadata.mockRejectedValue(error);

      await expect(
        MultiTenantStorageService.getFileMetadata(platformId, environment, fileUrl)
      ).rejects.toThrow('Get metadata failed: Metadata fetch failed');
    });
  });

  describe('fileExists', () => {
    const platformId = 'test-platform';
    const environment = 'uat';
    const fileUrl = 'https://bucket.s3.region.amazonaws.com/file.pdf';

    test('should return true if file exists', async () => {
      mockProvider.fileExists.mockResolvedValue(true);

      const result = await MultiTenantStorageService.fileExists(
        platformId,
        environment,
        fileUrl
      );

      expect(mockProvider.fileExists).toHaveBeenCalledWith(fileUrl);
      expect(result).toBe(true);
    });

    test('should return false if file does not exist', async () => {
      mockProvider.fileExists.mockResolvedValue(false);

      const result = await MultiTenantStorageService.fileExists(
        platformId,
        environment,
        fileUrl
      );

      expect(result).toBe(false);
    });

    test('should return false on error', async () => {
      mockProvider.fileExists.mockRejectedValue(new Error('Access denied'));

      const result = await MultiTenantStorageService.fileExists(
        platformId,
        environment,
        fileUrl
      );

      expect(result).toBe(false);
    });
  });

  describe('getProviderInfo', () => {
    const platformId = 'test-platform';
    const environment = 'uat';

    test('should return provider information', () => {
      const result = MultiTenantStorageService.getProviderInfo(platformId, environment);

      expect(result).toEqual({
        name: 's3',
        platformId,
        environment,
      });
      expect(mockProvider.getProviderName).toHaveBeenCalled();
    });
  });
});

