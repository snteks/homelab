import React, { useState, useEffect } from 'react';
import { Upload, Trash2, FolderPlus, File, Folder, Download, AlertTriangle, CheckCircle, Loader } from 'lucide-react';

const S3FileManager = () => {
  const [files, setFiles] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState(new Set());
  const [currentPath, setCurrentPath] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [uploadingFiles, setUploadingFiles] = useState([]);
  const [loading, setLoading] = useState(false);

  // Mock S3 service - replace with actual AWS SDK calls
  const mockS3Service = {
    listObjects: async (path = '') => {
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Mock data structure
      const mockData = [
        { key: 'documents/', type: 'folder', name: 'documents', size: 0, lastModified: new Date() },
        { key: 'images/', type: 'folder', name: 'images', size: 0, lastModified: new Date() },
        { key: 'report.pdf', type: 'file', name: 'report.pdf', size: 2048576, lastModified: new Date() },
        { key: 'data.xlsx', type: 'file', name: 'data.xlsx', size: 1024000, lastModified: new Date() },
        { key: 'presentation.pptx', type: 'file', name: 'presentation.pptx', size: 5120000, lastModified: new Date() },
      ];
      
      return mockData.filter(item => 
        item.key.startsWith(path) && 
        item.key.slice(path.length).indexOf('/') === (item.type === 'folder' ? item.key.slice(path.length).length - 1 : -1)
      );
    },

    uploadFile: async (file, path) => {
      // Simulate upload progress and virus scanning
      const uploadProgress = { name: file.name, progress: 0, status: 'uploading', virusScan: 'pending' };
      
      // Progress simulation
      for (let i = 0; i <= 100; i += 20) {
        await new Promise(resolve => setTimeout(resolve, 200));
        uploadProgress.progress = i;
        if (i === 60) {
          uploadProgress.virusScan = 'scanning';
        }
        if (i === 100) {
          uploadProgress.status = 'completed';
          uploadProgress.virusScan = Math.random() > 0.1 ? 'clean' : 'infected';
        }
      }
      
      return uploadProgress;
    },

    deleteFiles: async (keys) => {
      await new Promise(resolve => setTimeout(resolve, 1000));
      return { deleted: keys };
    },

    createFolder: async (folderName, path) => {
      await new Promise(resolve => setTimeout(resolve, 500));
      return { key: `${path}${folderName}/`, created: true };
    }
  };

  // Load files on component mount and path change
  useEffect(() => {
    loadFiles();
  }, [currentPath]);

  const loadFiles = async () => {
    setLoading(true);
    try {
      const fileList = await mockS3Service.listObjects(currentPath);
      setFiles(fileList);
    } catch (error) {
      console.error('Error loading files:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (event) => {
    const selectedFiles = Array.from(event.target.files);
    setUploadingFiles(selectedFiles.map(file => ({ 
      name: file.name, 
      progress: 0, 
      status: 'pending',
      virusScan: 'pending' 
    })));

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      
      setUploadingFiles(prev => prev.map((item, index) => 
        index === i ? { ...item, status: 'uploading' } : item
      ));

      try {
        const result = await mockS3Service.uploadFile(file, currentPath);
        
        setUploadingFiles(prev => prev.map((item, index) => 
          index === i ? result : item
        ));

        if (result.virusScan === 'clean') {
          // Add to files list if clean
          setTimeout(() => {
            setFiles(prev => [...prev, {
              key: `${currentPath}${file.name}`,
              type: 'file',
              name: file.name,
              size: file.size,
              lastModified: new Date()
            }]);
          }, 1000);
        }
      } catch (error) {
        setUploadingFiles(prev => prev.map((item, index) => 
          index === i ? { ...item, status: 'error', virusScan: 'error' } : item
        ));
      }
    }

    // Clear upload status after 3 seconds
    setTimeout(() => {
      setUploadingFiles([]);
    }, 3000);
  };

  const handleDeleteSelected = async () => {
    if (selectedFiles.size === 0) return;
    
    setLoading(true);
    try {
      const keysToDelete = Array.from(selectedFiles);
      await mockS3Service.deleteFiles(keysToDelete);
      
      setFiles(prev => prev.filter(file => !selectedFiles.has(file.key)));
      setSelectedFiles(new Set());
    } catch (error) {
      console.error('Error deleting files:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    
    setLoading(true);
    try {
      await mockS3Service.createFolder(newFolderName, currentPath);
      
      setFiles(prev => [...prev, {
        key: `${currentPath}${newFolderName}/`,
        type: 'folder',
        name: newFolderName,
        size: 0,
        lastModified: new Date()
      }]);
      
      setNewFolderName('');
    } catch (error) {
      console.error('Error creating folder:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleFileSelection = (fileKey) => {
    const newSelected = new Set(selectedFiles);
    if (newSelected.has(fileKey)) {
      newSelected.delete(fileKey);
    } else {
      newSelected.add(fileKey);
    }
    setSelectedFiles(newSelected);
  };

  const navigateToFolder = (folderKey) => {
    setCurrentPath(folderKey);
    setSelectedFiles(new Set());
  };

  const navigateUp = () => {
    const pathParts = currentPath.split('/').filter(Boolean);
    pathParts.pop();
    setCurrentPath(pathParts.length > 0 ? pathParts.join('/') + '/' : '');
    setSelectedFiles(new Set());
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getVirusScanIcon = (status) => {
    switch (status) {
      case 'clean': return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'infected': return <AlertTriangle className="w-4 h-4 text-red-500" />;
      case 'scanning': return <Loader className="w-4 h-4 text-blue-500 animate-spin" />;
      default: return <Loader className="w-4 h-4 text-gray-400" />;
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6 bg-white min-h-screen">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">S3 File Manager</h1>
        <div className="flex items-center space-x-2 text-sm text-gray-600">
          <span>Current path:</span>
          <span className="bg-gray-100 px-2 py-1 rounded font-mono">
            /{currentPath || 'root'}
          </span>
          {currentPath && (
            <button
              onClick={navigateUp}
              className="text-blue-600 hover:text-blue-800 underline"
            >
              Go up
            </button>
          )}
        </div>
      </div>

      {/* Upload Section */}
      <div className="mb-6 p-4 border-2 border-dashed border-gray-300 rounded-lg">
        <div className="flex items-center justify-center">
          <label className="flex flex-col items-center cursor-pointer">
            <Upload className="w-8 h-8 text-gray-400 mb-2" />
            <span className="text-sm text-gray-600 mb-2">Click to upload files</span>
            <input
              type="file"
              multiple
              onChange={handleFileUpload}
              className="hidden"
            />
            <span className="text-xs text-gray-500">Multiple files supported • Virus scanning enabled</span>
          </label>
        </div>
      </div>

      {/* Upload Progress */}
      {uploadingFiles.length > 0 && (
        <div className="mb-6 space-y-2">
          <h3 className="font-semibold text-gray-700">Upload Progress</h3>
          {uploadingFiles.map((file, index) => (
            <div key={index} className="bg-gray-50 p-3 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">{file.name}</span>
                <div className="flex items-center space-x-2">
                  {getVirusScanIcon(file.virusScan)}
                  <span className="text-xs text-gray-500">
                    {file.virusScan === 'clean' ? 'Clean' :
                     file.virusScan === 'infected' ? 'Virus detected!' :
                     file.virusScan === 'scanning' ? 'Scanning...' : 'Pending'}
                  </span>
                </div>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all duration-300 ${
                    file.virusScan === 'infected' ? 'bg-red-500' : 'bg-blue-500'
                  }`}
                  style={{ width: `${file.progress}%` }}
                ></div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Actions Bar */}
      <div className="mb-6 flex flex-wrap gap-4 items-center">
        <div className="flex items-center space-x-2">
          <input
            type="text"
            placeholder="New folder name"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            onClick={handleCreateFolder}
            disabled={!newFolderName.trim() || loading}
            className="flex items-center space-x-1 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <FolderPlus className="w-4 h-4" />
            <span>Create Folder</span>
          </button>
        </div>

        <button
          onClick={handleDeleteSelected}
          disabled={selectedFiles.size === 0 || loading}
          className="flex items-center space-x-1 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          <span>Delete Selected ({selectedFiles.size})</span>
        </button>
      </div>

      {/* Files List */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader className="w-6 h-6 text-gray-400 animate-spin mr-2" />
            <span className="text-gray-600">Loading...</span>
          </div>
        ) : files.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Folder className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>No files or folders found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {files.map((file) => (
              <div
                key={file.key}
                className={`flex items-center p-4 hover:bg-gray-50 transition-colors ${
                  selectedFiles.has(file.key) ? 'bg-blue-50' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedFiles.has(file.key)}
                  onChange={() => toggleFileSelection(file.key)}
                  className="mr-3 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                
                <div className="flex items-center flex-1 min-w-0">
                  {file.type === 'folder' ? (
                    <Folder className="w-5 h-5 text-blue-500 mr-3 flex-shrink-0" />
                  ) : (
                    <File className="w-5 h-5 text-gray-500 mr-3 flex-shrink-0" />
                  )}
                  
                  <div className="flex-1 min-w-0">
                    {file.type === 'folder' ? (
                      <button
                        onClick={() => navigateToFolder(file.key)}
                        className="text-blue-600 hover:text-blue-800 font-medium truncate block w-full text-left"
                      >
                        {file.name}
                      </button>
                    ) : (
                      <span className="font-medium text-gray-900 truncate block">
                        {file.name}
                      </span>
                    )}
                    
                    <div className="flex items-center space-x-4 text-sm text-gray-500 mt-1">
                      {file.type === 'file' && (
                        <span>{formatFileSize(file.size)}</span>
                      )}
                      <span>{file.lastModified.toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>

                {file.type === 'file' && (
                  <button className="ml-4 p-2 text-gray-400 hover:text-gray-600 transition-colors">
                    <Download className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default S3FileManager;