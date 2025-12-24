// providers/aws-s3-storage-provider.js
const { 
  S3Client, 
  PutObjectCommand, 
  DeleteObjectCommand, 
  HeadObjectCommand,
  GetObjectAclCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketOwnershipControlsCommand,  // ← Add this
  PutPublicAccessBlockCommand,          // ← Add this
  GetBucketAclCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const AbstractStorageProvider = require('./abstract-storage-provider');
const config = require('../config/platform-config');

class AWSS3StorageProvider extends AbstractStorageProvider {
  constructor(config) {
    super(config);
    
    if (!config.accessKeyId || !config.secretAccessKey || !config.region) {
      throw new Error('AWS credentials and region are required');
    }

    this.s3Client = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    });

    this.region = config.region;
  }

  /**
   * Upload file with object-level ACL
   */
  async uploadFile(bucketName, fileData, prefix, fileName, metadata = {}, access = 'private') {
    try {
      // Ensure bucket exists and its access level matches request
      const platformConfig = config.getPlatformConfig(metadata.platformId, metadata.environment);
      let bucketNameValue = platformConfig.bucketName

      let prefixValue = prefix ? `${bucketName}/${prefix}` : bucketName;
      await this.ensureBucketExists(bucketNameValue);

      // Convert metadata to AWS format (string values only)
      const awsMetadata = {};
      Object.keys(metadata).forEach(key => {
        awsMetadata[key] = String(metadata[key]);
      });

      awsMetadata.uploadedAt = new Date().toISOString();
      awsMetadata.provider = 's3';
      awsMetadata.access = access;

      // Construct full key with prefix
      const key = prefixValue ? `${prefixValue}/${fileName}` : fileName;

      
      // Set object-level ACL
      const command = new PutObjectCommand({
        Bucket: bucketNameValue,
        Key: key,
        Body: fileData,
        Metadata: awsMetadata,
        ...(access === 'public' ? { ACL: 'public-read' } : {}),
      });

      await this.s3Client.send(command);

      return `https://${bucketNameValue}.s3.${this.region}.amazonaws.com/${key}`;
    } catch (error) {
      throw new Error(`S3 upload failed: ${error.message}`);
    }
  }

  /**
   * Ensure S3 bucket exists with ACLs enabled
   */
  async ensureBucketExists(bucketName, expectedAccess) {
    // First verify the bucket exists
    try {
      const headCommand = new HeadBucketCommand({ Bucket: bucketName });
      await this.s3Client.send(headCommand);
    } catch (error) {
      //We are not creating the bucket here because bucket name must be unique across all regions.So its better to create the bucket first.
      throw new Error(`Bucket ${bucketName} does not exist.Please Create the bucket first.`);
    }

    // Then validate the bucket's current ACL aligns with requested access
    // if (expectedAccess) {
    //   const isPublic = await this.isBucketPublic(bucketName);
    //   const bucketAccess = isPublic ? 'public' : 'private';

    //   if (bucketAccess !== expectedAccess) {
    //     throw new Error(
    //       `Bucket ${bucketName} access mismatch: currently ${bucketAccess}, requested ${expectedAccess}`
    //     );
    //   }
    // }
  }

  /**
   * Enable ACLs on bucket by setting Object Ownership
   */
  async enableBucketACLs(bucketName) {
    try {
      const command = new PutBucketOwnershipControlsCommand({
        Bucket: bucketName,
        OwnershipControls: {
          Rules: [
            {
              ObjectOwnership: 'BucketOwnerPreferred'  // Allows ACLs
              // Other options:
              // - 'BucketOwnerEnforced': Disables ACLs (default for new buckets)
              // - 'ObjectWriter': Object uploader owns the object
            }
          ]
        }
      });

      await this.s3Client.send(command);
    } catch (error) {
      throw new Error(`Failed to enable ACLs: ${error.message}`);
    }
  }

  /**
   * Configure public access block to allow public ACLs
   */
  async configurePublicAccessBlock(bucketName) {
    try {
      const command = new PutPublicAccessBlockCommand({
        Bucket: bucketName,
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: false,        // Allow public ACLs
          IgnorePublicAcls: false,       // Don't ignore public ACLs
          BlockPublicPolicy: true,       // Block public bucket policies (we're not using them)
          RestrictPublicBuckets: true    // Restrict public bucket policies
        }
      });

      await this.s3Client.send(command);
    } catch (error) {
      throw new Error(`Failed to configure public access: ${error.message}`);
    }
  }

  /**
   * Check if object has public-read ACL
   */
  async isObjectPublic(bucketName, key) {
    try {
      const command = new GetObjectAclCommand({ 
        Bucket: bucketName, 
        Key: key 
      });
      const response = await this.s3Client.send(command);
      
      const publicGrants = response.Grants?.filter(grant => 
        grant.Grantee?.URI === 'http://acs.amazonaws.com/groups/global/AllUsers' &&
        (grant.Permission === 'READ' || grant.Permission === 'FULL_CONTROL')
      ) || [];
      
      const isPublic = publicGrants.length > 0;
      
      return isPublic;
    } catch (error) {
      return false;
    }
  }

  async isBucketPublic(bucketName) {
    try {
      const command = new GetBucketAclCommand({ Bucket: bucketName });
      const response = await this.s3Client.send(command);
      return response.Grants?.some(grant => grant.Grantee?.URI === 'http://acs.amazonaws.com/groups/global/AllUsers' && (grant.Permission === 'READ' || grant.Permission === 'FULL_CONTROL'));
    } catch (error) {
      return false;
    }
  }

  /**
   * Generate download URL - checks object ACL only
   */
  async generateDownloadUrl(permanentUrl, options = {}) {
    try {
      const { bucketName, key } = this.parseUrl(permanentUrl);

      const exists = await this.fileExists(permanentUrl);
      if (!exists) {
        throw new Error('File not found');
      }

      // Check if object has public-read ACL
      const isPublic = await this.isObjectPublic(bucketName, key);
      const isBucketPublic = await this.isBucketPublic(bucketName);

      if (isPublic) {
        return {
          downloadUrl: permanentUrl,
          isPublic: true,
          requiresSAS: false,
          expiresIn: null,
          fileName: key.split('/').pop(),
        };
      }

      // If private, generate presigned URL
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: key
      });

      const expiryMinutes = options.expiryMinutes || 60;
      const expiresIn = expiryMinutes * 60;

      const signedUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn
      });

      const expiresAt = new Date(Date.now() + expiresIn * 1000);

      return {
        downloadUrl: signedUrl,
        isPublic: false,
        requiresSAS: true,
        expiresIn: expiresIn,
        expiresAt: expiresAt.toISOString(),
        fileName: key.split('/').pop(),
      };
    } catch (error) {
      throw new Error(`S3 download URL generation failed: ${error.message}`);
    }
  }

  async deleteFile(fileUrl) {
    try {
      const { bucketName, key } = this.parseUrl(fileUrl);

      const command = new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key
      });

      await this.s3Client.send(command);
      return true;
    } catch (error) {
      throw new Error(`S3 delete failed: ${error.message}`);
    }
  }

  /**
   * Delete file by bucket name and key
   * @param {string} bucketName - Bucket name
   * @param {string} key - File key (can include prefix like "prefix/filename" or just "filename")
   * @returns {Promise<boolean>} Success status
   */
  async deleteFileByBucketKey(bucketName, key, metadata) {
    try {
      const platformConfig = config.getPlatformConfig(metadata.platformId, metadata.environment);
      let bucketNameValue = platformConfig.bucketName
      let keyValue = key ? bucketName + '/' + key : bucketName;


      const command = new DeleteObjectCommand({
        Bucket: bucketNameValue,
        Key: keyValue
      });

      await this.s3Client.send(command);
      return true;
    } catch (error) {
      throw new Error(`S3 delete by bucket key failed: ${error.message}`);
    }
  }

  async getFileMetadata(fileUrl) {
    try {
      const { bucketName, key } = this.parseUrl(fileUrl);

      const command = new HeadObjectCommand({
        Bucket: bucketName,
        Key: key
      });

      const response = await this.s3Client.send(command);

      return {
        contentType: response.ContentType,
        contentLength: response.ContentLength,
        lastModified: response.LastModified,
        metadata: response.Metadata,
        etag: response.ETag,
        provider: 's3'
      };
    } catch (error) {
      throw new Error(`S3 metadata fetch failed: ${error.message}`);
    }
  }

  async fileExists(fileUrl) {
    try {
      const { bucketName, key } = this.parseUrl(fileUrl);

      const command = new HeadObjectCommand({
        Bucket: bucketName,
        Key: key
      });

      await this.s3Client.send(command);
      return true;
    } catch (error) {
      if (error.name === 'NotFound' || error.code === 'NotFound') {
        return false;
      }
      throw error;
    }
  }

  parseUrl(url) {
    try {
      const urlObj = new URL(url);
      
      let bucketName, key;

      if (urlObj.hostname.includes('.s3.')) {
        bucketName = urlObj.hostname.split('.')[0];
        key = urlObj.pathname.substring(1);
      } else {
        const pathParts = urlObj.pathname.split('/').filter(part => part.length > 0);
        bucketName = pathParts[0];
        key = pathParts.slice(1).join('/');
      }

      return {
        bucketName,
        key,
        region: this.region,
        baseUrl: `https://${bucketName}.s3.${this.region}.amazonaws.com`,
        fullPath: `/${key}`
      };
    } catch (error) {
      throw new Error(`Failed to parse S3 URL: ${error.message}`);
    }
  }

  getProviderName() {
    return 's3';
  }
}

module.exports = AWSS3StorageProvider;