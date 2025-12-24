// providers/storage-provider-factory.js
const AzureStorageProvider = require('./azure-storage-provider');
const AWSS3StorageProvider = require('./aws-s3-provider');

class StorageProviderFactory {
  /**
   * Create storage provider instance based on type
   */
  static createProvider(providerType, config) {
    switch (providerType.toLowerCase()) {
      case 'azure':
        return new AzureStorageProvider(config);
      case 'aws':
        return new AWSS3StorageProvider(config);
      case 's3':
        return new AWSS3StorageProvider(config);  
     
      
      default:
        throw new Error(`Unsupported storage provider: ${providerType}`);
    }
  }
}

module.exports = StorageProviderFactory;