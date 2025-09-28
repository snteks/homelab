# S3 CRUD Interface

React app for S3 CRUD operations with AWS integration.

## Description

This project provides a web-based interface for managing files in an AWS S3 bucket. It allows users to perform Create, Read, Update, and Delete (CRUD) operations on files.

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/s3-crud-interface.git
   ```
2. Install the dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the root directory and add your AWS credentials and S3 bucket information:
   ```
   AWS_ACCESS_KEY_ID=your-access-key-id
   AWS_SECRET_ACCESS_KEY=your-secret-access-key
   AWS_REGION=your-aws-region
   S3_BUCKET_NAME=your-s3-bucket-name
   ```

## Usage

To start the development server, run:

```bash
npm run dev
```

This will start the React client and the Express server concurrently.

The available scripts are:

- `npm run dev`: Starts the development server for both the client and the server.
- `npm run client`: Starts the React development server.
- `npm run server`: Starts the Node.js server with nodemon.
- `npm run build`: Builds the React app for production.
- `npm run start`: Starts the Node.js server.
- `npm run test`: Runs the tests.

## License

This project is licensed under the MIT License.
