# File Upload Service - Flow Documentation

## Overview

This document explains how .NET applications interact with the File Upload Service API endpoints. It describes the flow from the .NET client's perspective, including request preparation, API calls, and response handling.

## High-Level Flow

### 1. .NET Application to File Upload Service Communication

```
.NET Application
    │
    │ HTTP Request
    │ (Headers: X-Platform-ID)
    │
    ▼
File Upload Service (Node.js)
    │
    │ Storage Operations
    │
    ▼
Cloud Storage Provider
(AWS S3 / Azure Blob Storage)
```

## Detailed Flow Scenarios

### Scenario 1: Uploading a File

**Flow Steps:**

1. **.NET Application Preparation**

   - The .NET application receives a file from the user (via upload form, API, or file system)
   - The application identifies which platform it belongs to (e.g., OneDigital, Invictus, Brokerage)
   - The application determines the **logical bucket name** (top-level folder) under which the file should be stored (e.g., `"documents"`)
   - The application may specify an optional **folder prefix inside that logical bucket** (e.g., `"Invoices/2024"`)
   - The application decides whether the file should be public or private

2. **Request Preparation**

   - The .NET application constructs a multipart form-data request
   - The file content is included in the request body with field name "file"
   - Additional form fields are added:
     - `bucketName`: **Logical bucket name / top-level folder** (e.g., `"documents"`)
     - `prefix`: Optional **nested folder structure inside the logical bucket** (e.g., `"invoices/2024"`)
     - `access`: Either "public" or "private"
     - `userId`: Optional user identifier
     - `metadata`: Optional JSON string with additional metadata
   - Required header is set:
     - `X-Platform-ID`: Identifies which platform is making the request

3. **HTTP Request Execution**

   - The .NET application sends a POST request to `/api/files/upload-file` endpoint
   - The request includes the multipart form-data with the file and parameters
   - The `X-Platform-ID` header allows the service to identify the tenant and load appropriate configuration

4. **Service Processing**

   - The File Upload Service receives the request
   - Platform authentication middleware extracts the platform ID from the header
   - The service determines the environment from NODE_ENV (uat, preprod, or prod)
   - The service loads the platform configuration (which storage provider to use for this platform-environment combination)
   - The service validates the request (ensures file is present, logical bucketName is provided, access value is valid)
   - File name and logical bucket name are sanitized to ensure they meet storage provider requirements
   - The appropriate storage provider (AWS S3 or Azure Blob Storage) is selected and initialized
   - **For S3 specifically**:
     - The *physical* bucket name is taken from configuration (and is globally unique)
     - The actual S3 object key is built as:
       - `"<logicalBucket>/<optionalPrefix>/<sanitizedFileName>"`
   - The file is uploaded to the cloud storage provider
   - Metadata is enriched with platform context (platform ID, environment, provider name)

5. **Response to .NET Application**

   - The service returns a JSON response containing:
     - Success status
     - Permanent file URL (this is the URL that should be stored in the .NET application's database)
     - Bucket name (logical bucket name used in the request)
     - File name (sanitized with timestamp prefix)
     - Prefix/folder path
     - Access level (public/private)
     - File size
     - Platform and environment information
     - Storage provider name

6. **.NET Application Handling**
   - The .NET application receives the response
   - The application stores the permanent file URL in its database (typically associated with a record)
   - The application can use this URL later for downloading, sharing, or deletion
   - If the upload fails, the application handles the error response appropriately

### Scenario 2: Generating a Download URL

**Flow Steps:**

1. **.NET Application Preparation**

   - A user requests to download a file
   - The .NET application retrieves the permanent file URL from its database (stored during upload)
   - The application determines how long the download URL should be valid (expiry time in minutes)

2. **Request Preparation**

   - The .NET application constructs a JSON request body containing:
     - `fileUrl`: The permanent file URL retrieved from the database
     - `expiryMinutes`: How long the download URL should be valid (optional, defaults to 1 minute)
   - Required header is set:
     - `X-Platform-ID`: Identifies which platform is making the request

3. **HTTP Request Execution**

   - The .NET application sends a POST request to `/api/files/get-download-url` endpoint
   - The request body contains the file URL and optional expiry time

4. **Service Processing**

   - The File Upload Service receives the request
   - Platform authentication middleware identifies the platform and environment
   - The service loads the appropriate storage provider configuration
   - The service parses the file URL to extract bucket/container and file key information
   - The service checks whether the file is public or private:
     - **If public**: The service returns the direct URL (no signing needed)
     - **If private**: The service generates a temporary signed URL:
       - For AWS S3: Generates a presigned URL with expiration
       - For Azure Blob Storage: Generates a SAS (Shared Access Signature) token URL with expiration

5. **Response to .NET Application**

   - The service returns a JSON response containing:
     - Success status
     - `downloadUrl`: The temporary URL that can be used to download the file
     - `expiresAt`: Timestamp indicating when the URL will expire
     - `requiresSAS`: Boolean indicating if the URL is signed (true for private files)

6. **.NET Application Handling**
   - The .NET application receives the temporary download URL
   - The application can:
     - Return this URL to the user's browser for direct download
     - Use this URL in a redirect response
     - Embed this URL in an email or notification
     - Display the URL with expiration information to the user
   - The application should note that this URL is temporary and will expire

### Scenario 3: Downloading a File (Proxied Through Service)

**Flow Steps:**

1. **.NET Application Preparation**

   - Similar to generating a download URL, the .NET application has the permanent file URL
   - Instead of getting a temporary URL, the application wants to proxy the download through the service

2. **Request Preparation**

   - The .NET application constructs a JSON request body containing:
     - `fileUrl`: The permanent file URL
     - `expiryMinutes`: Optional expiry time (defaults to 5 minutes)
   - Required header is set:
     - `X-Platform-ID`: Identifies the platform

3. **HTTP Request Execution**

   - The .NET application sends a POST request to `/api/files/download-file` endpoint

4. **Service Processing**

   - The File Upload Service processes the request similar to generating a download URL
   - However, instead of returning a URL, the service:
     - Generates or retrieves the temporary download URL from the storage provider
     - Makes an HTTP request to fetch the file from the storage provider
     - Streams the file content directly back to the .NET application
     - Sets appropriate headers (Content-Type, Content-Disposition, Content-Length)

5. **Response to .NET Application**

   - The service returns a binary file stream (not JSON)
   - Headers indicate the file type and suggest a filename for download
   - The .NET application receives the file content as the response body

6. **.NET Application Handling**
   - The .NET application receives the file stream
   - The application can:
     - Forward the stream to the user's browser
     - Save the file to disk
     - Process the file content
     - Return it as a download response in an API

### Scenario 4: Deleting a File

**Flow Steps:**

1. **.NET Application Preparation**

   - A user requests to delete a file, or the application needs to clean up files
   - The .NET application retrieves the permanent file URL from its database

2. **Request Preparation**

   - The .NET application constructs a JSON request body containing:
     - `fileUrl`: The permanent file URL to delete
   - Required header is set:
     - `X-Platform-ID`: Identifies the platform

3. **HTTP Request Execution**

   - The .NET application sends a DELETE request to `/api/files/delete-file` endpoint
   - The request body contains the file URL

4. **Service Processing**

   - The File Upload Service receives the request
   - Platform authentication middleware identifies the platform and environment
   - The service loads the appropriate storage provider
   - The service first checks if the file exists
   - If the file exists, the service deletes it from the cloud storage provider
   - If the file doesn't exist, the service returns an error

5. **Response to .NET Application**

   - The service returns a JSON response containing:
     - Success status
     - Message confirming deletion (or error if file not found)

6. **.NET Application Handling**
   - The .NET application receives the response
   - If successful, the application may:
     - Remove the file reference from its database
     - Update records that reference this file
     - Log the deletion event
   - If unsuccessful, the application handles the error appropriately

### Scenario 5: Deleting a File by Bucket and Key

**Flow Steps:**

1. **.NET Application Preparation**

   - The .NET application knows the **logical bucket name** and file key (path) but may not have the full URL stored

2. **Request Preparation**

   - The .NET application constructs a JSON request body containing:
     - `bucketName`: The **logical bucket name / top-level folder** (e.g., `"documents"`)
     - `key`: The **file key/path inside that logical bucket** (e.g., `"invoices/2024/file.pdf"` or `"file.pdf"`)
   - Required header is set:
     - `X-Platform-ID`: Identifies the platform

3. **HTTP Request Execution**

   - The .NET application sends a DELETE request to `/api/files/delete-by-bucket-key` endpoint

4. **Service Processing**

   - Similar to delete-by-URL, but uses logical bucket name and key directly
   - The service:
     - Uses the configured, globally unique S3 bucket for the platform/environment
     - Constructs the S3 object key as:
       - `"<bucketName>/<key>"`
       - Example: `bucketName = "documents"`, `key = "invoices/2024/file.pdf"` → S3 key: `"documents/invoices/2024/file.pdf"`

5. **Response and Handling**
   - Same as Scenario 4

### Scenario 6: Checking File Existence

**Flow Steps:**

1. **.NET Application Preparation**

   - The .NET application wants to verify if a file still exists in storage before performing operations

2. **Request Preparation**

   - The .NET application constructs a request with:
     - `fileUrl`: The permanent file URL to check
   - Required header is set:
     - `X-Platform-ID`: Identifies the platform

3. **HTTP Request Execution**

   - The .NET application sends a GET request to `/api/files/exists` endpoint
   - The file URL is sent in the request body

4. **Service Processing**

   - The File Upload Service checks with the storage provider if the file exists
   - Returns a boolean result

5. **Response and Handling**
   - The service returns JSON with exists status
   - The .NET application uses this information to decide next steps

### Scenario 7: Getting File Metadata

**Flow Steps:**

1. **.NET Application Preparation**

   - The .NET application needs information about a file (size, content type, last modified date, etc.)

2. **Request Preparation**

   - The .NET application constructs a GET request
   - Query parameter:
     - `fileUrl`: The permanent file URL
   - Required header is set:
     - `X-Platform-ID`: Identifies the platform

3. **HTTP Request Execution**

   - The .NET application sends a GET request to `/api/files/metadata` endpoint with the file URL as a query parameter

4. **Service Processing**

   - The File Upload Service queries the storage provider for file metadata
   - Returns detailed information about the file

5. **Response and Handling**
   - The service returns JSON with file metadata
   - The .NET application can use this information for display, validation, or processing

## Platform Identification Flow

**How the Service Determines Platform and Storage Provider:**

1. **Platform ID from Header**

   - The .NET application sends `X-Platform-ID` header with every request
   - This header contains the platform identifier (e.g., "onedigital", "invictus", "brokerage")

2. **Environment Determination**

   - The File Upload Service reads the `NODE_ENV` environment variable
   - This determines whether the request should go to UAT, Preprod, or Production storage
   - The .NET application doesn't need to specify the environment explicitly

3. **Configuration Lookup**

   - The service looks up the platform configuration using platform ID and environment
   - Each platform-environment combination has its own storage provider configuration
   - For example:
     - OneDigital UAT → Azure Blob Storage
     - OneDigital Production → AWS S3
     - Invictus UAT → AWS S3
     - Brokerage Preprod → Azure Blob Storage

4. **Provider Selection**
   - Based on the configuration, the appropriate storage provider is selected and initialized
   - The provider uses the credentials and settings from the configuration
   - Provider instances are cached for performance

## Request-Response Cycle

**Standard Request Pattern:**

1. .NET application prepares request with `X-Platform-ID` header
2. Request is sent to File Upload Service endpoint
3. Service authenticates and identifies platform
4. Service selects appropriate storage provider
5. Service performs storage operation
6. Service returns JSON response (or file stream for downloads)
7. .NET application processes response

## Error Handling Flow

**When Errors Occur:**

1. **Validation Errors (400)**

   - Missing required parameters (file, bucketName, fileUrl, etc.)
   - Invalid parameter values (invalid access value, etc.)
   - .NET application should validate inputs before sending

2. **Authentication Errors (400/404)**

   - Missing `X-Platform-ID` header
   - Platform not found for the current environment
   - .NET application should ensure correct platform ID is sent

3. **File Not Found (400)**

   - File doesn't exist when trying to delete or check existence
   - .NET application should handle gracefully

4. **Server Errors (500)**
   - Storage provider failures
   - Network issues
   - Unexpected errors
   - .NET application should implement retry logic and error logging

**Error Response Format:**

- All errors return JSON with `success: false` and `error` message
- .NET application should parse error responses and handle appropriately

## Best Practices for .NET Applications

1. **Store Permanent URLs**: Always store the permanent file URL returned from upload in your database, not temporary download URLs

2. **Handle Expiration**: Temporary download URLs expire. Generate new ones when needed rather than storing them

3. **Error Handling**: Implement proper error handling and retry logic for network failures

4. **Platform ID Management**: Ensure the correct platform ID is sent with every request based on the application's context

5. **File Size Limits**: Be aware of the 100MB file size limit for uploads

6. **Content-Type**: The service preserves content types, but ensure correct MIME types are set during upload if needed

7. **Bucket Management**: The service uses existing buckets/containers. Ensure buckets exist before uploading files

8. **Metadata Storage**: Store essential metadata in your .NET application's database since retrieving it requires an API call

## Summary

The File Upload Service acts as a middleware layer between .NET applications and cloud storage providers. The .NET application identifies itself via the `X-Platform-ID` header, and the service automatically routes requests to the appropriate storage provider (AWS S3 or Azure Blob Storage) based on platform and environment configuration. The .NET application doesn't need to know which storage provider is being used or manage storage credentials directly - it simply calls the API endpoints and receives file URLs and operation results.
