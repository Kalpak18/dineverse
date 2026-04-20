import { useRef, useState } from 'react';
import { getPresignedUrl } from '../services/api';
import toast from 'react-hot-toast';

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_MB = 5;

/**
 * ImageUpload
 *
 * Props:
 *   value       — current image URL (string)
 *   onChange    — called with the final S3 URL after upload
 *   uploadType  — 'menu_item' | 'logo' | 'cover'  (default: 'menu_item')
 *   label       — field label text
 *   aspectClass — Tailwind class for the preview box aspect ratio (default 'aspect-square')
 */
export default function ImageUpload({
  value,
  onChange,
  uploadType = 'menu_item',
  label = 'Image',
  aspectClass = 'aspect-square',
}) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  const upload = async (file) => {
    if (!ACCEPTED.includes(file.type)) {
      toast.error('Only JPEG, PNG, WebP and GIF are supported');
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`Image must be under ${MAX_MB} MB`);
      return;
    }

    setUploading(true);
    setProgress(0);

    try {
      // 1. Get presigned URL from our backend
      const { data } = await getPresignedUrl(file.type, file.size, uploadType);
      const { uploadUrl, objectUrl } = data;

      // 2. PUT the file directly to S3 (XMLHttpRequest for progress tracking)
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => (xhr.status === 200 ? resolve() : reject(new Error(`S3 error ${xhr.status}`)));
        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.send(file);
      });

      // 3. Notify parent with the permanent S3 URL
      onChange(objectUrl);
      toast.success('Image uploaded');
    } catch (err) {
      if (import.meta.env.DEV) console.error('Upload error:', err);
      toast.error('Upload failed — please try again');
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) upload(file);
    // Reset so the same file can be re-selected if needed
    e.target.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) upload(file);
  };

  const handleRemove = (e) => {
    e.stopPropagation();
    onChange('');
  };

  return (
    <div>
      {label && <label className="label">{label}</label>}

      <div
        onClick={() => !uploading && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`
          relative w-full ${aspectClass} max-w-[160px] rounded-xl border-2 border-dashed
          flex flex-col items-center justify-center cursor-pointer overflow-hidden
          transition-colors duration-150 select-none
          ${dragOver ? 'border-brand-400 bg-brand-50' : 'border-gray-300 bg-gray-50 hover:border-brand-400 hover:bg-brand-50/40'}
          ${uploading ? 'pointer-events-none' : ''}
        `}
      >
        {/* Existing image preview */}
        {value && !uploading && (
          <>
            <img src={value} alt="Preview" className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/0 hover:bg-black/30 transition-colors flex items-center justify-center group">
              <div className="opacity-0 group-hover:opacity-100 flex gap-2">
                <span className="text-white text-xs bg-black/60 rounded px-2 py-1">Change</span>
                <button
                  type="button"
                  onClick={handleRemove}
                  className="text-white text-xs bg-red-600/80 rounded px-2 py-1"
                >
                  Remove
                </button>
              </div>
            </div>
          </>
        )}

        {/* Upload progress overlay */}
        {uploading && (
          <div className="absolute inset-0 bg-white/90 flex flex-col items-center justify-center gap-2 p-3">
            <div className="w-full bg-gray-200 rounded-full h-1.5">
              <div
                className="bg-brand-500 h-1.5 rounded-full transition-all duration-150"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs text-gray-500">{progress}%</span>
          </div>
        )}

        {/* Placeholder (no image, not uploading) */}
        {!value && !uploading && (
          <div className="flex flex-col items-center gap-1.5 p-3 text-center">
            <UploadIcon />
            <span className="text-xs text-gray-500 leading-tight">
              {dragOver ? 'Drop here' : 'Click or drag to upload'}
            </span>
            <span className="text-[10px] text-gray-400">PNG, JPG, WebP · max {MAX_MB} MB</span>
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(',')}
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}

function UploadIcon() {
  return (
    <svg className="w-7 h-7 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  );
}
