const request = require('supertest');
const express = require('express');

// Mock dependencies before requiring the router
jest.mock('../service/multi-tenant-storage-service.js');
jest.mock('../middlewares/platform-auth.js');
jest.mock('../utils/sanitizeFileName.js');
jest.mock('../utils/sanitizeBucketName.js');

const storageService = require('../service/multi-tenant-storage-service.js');
const platformAuthMiddleware = require('../middlewares/platform-auth.js');
const { sanitizeFileName } = require('../utils/sanitizeFileName.js');
const { sanitizeBucketName } = require('../utils/sanitizeBucketName.js');
const fileRoutes = require('../routes/file-routes.js');

describe('File Routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup express app for testing
    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    
    // Mock middleware to pass through and set platformContext
    platformAuthMiddleware.mockImplementation((req, res, next) => {
      req.platformContext = {
        platformId: 'test-platform',
        environment: 'uat',
        config: { provider: 'azure' }
      };
      next();
    });
    
    // Mock sanitize functions
    sanitizeFileName.mockImplementation((name) => name.replace(/[^a-zA-Z0-9.-]/g, '_'));
    sanitizeBucketName.mockImplementation((name) => name.toLowerCase());
    
    app.use('/api/files', fileRoutes);
  });

  describe('POST /api/files/upload-file', () => {
    test('should upload file successfully', async () => {
      const mockResult = {
        fileUrl: 'https://storage.example.com/bucket/file.txt'
      };
      
      storageService.uploadFile.mockResolvedValue(mockResult);
      storageService.getProviderInfo.mockReturnValue({ name: 'azure' });

      const response = await request(app)
        .post('/api/files/upload-file')
        .field('bucketName', 'test-bucket')
        .field('prefix', 'documents')
        .field('access', 'public')
        .field('userId', 'user123')
        .attach('file', Buffer.from('test content'), 'test.txt');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.fileUrl).toBe(mockResult.fileUrl);
      expect(response.body.data.platform).toBe('test-platform');
      expect(response.body.data.environment).toBe('uat');
      expect(response.body.data.provider).toBe('azure');
      expect(storageService.uploadFile).toHaveBeenCalled();
    });

    test('should return 400 when no file is uploaded', async () => {
      const response = await request(app)
        .post('/api/files/upload-file')
        .field('bucketName', 'test-bucket');

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('No file uploaded');
    });

    test('should return 400 when bucketName is missing', async () => {
      const response = await request(app)
        .post('/api/files/upload-file')
        .attach('file', Buffer.from('test content'), 'test.txt');

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('bucketName is required');
    });

    test('should return 400 when access is invalid', async () => {
      const response = await request(app)
        .post('/api/files/upload-file')
        .field('bucketName', 'test-bucket')
        .field('access', 'invalid')
        .attach('file', Buffer.from('test content'), 'test.txt');

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('access must be either "private" or "public"');
    });

    test('should default access to private', async () => {
      const mockResult = { fileUrl: 'https://storage.example.com/file.txt' };
      storageService.uploadFile.mockResolvedValue(mockResult);
      storageService.getProviderInfo.mockReturnValue({ name: 'azure' });

      const response = await request(app)
        .post('/api/files/upload-file')
        .field('bucketName', 'test-bucket')
        .attach('file', Buffer.from('test content'), 'test.txt');

      expect(response.status).toBe(200);
      expect(storageService.uploadFile).toHaveBeenCalledWith(
        'test-platform',
        'uat',
        expect.any(String),
        expect.any(String),
        'private',
        expect.any(Buffer),
        expect.any(String),
        expect.any(Object)
      );
    });

    test('should return 500 when upload fails to return fileUrl', async () => {
      storageService.uploadFile.mockResolvedValue({});

      const response = await request(app)
        .post('/api/files/upload-file')
        .field('bucketName', 'test-bucket')
        .attach('file', Buffer.from('test content'), 'test.txt');

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Failed to upload file');
    });

    test('should return 500 when storageService throws error', async () => {
      storageService.uploadFile.mockRejectedValue(new Error('Storage error'));

      const response = await request(app)
        .post('/api/files/upload-file')
        .field('bucketName', 'test-bucket')
        .attach('file', Buffer.from('test content'), 'test.txt');

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Storage error');
    });

    test('should parse JSON metadata from string', async () => {
      const mockResult = { fileUrl: 'https://storage.example.com/file.txt' };
      storageService.uploadFile.mockResolvedValue(mockResult);
      storageService.getProviderInfo.mockReturnValue({ name: 'azure' });

      const metadata = JSON.stringify({ custom: 'value', tags: ['a', 'b'] });

      const response = await request(app)
        .post('/api/files/upload-file')
        .field('bucketName', 'test-bucket')
        .field('metadata', metadata)
        .attach('file', Buffer.from('test content'), 'test.txt');

      expect(response.status).toBe(200);
      expect(storageService.uploadFile).toHaveBeenCalledWith(
        'test-platform',
        'uat',
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(Buffer),
        expect.any(String),
        expect.objectContaining({
          custom: 'value',
          tags: ['a', 'b']
        })
      );
    });

    test('should sanitize prefix with Windows-style slashes', async () => {
      const mockResult = { fileUrl: 'https://storage.example.com/file.txt' };
      storageService.uploadFile.mockResolvedValue(mockResult);
      storageService.getProviderInfo.mockReturnValue({ name: 'azure' });

      const response = await request(app)
        .post('/api/files/upload-file')
        .field('bucketName', 'test-bucket')
        .field('prefix', '\\docs\\\\pdfs\\')
        .attach('file', Buffer.from('test content'), 'test.txt');

      expect(response.status).toBe(200);
      expect(storageService.uploadFile).toHaveBeenCalledWith(
        'test-platform',
        'uat',
        expect.any(String),
        'docs/pdfs',
        expect.any(String),
        expect.any(Buffer),
        expect.any(String),
        expect.any(Object)
      );
    });
  });

  describe('POST /api/files/get-download-url', () => {
    test('should generate download URL successfully', async () => {
      const mockResult = {
        downloadUrl: 'https://storage.example.com/file.txt?token=abc',
        requiresSAS: true
      };
      storageService.generateDownloadUrl.mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/api/files/get-download-url')
        .send({
          fileUrl: 'https://storage.example.com/file.txt',
          expiryMinutes: 30
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.downloadUrl).toBe(mockResult.downloadUrl);
      expect(response.body.data.expiresAt).toBeDefined();
      expect(storageService.generateDownloadUrl).toHaveBeenCalledWith(
        'test-platform',
        'uat',
        'https://storage.example.com/file.txt',
        { expiryMinutes: 30 }
      );
    });

    test('should use default expiry of 1 minute', async () => {
      const mockResult = { downloadUrl: 'https://example.com/file', requiresSAS: false };
      storageService.generateDownloadUrl.mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/api/files/get-download-url')
        .send({ fileUrl: 'https://storage.example.com/file.txt' });

      expect(response.status).toBe(200);
      expect(storageService.generateDownloadUrl).toHaveBeenCalledWith(
        'test-platform',
        'uat',
        'https://storage.example.com/file.txt',
        { expiryMinutes: 1 }
      );
    });

    test('should return null expiresAt when requiresSAS is false', async () => {
      const mockResult = { downloadUrl: 'https://example.com/file', requiresSAS: false };
      storageService.generateDownloadUrl.mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/api/files/get-download-url')
        .send({ fileUrl: 'https://storage.example.com/file.txt' });

      expect(response.status).toBe(200);
      expect(response.body.data.expiresAt).toBeNull();
    });

    test('should return 400 when fileUrl is missing', async () => {
      const response = await request(app)
        .post('/api/files/get-download-url')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('fileUrl is required');
    });

    test('should return 500 when service throws error', async () => {
      storageService.generateDownloadUrl.mockRejectedValue(new Error('URL generation failed'));

      const response = await request(app)
        .post('/api/files/get-download-url')
        .send({ fileUrl: 'https://storage.example.com/file.txt' });

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('URL generation failed');
    });
  });

  describe('POST /api/files/download-file', () => {
    test('should return 400 when fileUrl is missing', async () => {
      const response = await request(app)
        .post('/api/files/download-file')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('fileUrl is required');
    });

    test('should return 400 when downloadUrl generation fails', async () => {
      storageService.generateDownloadUrl.mockResolvedValue({});

      const response = await request(app)
        .post('/api/files/download-file')
        .send({ fileUrl: 'https://storage.example.com/file.txt' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Failed to generate download URL');
    });

    test('should use default expiry of 5 minutes', async () => {
      storageService.generateDownloadUrl.mockResolvedValue({});

      await request(app)
        .post('/api/files/download-file')
        .send({ fileUrl: 'https://storage.example.com/file.txt' });

      expect(storageService.generateDownloadUrl).toHaveBeenCalledWith(
        'test-platform',
        'uat',
        'https://storage.example.com/file.txt',
        { expiryMinutes: 5 }
      );
    });
  });

  describe('DELETE /api/files/delete-file', () => {
    test('should delete file successfully', async () => {
      storageService.fileExists.mockResolvedValue(true);
      storageService.deleteFile.mockResolvedValue(true);

      const response = await request(app)
        .delete('/api/files/delete-file')
        .send({ fileUrl: 'https://storage.example.com/file.txt' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('File deleted successfully');
      expect(storageService.fileExists).toHaveBeenCalledWith(
        'test-platform',
        'uat',
        'https://storage.example.com/file.txt'
      );
      expect(storageService.deleteFile).toHaveBeenCalledWith(
        'test-platform',
        'uat',
        'https://storage.example.com/file.txt'
      );
    });

    test('should return 400 when fileUrl is missing', async () => {
      const response = await request(app)
        .delete('/api/files/delete-file')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('fileUrl is required');
    });

    test('should return 400 when file does not exist', async () => {
      storageService.fileExists.mockResolvedValue(false);

      const response = await request(app)
        .delete('/api/files/delete-file')
        .send({ fileUrl: 'https://storage.example.com/nonexistent.txt' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('File not found');
      expect(storageService.deleteFile).not.toHaveBeenCalled();
    });

    test('should return 500 when delete throws error', async () => {
      storageService.fileExists.mockResolvedValue(true);
      storageService.deleteFile.mockRejectedValue(new Error('Delete failed'));

      const response = await request(app)
        .delete('/api/files/delete-file')
        .send({ fileUrl: 'https://storage.example.com/file.txt' });

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Delete failed');
    });
  });

  describe('GET /api/files/metadata', () => {
    test('should return file metadata successfully', async () => {
      const mockMetadata = {
        size: 1024,
        contentType: 'text/plain',
        lastModified: '2024-01-01T00:00:00.000Z'
      };
      storageService.getFileMetadata.mockResolvedValue(mockMetadata);

      const response = await request(app)
        .get('/api/files/metadata')
        .query({ fileUrl: 'https://storage.example.com/file.txt' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockMetadata);
      expect(storageService.getFileMetadata).toHaveBeenCalledWith(
        'test-platform',
        'uat',
        'https://storage.example.com/file.txt'
      );
    });

    test('should return 400 when fileUrl query param is missing', async () => {
      const response = await request(app)
        .get('/api/files/metadata');

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('fileUrl query parameter is required');
    });

    test('should return 500 when service throws error', async () => {
      storageService.getFileMetadata.mockRejectedValue(new Error('Metadata retrieval failed'));

      const response = await request(app)
        .get('/api/files/metadata')
        .query({ fileUrl: 'https://storage.example.com/file.txt' });

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Metadata retrieval failed');
    });
  });

  describe('GET /api/files/exists', () => {
    test('should return true when file exists', async () => {
      storageService.fileExists.mockResolvedValue(true);

      const response = await request(app)
        .get('/api/files/exists')
        .send({ fileUrl: 'https://storage.example.com/file.txt' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.exists).toBe(true);
    });

    test('should return false when file does not exist', async () => {
      storageService.fileExists.mockResolvedValue(false);

      const response = await request(app)
        .get('/api/files/exists')
        .send({ fileUrl: 'https://storage.example.com/nonexistent.txt' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.exists).toBe(false);
    });

    test('should return 400 when fileUrl is missing', async () => {
      const response = await request(app)
        .get('/api/files/exists')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('fileUrl is required');
    });

    test('should return 500 when service throws error', async () => {
      storageService.fileExists.mockRejectedValue(new Error('Check failed'));

      const response = await request(app)
        .get('/api/files/exists')
        .send({ fileUrl: 'https://storage.example.com/file.txt' });

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Check failed');
    });
  });

  describe('Authentication middleware', () => {
    test('should apply platform auth middleware to all routes', async () => {
      storageService.fileExists.mockResolvedValue(true);

      await request(app)
        .get('/api/files/exists')
        .send({ fileUrl: 'https://storage.example.com/file.txt' });

      expect(platformAuthMiddleware).toHaveBeenCalled();
    });

    test('should pass request through middleware with platformContext', async () => {
      const customMiddleware = jest.fn((req, res, next) => {
        req.platformContext = {
          platformId: 'custom-platform',
          environment: 'prod',
          config: {}
        };
        next();
      });

      platformAuthMiddleware.mockImplementation(customMiddleware);

      storageService.fileExists.mockResolvedValue(true);
      storageService.deleteFile.mockResolvedValue(true);

      await request(app)
        .delete('/api/files/delete-file')
        .send({ fileUrl: 'https://storage.example.com/file.txt' });

      expect(storageService.fileExists).toHaveBeenCalledWith(
        'custom-platform',
        'prod',
        expect.any(String)
      );
    });
  });
});

