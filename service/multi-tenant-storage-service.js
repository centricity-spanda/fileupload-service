// services/multi-tenant-storage-service.js
const StorageProviderFactory = require('../providers/storage-provider-factory');
const platformConfig = require('../config/platform-config');

class MultiTenantStorageService {
  constructor() {
    // Cache for provider instances per platform-environment
    this.providerCache = new Map();
  }

  /**
   * Get storage provider for platform-environment
   */
  getStorageProvider(platformId, environment) {
    const cacheKey = `${platformId}-${environment}`;
    
    if (this.providerCache.has(cacheKey)) {
      return this.providerCache.get(cacheKey);
    }

    const config = platformConfig.getPlatformConfig(platformId, environment);
    const provider = StorageProviderFactory.createProvider(config.provider, config);

    this.providerCache.set(cacheKey, provider);

    return provider;
  }

  /**
   * Upload file - bucket name comes from request
   * @param {string} platformId - Platform identifier
   * @param {string} environment - Environment (internally determined)
   * @param {string} bucketName - Bucket/container name (from request)
   * @param {string} prefix - Folder prefix (from request)
   * @param {string} access - 'public' or 'private' (from request)
   * @param {Buffer} fileData - File buffer
   * @param {string} fileName - File name
   * @param {object} metadata - Additional metadata
   * @returns {Promise<object>} Upload result
   */
  async uploadFile(platformId, environment, bucketName, prefix, access, fileData, fileName, metadata = {}) {
    try {
      const provider = this.getStorageProvider(platformId, environment);      
      // Enrich metadata with platform context
      const enrichedMetadata = {
        platformId,
        environment,
        provider: provider.getProviderName(),
        ...metadata
      };

      // Upload to specified bucket with prefix
      const permanentUrl = await provider.uploadFile(
        bucketName,
        fileData,
        prefix,
        fileName,
        enrichedMetadata,
        access
      );
      
      return {
        fileUrl: permanentUrl,
        bucketName: bucketName,
        prefix: prefix,
        fileName: fileName,
        access: access,
        isPublic: access === 'public'
      };
    } catch (error) {
      throw new Error(`Upload failed: ${error.message}`);
    }
  }

  /**
   * Generate download URL
   * @param {string} platformId - Platform identifier
   * @param {string} environment - Environment
   * @param {string} permanentUrl - Permanent file URL
   * @param {object} options - Options (expiryMinutes, etc.)
   * @returns {Promise<object>} Download URL with metadata
   */
  async generateDownloadUrl(platformId, environment, permanentUrl, options = {}) {
    try {
      const provider = this.getStorageProvider(platformId, environment);
      
      // Provider handles checking if public/private and returns appropriate URL
      return await provider.generateDownloadUrl(permanentUrl, options);
    } catch (error) {
      throw new Error(`Download URL generation failed: ${error.message}`);
    }
  }

  /**
   * Delete file
   */
  async deleteFile(platformId, environment, fileUrl) {
    try {
      const provider = this.getStorageProvider(platformId, environment);
      return await provider.deleteFile(fileUrl);
    } catch (error) {
      throw new Error(`Delete failed: ${error.message}`);
    }
  }

  /**
   * Delete file by bucket name and key
   * @param {string} platformId - Platform identifier
   * @param {string} environment - Environment
   * @param {string} bucketName - Bucket/container name
   * @param {string} key - File key (can include prefix like "prefix/filename" or just "filename")
   * @returns {Promise<boolean>} Success status
   */
  async deleteFileByBucketKey(platformId, environment, bucketName, key) {
    try {
      const metadata = {
        platformId,
        environment,
      };
      const provider = this.getStorageProvider(platformId, environment);
      console.log('metadata', metadata);
      console.log('--------------------------------');
      console.log('--------------------------------');
      return await provider.deleteFileByBucketKey(bucketName, key, metadata);
    } catch (error) {
      throw new Error(`Delete by bucket key failed: ${error.message}`);
    }
  }

  /**
   * Get file metadata
   */
  async getFileMetadata(platformId, environment, fileUrl) {
    try {
      const provider = this.getStorageProvider(platformId, environment);
      return await provider.getFileMetadata(fileUrl);
    } catch (error) {
      throw new Error(`Get metadata failed: ${error.message}`);
    }
  }

  /**
   * Check if file exists
   */
  async fileExists(platformId, environment, fileUrl) {
    try {
      const provider = this.getStorageProvider(platformId, environment);
      return await provider.fileExists(fileUrl);
    } catch (error) {
      return false;
    }
  }

  /**
   * Get provider info
   */
  getProviderInfo(platformId, environment) {
    const provider = this.getStorageProvider(platformId, environment);
    return {
      name: provider.getProviderName(),
      platformId,
      environment
    };
  }
}

// Export a singleton instance
module.exports = new MultiTenantStorageService();