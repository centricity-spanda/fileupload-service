const AzureStorageProvider = require('../providers/azure-storage-provider');
const {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
} = require('@azure/storage-blob');

// Mock Azure SDK
jest.mock('@azure/storage-blob');

describe('AzureStorageProvider', () => {
  let provider;
  let mockContainerClient;
  let mockBlockBlobClient;
  let mockBlobServiceClient;

  const mockConfigWithConnectionString = {
    connectionString:
      'DefaultEndpointsProtocol=https;AccountName=testaccount;AccountKey=testkey==;EndpointSuffix=core.windows.net',
  };

  const mockConfigWithCredentials = {
    accountName: 'testaccount',
    accountKey: 'testkey==',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock blob client methods
    mockBlockBlobClient = {
      upload: jest.fn(),
      delete: jest.fn(),
      getProperties: jest.fn(),
      exists: jest.fn(),
      url: 'https://testaccount.blob.core.windows.net/container/blob.pdf',
    };

    mockContainerClient = {
      getBlockBlobClient: jest.fn().mockReturnValue(mockBlockBlobClient),
      exists: jest.fn(),
      create: jest.fn(),
      setAccessPolicy: jest.fn(),
      getProperties: jest.fn(),
    };

    mockBlobServiceClient = {
      getContainerClient: jest.fn().mockReturnValue(mockContainerClient),
    };

    BlobServiceClient.fromConnectionString.mockReturnValue(mockBlobServiceClient);
    BlobServiceClient.mockImplementation(() => mockBlobServiceClient);
  });

  describe('constructor', () => {
    test('should create provider with connection string', () => {
      provider = new AzureStorageProvider(mockConfigWithConnectionString);

      expect(BlobServiceClient.fromConnectionString).toHaveBeenCalledWith(
        mockConfigWithConnectionString.connectionString
      );
      expect(provider.accountName).toBe('testaccount');
      expect(provider.accountKey).toBe('testkey==');
    });

    test('should create provider with account credentials', () => {
      StorageSharedKeyCredential.mockImplementation(() => ({}));

      provider = new AzureStorageProvider(mockConfigWithCredentials);

      expect(BlobServiceClient).toHaveBeenCalledWith(
        'https://testaccount.blob.core.windows.net',
        expect.anything()
      );
      expect(provider.accountName).toBe('testaccount');
      expect(provider.accountKey).toBe('testkey==');
    });

    test('should throw error if neither connection string nor credentials provided', () => {
      expect(() => {
        new AzureStorageProvider({});
      }).toThrow('Azure connection string or account credentials required');
    });

    test('should extract account name from connection string', () => {
      provider = new AzureStorageProvider(mockConfigWithConnectionString);
      expect(provider.accountName).toBe('testaccount');
    });

    test('should extract account key from connection string', () => {
      provider = new AzureStorageProvider(mockConfigWithConnectionString);
      expect(provider.accountKey).toBe('testkey==');
    });

    test('should throw error if connection string missing AccountName', () => {
      const invalidConfig = {
        connectionString: 'DefaultEndpointsProtocol=https;AccountKey=testkey==',
      };

      expect(() => {
        new AzureStorageProvider(invalidConfig);
      }).toThrow('Could not extract AccountName from connection string');
    });

    test('should throw error if connection string missing AccountKey', () => {
      const invalidConfig = {
        connectionString: 'DefaultEndpointsProtocol=https;AccountName=testaccount',
      };

      expect(() => {
        new AzureStorageProvider(invalidConfig);
      }).toThrow('Could not extract AccountKey from connection string');
    });
  });

  describe('uploadFile', () => {
    const containerName = 'documents';
    const fileData = Buffer.from('test file content');
    const prefix = 'invoices';
    const fileName = 'test-file.pdf';
    const metadata = { userId: '123' };
    const access = 'private';

    beforeEach(() => {
      provider = new AzureStorageProvider(mockConfigWithConnectionString);
    });

    test('should upload file with prefix and create container if not exists', async () => {
      mockContainerClient.exists.mockResolvedValue(false);
      mockBlockBlobClient.upload.mockResolvedValue({});

      const result = await provider.uploadFile(
        containerName,
        fileData,
        prefix,
        fileName,
        metadata,
        access
      );

      expect(mockContainerClient.exists).toHaveBeenCalled();
      expect(mockContainerClient.create).toHaveBeenCalled();
      expect(mockBlockBlobClient.upload).toHaveBeenCalledWith(
        fileData,
        fileData.length,
        {
          metadata: expect.objectContaining({
            uploadedAt: expect.any(String),
            provider: 'azure',
            userId: '123',
          }),
        }
      );
      expect(result).toBe(mockBlockBlobClient.url);
    });

    test('should upload file without prefix', async () => {
      mockContainerClient.exists.mockResolvedValue(true);
      mockContainerClient.getProperties.mockResolvedValue({
        blobPublicAccess: 'private',
      });
      mockBlockBlobClient.upload.mockResolvedValue({});

      await provider.uploadFile(containerName, fileData, null, fileName, metadata, access);

      expect(mockBlockBlobClient.upload).toHaveBeenCalledWith(
        fileData,
        fileData.length,
        expect.objectContaining({
          metadata: expect.objectContaining({
            provider: 'azure',
          }),
        })
      );
    });

    test('should set public access policy for public containers', async () => {
      mockContainerClient.exists.mockResolvedValue(false);
      mockBlockBlobClient.upload.mockResolvedValue({});

      await provider.uploadFile(containerName, fileData, prefix, fileName, metadata, 'public');

      expect(mockContainerClient.setAccessPolicy).toHaveBeenCalledWith('blob');
    });

    test('should not set access policy for private containers', async () => {
      mockContainerClient.exists.mockResolvedValue(false);
      mockBlockBlobClient.upload.mockResolvedValue({});

      await provider.uploadFile(containerName, fileData, prefix, fileName, metadata, 'private');

      expect(mockContainerClient.setAccessPolicy).not.toHaveBeenCalled();
    });

    test('should throw error if container access mismatch', async () => {
      mockContainerClient.exists.mockResolvedValue(true);
      mockContainerClient.getProperties.mockResolvedValue({
        blobPublicAccess: 'blob', // public
      });

      await expect(
        provider.uploadFile(containerName, fileData, prefix, fileName, metadata, 'private')
      ).rejects.toThrow('Container documents access mismatch: currently public, requested private');
    });

    test('should include uploadedAt timestamp in metadata', async () => {
      mockContainerClient.exists.mockResolvedValue(true);
      mockContainerClient.getProperties.mockResolvedValue({
        blobPublicAccess: 'private',
      });
      mockBlockBlobClient.upload.mockResolvedValue({});
      const beforeTime = new Date();

      await provider.uploadFile(containerName, fileData, prefix, fileName, metadata, access);

      const callArgs = mockBlockBlobClient.upload.mock.calls[0][2];
      const uploadedAt = new Date(callArgs.metadata.uploadedAt);
      const afterTime = new Date();

      expect(uploadedAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(uploadedAt.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });

    test('should throw error if upload fails', async () => {
      mockContainerClient.exists.mockResolvedValue(true);
      mockContainerClient.getProperties.mockResolvedValue({
        blobPublicAccess: 'private',
      });
      const error = new Error('Upload failed');
      mockBlockBlobClient.upload.mockRejectedValue(error);

      await expect(
        provider.uploadFile(containerName, fileData, prefix, fileName, metadata, access)
      ).rejects.toThrow('Azure upload failed: Upload failed');
    });
  });

  describe('generateDownloadUrl', () => {
    const permanentUrl = 'https://testaccount.blob.core.windows.net/container/blob.pdf';
    const containerName = 'container';
    const blobName = 'blob.pdf';

    beforeEach(() => {
      provider = new AzureStorageProvider(mockConfigWithConnectionString);
      generateBlobSASQueryParameters.mockReturnValue({
        toString: jest.fn().mockReturnValue('sig=abc123'),
      });
    });

    test('should return direct URL for public containers', async () => {
      mockBlockBlobClient.exists.mockResolvedValue(true);
      mockContainerClient.getProperties.mockResolvedValue({
        blobPublicAccess: 'blob',
      });

      const result = await provider.generateDownloadUrl(permanentUrl);

      expect(result).toEqual({
        downloadUrl: permanentUrl,
        isPublic: true,
        requiresSAS: false,
        expiresIn: null,
        fileName: 'blob.pdf',
      });
    });

    test('should generate SAS URL for private containers', async () => {
      mockBlockBlobClient.exists.mockResolvedValue(true);
      mockContainerClient.getProperties.mockResolvedValue({
        blobPublicAccess: null, // private
      });

      const result = await provider.generateDownloadUrl(permanentUrl, {
        expiryMinutes: 30,
      });

      // Ensure SAS is generated for the correct container/blob (ignore permissions detail)
      expect(generateBlobSASQueryParameters).toHaveBeenCalledWith(
        expect.objectContaining({
          containerName,
          blobName,
        }),
        expect.anything()
      );

      expect(result).toEqual({
        downloadUrl: expect.stringContaining(permanentUrl),
        isPublic: false,
        requiresSAS: true,
        expiresIn: 1800,
        expiresAt: expect.any(String),
        fileName: 'blob.pdf',
      });
    });

    test('should use default expiry of 60 minutes (plus 5-minute clock skew)', async () => {
      mockBlockBlobClient.exists.mockResolvedValue(true);
      mockContainerClient.getProperties.mockResolvedValue({
        blobPublicAccess: null,
      });

      await provider.generateDownloadUrl(permanentUrl);

      const callArgs = generateBlobSASQueryParameters.mock.calls[0][0];
      const startsOn = new Date(callArgs.startsOn);
      const expiresOn = new Date(callArgs.expiresOn);
      const diffMinutes = (expiresOn - startsOn) / (1000 * 60);

      // startsOn is set 5 minutes in the past as a clock-skew buffer, so total window is ~65 minutes
      expect(diffMinutes).toBeCloseTo(65, 0);
    });

    test('should throw error if file does not exist', async () => {
      mockBlockBlobClient.exists.mockResolvedValue(false);

      await expect(provider.generateDownloadUrl(permanentUrl)).rejects.toThrow(
        'File not found'
      );
    });

    test('should throw error if SAS generation fails', async () => {
      mockBlockBlobClient.exists.mockResolvedValue(true);
      mockContainerClient.getProperties.mockResolvedValue({
        blobPublicAccess: null,
      });
      generateBlobSASQueryParameters.mockImplementation(() => {
        throw new Error('SAS generation failed');
      });

      await expect(provider.generateDownloadUrl(permanentUrl)).rejects.toThrow(
        'Azure SAS generation failed: SAS generation failed'
      );
    });
  });

  describe('deleteFile', () => {
    const fileUrl = 'https://testaccount.blob.core.windows.net/container/blob.pdf';

    beforeEach(() => {
      provider = new AzureStorageProvider(mockConfigWithConnectionString);
    });

    test('should delete file by URL', async () => {
      mockBlockBlobClient.delete.mockResolvedValue({});

      const result = await provider.deleteFile(fileUrl);

      expect(mockBlobServiceClient.getContainerClient).toHaveBeenCalledWith('container');
      expect(mockContainerClient.getBlockBlobClient).toHaveBeenCalledWith('blob.pdf');
      expect(mockBlockBlobClient.delete).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    test('should throw error if delete fails', async () => {
      const error = new Error('Delete failed');
      mockBlockBlobClient.delete.mockRejectedValue(error);

      await expect(provider.deleteFile(fileUrl)).rejects.toThrow(
        'Azure delete failed: Delete failed'
      );
    });
  });

  describe('deleteFileByBucketKey', () => {
    const containerName = 'documents';
    const blobName = 'invoices/file.pdf';
    const metadata = {
      platformId: 'test-platform',
      environment: 'uat',
    };

    beforeEach(() => {
      provider = new AzureStorageProvider(mockConfigWithConnectionString);
    });

    test('should delete file using container name and blob name', async () => {
      mockBlockBlobClient.delete.mockResolvedValue({});

      const result = await provider.deleteFileByBucketKey(containerName, blobName, metadata);

      expect(mockBlobServiceClient.getContainerClient).toHaveBeenCalledWith(containerName);
      expect(mockContainerClient.getBlockBlobClient).toHaveBeenCalledWith(blobName);
      expect(mockBlockBlobClient.delete).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    test('should handle blob name without prefix', async () => {
      mockBlockBlobClient.delete.mockResolvedValue({});

      await provider.deleteFileByBucketKey(containerName, 'file.pdf', metadata);

      expect(mockContainerClient.getBlockBlobClient).toHaveBeenCalledWith('file.pdf');
    });

    test('should throw error if delete fails', async () => {
      const error = new Error('Delete failed');
      mockBlockBlobClient.delete.mockRejectedValue(error);

      await expect(
        provider.deleteFileByBucketKey(containerName, blobName, metadata)
      ).rejects.toThrow('Azure delete by bucket key failed: Delete failed');
    });
  });

  describe('getFileMetadata', () => {
    const fileUrl = 'https://testaccount.blob.core.windows.net/container/blob.pdf';

    beforeEach(() => {
      provider = new AzureStorageProvider(mockConfigWithConnectionString);
    });

    test('should retrieve file metadata', async () => {
      const mockProperties = {
        contentType: 'application/pdf',
        contentLength: 1024,
        lastModified: new Date(),
        metadata: { userId: '123' },
        etag: '0x8D1234567890ABC',
      };
      mockBlockBlobClient.getProperties.mockResolvedValue(mockProperties);

      const result = await provider.getFileMetadata(fileUrl);

      expect(mockBlockBlobClient.getProperties).toHaveBeenCalled();
      expect(result).toEqual({
        contentType: mockProperties.contentType,
        contentLength: mockProperties.contentLength,
        lastModified: mockProperties.lastModified,
        metadata: mockProperties.metadata,
        etag: mockProperties.etag,
        provider: 'azure',
      });
    });

    test('should throw error if metadata fetch fails', async () => {
      const error = new Error('Metadata fetch failed');
      mockBlockBlobClient.getProperties.mockRejectedValue(error);

      await expect(provider.getFileMetadata(fileUrl)).rejects.toThrow(
        'Azure metadata fetch failed: Metadata fetch failed'
      );
    });
  });

  describe('fileExists', () => {
    const fileUrl = 'https://testaccount.blob.core.windows.net/container/blob.pdf';

    beforeEach(() => {
      provider = new AzureStorageProvider(mockConfigWithConnectionString);
    });

    test('should return true if file exists', async () => {
      mockBlockBlobClient.exists.mockResolvedValue(true);

      const result = await provider.fileExists(fileUrl);

      expect(result).toBe(true);
    });

    test('should return false if file does not exist', async () => {
      mockBlockBlobClient.exists.mockResolvedValue(false);

      const result = await provider.fileExists(fileUrl);

      expect(result).toBe(false);
    });

    test('should return false on error', async () => {
      mockBlockBlobClient.exists.mockRejectedValue(new Error('Access denied'));

      const result = await provider.fileExists(fileUrl);

      expect(result).toBe(false);
    });
  });

  describe('isContainerPublic', () => {
    beforeEach(() => {
      provider = new AzureStorageProvider(mockConfigWithConnectionString);
    });

    test('should return true if container has blob public access', async () => {
      mockContainerClient.getProperties.mockResolvedValue({
        blobPublicAccess: 'blob',
      });

      const result = await provider.isContainerPublic('container');

      expect(result).toBe(true);
    });

    test('should return true if container has container public access', async () => {
      mockContainerClient.getProperties.mockResolvedValue({
        blobPublicAccess: 'container',
      });

      const result = await provider.isContainerPublic('container');

      expect(result).toBe(true);
    });

    test('should return false if container is private', async () => {
      mockContainerClient.getProperties.mockResolvedValue({
        blobPublicAccess: null,
      });

      const result = await provider.isContainerPublic('container');

      expect(result).toBe(false);
    });

    test('should return false on error', async () => {
      mockContainerClient.getProperties.mockRejectedValue(new Error('Access denied'));

      const result = await provider.isContainerPublic('container');

      expect(result).toBe(false);
    });
  });

  describe('parseUrl', () => {
    beforeEach(() => {
      provider = new AzureStorageProvider(mockConfigWithConnectionString);
    });

    test('should parse Azure Blob URL correctly', () => {
      const url = 'https://testaccount.blob.core.windows.net/container/blob.pdf';
      const result = provider.parseUrl(url);

      expect(result).toEqual({
        accountName: 'testaccount',
        containerName: 'container',
        blobName: 'blob.pdf',
        baseUrl: 'https://testaccount.blob.core.windows.net',
        fullPath: '/container/blob.pdf',
      });
    });

    test('should parse URL with nested blob path', () => {
      const url =
        'https://testaccount.blob.core.windows.net/container/folder/subfolder/file.pdf';
      const result = provider.parseUrl(url);

      expect(result.containerName).toBe('container');
      expect(result.blobName).toBe('folder/subfolder/file.pdf');
    });

    test('should throw error for invalid URL', () => {
      expect(() => {
        provider.parseUrl('not-a-valid-url');
      }).toThrow('Failed to parse Azure URL');
    });
  });

  describe('getProviderName', () => {
    test('should return "azure"', () => {
      provider = new AzureStorageProvider(mockConfigWithConnectionString);
      expect(provider.getProviderName()).toBe('azure');
    });
  });

  describe('ensureContainerExists', () => {
    beforeEach(() => {
      provider = new AzureStorageProvider(mockConfigWithConnectionString);
    });

    test('should create container if it does not exist', async () => {
      mockContainerClient.exists.mockResolvedValue(false);

      await provider.ensureContainerExists('new-container', 'private');

      expect(mockContainerClient.create).toHaveBeenCalledWith({
        access: 'private',
      });
    });

    test('should not create container if it already exists', async () => {
      mockContainerClient.exists.mockResolvedValue(true);

      await provider.ensureContainerExists('existing-container', 'private');

      expect(mockContainerClient.create).not.toHaveBeenCalled();
    });

    test('should set public access when creating public container', async () => {
      mockContainerClient.exists.mockResolvedValue(false);

      await provider.ensureContainerExists('public-container', 'public');

      expect(mockContainerClient.create).toHaveBeenCalledWith({
        access: 'blob',
      });
    });
  });
});

