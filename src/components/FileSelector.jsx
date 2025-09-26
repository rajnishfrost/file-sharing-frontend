import React from 'react';

const FileSelector = ({ onFileSelect, selectedFile }) => {
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      onFileSelect(file);
    }
  };

  return (
    <div className="file-selector">
      <label htmlFor="file-input" className="file-label">
        <svg 
          width="48" 
          height="48" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <span>Choose File to Share</span>
      </label>
      <input
        id="file-input"
        type="file"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
      {selectedFile && (
        <div className="selected-file">
          <p>Selected: {selectedFile.name}</p>
          <p>Size: {(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
        </div>
      )}
    </div>
  );
};

export default FileSelector;