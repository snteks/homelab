# Project Documentation: S3 CRUD Interface

## 1. Overview

This project is a web-based file manager for an AWS S3 bucket. It provides a user-friendly interface to perform Create, Read, Update, and Delete (CRUD) operations on files and folders within a specified S3 bucket.

### 1.1. Features

- **File and Folder Management:** List, upload, and delete files and folders.
- **Navigation:** Navigate through the folder structure of the S3 bucket.
- **Drag-and-Drop Uploads:** (Future implementation) Allow users to drag and drop files for uploading.
- **Virus Scanning:** (Simulated) Scan uploaded files for viruses before they are stored in the S3 bucket.
- **Progress Indicators:** Show progress for file uploads.

## 2. Technical Stack

- **Frontend:** React, TypeScript
- **Backend:** Node.js, Express
- **AWS Integration:** AWS SDK for JavaScript (v3)
- **Styling:** Tailwind CSS (via `lucide-react` for icons)

## 3. Project Structure

```
.env
package.json
package-lock.json
s3-crud-app.tsx
README.md
PROJECT_DOCUMENTATION.md
```

- **`.env`:** Contains environment variables for AWS credentials and S3 bucket configuration.
- **`package.json`:** Defines project metadata, dependencies, and scripts.
- **`s3-crud-app.tsx`:** The main React component for the file manager interface. **Note:** This file currently uses a mock S3 service for local development.
- **`README.md`:** A brief overview of the project.
- **`PROJECT_DOCUMENTATION.md`:** This file.

## 4. Getting Started

### 4.1. Prerequisites

- Node.js and npm installed
- An AWS account with an S3 bucket

### 4.2. Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/s3-crud-interface.git
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   Create a `.env` file in the root directory and add the following:
   ```
   AWS_ACCESS_KEY_ID=your-access-key-id
   AWS_SECRET_ACCESS_KEY=your-secret-access-key
   AWS_REGION=your-aws-region
   S3_BUCKET_NAME=your-s3-bucket-name
   ```

### 4.3. Running the Application

To start the development server (which runs both the client and server concurrently), use:

```bash
npm run dev
```

## 5. Development

### 5.1. Frontend

The frontend is a single React component (`s3-crud-app.tsx`) that manages the state of the file manager. It uses `lucide-react` for icons and is styled with Tailwind CSS utility classes.

**Note on the Mock S3 Service:** The `mockS3Service` object within `s3-crud-app.tsx` simulates the behavior of the AWS SDK. This allows for local development without needing to connect to AWS. To connect to your S3 bucket, you will need to replace the calls to `mockS3Service` with the appropriate AWS SDK v3 commands.

### 5.2. Backend

The backend is an Express server that will handle the communication with AWS. The server-side code is not yet implemented in this version of the project.

## 6. Future Enhancements

- **Implement the Express backend:** Create the API endpoints to handle file operations with the AWS SDK.
- **Replace the mock S3 service:** Connect the frontend to the backend API.
- **Implement drag-and-drop uploads:** Enhance the user experience for file uploads.
- **Add user authentication:** Secure the file manager with user login.

## 7. License

This project is licensed under the MIT License.
