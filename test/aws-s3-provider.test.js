const AWSS3StorageProvider = require('../providers/aws-s3-provider');
const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectAclCommand,
  HeadBucketCommand,
  GetBucketAclCommand,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const config = require('../config/platform-config');

// Mock only S3Client; keep Command classes real so we can inspect `.input`
jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn(),
  };
});
jest.mock('@aws-sdk/s3-request-presigner');
jest.mock('../config/platform-config');

describe('AWSS3StorageProvider', () => {
  let provider;
  let mockS3Client;
  let mockSend;

  const mockConfig = {
    accessKeyId: 'test-access-key',
    secretAccessKey: 'test-secret-key',
    region: 'ap-south-1',
  };

  const mockPlatformConfig = {
    bucketName: 'my-unique-bucket-123',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock S3Client
    mockSend = jest.fn();
    mockS3Client = {
      send: mockSend,
    };
    S3Client.mockImplementation(() => mockS3Client);

    // Mock platform config
    config.getPlatformConfig.mockReturnValue(mockPlatformConfig);

    provider = new AWSS3StorageProvider(mockConfig);
  });

  describe('constructor', () => {
    test('should create S3Client with correct credentials', () => {
      expect(S3Client).toHaveBeenCalledWith({
        region: mockConfig.region,
        credentials: {
          accessKeyId: mockConfig.accessKeyId,
          secretAccessKey: mockConfig.secretAccessKey,
        },
      });
      expect(provider.region).toBe(mockConfig.region);
    });

    test('should throw error if accessKeyId is missing', () => {
      expect(() => {
        new AWSS3StorageProvider({
          secretAccessKey: 'secret',
          region: 'us-east-1',
        });
      }).toThrow('AWS credentials and region are required');
    });

    test('should throw error if secretAccessKey is missing', () => {
      expect(() => {
        new AWSS3StorageProvider({
          accessKeyId: 'key',
          region: 'us-east-1',
        });
      }).toThrow('AWS credentials and region are required');
    });

    test('should throw error if region is missing', () => {
      expect(() => {
        new AWSS3StorageProvider({
          accessKeyId: 'key',
          secretAccessKey: 'secret',
        });
      }).toThrow('AWS credentials and region are required');
    });
  });

  describe('uploadFile', () => {
    const fileData = Buffer.from('test file content');
    const logicalBucketName = 'documents';
    const prefix = 'invoices';
    const fileName = 'test-file.pdf';
    const metadata = {
      platformId: 'test-platform',
      environment: 'uat',
    };
    const access = 'private';

    test('should upload file with prefix and construct correct key', async () => {
      mockSend.mockResolvedValue({});

      const result = await provider.uploadFile(
        logicalBucketName,
        fileData,
        prefix,
        fileName,
        metadata,
        access
      );

      expect(config.getPlatformConfig).toHaveBeenCalledWith(
        metadata.platformId,
        metadata.environment
      );
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Bucket: mockPlatformConfig.bucketName,
            Key: `${logicalBucketName}/${prefix}/${fileName}`,
            Body: fileData,
            Metadata: expect.objectContaining({
              platformId: String(metadata.platformId),
              environment: String(metadata.environment),
              provider: 's3',
              access: 'private',
            }),
          }),
        })
      );
      expect(result).toBe(
        `https://${mockPlatformConfig.bucketName}.s3.${mockConfig.region}.amazonaws.com/${logicalBucketName}/${prefix}/${fileName}`
      );
    });

    test('should upload file without prefix', async () => {
      mockSend.mockResolvedValue({});

      const result = await provider.uploadFile(
        logicalBucketName,
        fileData,
        null,
        fileName,
        metadata,
        access
      );

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Key: `${logicalBucketName}/${fileName}`,
          }),
        })
      );
      expect(result).toContain(`${logicalBucketName}/${fileName}`);
    });

    test('should set public-read ACL for public access', async () => {
      mockSend.mockResolvedValue({});

      await provider.uploadFile(
        logicalBucketName,
        fileData,
        prefix,
        fileName,
        metadata,
        'public'
      );

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            ACL: 'public-read',
          }),
        })
      );
    });

    test('should not set ACL for private access', async () => {
      mockSend.mockResolvedValue({});

      await provider.uploadFile(
        logicalBucketName,
        fileData,
        prefix,
        fileName,
        metadata,
        'private'
      );

      const callArgs = mockSend.mock.calls[0][0].input;
      expect(callArgs.ACL).toBeUndefined();
    });

    test('should include uploadedAt timestamp in metadata', async () => {
      mockSend.mockResolvedValue({});
      const beforeTime = new Date();

      await provider.uploadFile(
        logicalBucketName,
        fileData,
        prefix,
        fileName,
        metadata,
        access
      );

      // First call is HeadBucketCommand, second is PutObjectCommand
      const putObjectCall = mockSend.mock.calls.find(
        call => call[0].input && call[0].input.Key && call[0].input.Body
      );
      const callArgs = putObjectCall[0].input;
      const uploadedAt = new Date(callArgs.Metadata.uploadedAt);
      const afterTime = new Date();

      expect(uploadedAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(uploadedAt.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });

    test('should convert all metadata values to strings', async () => {
      mockSend.mockResolvedValue({});
      const metadataWithNumbers = {
        platformId: 'test',
        environment: 'uat',
        userId: 12345,
        size: 1024,
      };

      await provider.uploadFile(
        logicalBucketName,
        fileData,
        prefix,
        fileName,
        metadataWithNumbers,
        access
      );

      // First call is HeadBucketCommand, second is PutObjectCommand
      const putObjectCall = mockSend.mock.calls.find(
        call => call[0].input && call[0].input.Key && call[0].input.Body
      );
      const callArgs = putObjectCall[0].input;
      expect(callArgs.Metadata.userId).toBe('12345');
      expect(callArgs.Metadata.size).toBe('1024');
    });

    test('should throw error if upload fails', async () => {
      const error = new Error('S3 upload error');
      // First call (HeadBucket) succeeds, second call (PutObject) fails
      mockSend.mockResolvedValueOnce({}).mockRejectedValueOnce(error);

      await expect(
        provider.uploadFile(
          logicalBucketName,
          fileData,
          prefix,
          fileName,
          metadata,
          access
        )
      ).rejects.toThrow('S3 upload failed: S3 upload error');
    });

    test('should check bucket exists before upload', async () => {
      mockSend.mockResolvedValue({});

      await provider.uploadFile(
        logicalBucketName,
        fileData,
        prefix,
        fileName,
        metadata,
        access
      );

      // First call should be HeadBucketCommand
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Bucket: mockPlatformConfig.bucketName,
          }),
        })
      );
    });
  });

  describe('ensureBucketExists', () => {
    test('should return successfully if bucket exists', async () => {
      mockSend.mockResolvedValue({});

      await provider.ensureBucketExists('test-bucket');

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Bucket: 'test-bucket',
          }),
        })
      );
    });

    test('should throw error if bucket does not exist', async () => {
      const error = new Error('Bucket not found');
      error.name = 'NotFound';
      mockSend.mockRejectedValue(error);

      await expect(provider.ensureBucketExists('non-existent-bucket')).rejects.toThrow(
        'Bucket non-existent-bucket does not exist.Please Create the bucket first.'
      );
    });
  });

  describe('generateDownloadUrl', () => {
    const permanentUrl = `https://${mockPlatformConfig.bucketName}.s3.${mockConfig.region}.amazonaws.com/documents/invoices/file.pdf`;
    const key = 'documents/invoices/file.pdf';

    test('should return direct URL for public files', async () => {
      mockSend
        .mockResolvedValueOnce({}) // fileExists
        .mockResolvedValueOnce({
          Grants: [
            {
              Grantee: { URI: 'http://acs.amazonaws.com/groups/global/AllUsers' },
              Permission: 'READ',
            },
          ],
        }); // isObjectPublic

      const result = await provider.generateDownloadUrl(permanentUrl);

      expect(result).toEqual({
        downloadUrl: permanentUrl,
        isPublic: true,
        requiresSAS: false,
        expiresIn: null,
        fileName: 'file.pdf',
      });
    });

    test('should generate presigned URL for private files', async () => {
      const presignedUrl = 'https://s3.amazonaws.com/bucket/key?signature=xyz';
      mockSend
        .mockResolvedValueOnce({}) // fileExists
        .mockResolvedValueOnce({ Grants: [] }); // isObjectPublic (not public)
      getSignedUrl.mockResolvedValue(presignedUrl);

      const result = await provider.generateDownloadUrl(permanentUrl, {
        expiryMinutes: 30,
      });

      expect(getSignedUrl).toHaveBeenCalledWith(
        mockS3Client,
        expect.objectContaining({
          input: expect.objectContaining({
            Bucket: mockPlatformConfig.bucketName,
            Key: key,
          }),
        }),
        { expiresIn: 1800 }
      );

      expect(result).toEqual({
        downloadUrl: presignedUrl,
        isPublic: false,
        requiresSAS: true,
        expiresIn: 1800,
        expiresAt: expect.any(String),
        fileName: 'file.pdf',
      });
    });

    test('should use default expiry of 60 minutes', async () => {
      mockSend
        .mockResolvedValueOnce({}) // fileExists
        .mockResolvedValueOnce({ Grants: [] }); // isObjectPublic
      getSignedUrl.mockResolvedValue('presigned-url');

      await provider.generateDownloadUrl(permanentUrl);

      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { expiresIn: 3600 }
      );
    });

    test('should throw error if file does not exist', async () => {
      const error = new Error('Not found');
      error.name = 'NotFound';
      mockSend.mockRejectedValue(error);

      await expect(provider.generateDownloadUrl(permanentUrl)).rejects.toThrow(
        'File not found'
      );
    });
  });

  describe('deleteFile', () => {
    const fileUrl = `https://${mockPlatformConfig.bucketName}.s3.${mockConfig.region}.amazonaws.com/documents/invoices/file.pdf`;

    test('should delete file by URL', async () => {
      mockSend.mockResolvedValue({});

      const result = await provider.deleteFile(fileUrl);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Bucket: mockPlatformConfig.bucketName,
            Key: 'documents/invoices/file.pdf',
          }),
        })
      );
      expect(result).toBe(true);
    });

    test('should throw error if delete fails', async () => {
      const error = new Error('Delete failed');
      mockSend.mockRejectedValue(error);

      await expect(provider.deleteFile(fileUrl)).rejects.toThrow(
        'S3 delete failed: Delete failed'
      );
    });
  });

  describe('deleteFileByBucketKey', () => {
    const logicalBucketName = 'documents';
    const key = 'invoices/file.pdf';
    const metadata = {
      platformId: 'test-platform',
      environment: 'uat',
    };

    test('should delete file using logical bucket name and key', async () => {
      mockSend.mockResolvedValue({});

      const result = await provider.deleteFileByBucketKey(
        logicalBucketName,
        key,
        metadata
      );

      expect(config.getPlatformConfig).toHaveBeenCalledWith(
        metadata.platformId,
        metadata.environment
      );
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Bucket: mockPlatformConfig.bucketName,
            Key: `${logicalBucketName}/${key}`,
          }),
        })
      );
      expect(result).toBe(true);
    });

    test('should handle key without prefix', async () => {
      mockSend.mockResolvedValue({});

      await provider.deleteFileByBucketKey(logicalBucketName, 'file.pdf', metadata);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Key: `${logicalBucketName}/file.pdf`,
          }),
        })
      );
    });

    test('should handle empty key (delete logical bucket folder)', async () => {
      mockSend.mockResolvedValue({});

      await provider.deleteFileByBucketKey(logicalBucketName, null, metadata);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Key: logicalBucketName,
          }),
        })
      );
    });

    test('should throw error if delete fails', async () => {
      const error = new Error('Delete failed');
      mockSend.mockRejectedValue(error);

      await expect(
        provider.deleteFileByBucketKey(logicalBucketName, key, metadata)
      ).rejects.toThrow('S3 delete by bucket key failed: Delete failed');
    });
  });

  describe('getFileMetadata', () => {
    const fileUrl = `https://${mockPlatformConfig.bucketName}.s3.${mockConfig.region}.amazonaws.com/documents/file.pdf`;

    test('should retrieve file metadata', async () => {
      const mockResponse = {
        ContentType: 'application/pdf',
        ContentLength: 1024,
        LastModified: new Date(),
        Metadata: { userId: '123' },
        ETag: '"abc123"',
      };
      mockSend.mockResolvedValue(mockResponse);

      const result = await provider.getFileMetadata(fileUrl);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Bucket: mockPlatformConfig.bucketName,
            Key: 'documents/file.pdf',
          }),
        })
      );
      expect(result).toEqual({
        contentType: mockResponse.ContentType,
        contentLength: mockResponse.ContentLength,
        lastModified: mockResponse.LastModified,
        metadata: mockResponse.Metadata,
        etag: mockResponse.ETag,
        provider: 's3',
      });
    });

    test('should throw error if metadata fetch fails', async () => {
      const error = new Error('Metadata fetch failed');
      mockSend.mockRejectedValue(error);

      await expect(provider.getFileMetadata(fileUrl)).rejects.toThrow(
        'S3 metadata fetch failed: Metadata fetch failed'
      );
    });
  });

  describe('fileExists', () => {
    const fileUrl = `https://${mockPlatformConfig.bucketName}.s3.${mockConfig.region}.amazonaws.com/documents/file.pdf`;

    test('should return true if file exists', async () => {
      mockSend.mockResolvedValue({});

      const result = await provider.fileExists(fileUrl);

      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Bucket: mockPlatformConfig.bucketName,
            Key: 'documents/file.pdf',
          }),
        })
      );
    });

    test('should return false if file does not exist', async () => {
      const error = new Error('Not found');
      error.name = 'NotFound';
      mockSend.mockRejectedValue(error);

      const result = await provider.fileExists(fileUrl);

      expect(result).toBe(false);
    });

    test('should return false for NotFound error code', async () => {
      const error = new Error('Not found');
      error.code = 'NotFound';
      mockSend.mockRejectedValue(error);

      const result = await provider.fileExists(fileUrl);

      expect(result).toBe(false);
    });

    test('should throw error for other errors', async () => {
      const error = new Error('Access denied');
      mockSend.mockRejectedValue(error);

      await expect(provider.fileExists(fileUrl)).rejects.toThrow('Access denied');
    });
  });

  describe('parseUrl', () => {
    test('should parse S3 URL with .s3. in hostname', () => {
      const url = `https://${mockPlatformConfig.bucketName}.s3.${mockConfig.region}.amazonaws.com/documents/file.pdf`;
      const result = provider.parseUrl(url);

      expect(result).toEqual({
        bucketName: mockPlatformConfig.bucketName,
        key: 'documents/file.pdf',
        region: mockConfig.region,
        baseUrl: `https://${mockPlatformConfig.bucketName}.s3.${mockConfig.region}.amazonaws.com`,
        fullPath: '/documents/file.pdf',
      });
    });

    test('should parse alternative URL format', () => {
      const url = `https://s3.amazonaws.com/${mockPlatformConfig.bucketName}/documents/file.pdf`;
      const result = provider.parseUrl(url);

      expect(result.bucketName).toBe(mockPlatformConfig.bucketName);
      expect(result.key).toBe('documents/file.pdf');
    });

    test('should handle nested paths', () => {
      const url = `https://${mockPlatformConfig.bucketName}.s3.${mockConfig.region}.amazonaws.com/documents/invoices/2024/file.pdf`;
      const result = provider.parseUrl(url);

      expect(result.key).toBe('documents/invoices/2024/file.pdf');
    });

    test('should throw error for invalid URL', () => {
      expect(() => {
        provider.parseUrl('not-a-valid-url');
      }).toThrow('Failed to parse S3 URL');
    });
  });

  describe('isObjectPublic', () => {
    test('should return true if object has public-read ACL', async () => {
      mockSend.mockResolvedValue({
        Grants: [
          {
            Grantee: { URI: 'http://acs.amazonaws.com/groups/global/AllUsers' },
            Permission: 'READ',
          },
        ],
      });

      const result = await provider.isObjectPublic('bucket', 'key');

      expect(result).toBe(true);
    });

    test('should return true if object has FULL_CONTROL permission', async () => {
      mockSend.mockResolvedValue({
        Grants: [
          {
            Grantee: { URI: 'http://acs.amazonaws.com/groups/global/AllUsers' },
            Permission: 'FULL_CONTROL',
          },
        ],
      });

      const result = await provider.isObjectPublic('bucket', 'key');

      expect(result).toBe(true);
    });

    test('should return false if object is private', async () => {
      mockSend.mockResolvedValue({ Grants: [] });

      const result = await provider.isObjectPublic('bucket', 'key');

      expect(result).toBe(false);
    });

    test('should return false on error', async () => {
      mockSend.mockRejectedValue(new Error('Access denied'));

      const result = await provider.isObjectPublic('bucket', 'key');

      expect(result).toBe(false);
    });
  });

  describe('isBucketPublic', () => {
    test('should return true if bucket has public access', async () => {
      mockSend.mockResolvedValue({
        Grants: [
          {
            Grantee: { URI: 'http://acs.amazonaws.com/groups/global/AllUsers' },
            Permission: 'READ',
          },
        ],
      });

      const result = await provider.isBucketPublic('bucket');

      expect(result).toBe(true);
    });

    test('should return false if bucket is private', async () => {
      mockSend.mockResolvedValue({ Grants: [] });

      const result = await provider.isBucketPublic('bucket');

      expect(result).toBe(false);
    });

    test('should return false on error', async () => {
      mockSend.mockRejectedValue(new Error('Access denied'));

      const result = await provider.isBucketPublic('bucket');

      expect(result).toBe(false);
    });
  });

  describe('getProviderName', () => {
    test('should return "s3"', () => {
      expect(provider.getProviderName()).toBe('s3');
    });
  });
});

