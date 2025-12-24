// providers/azure-storage-provider.js
const { 
  BlobServiceClient, 
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  SASProtocol
} = require('@azure/storage-blob');
const AbstractStorageProvider = require('./abstract-storage-provider');

class AzureStorageProvider extends AbstractStorageProvider {
  constructor(config) {
    super(config);
    
    if (!config.connectionString && (!config.accountName || !config.accountKey)) {
      throw new Error('Azure connection string or account credentials required');
    }

    // Extract account name and key
    if (config.connectionString) {
      this.accountName = this.extractAccountName(config.connectionString);
      this.accountKey = this.extractAccountKey(config.connectionString);
      this.blobServiceClient = BlobServiceClient.fromConnectionString(config.connectionString);
    } else {
      this.accountName = config.accountName;
      this.accountKey = config.accountKey;
      const credential = new StorageSharedKeyCredential(this.accountName, this.accountKey);
      this.blobServiceClient = new BlobServiceClient(
        `https://${this.accountName}.blob.core.windows.net`,
        credential
      );
    }


    // Create credential for SAS generation
    this.sharedKeyCredential = new StorageSharedKeyCredential(
      this.accountName, 
      this.accountKey
    );
  }

  /**
   * Extract account name from connection string
   */
  extractAccountName(connectionString) {
    const match = connectionString.match(/AccountName=([^;]+)/);
    if (!match) {
      throw new Error('Could not extract AccountName from connection string');
    }
    return match[1];
  }

  /**
   * Extract account key from connection string
   */
  extractAccountKey(connectionString) {
    const match = connectionString.match(/AccountKey=([^;]+)/);
    if (!match) {
      throw new Error('Could not extract AccountKey from connection string');
    }
    return match[1];
  }

  /**
   * Upload file to Azure Blob Storage
   */
  async uploadFile(bucketName, fileData, prefix, fileName, metadata = {}, access = 'private') {
    try {
      const containerClient = this.blobServiceClient.getContainerClient(bucketName);
  
      // Check if container exists before creating
      const containerExists = await containerClient.exists();

      // Create container if not exists (defaults to private)
      // Only set access policy when creating a new container
      if (!containerExists) {
        await containerClient.create();
        // Set access policy only if public access is requested
        if (access === 'public') {
          await containerClient.setAccessPolicy('blob');   // blob-level public access
        }
      } else {
        // If container already exists, ensure its access matches the request
        const isPublic = await this.isContainerPublic(bucketName);
        const containerAccess = isPublic ? 'public' : 'private';

        if (containerAccess !== access) {
          throw new Error(
            `Container ${bucketName} access mismatch: currently ${containerAccess}, requested ${access}`
          );
        }
      }
  
      // Construct full blob path
      const blobPath = prefix ? `${prefix}/${fileName}` : fileName;
      const blockBlobClient = containerClient.getBlockBlobClient(blobPath);
  
      // Upload file with metadata
      await blockBlobClient.upload(fileData, fileData.length, {
        metadata: {
          uploadedAt: new Date().toISOString(),
          provider: 'azure',
          ...metadata
        }
      });
  
      // Return actual permanent blob URL
      return blockBlobClient.url;
  
    } catch (error) {
      throw new Error(`Azure upload failed: ${error.message}`);
    }
  }

  /**
   * Ensure container exists
   */
  async ensureContainerExists(containerName, access = 'private') {
    try {
      const containerClient = this.blobServiceClient.getContainerClient(containerName);
      const exists = await containerClient.exists();

      if (!exists) {
        await containerClient.create({
          access: access === 'public' ? 'blob' : 'private'
        });
      }
    } catch (error) {
      throw new Error(`Failed to ensure container exists: ${error.message}`);
    }
  }

  /**
   * Generate SAS URL for download
   */
  async generateDownloadUrl(permanentUrl, options = {}) {
    try {
      const { containerName, blobName } = this.parseUrl(permanentUrl);

      const exists = await this.fileExists(permanentUrl);
      if (!exists) {
        throw new Error('File not found');
      }

      const isPublic = await this.isContainerPublic(containerName);

      if (isPublic) {
        return {
          downloadUrl: permanentUrl,
          isPublic: true,
          requiresSAS: false,
          expiresIn: null,
          fileName: blobName.split('/').pop(),
        };
      }

      const expiryMinutes = options.expiryMinutes || 60;
      
      // ✅ Simpler UTC approach
      const startsOn = new Date();
      startsOn.setMinutes(startsOn.getMinutes() - 5); // 5 min clock skew buffer
      
      const expiresOn = new Date();
      expiresOn.setMinutes(expiresOn.getMinutes() + expiryMinutes);

      const sasToken = generateBlobSASQueryParameters({
        containerName,
        blobName,
        permissions: BlobSASPermissions.parse("r"),
        startsOn,
        expiresOn,
        protocol: SASProtocol.Https,
        version: "2021-06-08"
      }, this.sharedKeyCredential).toString();

      const sasUrl = `${permanentUrl}?${sasToken}`;

      return {
        downloadUrl: sasUrl,
        isPublic: false,
        requiresSAS: true,
        expiresIn: expiryMinutes * 60,
        expiresAt: expiresOn.toISOString(),
        fileName: blobName.split('/').pop(),
      };
    } catch (error) {
      throw new Error(`Azure SAS generation failed: ${error.message}`);
    }
  }

  /**
   * Check if container has public access
   */
  async isContainerPublic(containerName) {
    try {
      const containerClient = this.blobServiceClient.getContainerClient(containerName);
      const properties = await containerClient.getProperties();
      
      // Check if public access is enabled
      return properties.blobPublicAccess === 'blob' || properties.blobPublicAccess === 'container';
    } catch (error) {
      return false;
    }
  }

  /**
   * Delete file
   */
  async deleteFile(fileUrl) {
    try {
      const { containerName, blobName } = this.parseUrl(fileUrl);
      const containerClient = this.blobServiceClient.getContainerClient(containerName);
      const blockBlobClient = containerClient.getBlockBlobClient(blobName);

      await blockBlobClient.delete();
      return true;
    } catch (error) {
      throw new Error(`Azure delete failed: ${error.message}`);
    }
  }

  /**
   * Delete file by container name and blob name
   * @param {string} containerName - Container name (bucket equivalent)
   * @param {string} blobName - Blob name (can include prefix like "prefix/filename" or just "filename")
   * @returns {Promise<boolean>} Success status
   */
  async deleteFileByBucketKey(containerName, blobName, metadata) {
    try {
      const containerClient = this.blobServiceClient.getContainerClient(containerName);
      const blockBlobClient = containerClient.getBlockBlobClient(blobName);

      await blockBlobClient.delete();
      return true;
    } catch (error) {
      throw new Error(`Azure delete by bucket key failed: ${error.message}`);
    }
  }

  /**
   * Get file metadata
   */
  async getFileMetadata(fileUrl) {
    try {
      const { containerName, blobName } = this.parseUrl(fileUrl);
      const containerClient = this.blobServiceClient.getContainerClient(containerName);
      const blockBlobClient = containerClient.getBlockBlobClient(blobName);

      const properties = await blockBlobClient.getProperties();

      return {
        contentType: properties.contentType,
        contentLength: properties.contentLength,
        lastModified: properties.lastModified,
        metadata: properties.metadata,
        etag: properties.etag,
        provider: 'azure'
      };
    } catch (error) {
      throw new Error(`Azure metadata fetch failed: ${error.message}`);
    }
  }

  /**
   * Check if file exists
   */
  async fileExists(fileUrl) {
    try {
      const { containerName, blobName } = this.parseUrl(fileUrl);
      const containerClient = this.blobServiceClient.getContainerClient(containerName);
      const blockBlobClient = containerClient.getBlockBlobClient(blobName);

      return await blockBlobClient.exists();
    } catch (error) {
      return false;
    }
  }

  /**
   * Parse Azure Blob URL
   */
  parseUrl(url) {
    try {
      const urlObj = new URL(url);
      
      // Extract account name from hostname
      const accountName = urlObj.hostname.split('.')[0];
      
      // Extract container and blob path
      const pathParts = urlObj.pathname.split('/').filter(part => part.length > 0);
      const containerName = pathParts[0];
      const blobName = pathParts.slice(1).join('/');

      return {
        accountName,
        containerName,
        blobName,
        baseUrl: `https://${accountName}.blob.core.windows.net`,
        fullPath: `/${containerName}/${blobName}`
      };
    } catch (error) {
      throw new Error(`Failed to parse Azure URL: ${error.message}`);
    }
  }

  getProviderName() {
    return 'azure';
  }
}

module.exports = AzureStorageProvider;