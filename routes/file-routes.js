// routes/file.routes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const storageService = require('../service/multi-tenant-storage-service.js');
const platformAuthMiddleware = require('../middlewares/platform-auth.js');
const { sanitizeFileName } = require('../utils/sanitizeFileName.js');
const { sanitizeBucketName } = require('../utils/sanitizeBucketName.js');

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }
});

// Apply authentication middleware
router.use(platformAuthMiddleware);

/**
 * Upload file
 * POST /api/files/upload
 * 
 * Headers:
 *   X-Platform-ID: <platform-id>
 *   X-API-Key: <api-key> (determines environment internally)
 * 
 * Body (form-data):
 *   file: <file>
 *   bucketName: <your-existing-bucket-name>
 *   prefix: <folder-prefix> (e.g., "Documents/invoices")
 *   access: public | private
 *   userId: <user-id> (optional)
 *   metadata: <JSON string> (optional)
 */
router.post('/upload-file', upload.single('file'), async (req, res) => {
  try {
    const { platformId, environment } = req.platformContext;
    
    // Validate that file was uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded. Please ensure the file field is named "file" and the request uses multipart/form-data'
      });
    }
    
    const { buffer, originalname, mimetype } = req.file;
    
    // Extract parameters from request
    const { 
      bucketName,           // Required: bucket/container name
      prefix = '',          // Optional: folder prefix
      access = 'private',   // Optional: public or private (default: private)
      userId,               // Optional: user ID
      metadata = {}         // Optional: additional metadata
    } = req.body;

    // Validate required fields
    if (!bucketName) {
      return res.status(400).json({
        success: false,
        error: 'bucketName is required'
      });
    }

    // Validate access parameter
    if (!['private', 'public'].includes(access)) {
      return res.status(400).json({
        success: false,
        error: 'access must be either "private" or "public"'
      });
    }

    // Parse metadata if it's a JSON string
    const parsedMetadata = typeof metadata === 'string' 
      ? JSON.parse(metadata) 
      : metadata;
      
    // Upload file
    const sanitizedBucketName = sanitizeBucketName(bucketName);
    const sanitizedFileName = `${Date.now()}-${sanitizeFileName(originalname)}`;
    // Keep provided folder structure (e.g. "/docs/pdfs/2024") while preventing accidental leading/trailing slashes or backslashes
    const sanitizedPrefix = (prefix || '')
      .trim()
      .replace(/\\/g, '/')      // normalize Windows-style slashes
      .replace(/\/+/g, '/')     // collapse duplicate slashes
      .replace(/^\/+|\/+$/g, ''); // strip leading/trailing slashes
    const result = await storageService.uploadFile(
      platformId,
      environment,
      sanitizedBucketName,        // From request
      sanitizedPrefix,            // From request
      access,            // From request
      buffer,
      sanitizedFileName, 
      {
        userId,
        originalFileName: sanitizedFileName,
        contentType: mimetype,
        ...parsedMetadata
      }
    );

    if(!result.fileUrl) {
      return res.status(500).json({
        success: false,
        error: 'Failed to upload file'
      });
    }

    const providerInfo = storageService.getProviderInfo(platformId, environment);

    res.json({
      success: true,
      data: {
        ...result,
        fileSize: buffer.length,
        platform: platformId,
        environment,
        provider: providerInfo.name
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Generate download URL
 * POST /api/files/download-url
 * 
 * Headers:
 *   X-Platform-ID: <platform-id>
 *   X-API-Key: <api-key>
 * 
 * Body:
 *   fileUrl: <permanent-file-url>
 *   expiryMinutes: <number> (optional, default: 60)
 */
router.post('/get-download-url', async (req, res) => {
  try {
    const { platformId, environment } = req.platformContext;
    const { fileUrl, expiryMinutes = 1 } = req.body;

    if (!fileUrl) {
      return res.status(400).json({
        success: false,
        error: 'fileUrl is required'
      });
    }

    // Generate download URL (provider handles public/private)
    const result = await storageService.generateDownloadUrl(
      platformId,
      environment,
      fileUrl,
      { expiryMinutes }
    );

    res.json({
      success: true,
      data: {
        ...result,
        expiresAt: result.requiresSAS 
          ? new Date(Date.now() + expiryMinutes * 60 * 1000) 
          : null
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


/**
 * Download file
 * POST /api/files/download-file
 * 
 * Headers:
 *   X-Platform-ID: <platform-id>
 *   X-API-Key: <api-key>
 * 
 * Body:
 *   fileUrl: <permanent-file-url>
 *   expiryMinutes: <number> (optional, default: 60)
 */
router.post('/download-file', async (req, res) => {
  try {
    const { platformId, environment } = req.platformContext;
    const { fileUrl, expiryMinutes = 5 } = req.body;

    if (!fileUrl) {
      return res.status(400).json({
        success: false,
        error: 'fileUrl is required'
      });
    }

    // Generate download URL (provider handles public/private)
    const result = await storageService.generateDownloadUrl(
      platformId,
      environment,
      fileUrl,
      { expiryMinutes }
    );

    const downloadUrl = result.downloadUrl;

    if(!downloadUrl) {
      return res.status(400).json({
        success: false,
        error: 'Failed to generate download URL'
      });
    }

    // Parse the URL to determine protocol
    const urlObj = new URL(downloadUrl);
    const isHttps = urlObj.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    // Download file from the generated URL
    return new Promise((resolve, reject) => {
      const request = httpModule.get(downloadUrl, (response) => {
        // Check if request was successful
        if (response.statusCode !== 200) {
          response.resume(); // Consume response data to free up memory
          return reject(new Error(`Failed to download file: ${response.statusCode} ${response.statusMessage}`));
        }

        // Set response headers
        const contentType = response.headers['content-type'] || 'application/octet-stream';
        const contentLength = response.headers['content-length'];
        const contentDisposition = response.headers['content-disposition'] || 
          `attachment; filename="${fileUrl.split('/').pop()}"`;

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', contentDisposition);
        if (contentLength) {
          res.setHeader('Content-Length', contentLength);
        }

        // Pipe the file data to response
        response.pipe(res);

        response.on('end', () => {
          resolve();
        });

        response.on('error', (error) => {
          reject(new Error(`Error downloading file: ${error.message}`));
        });
      });

      request.on('error', (error) => {
        reject(new Error(`Request failed: ${error.message}`));
      });

      request.end();
    });
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
});

/**
 * Delete file
 * DELETE /api/files
 * 
 * Headers:
 *   X-Platform-ID: <platform-id>
 *   X-API-Key: <api-key>
 * 
 * Body:
 *   fileUrl: <file-url-to-delete>
 */
router.delete('/delete-file', async (req, res) => {
  try {
    const { platformId, environment } = req.platformContext;
    const { fileUrl } = req.body;

    if (!fileUrl) {
      return res.status(400).json({
        success: false,
        error: 'fileUrl is required'
      });
    }

    const isfileExists = await storageService.fileExists(platformId, environment, fileUrl)

    if(!isfileExists) {
      return res.status(400).json({
        success: false,
        error: 'File not found'
      });
    }

    await storageService.deleteFile(platformId, environment, fileUrl);

    res.status(200).json({
      success: true,
      message: 'File deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


/**
 * Delete file by bucket name and key
 * DELETE /api/files/delete-file-by-bucket-key
 * 
 * Headers:
 *   X-Platform-ID: <platform-id>
 *   X-API-Key: <api-key>
 * 
 * Body:
 *   bucketName: <bucket-name>
 *   key: <file-key> (can include prefix like "prefix/filename" or just "filename")
 */
router.delete('/delete-by-bucket-key', async (req, res) => {
  try {
    const { platformId, environment } = req.platformContext;
    const { bucketName, key } = req.body;

    if (!bucketName || !key) {
      return res.status(400).json({
        success: false,
        error: 'bucketName and key are required'
      });
    }

    await storageService.deleteFileByBucketKey(platformId, environment, bucketName, key);

    res.status(200).json({
      success: true,
      message: 'File deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});




/**
 * Get file metadata
 * GET /api/files/metadata
 * 
 * Headers:
 *   X-Platform-ID: <platform-id>
 *   X-API-Key: <api-key>
 * 
 * Query:
 *   fileUrl: <file-url>
 */
router.get('/metadata', async (req, res) => {
  try {
    const { platformId, environment } = req.platformContext;
    const { fileUrl } = req.query;

    if (!fileUrl) {
      return res.status(400).json({
        success: false,
        error: 'fileUrl query parameter is required'
      });
    }

    const metadata = await storageService.getFileMetadata(
      platformId,
      environment,
      fileUrl
    );

    res.json({
      success: true,
      data: metadata
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Check if file exists
 * GET /api/files/exists
 * 
 * Headers:
 *   X-Platform-ID: <platform-id>
 *   X-API-Key: <api-key>
 * 
 * Query:
 *   fileUrl: <file-url>
 */
router.get('/exists', async (req, res) => {
  try {
    const { platformId, environment } = req.platformContext;
    const { fileUrl } = req.body;

    if (!fileUrl) {
      return res.status(400).json({
        success: false,
        error: 'fileUrl is required'
      });
    }

    const exists = await storageService.fileExists(
      platformId,
      environment,
      fileUrl
    );

    res.json({
      success: true,
      data: { exists }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;