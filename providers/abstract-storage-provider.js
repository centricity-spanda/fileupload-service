// providers/abstract-storage-provider.js

/**
 * Abstract Storage Provider
 * Defines interface for all storage providers
 */
class AbstractStorageProvider {
    constructor(config) {
      if (new.target === AbstractStorageProvider) {
        throw new TypeError('Cannot construct AbstractStorageProvider instances directly');
      }
      this.config = config;
    }
  
    /**
     * Upload file to storage
     * @param {string} bucketName - Bucket/container name (from request)
     * @param {Buffer} fileData - File buffer
     * @param {string} prefix - Folder prefix (from request)
     * @param {string} fileName - File name
     * @param {object} metadata - File metadata
     * @param {string} access - 'public' or 'private'
     * @returns {Promise<string>} Permanent storage URL
     */
    async uploadFile(bucketName, fileData, prefix, fileName, metadata, access) {
      throw new Error('uploadFile method must be implemented');
    }
  
    /**
     * Generate temporary download URL
     * @param {string} permanentUrl - Permanent storage URL
     * @param {object} options - URL generation options
     * @returns {Promise<object>} Download URL with metadata
     */
    async generateDownloadUrl(permanentUrl, options) {
      throw new Error('generateDownloadUrl method must be implemented');
    }
  
    /**
     * Delete file from storage
     * @param {string} fileUrl - File URL to delete
     * @returns {Promise<boolean>} Success status
     */
    async deleteFile(fileUrl) {
      throw new Error('deleteFile method must be implemented');
    }

    /**
     * Delete file by bucket name and key
     * @param {string} bucketName - Bucket/container name
     * @param {string} key - File key (can include prefix like "prefix/filename" or just "filename")
     * @returns {Promise<boolean>} Success status
     */
    async deleteFileByBucketKey(bucketName, key) {
      throw new Error('deleteFileByBucketKey method must be implemented');
    }
  
    /**
     * Get file metadata
     * @param {string} fileUrl - File URL
     * @returns {Promise<object>} File metadata
     */
    async getFileMetadata(fileUrl) {
      throw new Error('getFileMetadata method must be implemented');
    }
  
    /**
     * Check if file exists
     * @param {string} fileUrl - File URL
     * @returns {Promise<boolean>} Exists status
     */
    async fileExists(fileUrl) {
      throw new Error('fileExists method must be implemented');
    }
  
    /**
     * Check if bucket/container is public
     * @param {string} bucketName - Bucket/container name
     * @returns {Promise<boolean>} Is public
     */
    async isBucketPublic(bucketName) {
      throw new Error('isBucketPublic method must be implemented');
    }
  
    /**
     * Parse storage URL
     * @param {string} url - Storage URL
     * @returns {object} Parsed components
     */
    parseUrl(url) {
      throw new Error('parseUrl method must be implemented');
    }
  
    /**
     * Get provider name
     * @returns {string} Provider name
     */
    getProviderName() {
      throw new Error('getProviderName method must be implemented');
    }
  }
  
  module.exports = AbstractStorageProvider;