// config/platforms.config.js
module.exports = {
    platforms: {
      'onedigital': {
        name: 'OneDigital',
        environments: {
          uat: {
            apiKey: process.env.ONEDIGITAL_UAT_API_KEY,
            provider: 'azure',
            connectionString: process.env.ONEDIGITAL_UAT_CONNECTION_STRING,
            accountName: process.env.ONEDIGITAL_UAT_ACCOUNT_NAME,
            accountKey: process.env.ONEDIGITAL_UAT_ACCOUNT_KEY
          },
          preprod: {
            apiKey: process.env.ONEDIGITAL_PREPROD_API_KEY,
            provider: 'azure',
            connectionString: process.env.ONEDIGITAL_PREPROD_CONNECTION_STRING,
            accountName: process.env.ONEDIGITAL_PREPROD_ACCOUNT_NAME,
            accountKey: process.env.ONEDIGITAL_PREPROD_ACCOUNT_KEY
          },
          prod: {
            apiKey: process.env.ONEDIGITAL_PROD_API_KEY,
            provider: 's3',
            accessKeyId: process.env.ONEDIGITAL_PROD_AWS_ACCESS_KEY,
            secretAccessKey: process.env.ONEDIGITAL_PROD_AWS_SECRET_KEY,
            region: 'ap-south-1',
            bucketName: process.env.ONEDIGITAL_PROD_BUCKET_NAME
          }
        }
      },
      'invictus': {
        name: 'Invictus',
        environments: {
          uat: {
            apiKey: process.env.INVICTUS_UAT_API_KEY,
            provider: 's3',
            accessKeyId: process.env.INVICTUS_UAT_AWS_ACCESS_KEY,
            secretAccessKey: process.env.INVICTUS_UAT_AWS_SECRET_KEY,
            region: process.env.INVICTUS_UAT_AWS_REGION || 'ap-south-1'
          },
          preprod: {
            apiKey: process.env.INVICTUS_PREPROD_API_KEY,
            provider: 's3',
            accessKeyId: process.env.INVICTUS_PREPROD_AWS_ACCESS_KEY,
            secretAccessKey: process.env.INVICTUS_PREPROD_AWS_SECRET_KEY,
            region: process.env.INVICTUS_PREPROD_AWS_REGION || 'ap-south-1'
          },
          prod: {
            apiKey: process.env.INVICTUS_PROD_API_KEY,
            provider: 's3',
            accessKeyId: process.env.INVICTUS_PROD_AWS_ACCESS_KEY,
            secretAccessKey: process.env.INVICTUS_PROD_AWS_SECRET_KEY,
            region: process.env.INVICTUS_PROD_AWS_REGION || 'ap-south-1'
          }
        }
      },
      'brokerage': {
        name: 'Brokerage',
        environments: {
          uat: {
            apiKey: process.env.BROKERAGE_UAT_API_KEY,
            provider: 'azure',
            connectionString: process.env.BROKERAGE_UAT_CONNECTION_STRING,
            accountName: process.env.BROKERAGE_UAT_ACCOUNT_NAME,
            accountKey: process.env.BROKERAGE_UAT_ACCOUNT_KEY
          },
          preprod: {
            apiKey: process.env.BROKERAGE_PREPROD_API_KEY,
            provider: 'azure',
            connectionString: process.env.BROKERAGE_PREPROD_CONNECTION_STRING,
            accountName: process.env.BROKERAGE_PREPROD_ACCOUNT_NAME,
            accountKey: process.env.BROKERAGE_PREPROD_ACCOUNT_KEY
          },
          prod: {
            apiKey: process.env.BROKERAGE_PROD_API_KEY,
            provider: 'azure',
            connectionString: process.env.BROKERAGE_PROD_CONNECTION_STRING,
            accountName: process.env.BROKERAGE_PROD_ACCOUNT_NAME,
            accountKey: process.env.BROKERAGE_PROD_ACCOUNT_KEY
          }
        }
      }
    },
  
    /**
     * Get platform config
     */
    getPlatformConfig(platformId, environment) {
      const platform = this.platforms[platformId];
      
      if (!platform) {
        throw new Error(`Platform '${platformId}' not found`);
      }
  
      const envConfig = platform.environments[environment];
      
      if (!envConfig) {
        throw new Error(`Environment '${environment}' not found for platform '${platformId}'`);
      }
  
      return {
        platformName: platform.name,
        ...envConfig
      };
    }
  };