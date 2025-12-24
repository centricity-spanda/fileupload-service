# File Upload Service - Architecture & Flow Documentation

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Request Flow](#request-flow)
4. [Components](#components)
5. [API Endpoints](#api-endpoints)
6. [Storage Providers](#storage-providers)
7. [Configuration](#configuration)
8. [Authentication & Authorization](#authentication--authorization)

## Overview

This is a **multi-tenant file upload service** that provides a unified interface for uploading, downloading, and managing files across different cloud storage providers (AWS S3 and Azure Blob Storage). The service supports multiple platforms and environments, allowing each platform to use different storage providers per environment.

### Key Features

- **Multi-tenant architecture**: Supports multiple platforms (e.g., OneDigital, Invictus, Brokerage)
- **Multi-environment support**: UAT, Preprod, and Production environments
- **Provider abstraction**: Seamlessly switches between AWS S3 and Azure Blob Storage
- **Platform-based authentication**: Uses platform ID header for tenant identification
- **Environment-based routing**: Automatically selects storage provider based on platform and environment
- **File operations**: Upload, download, delete, metadata retrieval, and existence checks

## Architecture

### High-Level Architecture

```
┌─────────────────┐
│   Client App    │
└────────┬────────┘
         │ HTTP Request
         │ (X-Platform-ID header)
         ▼
┌─────────────────────────────────────┐
│         Express Server              │
│  ┌───────────────────────────────┐  │
│  │   Platform Auth Middleware    │  │
│  │  - Validates Platform ID      │  │
│  │  - Determines Environment     │  │
│  │  - Loads Platform Config      │  │
│  └──────────────┬────────────────┘  │
│                 │                    │
│  ┌──────────────▼────────────────┐  │
│  │      File Routes              │  │
│  │  - Upload, Download, Delete   │  │
│  │  - Metadata, Exists           │  │
│  └──────────────┬────────────────┘  │
└─────────────────┼────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│   Multi-Tenant Storage Service      │
│  ┌───────────────────────────────┐  │
│  │   Provider Cache              │  │
│  │   (platform-env → provider)   │  │
│  └──────────────┬────────────────┘  │
│                 │                    │
│  ┌──────────────▼────────────────┐  │
│  │  Storage Provider Factory     │  │
│  │  - Creates provider instances │  │
│  └──────────────┬────────────────┘  │
└─────────────────┼────────────────────┘
                  │
         ┌────────┴────────┐
         │                 │
         ▼                 ▼
┌─────────────┐   ┌─────────────┐
│ AWS S3      │   │ Azure Blob  │
│ Provider    │   │ Provider    │
└─────────────┘   └─────────────┘
```

### Directory Structure

```
fileupload-service/
├── index.js                          # Application entry point
├── config/
│   └── platform-config.js           # Platform & environment configuration
├── middlewares/
│   └── platform-auth.js             # Platform authentication middleware
├── routes/
│   └── file-routes.js               # File operation routes
├── service/
│   └── multi-tenant-storage-service.js  # Core service layer
├── providers/
│   ├── abstract-storage-provider.js     # Abstract base class
│   ├── aws-s3-provider.js               # AWS S3 implementation
│   ├── azure-storage-provider.js        # Azure Blob implementation
│   └── storage-provider-factory.js      # Provider factory
└── utils/
    ├── sanitizeFileName.js              # File name sanitization
    └── sanitizeBucketName.js            # Bucket name sanitization
```

## Request Flow

### 1. Upload File Flow

```
1. Client Request
   POST /api/files/upload-file
   Headers: X-Platform-ID: "onedigital"
   Body: multipart/form-data (file, bucketName, prefix, access, etc.)

2. Express Server
   ├─> CORS validation
   ├─> Body parsing (multer for file upload)
   └─> Routes to /api/files/upload-file

3. Platform Auth Middleware
   ├─> Extracts X-Platform-ID header
   ├─> Reads NODE_ENV (environment: uat/preprod/prod)
   ├─> Loads platform config from platform-config.js
   ├─> Validates platform exists for environment
   └─> Attaches platformContext to req:
       {
         platformId: "onedigital",
         environment: "uat",
         config: { provider: "azure", connectionString: "...", ... }
       }

4. File Route Handler
   ├─> Validates file upload
   ├─> Extracts parameters (bucketName, prefix, access, metadata)
   ├─> Sanitizes bucket name and file name
   └─> Calls storageService.uploadFile()

5. Multi-Tenant Storage Service
   ├─> Gets platformId and environment from context
   ├─> Checks provider cache for existing instance
   │   └─> If not cached:
   │       ├─> Loads config for platform+environment
   │       ├─> Creates provider via StorageProviderFactory
   │       └─> Caches provider instance
   ├─> Enriches metadata with platform context
   └─> Calls provider.uploadFile()

6. Storage Provider (AWS S3 or Azure)
   ├─> Creates/validates bucket/container
   ├─> Uploads file with metadata
   ├─> Sets ACL/permissions based on access parameter
   └─> Returns permanent URL

7. Response
   └─> Returns JSON with fileUrl, bucketName, metadata, etc.
```

### 2. Download URL Generation Flow

```
1. Client Request
   POST /api/files/get-download-url
   Headers: X-Platform-ID: "onedigital"
   Body: { fileUrl: "...", expiryMinutes: 60 }

2. Platform Auth Middleware
   └─> Same as upload flow

3. File Route Handler
   ├─> Validates fileUrl parameter
   └─> Calls storageService.generateDownloadUrl()

4. Multi-Tenant Storage Service
   ├─> Gets cached provider for platform+environment
   └─> Calls provider.generateDownloadUrl()

5. Storage Provider
   ├─> Parses file URL to extract bucket/key
   ├─> Checks if file is public or private
   ├─> If public: returns direct URL
   ├─> If private: generates presigned URL (S3) or SAS token (Azure)
   └─> Returns download URL with expiry information

6. Response
   └─> Returns JSON with downloadUrl, expiresAt, etc.
```

### 3. Delete File Flow

```
1. Client Request
   DELETE /api/files/delete-file
   Headers: X-Platform-ID: "onedigital"
   Body: { fileUrl: "..." }

2. Platform Auth Middleware
   └─> Same as upload flow

3. File Route Handler
   ├─> Validates fileUrl parameter
   ├─> Checks if file exists via storageService.fileExists()
   └─> Calls storageService.deleteFile()

4. Multi-Tenant Storage Service
   ├─> Gets cached provider
   └─> Calls provider.deleteFile()

5. Storage Provider
   ├─> Parses file URL
   ├─> Deletes object from bucket/container
   └─> Returns success status

6. Response
   └─> Returns success message
```

## Components

### 1. Express Server (`index.js`)

**Responsibilities:**

- Initializes Express application
- Configures CORS with allowed origins
- Sets up body parsing middleware
- Registers health check endpoint
- Mounts file routes at `/api/files`

**Key Configuration:**

- Port: `process.env.PORT` (default: 3000)
- CORS: Configurable via `ALLOWED_ORIGINS` environment variable
- Environment: Set via `NODE_ENV`

### 2. Platform Authentication Middleware (`middlewares/platform-auth.js`)

**Responsibilities:**

- Validates `X-Platform-ID` header presence
- Determines environment from `NODE_ENV`
- Loads platform configuration
- Attaches `platformContext` to request object

**Request Context Added:**

```javascript
req.platformContext = {
  platformId: string, // From X-Platform-ID header
  environment: string, // From NODE_ENV (uat/preprod/prod)
  config: object, // Platform config (provider, credentials, etc.)
};
```

### 3. Platform Configuration (`config/platform-config.js`)

**Structure:**

```javascript
{
  platforms: {
    'platform-id': {
      name: 'Platform Name',
      environments: {
        uat: { provider: 'azure', ... },
        preprod: { provider: 'azure', ... },
        prod: { provider: 's3', ... }
      }
    }
  }
}
```

**Responsibilities:**

- Stores platform and environment configurations
- Maps platform IDs to storage provider configurations
- Provides `getPlatformConfig(platformId, environment)` method

### 4. File Routes (`routes/file-routes.js`)

**Endpoints:**

- `POST /upload-file` - Upload a file (logical bucket + optional prefix)
- `POST /get-download-url` - Generate temporary download URL
- `POST /download-file` - Download file directly (proxied)
- `DELETE /delete-file` - Delete file by URL
- `DELETE /delete-by-bucket-key` - Delete file by bucket and key
- `GET /metadata` - Get file metadata
- `GET /exists` - Check if file exists

**Features:**

- Uses Multer for file uploads (memory storage, 100MB limit)
- Validates request parameters
- Sanitizes file and bucket names
- Handles errors and returns appropriate status codes

### 5. Multi-Tenant Storage Service (`service/multi-tenant-storage-service.js`)

**Responsibilities:**

- Manages provider instances (caching)
- Routes requests to appropriate storage provider
- Enriches metadata with platform context
- Provides unified interface for all file operations

**Provider Caching:**

- Uses `Map` to cache provider instances
- Cache key: `"${platformId}-${environment}"`
- Providers are created on first use and reused

**Methods:**

- `uploadFile()` - Upload file to storage
- `generateDownloadUrl()` - Generate temporary download URL
- `deleteFile()` - Delete file by URL
- `deleteFileByBucketKey()` - Delete file by bucket and key
- `getFileMetadata()` - Get file metadata
- `fileExists()` - Check file existence
- `getProviderInfo()` - Get provider information

### 6. Storage Provider Factory (`providers/storage-provider-factory.js`)

**Responsibilities:**

- Creates provider instances based on provider type
- Supports: `azure`, `aws`, `s3`

**Factory Pattern:**

```javascript
StorageProviderFactory.createProvider(providerType, config);
```

### 7. Abstract Storage Provider (`providers/abstract-storage-provider.js`)

**Purpose:**

- Defines interface contract for all storage providers
- Ensures consistent API across providers

**Required Methods:**

- `uploadFile(bucketName, fileData, prefix, fileName, metadata, access)`
- `generateDownloadUrl(permanentUrl, options)`
- `deleteFile(fileUrl)`
- `deleteFileByBucketKey(bucketName, key)`
- `getFileMetadata(fileUrl)`
- `fileExists(fileUrl)`
- `isBucketPublic(bucketName)`
- `parseUrl(url)`
- `getProviderName()`

### 8. AWS S3 Provider (`providers/aws-s3-provider.js`)

**Implementation Details:**

- Uses `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`
- Implements all abstract methods for S3 operations
- Generates presigned URLs for private files
- Handles bucket creation if needed
- Sets ACL based on access parameter

### 9. Azure Blob Storage Provider (`providers/azure-storage-provider.js`)

**Implementation Details:**

- Uses `@azure/storage-blob`
- Implements all abstract methods for Azure operations
- Generates SAS tokens for private files
- Handles container creation if needed
- Sets access policy based on access parameter

### 10. Utility Functions

**`utils/sanitizeFileName.js`:**

- Converts to lowercase
- Replaces spaces with hyphens
- Removes invalid characters
- Ensures safe file names for storage

**`utils/sanitizeBucketName.js`:**

- Trims whitespace
- Converts to lowercase
- Removes trailing hyphens
- Ensures valid bucket/container names

## API Endpoints

### POST /api/files/upload-file

Upload a file to cloud storage.

**Headers:**

- `X-Platform-ID`: Platform identifier (required)

**Body (multipart/form-data):**

- `file`: File to upload (required)
- `bucketName`: **Container(In Azure) / top-level folder(In S3)** (required, In Azure it will be the container name but in S3 the bucket name will be taken from config and this will be the top level folder after bucket)
- `prefix`: **Nested folder prefix** under the logical bucket (optional, e.g., `"Invoices/2024"`)
- `access`: "public" or "private" (optional, default: "private")
- `userId`: User ID (optional)
- `metadata`: JSON string with additional metadata (optional)

**Response:**

```json
{
  "success": true,
  "data": {
    "fileUrl": "https://...",
    "bucketName": "my-bucket",
    "prefix": "Documents",
    "fileName": "1234567890-document.pdf",
    "access": "private",
    "isPublic": false,
    "fileSize": 1024,
    "platform": "onedigital",
    "environment": "uat",
    "provider": "azure"
  }
}
```

### POST /api/files/get-download-url

Generate a temporary download URL for a file.

**Headers:**

- `X-Platform-ID`: Platform identifier (required)

**Body:**

```json
{
  "fileUrl": "https://...",
  "expiryMinutes": 60
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "downloadUrl": "https://...",
    "expiresAt": "2024-01-01T12:00:00.000Z",
    "requiresSAS": true
  }
}
```

### POST /api/files/download-file

Download a file directly through the service (proxy mode).

**Headers:**

- `X-Platform-ID`: Platform identifier (required)

**Body:**

```json
{
  "fileUrl": "https://...",
  "expiryMinutes": 5
}
```

**Response:**

- File stream with appropriate headers

### DELETE /api/files/delete-file

Delete a file by its URL.

**Headers:**

- `X-Platform-ID`: Platform identifier (required)

**Body:**

```json
{
  "fileUrl": "https://..."
}
```

**Response:**

```json
{
  "success": true,
  "message": "File deleted successfully"
}
```

### DELETE /api/files/delete-by-bucket-key

Delete a file by logical bucket name and key (path).

**Headers:**

- `X-Platform-ID`: Platform identifier (required)

**Body:**

```json
{
  "bucketName": "documents", // logical bucket (top-level folder)
  "key": "invoices/2024/file.pdf" // key/path *inside* this logical bucket (does NOT repeat bucketName)
}
```

**Response:**

```json
{
  "success": true,
  "message": "File deleted successfully"
}
```

### GET /api/files/metadata

Get file metadata.

**Headers:**

- `X-Platform-ID`: Platform identifier (required)

**Query Parameters:**

- `fileUrl`: File URL (required)

**Response:**

```json
{
  "success": true,
  "data": {
    "size": 1024,
    "contentType": "application/pdf",
    "lastModified": "2024-01-01T12:00:00.000Z",
    ...
  }
}
```

### GET /api/files/exists

Check if a file exists.

**Headers:**

- `X-Platform-ID`: Platform identifier (required)

**Body:**

```json
{
  "fileUrl": "https://..."
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "exists": true
  }
}
```

## Storage Providers

### Provider Selection

The service automatically selects the storage provider based on:

1. **Platform ID** (from `X-Platform-ID` header)
2. **Environment** (from `NODE_ENV`)

**Example:**

- Platform: `onedigital`
- Environment: `uat`
- Provider: `azure` (from config)
- Result: Azure Blob Storage provider is used

### Provider Configuration

Each platform-environment combination has its own configuration:

**Azure Configuration:**

```javascript
{
  provider: 'azure',
  connectionString: process.env.XXX_CONNECTION_STRING,
  accountName: process.env.XXX_ACCOUNT_NAME,
  accountKey: process.env.XXX_ACCOUNT_KEY
}
```

**AWS S3 Configuration:**

```javascript
{
  provider: 's3',
  accessKeyId: process.env.XXX_AWS_ACCESS_KEY,
  secretAccessKey: process.env.XXX_AWS_SECRET_KEY,
  region: 'ap-south-1',
  // NOTE: For S3, the *physical* bucket must be globally unique and is configured here:
  bucketName: process.env.XXX_AWS_BUCKET_NAME
}
```

When talking to the API:

- `bucketName` in the request is a **logical bucket / folder name** chosen by the client (e.g., `"documents"`).
- The service uses the configured, globally unique S3 bucket from `platform-config.js` and builds S3 keys as:
  - **Upload:** `key = "<logicalBucket>/<optionalPrefix>/<fileName>"`
  - **Delete-by-bucket-key:** expects:
    - `bucketName` = logical bucket (e.g., `"documents"`)
    - `key` = _path inside that logical bucket_ (e.g., `"invoices/2024/file.pdf"`, **without** repeating `documents/`).

### Adding New Providers

To add a new storage provider:

1. Create a new provider class extending `AbstractStorageProvider`
2. Implement all required methods
3. Add provider type to `StorageProviderFactory`
4. Update platform configuration with new provider

## Configuration

### Environment Variables

The service uses environment-specific `.env` files:

- `.env` - Development
- `.env.uat` - UAT environment
- `.env.preprod` - Preprod environment
- `.env.prod` - Production environment

**Required Variables:**

```env
NODE_ENV=uat|preprod|prod
PORT=3000
ALLOWED_ORIGINS=https://example.com,https://app.example.com

# Platform-specific variables (examples)
ONEDIGITAL_UAT_API_KEY=...
ONEDIGITAL_UAT_CONNECTION_STRING=...
ONEDIGITAL_UAT_ACCOUNT_NAME=...
ONEDIGITAL_UAT_ACCOUNT_KEY=...

INVICTUS_UAT_AWS_ACCESS_KEY=...
INVICTUS_UAT_AWS_SECRET_KEY=...
INVICTUS_UAT_AWS_REGION=ap-south-1
```

### Platform Configuration

Platforms are configured in `config/platform-config.js`. To add a new platform:

```javascript
'new-platform': {
  name: 'New Platform',
  environments: {
    uat: {
      apiKey: process.env.NEW_PLATFORM_UAT_API_KEY,
      provider: 's3',
      accessKeyId: process.env.NEW_PLATFORM_UAT_AWS_ACCESS_KEY,
      secretAccessKey: process.env.NEW_PLATFORM_UAT_AWS_SECRET_KEY,
      region: 'ap-south-1'
    },
    prod: {
      // Production config
    }
  }
}
```

## Authentication & Authorization

### Current Implementation

- **Platform Authentication**: Validates `X-Platform-ID` header
- **Environment Detection**: Uses `NODE_ENV` to determine environment
- **API Key Verification**: Currently commented out (can be enabled)

### Security Considerations

1. **Platform ID Validation**: Only registered platforms can access the service
2. **Environment Isolation**: Each environment has separate configurations
3. **Provider Isolation**: Each platform-environment uses separate storage credentials
4. **CORS Protection**: Configurable allowed origins

### Enabling API Key Authentication

To enable API key authentication, uncomment the validation code in `middlewares/platform-auth.js`:

```javascript
// Verify API key matches the platform and environment
if (config.apiKey !== apiKey) {
  return res.status(403).json({
    success: false,
    error: "Invalid API key for platform and environment",
  });
}
```

And extract the API key from headers:

```javascript
const apiKey = req.headers["x-api-key"];
```

## Data Flow Summary

1. **Request arrives** → Express server
2. **CORS & Body parsing** → Middleware layer
3. **Platform authentication** → Validates platform, loads config
4. **Route handler** → Validates input, sanitizes data
5. **Storage service** → Gets/caches provider instance
6. **Provider** → Executes storage operation (AWS/Azure)
7. **Response** → Returns result to client

## Error Handling

The service implements comprehensive error handling:

- **400**: Bad Request (missing parameters, invalid input)
- **403**: Forbidden (authentication failures)
- **404**: Not Found (platform not found, file not found)
- **500**: Internal Server Error (storage failures, unexpected errors)

All errors return JSON format:

```json
{
  "success": false,
  "error": "Error message"
}
```
